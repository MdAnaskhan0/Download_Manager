// node build.js  ->  dist/brave and dist/firefox
const fs = require("fs"), path = require("path");
const src = path.join(__dirname, "src");
for (const t of ["brave", "firefox"]) {
  const out = path.join(__dirname, "dist", t);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of ["background.js", "content.js", "popup.html", "popup.js"]) fs.copyFileSync(path.join(src, f), path.join(out, f));
  fs.copyFileSync(path.join(src, `manifest.${t}.json`), path.join(out, "manifest.json"));
  console.log("built", out);
}
