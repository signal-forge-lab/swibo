# Service-owned lifecycle: remove unsafe PID termination

## Problem

Legacy `processKey` and `kind: "terminate"` use a transient PID cache.
The cache is lost when the Swibo daemon restarts, and a bare PID can be reused.
The current Windows live registry has no remaining consumer of either field.
The published BrowserSkill example still advertised the unsafe pattern.

## Requirements

1. Swibo remains a separate, always-on control daemon with an optional Tauri monitor.
2. Start/Stop/Restart invoke target-owned lifecycle commands and verify readiness.
3. Registry validation explicitly rejects legacy `kind: "terminate"` or
   `processKey` actions instead of silently ignoring them.
4. Core code has no cache-based process termination side effects.
5. README examples and agent operational policy must use the same contract.
6. Workstation-specific target definitions, secrets, running browsers, and
   unrelated services must not be changed.

## Acceptance

- Legacy PID actions fail validation with a migration hint.
- Service-owned lifecycle actions retain their existing behavior.
- Windows live registry validates under the new contract.
- Node tests and Tauri Rust tests/lints pass.
- Rollout is limited to the Swibo daemon; monitor is not rebuilt.
