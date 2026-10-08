param([string]$ProjectRoot = "D:\stock-picker-data")
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Path $ProjectRoot -Force | Out-Null
# Generate neutral configuration locally, outside the release. Never overwrite
# existing settings or import keys, passwords or NAS index files.
$defaults = @{
    "stock-picker.config.json" = '{"slotsFile":"image-slots.json","archiveDir":"public/images","videoArchiveDir":"public/videos","envFile":".env"}'
    "image-slots.json" = '{"slots":[]}'
    "nas_config.json" = '{"searchService":{"url":"http://192.168.3.2:8088","timeoutMs":30000}}'
    ".env" = "# Add API keys here locally. No credentials are included in the release."
}
foreach ($name in $defaults.Keys) {
    $destination = Join-Path $ProjectRoot $name
    if (-not (Test-Path -LiteralPath $destination)) {
        [System.IO.File]::WriteAllText($destination, $defaults[$name], (New-Object System.Text.UTF8Encoding -ArgumentList $false))
    }
}
Write-Output "Data directory ready: $ProjectRoot (existing files preserved)."
