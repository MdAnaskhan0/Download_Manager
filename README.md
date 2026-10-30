# VidGrab (Brave + Firefox video downloader for Windows)

## 0. Requirements
- Node.js 18+  (https://nodejs.org)
- Optional but recommended: put `ffmpeg.exe` and `yt-dlp.exe` in the `bin` folder (or add them to PATH)
  - ffmpeg is needed for HLS (.m3u8) / DASH (.mpd) and merging
  - yt-dlp covers YouTube, Facebook, Instagram, TikTok, X, Vimeo, and 1000+ more sites

## 1. Build the extensions
    node build.js
Creates `dist\brave` and `dist\firefox`.

## 2. Brave
1. Open `brave://extensions`, turn on **Developer mode**, click **Load unpacked**, pick `dist\brave`.
2. Copy the extension **ID** shown on the card.
3. In PowerShell inside this folder:  `.\install.ps1 -BraveExtensionId <ID>`
   (If PowerShell blocks the script: `powershell -ExecutionPolicy Bypass -File .\install.ps1 -BraveExtensionId <ID>`)
Note: the ID changes if you move the `dist\brave` folder; re-run install.ps1 if it does.

## 3. Firefox
1. Run `.\install.ps1` (registers the Firefox host; the Firefox ID is fixed: vidgrab@local.dev).
2. Open `about:debugging#/runtime/this-firefox` -> **Load Temporary Add-on** -> pick `dist\firefox\manifest.json`.
3. Open `about:addons` -> VidGrab -> **Permissions** -> enable **Access your data for all websites**
   (Firefox MV3 doesn't grant this automatically; detection won't work without it).
Temporary add-ons vanish on restart. For permanent use: sign it as "unlisted" on addons.mozilla.org, or use Firefox Developer Edition/Nightly with `xpinstall.signatures.required = false`.

## 4. Use it
- Play a video, the toolbar icon shows a badge with detected streams. Click it to pick one.
- Hover a video player and click the blue **Download this video** button.
- Files go to `Downloads\VidGrab`.
