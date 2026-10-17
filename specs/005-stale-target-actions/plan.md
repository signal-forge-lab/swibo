# Plan

1. Add a pure front-end decision helper for evaluating the originally requested action
   against the fresh status. Test mismatches and invalid/transitional states.
2. Expose existing daemon `refreshTargetStatus(id)` as a scoped POST route with no
   lifecycle side effects.
3. Keep stale controls enabled; derive primary button from the last *observed* state
   while labeling the state STALE and indicating that the click checks first.
4. In the UI, conditionally call scoped refresh before an action on stale data.
   Apply the latest cached snapshot, reject mismatched/failed checks, then execute
   the originally requested lifecycle action only when verified.
5. Run regression and verify behavior on a separate port with a disabled isolated
   registry before changing a running daemon.
6. Extend the opt-in unified bridge with an ID-validated scoped refresh route. Use the
   same fresh-action decision policy in the unified WebView without loosening the bridge
   allowlist or silently converting one action into another.
