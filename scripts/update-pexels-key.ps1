# 更新共用 stock-api.env 的 Pexels Key，並同步到行程專案 .env
param(
    [string]$ApiKey = "",
    [string]$GithubRoot = "D:/GITHUB_2"
)

$ErrorActionPreference = "Stop"

function Read-EnvValue([string]$file, [string]$key) {
    if (-not (Test-Path $file)) { return "" }
    foreach ($line in Get-Content $file -Encoding UTF8) {
        if ($line -match "^\s*$key\s*=\s*(.*)\s*$") {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Set-EnvValue([string]$file, [string]$key, [string]$value) {
    if (-not (Test-Path $file)) {
        New-Item -ItemType File -Path $file -Force | Out-Null
    }
    $lines = Get-Content $file -Encoding UTF8
    $found = $false
    $next = foreach ($line in $lines) {
        if ($line -match "^\s*$key\s*=") {
            $found = $true
            "$key=$value"
        } else {
            $line
        }
    }
    if (-not $found) {
        $next += "$key=$value"
    }
    Set-Content -Path $file -Value ($next -join "`n") -Encoding UTF8 -NoNewline
    Add-Content -Path $file -Value "" -Encoding UTF8
}

function Test-PexelsKey([string]$key) {
    if (-not $key) { return $false }
    try {
        $headers = @{ Authorization = $key }
        $res = Invoke-WebRequest -Uri "https://api.pexels.com/v1/search?query=test&per_page=1" -Headers $headers -UseBasicParsing
        return $res.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not $ApiKey) {
    Write-Host ""
    Write-Host "請貼上新的 Pexels API Key（從 https://www.pexels.com/api/ 取得）：" -ForegroundColor Cyan
    $ApiKey = (Read-Host "PEXELS_API_KEY").Trim()
}

if (-not $ApiKey) {
    Write-Error "未輸入 API Key，已取消。"
    exit 1
}

Write-Host ""
Write-Host "測試金鑰..." -ForegroundColor Yellow
if (-not (Test-PexelsKey $ApiKey)) {
    Write-Host "FAIL：Pexels 回傳 401 或連線失敗，請確認 Key 是否完整複製。" -ForegroundColor Red
    exit 1
}
Write-Host "OK：金鑰有效" -ForegroundColor Green

$stockPickerRoot = Join-Path $GithubRoot "圖庫下載說明"
$stockApi = Join-Path $stockPickerRoot ".preview/stock-api.env"
if (-not (Test-Path $stockApi)) {
    $example = Join-Path $stockPickerRoot "templates/stock-api.env.example"
    if (Test-Path $example) {
        Copy-Item $example $stockApi
    } else {
        New-Item -ItemType File -Path $stockApi -Force | Out-Null
    }
}

Set-EnvValue $stockApi "PEXELS_API_KEY" $ApiKey
Write-Host "已更新：$stockApi"

$projectRoots = @(
    "UIO16A 加拉巴哥群島 厄瓜多 哥倫比亞雙城 咖啡風情 16日",
    "OSL10A 挪威 羅弗敦群島 夢幻北極光 12日",
    "2027NEWYEAR"
)

foreach ($name in $projectRoots) {
    $envFile = Join-Path $GithubRoot "$name/.env"
    if (-not (Test-Path $envFile)) { continue }
    Set-EnvValue $envFile "PEXELS_API_KEY" $ApiKey
    Write-Host "已更新：$envFile"
}

Write-Host ""
Write-Host "完成。共用金鑰檔：圖庫下載說明/.preview/stock-api.env" -ForegroundColor Green
Write-Host "新專案：powershell -File scripts/setup-env.ps1" -ForegroundColor Green
Write-Host '驗證：node scripts/find-images.js --pexels-only "ocean"' -ForegroundColor Green
