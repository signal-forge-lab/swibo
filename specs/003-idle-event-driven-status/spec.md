# Feature Specification: Idle event-driven status

**Branch**: `feature/idle-event-driven-status`
**Status**: Accepted for implementation

## Goal

Make Swibo effectively idle when nobody is operating it. The daemon may keep its loopback HTTP
listener and in-memory state, but it must not continuously health-check every registered target.

## Requirements

- **R-001**: The dashboard must not run periodic status polling.
- **R-002**: `GET /api/status` returns the current cached snapshot without running target checks.
- **R-003**: `POST /api/refresh` performs an explicit fresh full status sweep and updates the cache.
- **R-004**: The dashboard performs a fresh check on initial load, explicit Refresh, and when it
  becomes visible again.
- **R-005**: The daemon exposes a loopback-only SSE status stream and pushes only when cached state
  changes. No periodic heartbeat timer is required on localhost.
- **R-006**: Start/Stop/Restart and component lifecycle actions refresh affected cached state and
  publish the result.
- **R-007**: Registry add/update/remove publishes the resulting cached state. Add/update may check
  only the affected target; remove performs no health check.
- **R-008**: `mcpctl status` remains fresh by using the explicit refresh endpoint.
- **R-009**: Swibo must not infer service death from a lifecycle wrapper child process exiting.
  Existing health checks remain authoritative for service state.
- **R-010**: The loopback Host/Origin security boundary remains unchanged.

## Acceptance Criteria

1. No dashboard `setInterval` or equivalent periodic health polling remains.
2. Cache unit tests prove full refresh, single-target refresh, registry reorder/removal, and
   per-target check timestamps.
3. UI contract tests prove EventSource/SSE consumption and explicit refresh semantics.
4. Node regression, Rust tests, clippy, and release build pass.
5. Live daemon verification shows repeated cached `GET /api/status` calls do not change target
   check timestamps while `POST /api/refresh` does.
6. With the dashboard left open and untouched, Swibo shows no recurring health-check traffic.
