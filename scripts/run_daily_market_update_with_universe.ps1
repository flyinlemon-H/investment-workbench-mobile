param(
    [string]$SourceRoot = '',
    [string]$WorkbenchRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$UniverseInbox = '',
    [ValidateNotNullOrEmpty()][string]$TaskName = 'InvestmentWorkbench-DailyMarketUpdate',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$StartedAt = Get-Date
$FinalCode = 1
$Lock = $null

function Write-AtomicUtf8File {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Content)
    $Directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { New-Item -ItemType Directory -Force -Path $Directory | Out-Null }
    $Temp = "$Path.tmp"
    try {
        [System.IO.File]::WriteAllText($Temp, $Content, [System.Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $Backup = "$Path.replace-backup"
            [System.IO.File]::Replace($Temp, $Path, $Backup)
            Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
        } else {
            [System.IO.File]::Move($Temp, $Path)
        }
    } finally {
        Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue
        if ($Backup) { Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue }
    }
}

function Read-OutputValue {
    param([Parameter(Mandatory = $true)][string]$Text, [Parameter(Mandatory = $true)][string]$Name)
    $Match = [regex]::Match($Text, "(?m)^$([regex]::Escape($Name)):\s*(.+)$")
    if ($Match.Success) { return $Match.Groups[1].Value.Trim() }
    return ''
}

try {
    $WorkbenchRoot = [System.IO.Path]::GetFullPath($WorkbenchRoot)
    if (-not $SourceRoot) {
        $SourceDirectoryName = -join ([int[]](0x6295, 0x8D44, 0x5206, 0x6790, 0x7A0B, 0x5E8F) | ForEach-Object { [char]$_ })
        $SourceRoot = Join-Path (Split-Path -Parent $WorkbenchRoot) $SourceDirectoryName
    }
    $SourceRoot = [System.IO.Path]::GetFullPath($SourceRoot)
    if (-not $UniverseInbox) { $UniverseInbox = Join-Path (Split-Path -Parent $WorkbenchRoot) 'investment-workbench-mobile-sync\inbox' }
    $UniverseInbox = [System.IO.Path]::GetFullPath($UniverseInbox)
    $Adapter = Join-Path $WorkbenchRoot 'scripts\update_market_universe.py'
    $BridgePath = Join-Path $WorkbenchRoot 'data\market_data_bridge.js'
    $StatusBridgePath = Join-Path $WorkbenchRoot 'data\market_task_status_bridge.js'
    $LogDirectory = Join-Path $SourceRoot 'data\logs\market_data'
    $LockPath = Join-Path $LogDirectory 'market_update.lock'
    $LogPath = Join-Path $LogDirectory ('market_update_{0}.log' -f $StartedAt.ToString('yyyyMMdd_HHmmss'))
    New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
    New-Item -ItemType Directory -Force -Path $UniverseInbox | Out-Null
    if (-not (Test-Path -LiteralPath $Adapter -PathType Leaf)) { throw "Universe adapter missing: $Adapter" }
    $Lock = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $Python = (Get-Command python -ErrorAction Stop).Source
    $Arguments = @($Adapter, '--source-root', $SourceRoot, '--workbench-root', $WorkbenchRoot, '--inbox', $UniverseInbox)
    if ($DryRun) { $Arguments += '--dry-run' }
    "$(Get-Date -Format o) start: universe-aware DailyMarketUpdate" | Set-Content -LiteralPath $LogPath -Encoding UTF8
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $CommandOutput = @(& $Python @Arguments 2>&1 | ForEach-Object { $_.ToString() })
        $FinalCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
    $CommandOutput | Add-Content -LiteralPath $LogPath -Encoding UTF8
    $Output = $CommandOutput -join "`n"
    $Symbols = [int]((Read-OutputValue -Text $Output -Name 'symbols') -as [int])
    $Success = [int]((Read-OutputValue -Text $Output -Name 'success') -as [int])
    $Failed = [int]((Read-OutputValue -Text $Output -Name 'failed') -as [int])
    $WriteStatus = Read-OutputValue -Text $Output -Name 'writeStatus'
    $BridgeStatus = Read-OutputValue -Text $Output -Name 'bridgeStatus'
    $LatestTradeDate = Read-OutputValue -Text $Output -Name 'latestTradeDate'
    $DeliveredGeneratedAt = Read-OutputValue -Text $Output -Name 'deliveredGeneratedAt'
    $DeliveredStockCount = [int]((Read-OutputValue -Text $Output -Name 'deliveredStockCount') -as [int])
    $CloudUniverseStatus = Read-OutputValue -Text $Output -Name 'cloudUniverseStatus'
    $CloudUniverseCode = Read-OutputValue -Text $Output -Name 'cloudUniverseCode'
    $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $TaskInfo = if ($Task) { Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue } else { $null }
    $Schedule = if ($Task -and $Task.Triggers) { ($Task.Triggers | ForEach-Object { "$(($_.DaysOfWeek -join ',')) $($_.StartBoundary)" }) -join '; ' } else { '' }
    $RunStatus = [ordered]@{
        started_at = $StartedAt.ToString('o')
        finished_at = (Get-Date).ToString('o')
        status = if ($FinalCode -eq 0) { 'success' } else { 'failed' }
        exit_code = $FinalCode
        symbols = $Symbols
        success = $Success
        failed = $Failed
        latest_trade_date = $LatestTradeDate
        write_status = $WriteStatus
        bridge_status = $BridgeStatus
        workbench_delivery_status = if ($BridgeStatus -eq 'success') { 'success' } else { 'skipped' }
        workbench_bridge_path = $BridgePath
        delivered_generated_at = $DeliveredGeneratedAt
        delivered_stock_count = $DeliveredStockCount
        cloud_universe_status = $CloudUniverseStatus
        cloud_universe_warning = $CloudUniverseCode
        log_path = $LogPath
        error = if ($FinalCode -eq 0) { '' } else { (@($CommandOutput | Where-Object { $_ -match 'Error:|error=' }) -join '; ') }
    }
    if (-not $DryRun) {
        $Payload = [ordered]@{
            generated_at = (Get-Date).ToString('o')
            task_exists = [bool]$Task
            task_name = $TaskName
            enabled = if ($Task) { [string]$Task.State -ne 'Disabled' } else { $false }
            schedule = $Schedule
            next_run_time = if ($TaskInfo -and $TaskInfo.NextRunTime.Year -gt 1900) { $TaskInfo.NextRunTime.ToString('o') } else { '' }
            last_run_time = if ($TaskInfo -and $TaskInfo.LastRunTime.Year -gt 1900) { $TaskInfo.LastRunTime.ToString('o') } else { '' }
            last_task_result = $FinalCode
            script_path = $MyInvocation.MyCommand.Path
            latest_log_path = $LogPath
            latest_data_trade_date = $LatestTradeDate
            latest_run = $RunStatus
        }
        $Json = $Payload | ConvertTo-Json -Depth 10 -Compress
        $null = $Json | ConvertFrom-Json
        Write-AtomicUtf8File -Path $StatusBridgePath -Content ("window.MARKET_TASK_STATUS = $Json;`n")
    }
    $CommandOutput | ForEach-Object { Write-Output $_ }
    "$(Get-Date -Format o) exitCode=$FinalCode" | Add-Content -LiteralPath $LogPath -Encoding UTF8
    exit $FinalCode
} catch {
    Write-Output "universeAwareRunnerError: $($_.Exception.Message)"
    exit $FinalCode
} finally {
    if ($Lock) { $Lock.Dispose() }
    if ($LockPath) { Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue }
}
