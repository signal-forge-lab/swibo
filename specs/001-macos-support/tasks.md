# Tasks: macOS support

## Phase 1: Contract and regression guards

- [x] T001 [US2] Add failing platform-path tests in `tests/platform-support.test.js` for Windows preservation, macOS Application Support, and explicit state override.
- [x] T002 [US1] Add failing repository contract assertions that desktop scripts no longer require PowerShell and the public example uses `${SWIBO_STATE_HOME}`.

## Phase 2: Cross-platform implementation

- [x] T003 [US2] Implement platform-aware state/path variables in `src/paths.js`.
- [x] T004 [US1] Add shared Node desktop launcher in `scripts/launch.mjs`, retain `scripts/launch.ps1` as compatibility wrapper, and update `package.json`.
- [x] T005 [US3] Gate Windows-only icon/build attributes in `src-tauri/build.rs`.
- [x] T006 [US2] Update `config/config.example.json`, `AGENTS.md`, and English/Japanese docs for cross-platform state/launch semantics.

## Phase 3: Verification

- [x] T007 Run Windows `npm.cmd run check`, Tauri tests, clippy, and release build.
- [x] T008 Transfer the verified feature branch to the user's Mac without publishing the private development branch.
- [x] T009 Run Mac Node tests, Tauri tests/clippy, release build, desktop launch, daemon health, and state-location smoke.
- [x] T010 Re-run Windows regression if Mac verification requires code changes, then fast-forward the verified feature branch into local `develop`.

## Completion

The feature is complete only when Windows regression remains green and the actual Apple Silicon Mac successfully builds and launches Swibo with its live state outside the repository.
