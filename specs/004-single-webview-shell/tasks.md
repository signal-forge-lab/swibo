# Implementation tasks and evidence

- [x] T001 Audit both current Tauri hosts, UI origins, native command paths,
      WebView2 owner groups, and current unified HTML prototype.
- [x] T002 Document the single-WebView2 contract, origin/security boundaries,
      acceptance tests, and rollback requirements.
- [x] T003 Create opt-in merged local-origin frontend entry point with one
      WebView and a restricted Swibo daemon command bridge.
- [x] T004 Reuse the existing Loctl Rust module runtime via bounded headless
      one-shot JSON dispatch; preserve registry and process-json-v1 semantics
      without a second permanent WebView2.
- [x] T005 Wire the merged dashboard's real Runtime / Auto-start / Monitor
      and Launcher / Favorites / Module flows into the live services.
- [x] T006 Unit/integration tests for action parity, module failure isolation,
      navigation/origin denial, service persistence, and no idle polling.
- [x] T007 Run separate-vs-merged measured benchmarks for CPU, memory, GUI
      startup, process count and action latency, with cold and warm trials.
- [x] T008 Roll out behind opt-in launcher, validate on Windows, and keep
      rollback paths until explicit cutover approval.

## Verification evidence, 2026-10-10

- Swibo standalone remains the default launch; preview requires
  `SWIBO_UNIFIED_PREVIEW=1`. Rust IPC commands reject calls outside preview.
- Preview uses local `unified.html`; the existing Swibo dashboard origin,
  Host/Origin policy, CSP and frame-denial headers are unchanged.
- The Loctl source now supports `--headless-rpc` via a bounded, strict JSON
  request to the same registry/adapter functions as the original native GUI.
  The preview requires `SWIBO_UNIFIED_LOCTL_EXE` pointing to the built Loctl
  executable. No additional persistent Loctl window is launched.
- Swibo Node 59/59, Rust 7/7, clippy clean; Loctl Node 24/24, Rust
  14/14, clippy clean.
- Win32 UI Automation on opt-in preview: Runtimes showed 17 actual daemon
  targets; Launcher showed 7 registered Loctl modules; invoking `status
  Swibo` displayed `READY · 13/17 targets ready`.
- Test preview PID was closed after inspection; the normal Swibo GUI,
  standalone Loctl GUI, and Swibo daemon remained alive.

**Remaining at this initial checkpoint:** Production-grade UI parity (detailed editor, all module views,
favorites and navigation); richer action tests and security coverage;
separate/merged resource benchmarks; optional release and rollback validation.
Do not retire either standalone GUI on the basis of this preview alone.

## Additional evidence, 2026-10-10

- Launcher now provides module search, pinned-first ordering, selected stage,
  signals, quick view, recent activity and isolated errors. UI Automation
  verified search, status lookup and selected module details.
- Added one persistent Swibo SSE listener in the preview Tauri host and an
  explicit `core:event:allow-listen` capability. Live daemon refresh updated
  the preview timestamp without periodic polling or an extra WebView.
- Added an opt-in launcher `node scripts/launch-unified-preview.mjs`.
  It validates the Loctl headless RPC protocol before launching; a stale
  GUI-only Release executable cannot silently be used as the RPC backend.
- Warm coexistence resource measurements are recorded in
  `benchmark-warm-20261010.md`; exclusive cold/warm A/B benchmarking remains
  outstanding.
- Full source tests and Clippy passed before the additional event-listener
  capability. Final regression is required again after all changes are saved.

## Continuation evidence, 2026-10-10

- Unified Runtime now includes registry-backed target Add/Edit/Delete through
  an opt-in-only, ID-validated local daemon bridge, along with target detail
  expansion and start-all/stop-all actions. Existing per-target and monitor
  controls, autostart, module actions, pinned ordering, search, and SSE remain.
- The GUI was launched with the current debug build next to the unchanged
  standalone applications. Windows UI Automation verified 17 live Swibo
  targets, the existing Workbridge target editor containing the real registry
  JSON, and the separate Launcher search field. The editor was cancelled;
  no live target mutation or runtime lifecycle operation was performed.
- Swibo Node 61/61; Rust 9/9, Clippy clean. Unsafe IDs and unknown registry
  actions are rejected by the bridge; the daemon remains the final registry
  validator. The ordinary standalone GUI retains its preview-disabled gate.
- At this earlier checkpoint, T006 remained open for live mutation/action-isolation E2E and security parity.
  The strict exclusive cold/warm benchmark T007 and opt-in release/rollback
  gate T008 have not been completed. Standalone GUI cutover is not approved.
- A release build attempt failed at replacing the existing
  `src-tauri/target/release/mcp-supervisor.exe` with Windows access denied
  (OS error 5). The current standalone executable was not terminated or
  replaced. A future isolated release target or a coordinated GUI shutdown
  is needed to complete T008 without disrupting live usage.

## Release and isolation continuation, 2026-10-10

- T006: Native loopback HTTP fixture verifies registry PUT routing and
  request body with no live registry mutation. Rust tests cover redirects,
  response length, unsupported transfer encoding, bounded SSE lines, strict
  target/module IDs, navigation denial, and opt-in boundary. Real Loctl
  headless integration uses a temporary independent registry with healthy,
  broken and missing modules; failures do not prevent healthy status calls.
  No idle timer was introduced, and the Swibo SSE relay remains event-driven.
- T008: The opt-in `node scripts/launch-unified-preview.mjs --release`
  builds/starts an independent Release executable under the local Cargo
  target cache, avoiding the locked standalone executable. Windows native UI
  verified the 17-target dashboard and Launcher; closing the Release window
  originally left a background GUI process because the SSE relay held an
  AppHandle. The unified shell now explicitly exits when its sole main window
  is destroyed. Recompiled Release was started and closed; the GUI process
  exited and the separate Swibo daemon PID remained unchanged. Standalone
  Swibo and Loctl GUIs are retained and remain the rollback path.
- The unified Launcher now renders module-local icons via existing Loctl RPC.
  Icon requests are sequenced to bound one-shot process concurrency and avoid
  adding a burst of short-lived native runtimes.
- All current non-mutating Windows release smoke and simulated mutation tests
  passed. Actual production registry edits and lifecycle start/stop/restart
  remain intentionally unexecuted against user-managed services.
- At the previous checkpoint, T007 remained open. See `benchmark-coexistence-20261010.md` for the measured
  warm coexistence delta. This does not establish the exclusive A/B savings
  required for a permanent GUI cutover.

## T007 completed: exclusive paired measurements, 2026-10-10

- Three cold/warm paired trials with alternating configuration order were
  performed by `scripts/benchmark-unified-guis.ps1`. Details and limitations
  are in `benchmark-exclusive-20261010.md`.
- The merged GUI averaged 201.49 MB warm Private Bytes vs. 431.14 MB for
  the two standalone GUIs, with six rather than twelve WebView2 processes.
  Backend status time was comparable. CPU was measured for GUI process trees.
- The original minimized GUI processes were gracefully closed for the
  exclusive run. Both standalone windows were restored with their original
  executables and the Swibo daemon PID remained unchanged.
- Window-ready and backend status measurements are useful bounded proxies,
  not DOM-complete startup or end-to-end native UI action latencies.
- All eight tasks are implemented/tested at the **opt-in preview** gate.
  This is **not approval** to retire standalone GUIs or change the default
  launch; production parity and cutover remain separate decisions.
