[CmdletBinding()]
param()

# Task Scheduler owns this foreground wrapper. Hiding PowerShell's window also
# hides the child Node console while retaining the task's process lifetime.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'src\daemon.js'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logs = Join-Path $env:LOCALAPPDATA 'mcp-supervisor'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

try {
    & $node $script 1>> (Join-Path $logs 'daemon.stdout.log') 2>> (Join-Path $logs 'daemon.stderr.log')
    exit $LASTEXITCODE
} catch {
    [IO.File]::AppendAllText((Join-Path $logs 'daemon.stderr.log'), $_.Exception.Message + [Environment]::NewLine)
    exit 1
}
