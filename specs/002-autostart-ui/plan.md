# Implementation Plan: Auto Start controls

1. Reuse the existing `PUT /api/targets/:id` endpoint; add no new daemon endpoint.
2. Render a compact `Auto Start` switch inside each target identity cell so the existing four-column layout stays unchanged.
3. Add a panel-level count plus `All` / `Auto Start` filter buttons.
4. Keep filter state client-side only.
5. Persist policy changes by cloning the target from `snapshot.registry.targets`, changing only
   `startupPolicy`, issuing PUT, then refreshing.
6. Verify with UI contract tests, full regression, release build, and live launch.
