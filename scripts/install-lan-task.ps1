# Run on the destination server in an elevated Windows PowerShell window.
param(
    [ValidateRange(1, 65535)][int]$Port = 3456,
    [string]$NodePath = "",
    [string]$ProjectRoot = "D:\stock-picker-data"
)
$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$windowsPrincipal = New-Object Security.Principal.WindowsPrincipal -ArgumentList $identity
if (-not $windowsPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run Windows PowerShell as administrator." }
$appRoot = Split-Path $PSScriptRoot -Parent
if (-not $NodePath) {
    $bundledNode = Join-Path $appRoot "runtime\node.exe"
    if (Test-Path -LiteralPath $bundledNode) { $NodePath = $bundledNode } else { $NodePath = (Get-Command node -ErrorAction Stop).Source }
}
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$major = & $NodePath -p "process.versions.node.split('.')[0]"
if ($LASTEXITCODE -ne 0 -or [int]$major -lt 16) { throw "Node.js 16.20.2 or newer is required." }
if ([Environment]::OSVersion.Version -lt [Version]"10.0" -and [int]$major -ne 16) { throw "On Server 2012 R2 use the isolated Node.js 16.20.2 runtime." }
$taskName = "TcawgStockPicker-LAN"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw "Task $taskName already exists. Inspect it before changing it." }
$probe = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Any), $Port
try { $probe.Start() } catch { throw "Port $Port is unavailable. Use -Port with an unused port." } finally { $probe.Stop() }
$startScript = Join-Path $PSScriptRoot "start-lan.ps1"
$appRoot = Split-Path $PSScriptRoot -Parent
& (Join-Path $PSScriptRoot "init-server-data.ps1") -ProjectRoot $ProjectRoot
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Port {1} -NodePath "{2}" -ProjectRoot "{3}"' -f $startScript, $Port, $NodePath, $ProjectRoot
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments -WorkingDirectory $appRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# Server 2012 R2's cmdlet can leave PT72H when given TimeSpan.Zero.
$settings.ExecutionTimeLimit = "PT0S"
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Task installed and started. Open http://192.168.3.2:$Port from another LAN computer. Check logs and Task Scheduler if it cannot connect."
Write-Output "Firewall and UAC were not changed. Ask the administrator to open the selected port for the office subnet if required."
