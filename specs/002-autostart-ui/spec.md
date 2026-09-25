# Feature Specification: Auto Start controls

**Branch**: `feature/autostart-ui`
**Status**: Accepted for implementation

## Goal

Let users see and change which Swibo targets start automatically when the Swibo daemon starts,
without opening the raw JSON editor.

## Requirements

- **R-001**: Each target row exposes an accessible `Auto Start` on/off control.
- **R-002**: Changing `Auto Start` updates only the target's `startupPolicy` between
  `auto` and `manual`; it must not start, stop, or restart the target immediately.
- **R-003**: The target panel shows the current number of auto-start targets.
- **R-004**: The target list provides a compact `Auto Start` filter in addition to `All`.
- **R-005**: Filter and switch controls use native buttons with visible state and accessible
  pressed/checked state.
- **R-006**: Existing target lifecycle controls, JSON editing, and registry validation remain unchanged.

## Acceptance Criteria

1. UI contract tests cover the per-target Auto Start control, count, filter, switch semantics, and PUT-based update.
2. Toggling Auto Start persists through the existing target update API and does not invoke lifecycle actions.
3. Full Node regression passes.
4. Release desktop build passes and the Swibo window opens with the new controls.
