
param(
  [string]$BraveExtensionId = "",
  [string]$FirefoxExtensionId = "vidgrab@local.dev",
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$name   = "com.vidgrab.host"
$bat    = Join-Path $PSScriptRoot "host\host.bat"
$appDir = Join-Path $env:LOCALAPPDATA "VidGrab"
$braveKey = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$name"
$ffKey    = "HKCU:\Software\Mozilla\NativeMessagingHosts\$name"

if ($Uninstall) {
  Remove-Item $braveKey, $ffKey -ErrorAction SilentlyContinue
  Remove-Item $appDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Uninstalled."; return
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 18+ is required. Install it from https://nodejs.org" }
New-Item -ItemType Directory -Force $appDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false

if ($BraveExtensionId) {
  $m = [ordered]@{ name=$name; description="VidGrab native host"; path=$bat; type="stdio"; allowed_origins=@("chrome-extension://$BraveExtensionId/") }
  $p = Join-Path $appDir "$name.brave.json"
  [IO.File]::WriteAllText($p, ($m | ConvertTo-Json -Depth 5), $utf8)
  New-Item -Path $braveKey -Value $p -Force | Out-Null
  Write-Host "Brave host registered."
} else { Write-Host "Skipped Brave (no -BraveExtensionId given)." }

$m = [ordered]@{ name=$name; description="VidGrab native host"; path=$bat; type="stdio"; allowed_extensions=@($FirefoxExtensionId) }
$p = Join-Path $appDir "$name.firefox.json"
[IO.File]::WriteAllText($p, ($m | ConvertTo-Json -Depth 5), $utf8)
New-Item -Path $ffKey -Value $p -Force | Out-Null
Write-Host "Firefox host registered."
