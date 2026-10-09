param(
  [ValidateRange(1,10)][int]$Trials = 3,
  [switch]$Exclusive
)

# Deliberately requires an explicit exclusive switch. Only the two verified
# standalone GUI windows are closed; the Swibo daemon is never stopped.
$ErrorActionPreference = 'Stop'
if (!$Exclusive) { throw 'Exclusive GUI benchmark requires -Exclusive.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$swiboRelease = Join-Path $root 'src-tauri\target\release\mcp-supervisor.exe'
$mergedRelease = Join-Path $env:LOCALAPPDATA 'IntelligenceWorks\cargo-target\swibo-unified-release\release\mcp-supervisor.exe'
$loctlRoot = [IO.Path]::GetFullPath((Join-Path $root '..\..\tools\loctl'))
$loctlRelease = Join-Path $loctlRoot 'src-tauri\target\release\loctl.exe'
$loctlHeadless = Join-Path $env:LOCALAPPDATA 'IntelligenceWorks\cargo-target\loctl-unified\debug\loctl.exe'
$outDir = Join-Path $env:LOCALAPPDATA 'IntelligenceWorks\diagnostics\swibo'
foreach ($file in @($swiboRelease,$mergedRelease,$loctlRelease,$loctlHeadless)) {
  if (!(Test-Path $file)) { throw "Missing executable for safe benchmark: $file" }
}
$healthBefore = Invoke-RestMethod -Uri 'http://127.0.0.1:17991/api/health'
$initial = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('mcp-supervisor.exe','loctl.exe')
})
$swiboOriginal = @($initial | Where-Object { $_.ExecutablePath -eq $swiboRelease })
$loctlOriginal = @($initial | Where-Object { $_.ExecutablePath -eq $loctlRelease })
$other = @($initial | Where-Object { $_.ExecutablePath -notin @($swiboRelease,$loctlRelease) })
if ($swiboOriginal.Count -ne 1 -or $loctlOriginal.Count -ne 1 -or $other.Count) {
  throw 'Unexpected GUI process set; refusing to close any window.'
}
$originals = @(
  [pscustomobject]@{Id=$swiboOriginal[0].ProcessId; Exe=$swiboRelease; WorkDir=$root; Label='Swibo'},
  [pscustomobject]@{Id=$loctlOriginal[0].ProcessId; Exe=$loctlRelease; WorkDir=$loctlRoot; Label='Loctl'}
)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowState {
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hwnd);
}
'@
foreach ($entry in $originals) {
  $p = Get-Process -Id $entry.Id -ErrorAction Stop
  if ($p.MainWindowTitle -ne $entry.Label -or $p.MainWindowHandle -eq 0 -or
      ![WindowState]::IsIconic($p.MainWindowHandle)) {
    throw "Original $($entry.Label) GUI must have its expected title and be minimized; refusing benchmark."
  }
}

function Close-Gui($p, [bool]$trialOwned) {
  if (!$p -or $p.HasExited) { return }
  $null = $p.CloseMainWindow()
  $null = $p.WaitForExit(8000)
  if (!$p.HasExited) {
    if (!$trialOwned) { throw 'Original GUI did not close gracefully; refusing to force-stop.' }
    $p.Kill()
    $null = $p.WaitForExit(4000)
  }
}

function Start-Gui([string]$exe, [string]$workDir, [hashtable]$environment, [string]$expectedTitle) {
  $options = @{
    FilePath=$exe; WorkingDirectory=$workDir; WindowStyle='Minimized'; PassThru=$true
  }
  if ($environment.Count) { $options.Environment = $environment }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process @options
  while ($watch.ElapsedMilliseconds -lt 10000) {
    $p.Refresh()
    if ($p.HasExited) { throw "GUI exited during startup: $exe" }
    if ($p.MainWindowHandle -ne 0 -and $p.Responding -and $p.MainWindowTitle -eq $expectedTitle) {
      return [pscustomobject]@{Process=$p; WindowReadyMs=$watch.ElapsedMilliseconds}
    }
    Start-Sleep -Milliseconds 100
  }
  # The caller cannot track an incomplete Start-Gui return. Clean up the
  # exact process started here before propagating startup timeout.
  $null = $p.CloseMainWindow()
  $null = $p.WaitForExit(2000)
  if (!$p.HasExited) {
    $p.Kill()
    $null = $p.WaitForExit(4000)
  }
  throw "No responding GUI window within 10 seconds: $exe"
}

function Read-Tree([int[]]$roots) {
  $all = @(Get-CimInstance Win32_Process)
  $ids = [Collections.Generic.HashSet[int]]::new()
  foreach ($id in $roots) { $null = $ids.Add($id) }
  do {
    $previous = $ids.Count
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId)) { $null = $ids.Add([int]$p.ProcessId) }
    }
  } while ($previous -ne $ids.Count)
  $running = @(Get-Process -Id @($ids) -ErrorAction SilentlyContinue)
  $web = @($running | Where-Object ProcessName -eq 'msedgewebview2')
  return [pscustomobject]@{
    AppPids = @($running | Where-Object ProcessName -in @('mcp-supervisor','loctl')).Count
    WebViewPids = $web.Count
    TreePids = $running.Count
    PrivateMB = [math]::Round((($running|Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB),2)
    WorkingMB = [math]::Round((($running|Measure-Object WorkingSet64 -Sum).Sum / 1MB),2)
    CpuSeconds = [math]::Round((($running|Measure-Object CPU -Sum).Sum),3)
  }
}

function Measure-StatusLatency {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:17991/api/status'
  $watch.Stop()
  if (!$reply.targets) { throw 'Swibo status unavailable during benchmark.' }
  return [math]::Round($watch.Elapsed.TotalMilliseconds,2)
}

$temporary = [Collections.Generic.List[System.Diagnostics.Process]]::new()
$closedOriginals = [Collections.Generic.List[object]]::new()
$results = [Collections.Generic.List[object]]::new()
$failure = $null
try {
  foreach ($entry in $originals) {
    Close-Gui (Get-Process -Id $entry.Id -ErrorAction Stop) $false
    $closedOriginals.Add($entry)
  }
  Start-Sleep -Seconds 2

  for ($trial = 1; $trial -le $Trials; $trial++) {
    $order = if ($trial % 2) { @('separate','unified') } else { @('unified','separate') }
    foreach ($configuration in $order) {
      $startups = [Collections.Generic.List[object]]::new()
      try {
        if ($configuration -eq 'separate') {
          $startups.Add((Start-Gui $swiboRelease $root @{MCP_SUPERVISOR_ROOT=$root;SWIBO_UNIFIED_PREVIEW='0'} 'Swibo'))
          $startups.Add((Start-Gui $loctlRelease $loctlRoot @{} 'Loctl'))
        } else {
          $startups.Add((Start-Gui $mergedRelease $root @{
            MCP_SUPERVISOR_ROOT=$root;
            SWIBO_UNIFIED_PREVIEW='1';
            SWIBO_UNIFIED_LOCTL_EXE=$loctlHeadless
          } 'Swibo + Loctl Preview'))
        }
        foreach ($item in $startups) { $temporary.Add($item.Process) }
        $ids = @($startups | ForEach-Object { $_.Process.Id })
        Start-Sleep -Seconds 3
        $cold = Read-Tree $ids
        $coldLatency = Measure-StatusLatency
        Start-Sleep -Seconds 5
        $warm = Read-Tree $ids
        $warmLatency = Measure-StatusLatency
        $results.Add([pscustomobject]@{
          Trial=$trial; Mode=$configuration;
          WindowReadyMs=($startups|Measure-Object WindowReadyMs -Maximum).Maximum;
          Cold=$cold; Warm=$warm;
          ColdStatusMs=$coldLatency; WarmStatusMs=$warmLatency
        })
        Write-Output ("TRIAL $trial $configuration readyMs=$((($startups|Measure-Object WindowReadyMs -Maximum).Maximum)) coldPrivateMB=$($cold.PrivateMB) warmPrivateMB=$($warm.PrivateMB) webPids=$($warm.WebViewPids)")
      } finally {
        foreach ($item in $startups) {
          Close-Gui $item.Process $true
          $null = $temporary.Remove($item.Process)
        }
        Start-Sleep -Seconds 2
      }
    }
  }
} catch {
  $failure = $_
} finally {
  foreach ($p in $temporary) {
    try { Close-Gui $p $true } catch { Write-Warning $_.Exception.Message }
  }
  foreach ($entry in $closedOriginals) {
    try {
      $restored = Start-Gui $entry.Exe $entry.WorkDir @{} $entry.Label
      Write-Output ("RESTORED $($entry.Label) pid=$($restored.Process.Id)")
    } catch {
      Write-Error ("RESTORE FAILED for $($entry.Label): " + $_.Exception.Message)
    }
  }
  $healthAfter = Invoke-RestMethod -Uri 'http://127.0.0.1:17991/api/health'
  if ($healthBefore.pid -ne $healthAfter.pid) {
    Write-Warning 'Swibo daemon PID changed during GUI comparison.'
  }
  if ($results.Count) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $outFile = Join-Path $outDir ("bench-exclusive-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
    [pscustomobject]@{
      At=(Get-Date).ToString('o'); Trials=$Trials;
      DaemonPidBefore=$healthBefore.pid; DaemonPidAfter=$healthAfter.pid;
      Results=$results.ToArray()
    } | ConvertTo-Json -Depth 7 | Set-Content -Encoding utf8 $outFile
    Write-Output "RESULT_FILE=$outFile"
  }
}
if ($failure) { throw $failure }
