$ErrorActionPreference = "Stop"
$appRoot = Split-Path $PSScriptRoot -Parent
$releaseId = Get-Date -Format "yyyyMMdd-HHmmss"
$releaseRoot = Join-Path $appRoot "dist\stock-picker-$releaseId"
New-Item -ItemType Directory -Path $releaseRoot | Out-Null
# Deliberate allowlist: no preview data, settings, .env, indexes or archives.
foreach ($directory in @("bin", "lib", "server", "web", "node_modules")) {
    Copy-Item -LiteralPath (Join-Path $appRoot $directory) -Destination $releaseRoot -Recurse
}
$scriptDest = Join-Path $releaseRoot "scripts"
New-Item -ItemType Directory -Path $scriptDest | Out-Null
foreach ($name in @("start-lan.ps1", "install-lan-task.ps1", "init-server-data.ps1", "smoke-legacy.cjs")) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $scriptDest
}
foreach ($name in @("package.json", "package-lock.json", "Windows內網部署.md")) {
    Copy-Item -LiteralPath (Join-Path $appRoot $name) -Destination $releaseRoot
}
$runtimeDest = Join-Path $releaseRoot "runtime"
New-Item -ItemType Directory -Path $runtimeDest | Out-Null
foreach ($name in @("node.exe", "LICENSE")) {
    Copy-Item -LiteralPath (Join-Path $appRoot ".runtime\node-v16.20.2-win-x64\$name") -Destination $runtimeDest
}
& (Join-Path $runtimeDest "node.exe") (Join-Path $scriptDest "smoke-legacy.cjs")
if ($LASTEXITCODE -ne 0) { throw "Release integration checks failed." }
Compress-Archive -LiteralPath $releaseRoot -DestinationPath "$releaseRoot.zip"
Write-Output "Release ready: $releaseRoot"
