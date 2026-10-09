# Implementation tasks and evidence

- [x] T001 Audit both current Tauri hosts, UI origins, native command paths,
      WebView2 owner groups, and current unified HTML prototype.
- [x] T002 Document the single-WebView2 contract, origin/security boundaries,
      acceptance tests, and rollback requirements.
- [ ] T003 Create opt-in merged local-origin frontend entry point with one
      WebView and a restricted Swibo daemon command bridge.
- [ ] T004 Extract/reuse the Loctl Rust module runtime in the merged host;
      preserve user registry and process-json-v1 semantics.
- [ ] T005 Wire the merged dashboard's real Runtime / Auto-start / Monitor
      and Launcher / Favorites / Module flows into the live services.
- [ ] T006 Unit/integration tests for action parity, module failure isolation,
      navigation/origin denial, service persistence, and no idle polling.
- [ ] T007 Run separate-vs-merged measured benchmarks for CPU, memory, GUI
      startup, process count and action latency, with cold and warm trials.
- [ ] T008 Roll out behind opt-in launcher, validate on Windows, and keep
      rollback paths until explicit cutover approval.

**Current status:** Specification and design complete. Runtime integration,
test gates and rollout remain open.
