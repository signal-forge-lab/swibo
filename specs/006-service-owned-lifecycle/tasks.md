# Implementation tasks

- [x] Identify live registry PID termination usage (zero).
- [x] Reject legacy termination configuration at validation.
- [x] Remove transient PID-based termination implementation.
- [x] Update public English/Japanese examples and agent policy.
- [x] Add negative regression coverage.
- [x] Verify the live registry validates with the updated schema.
- [x] Pass Node.js validation/test gate.
- [x] Pass Tauri Rust validation/lint gate (11 Rust tests; clippy zero warnings).
- [x] Activate the revised daemon (PID 22344 -> 45712); existing service
  listeners stayed available and XMind remained STOPPED/manual.
- [x] Review staged Git diff for secrets or machine-specific values and commit.
