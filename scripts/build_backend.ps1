$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$buildRoot = Join-Path $root 'build'
$distPath = Join-Path $buildRoot 'backend'
$workPath = Join-Path $buildRoot 'pyinstaller-work'
$specPath = Join-Path $buildRoot 'pyinstaller-spec'
$serverDist = Join-Path $distPath 'player-server'

function Assert-InWorkspace($path) {
  $resolvedRoot = [System.IO.Path]::GetFullPath($root)
  $resolvedPath = [System.IO.Path]::GetFullPath($path)
  if (-not $resolvedPath.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch path outside workspace: $resolvedPath"
  }
}

Assert-InWorkspace $distPath
Assert-InWorkspace $workPath
Assert-InWorkspace $specPath

if (Test-Path -LiteralPath $distPath) { Remove-Item -LiteralPath $distPath -Recurse -Force }
if (Test-Path -LiteralPath $workPath) { Remove-Item -LiteralPath $workPath -Recurse -Force }
if (Test-Path -LiteralPath $specPath) { Remove-Item -LiteralPath $specPath -Recurse -Force }

New-Item -ItemType Directory -Force -Path $distPath, $workPath, $specPath | Out-Null

python -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name player-server `
  --console `
  --distpath $distPath `
  --workpath $workPath `
  --specpath $specPath `
  --hidden-import websocket `
  --hidden-import qrcode `
  --hidden-import qrcode.image.pil `
  --hidden-import Crypto.Cipher.AES `
  --hidden-import Crypto.Util.Padding `
  --add-data "$root\index.html;." `
  --add-data "$root\css;css" `
  --add-data "$root\js;js" `
  --add-data "$root\assets\app-icon.svg;assets" `
  --add-data "$root\THIRD_PARTY_NOTICES.md;." `
  "$root\serve.py"

if (-not (Test-Path -LiteralPath (Join-Path $serverDist 'player-server.exe'))) {
  throw 'PyInstaller did not produce player-server.exe'
}

Write-Host "Backend built at $serverDist"
