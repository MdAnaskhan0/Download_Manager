// Works in Brave (Chromium MV3 service worker) and Firefox (MV3 event page).
const api = globalThis.browser ?? globalThis.chrome;
const HOST = "com.vidgrab.host";

const MEDIA_EXT = /\.(mp4|webm|mkv|mov|m4v|flv|m3u8|mpd|mp3|m4a|aac|ogg|opus)(\?|#|$)/i;
const SEGMENT_EXT = /\.(ts|m4s|cmfv|cmfa)(\?|#|$)/i;
// Sites where raw stream sniffing gives partial/split streams -> use yt-dlp on the page URL
const SKIP_HOST = /(^|\.)googlevideo\.com$/i;
const YTDLP_FIRST = /(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|twitter\.com|x\.com|vimeo\.com|dailymotion\.com|twitch\.tv)$/i;
const KEEP_HEADERS = ["referer", "user-agent", "cookie", "origin"];

const reqHeaders = new Map();
let chain = Promise.resolve();
const enqueue = (fn) => (chain = chain.then(fn).catch((e) => console.warn("[VidGrab]", e)));
const key = (id) => `t${id}`;

async function getList(tabId) {
  const r = await api.storage.session.get(key(tabId));
  return r[key(tabId)] || [];
}
async function setList(tabId, list) {
  await api.storage.session.set({ [key(tabId)]: list });
  try {
    await api.action.setBadgeText({ tabId, text: list.length ? String(list.length) : "" });
    await api.action.setBadgeBackgroundColor({ tabId, color: "#1a73e8" });
  } catch {}
}

// ---- 1. capture request headers (referer / cookie / UA) ----
function onSend(d) {
  const h = {};
  for (const x of d.requestHeaders || []) {
    const n = x.name.toLowerCase();
    if (KEEP_HEADERS.includes(n)) h[n] = x.value;
  }
  reqHeaders.set(d.requestId, h);
}
const filter = { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other"] };
try {
  // Chromium needs extraHeaders to expose Cookie/Referer; Firefox rejects that value.
  api.webRequest.onBeforeSendHeaders.addListener(onSend, filter, ["requestHeaders", "extraHeaders"]);
} catch {
  api.webRequest.onBeforeSendHeaders.addListener(onSend, filter, ["requestHeaders"]);
}
const cleanup = (d) => reqHeaders.delete(d.requestId);
api.webRequest.onCompleted.addListener(cleanup, { urls: ["<all_urls>"] });
api.webRequest.onErrorOccurred.addListener(cleanup, { urls: ["<all_urls>"] });

// ---- 2. detect media responses ----
const hv = (d, n) => d.responseHeaders?.find((h) => h.name.toLowerCase() === n)?.value || "";

api.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0 || d.statusCode >= 400) return;
    let host = "";
    try { host = new URL(d.url).hostname; } catch { return; }
    if (SKIP_HOST.test(host)) return;

    const ct = hv(d, "content-type").split(";")[0].trim().toLowerCase();
    if (SEGMENT_EXT.test(d.url) || ct === "video/mp2t" || ct === "video/iso.segment") return;

    let kind = null;
    if (/mpegurl/.test(ct) || /\.m3u8(\?|#|$)/i.test(d.url)) kind = "hls";
    else if (ct === "application/dash+xml" || /\.mpd(\?|#|$)/i.test(d.url)) kind = "dash";
    else if (/^(video|audio)\//.test(ct) || (ct === "application/octet-stream" && MEDIA_EXT.test(d.url))) kind = "file";
    if (!kind) return;

    let size = parseInt(hv(d, "content-length")) || 0;
    const cr = /\/(\d+)$/.exec(hv(d, "content-range"));
    if (cr) size = +cr[1];
    if (kind === "file" && size && size < 200 * 1024) return; // ignore tiny clips/ads pings

    const item = { url: d.url, kind, type: ct, size, headers: reqHeaders.get(d.requestId) || {}, time: Date.now() };
    reqHeaders.delete(d.requestId);

    enqueue(async () => {
      const list = await getList(d.tabId);
      if (list.some((i) => i.url === item.url)) return;
      try {
        const t = await api.tabs.get(d.tabId);
        item.title = t.title;
        item.pageUrl = t.url;
      } catch {}
      list.push(item);
      if (list.length > 40) list.shift();
      await setList(d.tabId, list);
    });
  },
  filter,
  ["responseHeaders"]
);

// reset list when the tab navigates / closes
api.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) enqueue(() => setList(tabId, []));
});
api.tabs.onRemoved.addListener((tabId) => enqueue(() => api.storage.session.remove(key(tabId))));

// ---- 3. talk to the desktop app through Native Messaging ----
async function native(msg) {
  try {
    return await api.runtime.sendNativeMessage(HOST, msg);
  } catch (e) {
    return { ok: false, error: "Desktop app not reachable: " + (e.message || e) + " (did you run install.ps1?)" };
  }
}

function pickBest(list) {
  const files = list.filter((i) => i.kind === "file").sort((a, b) => (b.type.startsWith("video") - a.type.startsWith("video")) || b.size - a.size);
  return files[0] || list.find((i) => i.kind === "hls") || list.find((i) => i.kind === "dash") || null;
}

const jobFrom = (item, tab) => ({
  cmd: "download",
  kind: item.kind,
  url: item.url,
  headers: item.headers || {},
  type: item.type,
  pageUrl: item.pageUrl || tab?.url,
  title: item.title || tab?.title,
});
const ytdlpJob = (tab) => ({ cmd: "download", kind: "ytdlp", url: tab.url, pageUrl: tab.url, title: tab.title, headers: {} });

async function handle(msg, sender) {
  switch (msg.type) {
    case "list":
      return getList(msg.tabId);
    case "download": {
      const tab = await api.tabs.get(msg.tabId);
      return native(jobFrom(msg.item, tab));
    }
    case "ytdlp": {
      const tab = await api.tabs.get(msg.tabId);
      return native(ytdlpJob(tab));
    }
    case "page-download": { // from the floating button over the player
      const tab = sender.tab;
      let host = "";
      try { host = new URL(tab.url).hostname; } catch {}
      if (YTDLP_FIRST.test(host)) return native(ytdlpJob(tab));
      const best = pickBest(await getList(tab.id));
      return native(best ? jobFrom(best, tab) : ytdlpJob(tab));
    }
    case "status":
      return native({ cmd: "status" });
    case "cancel":
      return native({ cmd: "cancel", id: msg.id });
    case "open-folder":
      return native({ cmd: "open-folder" });
  }
  return { ok: false, error: "unknown message" };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});
