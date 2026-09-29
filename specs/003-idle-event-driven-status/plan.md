# Implementation Plan: Idle event-driven status

1. Add a small daemon-owned `StatusCache` with full-sweep and single-target update operations.
2. Keep `Supervisor` as the health/lifecycle authority; do not move caching into the generic
   supervisor and do not add target-specific branches.
3. Change `GET /api/status` to cached-only and add `POST /api/refresh` for fresh full checks.
4. Add `GET /api/events` as an SSE stream backed by a set of connected loopback clients.
5. Publish after cache mutations only; do not add heartbeat or monitoring timers.
6. Update action and registry mutation handlers to refresh the smallest necessary cache scope.
7. Update the dashboard to use EventSource and remove the 3-second interval.
8. Keep CLI status fresh by switching it to `POST /api/refresh`.
9. Verify runtime behavior and resource-idle behavior before merging.
