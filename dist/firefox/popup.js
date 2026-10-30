const api = globalThis.browser ?? globalThis.chrome;
const $ = (s) => document.querySelector(s);
const fmt = (n) => (!n ? "" : n > 1e9 ? (n / 1e9).toFixed(2) + " GB" : n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : (n / 1e3).toFixed(0) + " KB");
function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}
const send = (m) => api.runtime.sendMessage(m);
let tab;

function say(text) { $("#msg").textContent = text || ""; }

async function renderFound() {
  const list = (await send({ type: "list", tabId: tab.id })) || [];
  const box = $("#found");
  box.replaceChildren();
  if (!list.length) box.append(el("div", { className: "s", textContent: "Nothing detected yet — press play on the video." }));
  for (const item of list.slice().reverse()) {
    let name = item.url;
    try { name = decodeURIComponent(new URL(item.url).pathname.split("/").pop() || item.url).slice(0, 60); } catch {}
    const b = el("button", { textContent: "Download" });
    b.onclick = async () => {
      const r = await send({ type: "download", tabId: tab.id, item });
      say(r?.ok ? "" : r?.error);
    };
    box.append(el("div", { className: "row" },
      el("div", { className: "info" },
        el("div", { className: "t", textContent: name, title: item.url }),
        el("div", { className: "s" }, el("span", { className: "badge", textContent: item.kind.toUpperCase() }), fmt(item.size))),
      b));
  }
}

async function renderJobs() {
  const r = await send({ type: "status" });
  const box = $("#jobs");
  if (!r?.ok) { box.replaceChildren(el("div", { className: "s", textContent: r?.error || "" })); return; }
  box.replaceChildren(...r.jobs.map((j) => {
    const p = el("progress", { max: 1, value: j.progress >= 0 ? j.progress : undefined });
    const line = j.status === "error" ? "Error: " + j.error
      : j.status === "downloading" ? `${Math.round((j.progress || 0) * 100)}% ${j.speed ? "· " + fmt(j.speed) + "/s" : ""}`
      : j.status;
    const row = el("div", { className: "row" },
      el("div", { className: "info" },
        el("div", { className: "t", textContent: j.title || j.url, title: j.file || "" }),
        j.status === "downloading" ? p : "",
        el("div", { className: "s", textContent: line })));
    if (j.status === "downloading") {
      const c = el("button", { className: "sec", textContent: "Stop" });
      c.onclick = () => send({ type: "cancel", id: j.id });
      row.append(c);
    }
    return row;
  }));
}

(async () => {
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  $("#ytdlp").onclick = async () => { const r = await send({ type: "ytdlp", tabId: tab.id }); say(r?.ok ? "" : r?.error); };
  $("#folder").onclick = () => send({ type: "open-folder" });
  renderFound();
  renderJobs();
  setInterval(renderJobs, 1000);
  setInterval(renderFound, 2500);
})();
