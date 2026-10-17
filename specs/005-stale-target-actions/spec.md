# Recover actions from stale target status

## Context

Swibo deliberately does not poll service health while idle. Cached status older than two
minutes becomes STALE. Previously, STALE also disabled all lifecycle controls. This
effectively disabled the dashboard until an unrelated full refresh, contradicting its
idle/event-driven contract.

## Required behavior

- Retain the visible STALE label; never represent old observations as current health.
- Keep target and component lifecycle controls available when only the observation is stale.
- Before a lifecycle action initiated against stale state, check only the selected target
  through a loopback-only explicit endpoint.
- If the newly observed state changes which primary operation would be selected, cancel
  the original Start/Stop request, display the updated state, and ask the user to select
  the appropriate action again. Never reinterpret Start into Stop or vice versa.
- Restart remains a deliberately requested operation, but must still pass the fresh check.
- Failed checks prevent the lifecycle action and show an error, leaving STALE visible.
- A check never starts, stops, or restarts the managed workload by itself.
- Preserve no-periodic-health-polling behavior, existing lifecycle safety, Host/Origin checks,
  and current Auto Start controls. Apply the same behavior in both the classic dashboard
  and the opt-in unified WebView, including the unified bridge route allowlist.

## Acceptance

1. Contract and decision tests cover stale actions, changed observed state, component
   actions, disabled targets, failed checks and refusal to invoke lifecycle on mismatch.
2. `POST /api/targets/:id/refresh` fresh-checks only the selected target, updates its
   cache timestamp, and sends SSE. Full-sweep `checkedAt` does not change.
3. No periodic polling or automatic full refresh is added.
4. Node and Rust gates pass. An isolated daemon verifies target-only refresh.
5. The current desktop build serves the change without restarting managed targets unnecessarily.
