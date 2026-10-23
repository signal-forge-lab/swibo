[CmdletBinding()]
param(
    [ValidateSet('Install', 'Status', 'Uninstall')]
    [string]$Mode = 'Status',
    [switch]$AdoptRunning
)

# Keep the Swibo control plane independent of its optional Tauri desktop UI.
# Task Scheduler owns the foreground Node process and restarts on failure.
$ErrorActionPreference = 'Stop'
$taskName = 'SwiboDaemon'
$root = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $root 'src\daemon.js'
$node = (Get-Command node.exe -ErrorAction Stop).Source
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
if ($existing) {
    $action = @($existing.Actions)[0]
    if (-not $action -or
        -not [string]::Equals($action.Execute, $node, [StringComparison]::OrdinalIgnoreCase) -or
        -not $action.Arguments.Contains($scriptPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A task with the SwiboDaemon name exists but has a different action'
    }
    if ($existing.State -eq 'Running' -and (Get-Daemon)) {
        Write-Output 'TASK_ALREADY_RUNNING: registration and daemon unchanged.'
        exit 0
    }
}
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([timespan]::Zero) `
    -RestartCount 30 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew -StartWhenAvailable
$arguments = '"' + $scriptPath + '"'
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $root
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

$oldPid = Get-Daemon
if ($oldPid -and -not $AdoptRunning) {
    Write-Output 'TASK_INSTALLED: existing daemon left running; task starts at next logon.'
    exit 0
}
if ($oldPid) {
    # Verify identity above before shutting down the standalone daemon. The
    # target services (Gateway, BrowserSkill, etc.) are never stopped here.
    Invoke-RestMethod -Method Post 'http://127.0.0.1:17991/api/shutdown' -TimeoutSec 5 | Out-Null
    for ($i = 0; $i -lt 40; $i++) {
        if (-not (Get-NetTCPConnection -LocalPort 17991 -State Listen -ErrorAction SilentlyContinue)) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (Get-NetTCPConnection -LocalPort 17991 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Standalone daemon did not exit; task not started'
    }
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
