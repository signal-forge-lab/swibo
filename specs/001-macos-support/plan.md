# Implementation Plan: macOS support

**Branch**: `feature/macos-support` | **Date**: 2026-09-18 | **Spec**: `specs/001-macos-support/spec.md`

## Summary

Extend Swibo's existing Node/Tauri architecture to macOS while preserving Windows compatibility. Platform variation stays behind three existing seams: state-path resolution, repository desktop launch, and Tauri build metadata. The supervisor, checks, registry schema, daemon HTTP surface, and UI remain shared.

## Technical Context

**Language/Version**: Node.js >=22 (tested with Node 24), Rust 1.98 / edition 2021

**Primary Dependencies**: Node standard library, Tauri 2.11.5, tauri-build 2.6.3

**Storage**: User-local JSON/log/PID files outside the repository

**Testing**: Node `node:test`; Rust `cargo test` + `cargo clippy`; real macOS release build/launch smoke

**Target Platform**: Windows 11 and macOS 27 Apple Silicon

**Project Type**: Local desktop app + loopback daemon

**Constraints**: Preserve loopback-only security, existing Windows live registry location, generic target lifecycle contract, and internal compatibility names

## Constitution Check

- Explicit authority: this feature has `spec.md`, `plan.md`, and `tasks.md`.
- Minimal correct change: reuse Node stdlib and Tauri's existing cross-platform shell; no new dependency or duplicate Mac core.
- Verification: Node, Rust, Windows compatibility, and real Mac build/run gates are required.
- Security: loopback binding and Host/Origin restrictions remain unchanged.
- Authority changes: any scope expansion into signed distribution requires a spec update rather than silent implementation.

## Design

### State-path seam

`src/paths.js` becomes the single platform-aware path resolver. It keeps Windows `%LOCALAPPDATA%` semantics, uses macOS Application Support by default, provides `${SWIBO_STATE_HOME}`, and accepts an explicit `MCP_SUPERVISOR_STATE_DIR` override.

### Desktop-launch seam

Add `scripts/launch.mjs` using only Node standard-library process/path APIs. `package.json` points `desktop` and `desktop:build` at it. The launcher starts the existing daemon through `src/cli.js`, builds when requested/missing, then starts `mcp-supervisor.exe` on Windows or `mcp-supervisor` elsewhere. `scripts/launch.ps1` remains a Windows compatibility wrapper.

### Tauri build seam

`src-tauri/build.rs` continues generating the shared PNG context icon on every platform. ICO generation and `WindowsAttributes` are compiled only for Windows; macOS runs normal `tauri_build` attributes.

### Documentation/config

The generic registry example uses `${SWIBO_STATE_HOME}`. English/Japanese docs and `AGENTS.md` document both state locations and platform-neutral launcher behavior.

## Project Structure

```text
specs/001-macos-support/
├── spec.md
├── research.md
├── plan.md
├── quickstart.md
└── tasks.md

src/paths.js
scripts/launch.mjs
scripts/launch.ps1
src-tauri/build.rs
config/config.example.json
tests/platform-support.test.js
docs/README.md
docs/README_ja.md
AGENTS.md
```

## Complexity Tracking

No constitution violation. No new runtime dependency or new architectural layer is required.
