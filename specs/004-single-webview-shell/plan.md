# Implementation plan: single WebView2 host

## Chosen direction

Use the existing Swibo visual grammar and unified mock as the parent shell.
Keep Swibo's Node daemon and Loctl's generic manifest/adapter runtime as
independent *services*, but bring both visual surfaces into one Tauri host.
Do not merge their registries or duplicate Loctl's adapter implementation.

## Why iframe/shared profile shortcuts are rejected

- Swibo serves its dashboard at `http://127.0.0.1:17991/` and currently
  sets `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- Loctl's Tauri frontend CSP allows its own origin and Tauri IPC, not the
  Swibo localhost origin.
- Relaxing either security boundary merely to embed another full UI is
  contrary to the host's security contract.
- Assigning the same WebView2 user-data directory to two different Tauri
  executables does not eliminate two windows or guarantee process sharing.

## Staged implementation

1. **Capture parity baseline.** Record both apps' PID trees, WebView2
   user-data directories, memory, UI workflows, and rollback commands. Current
   baseline: Swibo WebView2 ~224 MB Private; Loctl ~219 MB Private, six child
   processes each (2026-10-10 audit).
2. **Local single-origin UI.** Promote the merged Swibo design to the Tauri
   local frontend. Add a strictly typed/allowlisted local command bridge to
   existing Swibo daemon APIs. Do not widen Swibo daemon CORS, Host/Origin or
   framing permissions.
3. **Reuse Loctl runtime.** Extend the existing Loctl binary with a bounded
   one-shot stdin/stdout JSON mode that calls the same in-process registry,
   adapter, icon and capability handlers already used by standalone Loctl.
   The merged host invokes this headless mode on demand through an allowlisted
   Tauri command; it never launches a second Loctl window or copies Loctl's
   module interpreter. This keeps the Rust core single-source and allows
   independent source repos and reversible rollout. No idle polling or extra
   resident Loctl process is needed.
4. **Compose one frontend.** Render Swibo and Loctl panels inside one
   JavaScript application and one WebView, with one-row tabs and preserved
   Autostart/Runtime first view. Reuse the checked-in unified mock and design
   parts; preserve source UI contracts rather than copying fake state.
5. **Shadow run and parity.** Keep existing UIs unchanged while exercising
   both backends via the merged host; test action parity and all failure
   states, then measure CPU/WS/Private/WebView2 process count.
6. **Opt-in cutover.** Switch only the GUI launcher to the unified executable.
   Keep both independent launchers and their registries for rollback until
   parity/security/resource gates are accepted.

## Test strategy and constraints

- Node: Swibo `npm run check`; Loctl `npm run check`.
- Rust: Swibo and Loctl `cargo test`, `cargo clippy -- -D warnings`.
- Live: Swibo cached status/SSE no busy polling, module icon+adapter isolation,
  daemon lifetime across GUI close, startup/rollback, offline dashboard state,
  normal and failure flows.
- Security: hostname and origin allowlists, local registry path checks,
  adapter command+args validation, no secrets in frontend/logs.
- No global `WebView2` environment overrides or service/process killing.

## Risks

The Swibo UI presently loads from an external loopback URL while Loctl loads
local Tauri assets. Changing this transport affects cookies/origin/API access;
it requires explicit integration tests rather than simply copying HTML.
The one-shot Loctl RPC must constrain stdin size and output size and preserve
the adapter's configured timeout; it must never interpret input as a shell
command or offer actions outside the existing capability contract.

## Status

Architecture and acceptance criteria established. No changes to either
production launcher yet.
