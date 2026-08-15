param(
    [string]$SourceRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) '..\投资分析程序'),
    [string]$WorkbenchRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Remote = 'https://github.com/flyinlemon-H/investment-workbench-mobile.git',
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$SourceRoot = [System.IO.Path]::GetFullPath($SourceRoot)
$WorkbenchRoot = [System.IO.Path]::GetFullPath($WorkbenchRoot)
$SourceRunScript = Join-Path $SourceRoot 'scripts\run_daily_market_update.ps1'
$PublisherScript = Join-Path $WorkbenchRoot 'scripts\publish_market_bridges.js'
$DataBridgePath = Join-Path $WorkbenchRoot 'data\market_data_bridge.js'
$StatusBridgePath = Join-Path $WorkbenchRoot 'data\market_task_status_bridge.js'
$PowerShell = Join-Path $PSHOME 'powershell.exe'

if (-not (Test-Path -LiteralPath $SourceRunScript -PathType Leaf)) { throw "Source market update script missing: $SourceRunScript" }
if (-not (Test-Path -LiteralPath $PublisherScript -PathType Leaf)) { throw "Market publisher script missing: $PublisherScript" }

& $PowerShell -NoProfile -ExecutionPolicy Bypass -File $SourceRunScript
$SourceExitCode = $LASTEXITCODE
if ($SourceExitCode -ne 0) {
    Write-Error "Daily market update failed with exit code $SourceExitCode; publish skipped."
    exit $SourceExitCode
}

$Node = (Get-Command node -ErrorAction Stop).Source
$PublishOutput = @(& $Node $PublisherScript --source-data-path $DataBridgePath --source-status-path $StatusBridgePath --remote $Remote --branch $Branch 2>&1 | ForEach-Object { $_.ToString() })
$PublishExitCode = $LASTEXITCODE
$PublishOutput | ForEach-Object { Write-Output $_ }

$LatestLog = Get-ChildItem -LiteralPath (Join-Path $SourceRoot 'data\logs\market_data') -Filter 'market_update_*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($LatestLog) {
    "$(Get-Date -Format o) publisher:" | Add-Content -Encoding UTF8 -LiteralPath $LatestLog.FullName
    $PublishOutput | Add-Content -Encoding UTF8 -LiteralPath $LatestLog.FullName
}
if ($PublishExitCode -ne 0) {
    Write-Error "Daily market publish failed with exit code $PublishExitCode."
    exit $PublishExitCode
}
exit 0
