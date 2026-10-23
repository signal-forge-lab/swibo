# Plan

- Confirm live use of `processKey` and `kind: "terminate"` across all
  registered targets and components. Both counts were zero at inspection.
- Remove the transient PID map and direct PID termination helper; refuse
  legacy registry fields at validation.
- Update BrowserSkill examples in both readmes and agent instructions.
- Add regression tests for rejected legacy actions.
- Run `npm run check`, `cargo test`, and `cargo clippy -- -D warnings`.
- Restart only the scheduled Swibo management daemon after validation,
  verifying that target services are not stopped and remain healthy.
