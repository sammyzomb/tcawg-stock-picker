param(
    [ValidateRange(1, 65535)][int]$Port = 3456,
    [string]$NodePath = "",
    [string]$ProjectRoot = ""
)
$ErrorActionPreference = "Stop"
$appRoot = Split-Path $PSScriptRoot -Parent
if (-not $NodePath) {
    $bundledNode = Join-Path $appRoot "runtime\node.exe"
    if (Test-Path -LiteralPath $bundledNode) { $NodePath = $bundledNode } else { $NodePath = (Get-Command node -ErrorAction Stop).Source }
}
$major = & $NodePath -p "process.versions.node.split('.')[0]"
if ($LASTEXITCODE -ne 0 -or [int]$major -lt 16) { throw "Node.js 16.20.2 or newer is required." }
if ([Environment]::OSVersion.Version -lt [Version]"10.0" -and [int]$major -ne 16) { throw "On Server 2012 R2 use the isolated Node.js 16.20.2 runtime." }
$probe = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Any), $Port
try { $probe.Start() } catch { throw "Port $Port is unavailable. Choose another port; do not stop the existing project." } finally { $probe.Stop() }
$logDir = Join-Path $appRoot "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location -LiteralPath $appRoot
$nodeArgs = @((Join-Path $appRoot "bin\stock-web.js"), "--host", "0.0.0.0", "--port", $Port)
if ($ProjectRoot) { $nodeArgs += @("--project", $ProjectRoot) }
& $NodePath @nodeArgs *>> (Join-Path $logDir ("web-{0}.log" -f (Get-Date -Format "yyyy-MM-dd")))
exit $LASTEXITCODE
