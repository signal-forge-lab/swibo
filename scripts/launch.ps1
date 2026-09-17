[CmdletBinding()]
param([switch]$Build)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$args = @((Join-Path $root 'scripts\launch.mjs'))
if ($Build) { $args += '--build' }
& node @args
if ($LASTEXITCODE -ne 0) { throw "Swibo launcher failed with exit code $LASTEXITCODE." }
