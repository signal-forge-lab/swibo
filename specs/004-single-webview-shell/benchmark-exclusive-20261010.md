# Exclusive Swibo / Loctl GUI A/B, 2026-10-10

## Method and rollback

Three paired trials used the same running Swibo daemon and local Loctl registry.
The original standalone windows were initially minimized. The audit captured
their **exact executable paths**, checked window titles and absence of other
matching GUI processes, and gracefully closed **only those two GUI windows**.
It then alternated the configurations to reduce order effects:

- Trial 1: standalone Swibo + standalone Loctl, then unified Release
- Trial 2: unified Release, then the two standalone GUIs
- Trial 3: the two standalone GUIs, then unified Release

Each trial used fresh Tauri GUI processes. The *cold* snapshot was taken after
the window first became responsive plus three seconds; the *warm* snapshot
followed five seconds later. Each snapshot summed the Windows host process and
its WebView2 descendant tree, excluding the unchanged Swibo daemon. The
non-mutating Swibo `/api/status` endpoint was timed under each configuration.
Only GUI windows were stopped. Production registry mutations and lifecycle
actions were not exercised.

In the `finally` restoration path, the original Swibo and Loctl executables
were relaunched successfully. The daemon PID was **unchanged**.
The diagnostic JSON was stored outside Git in the Windows local diagnostics
directory. The reusable benchmark script is
`scripts/benchmark-unified-guis.ps1 -Trials 3 -Exclusive`.

## Measurements

| Trial | Configuration | Cold private MB | Warm private MB | Warm working MB | WebView2 PIDs | Window ready ms | 5-second CPU seconds | Warm status ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Separate | 431.15 | 434.63 | 848.28 | 12 | 187 | 0.34 | 5.11 |
| 1 | Unified | 184.09 | 198.01 | 418.44 | 6 | 137 | 0.28 | 4.35 |
| 2 | Unified | 183.82 | 203.09 | 404.13 | 6 | 118 | 0.20 | 3.09 |
| 2 | Separate | 425.20 | 426.53 | 849.96 | 12 | 115 | 0.30 | 2.50 |
| 3 | Separate | 431.33 | 432.27 | 843.43 | 12 | 125 | 0.36 | 4.23 |
| 3 | Unified | 188.75 | 203.38 | 412.04 | 6 | 118 | 0.27 | 5.05 |

| Mean | Separate | Unified | Difference |
| --- | ---: | ---: | ---: |
| Warm private MB | 431.14 | 201.49 | -229.65 MB (-53.3%) |
| Warm working MB | 847.22 | 411.54 | -435.68 MB |
| WebView2 PIDs | 12 | 6 | -6 |
| Window ready ms | 142.3 | 124.3 | -18 ms |
| Five-second GUI-tree CPU seconds | 0.33 | 0.25 | -0.08 s |
| Warm daemon status ms | 3.95 | 4.16 | +0.21 ms |

**Interpretation:** All three paired runs show a substantial reduction in GUI
process Private Bytes and WebView2 process count with the merged shell. Working
Set is not additive physical system RAM savings and can double-count shared
pages. Window readiness means an HWND appeared and responded, **not** that
the web UI finished rendering. The status measurement is the shared Swibo
backend response time, **not** end-to-end UI interaction latency; similarly
these CPU measurements cover the GUI process trees, not all-system CPU.
Those distinctions must be preserved in future release claims.

The exclusive memory/process/CPU baseline gate is complete. Further formal
performance certification could add full DOM-ready and native UI-action
latencies, system-wide CPU, and more repetitions, but these are not grounds
for inventing unsupported metrics. **No permanent GUI cutover is authorized
by this benchmark.** Retain both standalone launchers and the opt-in flag.
