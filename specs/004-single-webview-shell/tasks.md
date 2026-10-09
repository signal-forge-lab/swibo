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
- [ ] T005 Wire the merged dashboard's real Runtime / Auto-start / Monitor
      and Launcher / Favorites / Module flows into the live services.
- [ ] T006 Unit/integration tests for action parity, module failure isolation,
      navigation/origin denial, service persistence, and no idle polling.
- [ ] T007 Run separate-vs-merged measured benchmarks for CPU, memory, GUI
      startup, process count and action latency, with cold and warm trials.
- [ ] T008 Roll out behind opt-in launcher, validate on Windows, and keep
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

**Remaining:** Production-grade UI parity (detailed editor, all module views,
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
