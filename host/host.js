// Native messaging host: browser <-> desktop. Tiny launcher; real work happens in engine.js
const fs = require("fs"), path = require("path"), os = require("os");
const { spawn } = require("child_process");

const APP_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "VidGrab");
const JOBS = path.join(APP_DIR, "jobs");
const DL_DIR = path.join(os.homedir(), "Downloads", "VidGrab");
fs.mkdirSync(JOBS, { recursive: true });
fs.mkdirSync(DL_DIR, { recursive: true });

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

const readJob = (f) => { try { return JSON.parse(fs.readFileSync(path.join(JOBS, f), "utf8")); } catch { return null; } };

async function handle(msg) {
  switch (msg.cmd) {
    case "ping":
      return { ok: true, version: "0.1.0" };

    case "download": {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const file = path.join(JOBS, id + ".json");
      fs.writeFileSync(file, JSON.stringify({ ...msg, cmd: undefined, id, status: "queued", created: Date.now() }));
      const child = spawn(process.execPath, [path.join(__dirname, "engine.js"), file], {
        detached: true, stdio: "ignore", windowsHide: true,
      });
      child.unref();
      return { ok: true, id };
    }

    case "status": {
      const jobs = fs.readdirSync(JOBS).filter((f) => f.endsWith(".json")).map(readJob).filter(Boolean)
        .sort((a, b) => b.created - a.created).slice(0, 15)
        .map(({ headers, ...rest }) => rest); // never send cookies back to the browser
      return { ok: true, jobs };
    }

    case "cancel": {
      const j = readJob(String(msg.id).replace(/[^a-z0-9]/gi, "") + ".json");
      if (j?.pid) {
        spawn("taskkill", ["/PID", String(j.pid), "/T", "/F"], { windowsHide: true });
        j.status = "cancelled";
        delete j.headers;
        fs.writeFileSync(path.join(JOBS, j.id + ".json"), JSON.stringify(j));
      }
      return { ok: true };
    }

    case "open-folder":
      spawn("explorer.exe", [DL_DIR], { detached: true, stdio: "ignore" }).unref();
      return { ok: true };
  }
  return { ok: false, error: "unknown cmd" };
}

let buf = Buffer.alloc(0);
process.stdin.on("data", async (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const n = buf.readUInt32LE(0);
    if (buf.length < 4 + n) break;
    const body = buf.subarray(4, 4 + n);
    buf = buf.subarray(4 + n);
    try { send(await handle(JSON.parse(body.toString("utf8")))); }
    catch (e) { send({ ok: false, error: String(e.message || e) }); }
  }
});
