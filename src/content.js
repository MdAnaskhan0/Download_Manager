// Floating "Download this video" button over any <video> element (IDM style).
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (window.__vidgrab) return;
  window.__vidgrab = true;

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;display:none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      button{font:600 12px/1 system-ui,sans-serif;color:#fff;background:#1a73e8;border:0;border-radius:6px;
             padding:8px 12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)}
      button:hover{background:#1558b0}
    </style>
    <button>⬇ Download this video</button>`;
  const btn = root.querySelector("button");
  document.documentElement.appendChild(host);

  let timer = 0;
  document.addEventListener("mousemove", (e) => {
    if (timer) return;
    timer = setTimeout(() => (timer = 0), 120);
    let hit = null;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      if (r.width > 200 && r.height > 120 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        hit = r;
        break;
      }
    }
    if (hit) {
      host.style.display = "block";
      host.style.left = Math.max(0, hit.right - 190) + "px";
      host.style.top = Math.max(0, hit.top + 10) + "px";
    } else if (!host.matches(":hover")) {
      host.style.display = "none";
    }
  }, true);

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    btn.textContent = "Sending…";
    try {
      const res = await api.runtime.sendMessage({ type: "page-download" });
      btn.textContent = res?.ok ? "✔ Added to VidGrab" : "✖ " + (res?.error || "Failed");
    } catch (err) {
      btn.textContent = "✖ " + err.message;
    }
    setTimeout(() => (btn.textContent = "⬇ Download this video"), 2500);
  });
})();
