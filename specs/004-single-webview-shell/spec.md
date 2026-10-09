# Unified Swibo + Loctl Shell: single WebView2 host

## Context

Swibo and Loctl currently run as separate Tauri applications with separate
WebView2 user-data directories. The Windows audit on 2026-10-10 measured their
WebView2 groups at approximately 224 MB and 219 MB Private Bytes, respectively.
These figures are not guaranteed recoverable memory.

An existing design prototype is available at
`design/loctl-swibo-unified-mock.html`. It is sample UI, not a running app.

## User outcome

Operate all existing Swibo runtime controls and Loctl module capabilities from
one desktop window and one WebView2 host, with no reduction in monitoring,
autostart, start/stop/restart, launch, module, or monitor actions.

## Functional requirements

- **R1 Single visual runtime:** Production integration MUST use one Tauri
  main window, one WebView2 host/user-data directory, and one combined
  JavaScript UI. It MUST NOT solve the problem by embedding a second native
  WebviewWindow or by silently continuing to launch two GUI processes.
- **R2 Swibo compatibility:** Preserve daemon `127.0.0.1:17991`, existing
  target IDs, registry, lifecycle semantics, cached status, SSE events,
  explicit Refresh, and event-driven idle behavior.
- **R3 Loctl compatibility:** Preserve the external module registry,
  `loctl.module/v1` manifests, process-json-v1 adapters, capability checking,
  timeouts, module-local icons, statuses, and failure isolation. No
  tool-specific branches in the generic host.
- **R4 UI:** Use the existing unified mock and Swibo design-parts sheet.
  One horizontal row of top tabs; runtime auto-start visible on first view;
  start/stop/restart and monitor buttons always accessible; details expand;
  launcher Favorites stays on one line.
- **R5 Security:** Keep the Swibo loopback Host/Origin restrictions, CSP
  `frame-ancestors 'none'`, and `X-Frame-Options: DENY`; do not enable
  arbitrary remote iframe contents or arbitrary commands. Bridge to the daemon
  through a restricted local-host API boundary if the UI moves to a Tauri
  origin. Loctl adapter trust and input validation remain unchanged.
- **R6 Independent service lifetime:** Closing or restarting the merged GUI
  must not kill the Swibo daemon or independently managed runtimes.
- **R7 Rollback:** Keep both existing standalone launchers functional until
  the merged shell passes parity, security, and measured resource gates.
  Cutover must be explicitly reversible.
- **R8 Measurements:** Compare the separate and merged configurations under
  equivalent workloads using per-owner WebView2 PID counts, Private Bytes,
  Working Set, CPU, startup time, and action latency. Improvement claims
  require measured differences, not a sum of theoretical process savings.

## Acceptance tests

1. One merged window can show all configured Swibo targets and all registered
   Loctl modules, including errors for unavailable modules.
2. Runtime Start, Stop, Restart, Monitor, autostart, module Open/Status,
   and signal/activity views have the same results as in the old applications.
3. Two separate WebView2 user-data directories are not required by the merged
   UI; only the merged shell owns its visual WebView2 processes.
4. Cross-origin navigation, unexpected Host/Origin, unsafe module action, and
   arbitrary frame embedding are rejected as before.
5. Closing the window leaves managed services running.
6. `npm run check`, Swibo Rust tests/clippy, Loctl tests, and live smoke
   checks pass; rollback to both standalone apps remains possible.

## Current state

Specification drafted. Runtime implementation and cutover not yet started.
