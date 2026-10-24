[CmdletBinding()]
param(
    [ValidateSet('Install', 'Status', 'Uninstall')]
    [string]$Mode = 'Status',
    [switch]$AdoptRunning
)

# Keep the Swibo control plane independent of its optional Tauri desktop UI.
# Task Scheduler owns a hidden PowerShell wrapper which waits for Node to exit.
$ErrorActionPreference = 'Stop'
$taskName = 'SwiboDaemon'
$root = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $root 'src\daemon.js'
$hiddenRunner = Join-Path $root 'scripts\run-daemon-hidden.ps1'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$hiddenArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $hiddenRunner + '"'
$url = 'http://127.0.0.1:17991/api/health'

function Get-Daemon {
    $listener = Get-NetTCPConnection -LocalPort 17991 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $listener) { return $null }
    $health = Invoke-RestMethod -Uri $url -TimeoutSec 3
    if ($health.ok -ne $true -or [int]$health.pid -ne $listener.OwningProcess) {
        throw 'Swibo health identity does not match the TCP listener'
    }
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
    if (-not $process -or $process.Name -ne 'node.exe' -or
        -not $process.CommandLine.Contains($scriptPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Port 17991 belongs to an unexpected process. Refusing to take ownership.'
    }
    return $listener.OwningProcess
}

function Get-Task {
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

if ($Mode -eq 'Status') {
    $task = Get-Task
    $pidValue = Get-Daemon
    [pscustomobject]@{
        task = $taskName
        installed = [bool]$task
        task_state = if ($task) { [string]$task.State } else { 'not_registered' }
        daemon_pid = $pidValue
        daemon_ready = [bool]$pidValue
    } | ConvertTo-Json -Compress
    exit 0
}

if ($Mode -eq 'Uninstall') {
    if (Get-Task) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    Write-Output 'Swibo task unregistered; no target processes were stopped.'
    exit 0
}

if (!(Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw 'Swibo daemon script is missing'
}
$existing = Get-Task
$legacyTask = $false
if ($existing) {
    $action = @($existing.Actions)[0]
    $legacyTask = $action -and
        [string]::Equals($action.Execute, $node, [StringComparison]::OrdinalIgnoreCase) -and
        $action.Arguments.Contains($scriptPath, [StringComparison]::OrdinalIgnoreCase)
    $hiddenTask = $action -and
        [string]::Equals($action.Execute, $powershell, [StringComparison]::OrdinalIgnoreCase) -and
        $action.Arguments.Contains($hiddenRunner, [StringComparison]::OrdinalIgnoreCase) -and
        $action.Arguments.Contains('-WindowStyle Hidden', [StringComparison]::OrdinalIgnoreCase)
    if (-not ($legacyTask -or $hiddenTask)) {
        throw 'A task with the SwiboDaemon name exists but has a different action'
    }
    if ($hiddenTask -and $existing.State -eq 'Running' -and (Get-Daemon)) {
        Write-Output 'TASK_ALREADY_RUNNING: registration and daemon unchanged.'
        exit 0
    }
}
$oldPid = Get-Daemon
if ($existing -and $legacyTask -and $oldPid -and -not $AdoptRunning) {
    Write-Output 'LEGACY_TASK_RUNNING: pass -AdoptRunning for a controlled hidden-task migration.'
    exit 0
}
if ($oldPid -and $AdoptRunning) {
    # Gracefully shut down only the manager, never its target runtimes.
    Invoke-RestMethod -Method Post 'http://127.0.0.1:17991/api/shutdown' -TimeoutSec 5 | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
        if (-not (Get-NetTCPConnection -LocalPort 17991 -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
    if (Get-NetTCPConnection -LocalPort 17991 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Previous daemon did not exit; new task was not installed'
    }
    if ($existing) {
        for ($i = 0; $i -lt 40; $i++) {
            if ((Get-Task).State -ne 'Running') { break }
            Start-Sleep -Milliseconds 250
        }
    }
}
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([timespan]::Zero) `
    -RestartCount 30 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew -StartWhenAvailable
$action = New-ScheduledTaskAction -Execute $powershell -Argument $hiddenArguments -WorkingDirectory $root
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

if ($oldPid -and -not $AdoptRunning) {
    Write-Output 'TASK_INSTALLED: existing daemon left running; task starts at next logon.'
    exit 0
}

try {
    Start-ScheduledTask -TaskName $taskName
    for ($i = 0; $i -lt 80; $i++) {
        Start-Sleep -Milliseconds 250
        $newPid = Get-Daemon
        if ($newPid -and (Get-Task).State -eq 'Running') {
            Write-Output ('TASK_MANAGED_DAEMON_READY pid=' + $newPid)
            exit 0
        }
    }
    throw 'Task-owned daemon did not become ready'
} catch {
    # Recovery is intentionally only for this management process.
    # This is not a request to restart managed target services.
    if (-not (Get-NetTCPConnection -LocalPort 17991 -State Listen -ErrorAction SilentlyContinue)) {
        & $node (Join-Path $root 'src\cli.js') daemon start | Out-Null
    }
    throw
}
