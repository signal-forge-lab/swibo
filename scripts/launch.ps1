[CmdletBinding()]
param([switch]$Build)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Join-Path $root 'src-tauri\Cargo.toml'
$exe = Join-Path $root 'src-tauri\target\release\mcp-supervisor.exe'

& node (Join-Path $root 'src\cli.js') daemon start
if ($LASTEXITCODE -ne 0) { throw 'Failed to start Swibo daemon.' }

if ($Build -or -not (Test-Path $exe -PathType Leaf)) {
    & cargo build --release --manifest-path $manifest
    if ($LASTEXITCODE -ne 0) { throw 'Failed to build Swibo desktop app.' }
}

$process = Start-Process -FilePath $exe -WorkingDirectory $root -PassThru
Write-Host "Swibo started. PID $($process.Id)"
