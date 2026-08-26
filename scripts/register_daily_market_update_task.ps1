param(
    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$Time = '16:30',
    [ValidateNotNullOrEmpty()][string]$TaskName = 'InvestmentWorkbench-DailyMarketUpdate',
    [switch]$Force,
    [switch]$PublishDryRun,
    [switch]$DescribeOnly
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$WrapperScript = Join-Path $PSScriptRoot 'run_daily_market_update_and_publish.ps1'
$PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$WrapperScript`""
if ($PublishDryRun) { $Arguments += ' -PublishDryRun' }
$Schedule = "Monday-Friday $Time"

$Description = [ordered]@{
    taskName = $TaskName
    executable = $PowerShell
    arguments = $Arguments
    workingDirectory = $Root
    schedule = $Schedule
    enabled = $true
    startWhenAvailable = $true
    multipleInstances = 'IgnoreNew'
    executionTimeLimit = 'PT2H'
    logonType = 'Interactive'
    runLevel = 'Limited'
    disallowStartIfOnBatteries = $true
    stopIfGoingOnBatteries = $true
    wakeToRun = $false
}

if ($DescribeOnly) {
    [pscustomobject]$Description | ConvertTo-Json -Depth 3
    exit 0
}

if (-not (Test-Path -LiteralPath $WrapperScript -PathType Leaf)) { throw "Target wrapper not found: $WrapperScript" }
if (-not (Test-Path -LiteralPath $PowerShell -PathType Leaf)) { throw "Windows PowerShell 5.1 not found: $PowerShell" }

& $PowerShell -NoProfile -ExecutionPolicy Bypass -File $WrapperScript -PreflightOnly
if ($LASTEXITCODE -ne 0) { throw "Wrapper preflight failed with exit code $LASTEXITCODE." }

$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing -and -not $Force) { throw "Task '$TaskName' already exists. Use -Force to update it." }

$Action = New-ScheduledTaskAction -Execute $PowerShell -Argument $Arguments -WorkingDirectory $Root
$At = [datetime]::Today.Add([timespan]::Parse($Time))
$Trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $At
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -DisallowStartIfOnBatteries -StopIfGoingOnBatteries
$Principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Post-market update, Workbench bridge delivery, and isolated publish.'
Register-ScheduledTask -TaskName $TaskName -InputObject $Task -Force:$Force | Out-Null
Enable-ScheduledTask -TaskName $TaskName | Out-Null

$Description.GetEnumerator() | ForEach-Object { Write-Output "$($_.Key)=$($_.Value)" }
