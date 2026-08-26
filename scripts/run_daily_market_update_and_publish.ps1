param(
    [string]$SourceRoot = '',
    [string]$WorkbenchRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Remote = 'https://github.com/flyinlemon-H/investment-workbench-mobile.git',
    [string]$Branch = 'main',
    [string]$LogPath = '',
    [switch]$PublishDryRun,
    [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'
$StartedAt = Get-Date
$FinalExitCode = 1

function Write-WrapperDiagnostic {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'ERROR')][string]$Level = 'INFO'
    )
    $Line = '{0} [{1}] {2}' -f (Get-Date -Format o), $Level, $Message
    Write-Output $Line
    if ($script:LogPath) {
        $Line | Add-Content -LiteralPath $script:LogPath -Encoding UTF8
    }
}

try {
    $WorkbenchRoot = [System.IO.Path]::GetFullPath($WorkbenchRoot)
    if (-not $LogPath) {
        $LogRoot = if ($env:LOCALAPPDATA) {
            Join-Path $env:LOCALAPPDATA 'InvestmentWorkbench\logs\daily-market-update'
        } else {
            Join-Path ([System.IO.Path]::GetTempPath()) 'InvestmentWorkbench\logs\daily-market-update'
        }
        $LogPath = Join-Path $LogRoot ('wrapper_{0}.log' -f $StartedAt.ToString('yyyyMMdd_HHmmss'))
    }
    $LogPath = [System.IO.Path]::GetFullPath($LogPath)
    $LogDirectory = Split-Path -Parent $LogPath
    if (-not (Test-Path -LiteralPath $LogDirectory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
    }

    Write-WrapperDiagnostic "wrapperStart=$($StartedAt.ToString('o'))"
    Write-WrapperDiagnostic "user=$([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"
    Write-WrapperDiagnostic "workbenchRoot=$WorkbenchRoot"

    if (-not $SourceRoot) {
        # Build the sibling directory name from Unicode code points. Keeping this
        # file ASCII-only prevents Windows PowerShell 5.1 from misdecoding it.
        $SourceDirectoryName = -join ([int[]](0x6295, 0x8D44, 0x5206, 0x6790, 0x7A0B, 0x5E8F) | ForEach-Object { [char]$_ })
        $SourceRoot = Join-Path (Split-Path -Parent $WorkbenchRoot) $SourceDirectoryName
    }
    $SourceRoot = [System.IO.Path]::GetFullPath($SourceRoot)
    $SourceRunScript = Join-Path $SourceRoot 'scripts\run_daily_market_update.ps1'
    $BridgePreparerScript = Join-Path $WorkbenchRoot 'scripts\prepare_market_bridge.js'
    $PublisherScript = Join-Path $WorkbenchRoot 'scripts\publish_market_bridges.js'
    $DataBridgePath = Join-Path $WorkbenchRoot 'data\market_data_bridge.js'
    $StatusBridgePath = Join-Path $WorkbenchRoot 'data\market_task_status_bridge.js'
    $WindowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

    Write-WrapperDiagnostic "resolvedSourceRoot=$SourceRoot"
    if (-not (Test-Path -LiteralPath $SourceRunScript -PathType Leaf)) {
        Write-WrapperDiagnostic "sourceRunnerPreflight=missing path=$SourceRunScript" 'ERROR'
        throw "Source market update script missing: $SourceRunScript"
    }
    Write-WrapperDiagnostic "sourceRunnerPreflight=found path=$SourceRunScript"
    if (-not (Test-Path -LiteralPath $BridgePreparerScript -PathType Leaf)) {
        Write-WrapperDiagnostic "bridgePreparerPreflight=missing path=$BridgePreparerScript" 'ERROR'
        throw "Market bridge preparer missing: $BridgePreparerScript"
    }
    Write-WrapperDiagnostic "bridgePreparerPreflight=found path=$BridgePreparerScript"
    if (-not (Test-Path -LiteralPath $PublisherScript -PathType Leaf)) {
        Write-WrapperDiagnostic "publisherPreflight=missing path=$PublisherScript" 'ERROR'
        throw "Market publisher script missing: $PublisherScript"
    }
    Write-WrapperDiagnostic "publisherPreflight=found path=$PublisherScript"
    if (-not (Test-Path -LiteralPath $WindowsPowerShell -PathType Leaf)) {
        throw "Windows PowerShell executable missing: $WindowsPowerShell"
    }

    if ($PreflightOnly) {
        $FinalExitCode = 0
        Write-WrapperDiagnostic 'finalStatus=success exitCode=0 mode=preflight'
        exit 0
    }

    Write-WrapperDiagnostic 'sourceUpdateStart=true'
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $SourceOutput = @(& $WindowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $SourceRunScript 2>&1 | ForEach-Object { $_.ToString() })
        $SourceExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
    $SourceOutput | ForEach-Object { Write-WrapperDiagnostic "source: $_" }
    Write-WrapperDiagnostic "sourceUpdateResult=completed exitCode=$SourceExitCode"

    $DataBridgeExists = Test-Path -LiteralPath $DataBridgePath -PathType Leaf
    $StatusBridgeExists = Test-Path -LiteralPath $StatusBridgePath -PathType Leaf
    $DeliveryResult = if ($SourceExitCode -eq 0 -and $DataBridgeExists -and $StatusBridgeExists) { 'success' } elseif ($SourceExitCode -ne 0) { 'failed' } else { 'incomplete' }
    Write-WrapperDiagnostic "bridgeDeliveryResult=$DeliveryResult dataBridgeExists=$DataBridgeExists statusBridgeExists=$StatusBridgeExists"

    if ($SourceExitCode -ne 0) {
        $SourceLogDirectory = Join-Path $SourceRoot 'data\logs\market_data'
        $LatestSourceLog = Get-ChildItem -LiteralPath $SourceLogDirectory -Filter 'market_update_*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($LatestSourceLog) {
            Write-WrapperDiagnostic "sourceFailureLog=$($LatestSourceLog.FullName)"
            Get-Content -LiteralPath $LatestSourceLog.FullName -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-WrapperDiagnostic "sourceLog: $_" 'ERROR' }
        }
        $FinalExitCode = $SourceExitCode
        Write-WrapperDiagnostic "finalStatus=failed exitCode=$FinalExitCode phase=source-update" 'ERROR'
        exit $FinalExitCode
    }
    if (-not $DataBridgeExists -or -not $StatusBridgeExists) {
        throw 'Source update completed without both Workbench bridge files.'
    }

    $Node = (Get-Command node -ErrorAction Stop).Source
    Write-WrapperDiagnostic 'bridgePreparationStart=true'
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $PrepareOutput = @(& $Node $BridgePreparerScript --bridge-path $DataBridgePath 2>&1 | ForEach-Object { $_.ToString() })
        $PrepareExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
    $PrepareOutput | ForEach-Object { Write-WrapperDiagnostic "bridgePreparer: $_" }
    Write-WrapperDiagnostic "bridgePreparationResult=completed exitCode=$PrepareExitCode"
    if ($PrepareExitCode -ne 0) {
        $FinalExitCode = $PrepareExitCode
        Write-WrapperDiagnostic "finalStatus=failed exitCode=$FinalExitCode phase=bridge-preparation" 'ERROR'
        exit $FinalExitCode
    }

    $PublishArguments = @(
        $PublisherScript,
        '--source-data-path', $DataBridgePath,
        '--source-status-path', $StatusBridgePath,
        '--remote', $Remote,
        '--branch', $Branch
    )
    if ($PublishDryRun) { $PublishArguments += @('--dry-run', '--accept-manual-run') }
    Write-WrapperDiagnostic "publishStart=true dryRun=$([bool]$PublishDryRun)"
    $PreviousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $PublishOutput = @(& $Node @PublishArguments 2>&1 | ForEach-Object { $_.ToString() })
        $PublishExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
    $PublishOutput | ForEach-Object { Write-WrapperDiagnostic "publisher: $_" }
    Write-WrapperDiagnostic "publishResult=completed exitCode=$PublishExitCode"
    if ($PublishExitCode -ne 0) {
        $FinalExitCode = $PublishExitCode
        Write-WrapperDiagnostic "finalStatus=failed exitCode=$FinalExitCode phase=publish" 'ERROR'
        exit $FinalExitCode
    }

    $FinalExitCode = 0
    Write-WrapperDiagnostic 'finalStatus=success exitCode=0'
    exit 0
} catch {
    Write-WrapperDiagnostic "failure=$($_.Exception.Message)" 'ERROR'
    Write-WrapperDiagnostic "finalStatus=failed exitCode=$FinalExitCode" 'ERROR'
    exit $FinalExitCode
}
