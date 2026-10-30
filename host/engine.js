
const fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");

const jobFile = process.argv[2];
const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));
const DL_DIR = path.join(os.homedir(), "Downloads", "VidGrab");
const BIN = path.join(__dirname, "..", "bin");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CONNECTIONS = 8, PIECE = 4 * 1024 * 1024;
fs.mkdirSync(DL_DIR, { recursive: true });

let lastSave = 0;
function save(patch, force) {
  Object.assign(job, patch);
  const now = Date.now();
  if (!force && now - lastSave < 400) return;
  lastSave = now;
  try { fs.writeFileSync(jobFile, JSON.stringify(job)); } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safe = (s) => (s || "video").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "video";
const EXT = { "video/mp4": ".mp4", "video/webm": ".webm", "video/x-matroska": ".mkv", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/webm": ".weba" };

function extFor() {
  if (job.kind === "hls" || job.kind === "dash") return ".mp4";
  if (EXT[job.type]) return EXT[job.type];
  const m = /\.(mp4|webm|mkv|mov|m4v|flv|mp3|m4a|aac|ogg|opus)(\?|#|$)/i.exec(job.url);
  return m ? "." + m[1].toLowerCase() : ".mp4";
}
function uniquePath(name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(DL_DIR, name), i = 1;
  while (fs.existsSync(p)) p = path.join(DL_DIR, `${base} (${i++})${ext}`);
  return p;
}
function requestHeaders() {
  const h = job.headers || {};
  const out = { "User-Agent": h["user-agent"] || UA };
  const ref = h.referer || job.pageUrl;
  if (ref) out.Referer = ref;
  if (h.cookie) out.Cookie = h.cookie;
  if (h.origin) out.Origin = h.origin;
  return out;
}

// ---------- direct file ----------
async function downloadFile() {
  const H = requestHeaders();
  const out = uniquePath(safe(job.title) + extFor());
  save({ file: out });

  const probe = await fetch(job.url, { headers: { ...H, Range: "bytes=0-0" }, redirect: "follow" });
  let size = 0, ranged = false;
  if (probe.status === 206) {
    const m = /\/(\d+)$/.exec(probe.headers.get("content-range") || "");
    if (m) { size = +m[1]; ranged = true; }
  } else if (probe.status === 200) {
    size = +(probe.headers.get("content-length") || 0);
  } else throw new Error("HTTP " + probe.status);
  try { await probe.body?.cancel(); } catch {}

  const fh = await fs.promises.open(out, "w");
  let done = 0, lastB = 0, lastT = Date.now();
  const tick = setInterval(() => {
    const now = Date.now();
    const speed = Math.round((done - lastB) / ((now - lastT) / 1000));
    lastB = done; lastT = now;
    save({ progress: size ? done / size : -1, speed, size, downloaded: done }, true);
  }, 1000);

  try {
    if (ranged && size > 2 * PIECE) {
      const pieces = Math.ceil(size / PIECE);
      let next = 0;
      const fetchPiece = async (start, end) => {
        let got = 0;
        try {
          const r = await fetch(job.url, { headers: { ...H, Range: `bytes=${start}-${end}` } });
          if (r.status !== 206) throw new Error("Server ignored range request (" + r.status + ")");
          let pos = start;
          for await (const c of r.body) {
            await fh.write(c, 0, c.length, pos);
            pos += c.length; got += c.length; done += c.length;
          }
          if (pos !== end + 1) throw new Error("short piece");
        } catch (e) { done -= got; throw e; }
      };
      const worker = async () => {
        while (true) {
          const i = next++;
          if (i >= pieces) return;
          const start = i * PIECE, end = Math.min(size - 1, start + PIECE - 1);
          for (let attempt = 0; ; attempt++) {
            try { await fetchPiece(start, end); break; }
            catch (e) { if (attempt >= 4) throw e; await sleep(1000 * (attempt + 1)); }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONNECTIONS, pieces) }, worker));
    } else {
      const r = await fetch(job.url, { headers: H });
      if (!r.ok) throw new Error("HTTP " + r.status);
      let pos = 0;
      for await (const c of r.body) { await fh.write(c, 0, c.length, pos); pos += c.length; done += c.length; }
    }
  } finally {
    clearInterval(tick);
    await fh.close();
  }
  save({ size: done, downloaded: done });
}

// ---------- external tools ----------
const bin = (n) => { const p = path.join(BIN, n + ".exe"); return fs.existsSync(p) ? p : n; };

function runProc(cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let tail = "";
    const feed = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      if (onLine) s.split(/[\r\n]+/).forEach((l) => l && onLine(l));
    };
    p.stdout.on("data", feed);
    p.stderr.on("data", feed);
    p.on("error", (e) => reject(e.code === "ENOENT" ? new Error(path.basename(cmd) + " not found. Put it in the bin folder or add it to PATH.") : e));
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(path.basename(cmd) + " failed (code " + c + "): " + tail.slice(-300)))));
  });
}

async function runFfmpeg() {
  const H = requestHeaders();
  const out = uniquePath(safe(job.title) + ".mp4");
  save({ file: out, progress: -1 });
  const extra = Object.entries(H).filter(([k]) => k !== "User-Agent").map(([k, v]) => `${k}: ${v}\r\n`).join("");
  let dur = 0;
  await runProc(bin("ffmpeg"), ["-y", "-hide_banner", "-user_agent", H["User-Agent"], "-headers", extra, "-i", job.url, "-c", "copy", out], (l) => {
    const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(l);
    if (d) dur = +d[1] * 3600 + +d[2] * 60 + +d[3];
    const t = /time=(\d+):(\d+):([\d.]+)/.exec(l);
    if (t && dur) save({ progress: Math.min(0.99, (+t[1] * 3600 + +t[2] * 60 + +t[3]) / dur) });
  });
}

async function runYtdlp() {
  save({ progress: -1 });
  const args = ["--no-playlist", "--newline", "--no-quiet", "--no-simulate", "--merge-output-format", "mp4",
    "-o", path.join(DL_DIR, "%(title).120s [%(id)s].%(ext)s"), "--print", "after_move:filepath"];
  const ff = path.join(BIN, "ffmpeg.exe");
  if (fs.existsSync(ff)) args.push("--ffmpeg-location", ff);
  args.push(job.url);
  await runProc(bin("yt-dlp"), args, (l) => {
    const p = /\[download\]\s+([\d.]+)%/.exec(l);
    if (p) save({ progress: Math.min(0.99, +p[1] / 100) });
    if (!l.startsWith("[") && fs.existsSync(l)) save({ file: l });
  });
}

// ---------- main ----------
(async () => {
  try {
    save({ status: "downloading", pid: process.pid, progress: 0 }, true);
    if (job.kind === "file") await downloadFile();
    else if (job.kind === "hls" || job.kind === "dash") await runFfmpeg();
    else if (job.kind === "ytdlp") await runYtdlp();
    else throw new Error("unknown kind " + job.kind);
    delete job.headers; // don't leave cookies on disk
    save({ status: "done", progress: 1, speed: 0 }, true);
  } catch (e) {
    delete job.headers;
    save({ status: "error", error: String(e.message || e) }, true);
  }
})();
