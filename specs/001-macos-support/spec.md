# Feature Specification: macOS support

**Feature Branch**: `feature/macos-support`

**Created**: 2026-09-18

**Status**: Accepted for implementation

**Input**: User description: "swiboをmacに対応したいです。"

## User Scenarios & Testing

### User Story 1 - Run Swibo on macOS (Priority: P1)

As a macOS user, I can start Swibo from the repository with the same dashboard, daemon, CLI, target lifecycle, and loopback-only security model used on Windows.

**Independent Test**: On an Apple Silicon Mac with Node, Rust, and Xcode Command Line Tools installed, `npm run desktop:build` builds and launches Swibo, and `http://127.0.0.1:17991/api/health` returns success.

**Acceptance Scenarios**:

1. **Given** a clean macOS checkout, **When** the user runs the desktop launcher, **Then** Swibo starts its daemon and native Tauri window without requiring PowerShell.
2. **Given** Swibo is running on macOS, **When** the dashboard loads, **Then** target status and lifecycle operations use the existing generic registry contract.
3. **Given** the same source is built on Windows, **When** existing verification runs, **Then** current Windows behavior remains unchanged.

### User Story 2 - Keep macOS state in a native user-data location (Priority: P1)

As a macOS user, Swibo stores its live registry, PID, and event state outside the repository in the standard per-user Application Support area rather than a Windows-shaped fallback path.

**Independent Test**: Platform-path tests resolve the macOS state root to `~/Library/Application Support/mcp-supervisor`, while Windows continues to resolve to `%LOCALAPPDATA%\mcp-supervisor`.

**Acceptance Scenarios**:

1. **Given** macOS with no explicit state override, **When** Swibo resolves its state directory, **Then** it uses `~/Library/Application Support/mcp-supervisor`.
2. **Given** Windows, **When** Swibo resolves its state directory, **Then** it continues using `%LOCALAPPDATA%\mcp-supervisor`.
3. **Given** a registry path containing `${SWIBO_STATE_HOME}`, **When** it is expanded on either platform, **Then** it resolves to the active Swibo state directory.

### User Story 3 - Preserve a single cross-platform source tree (Priority: P2)

As a maintainer, I can support Windows and macOS without duplicating the supervisor core or creating platform-specific product forks.

**Independent Test**: The Node supervisor/daemon modules remain shared; platform-specific behavior is limited to path resolution, launcher executable selection, and Tauri build metadata.

**Acceptance Scenarios**:

1. **Given** a target with platform-appropriate wrapper commands, **When** Swibo executes it, **Then** the existing lifecycle/check implementation works without target-specific branches in core supervisor code.
2. **Given** the Tauri build script runs on macOS, **When** it builds resources, **Then** Windows-only ICO configuration is not required.

### Edge Cases

- A repository-launched macOS app must still locate the project root even when the native executable is under `src-tauri/target/release`.
- Finder-launched distribution packaging, signing, notarization, auto-update, and App Store delivery are out of scope for this feature.
- Existing Windows live registry files and `${LOCALAPPDATA}` references must remain valid.
- A user may override Swibo's state root explicitly for testing or nonstandard installations.

## Requirements

### Functional Requirements

- **FR-001**: Swibo MUST run its daemon, CLI, dashboard, and Tauri desktop shell on macOS without requiring PowerShell.
- **FR-002**: Swibo MUST preserve existing Windows runtime and state-path behavior.
- **FR-003**: macOS MUST use `~/Library/Application Support/mcp-supervisor` as the default Swibo state root.
- **FR-004**: Swibo MUST expose a cross-platform `${SWIBO_STATE_HOME}` path variable for registry paths.
- **FR-005**: The public example registry MUST use cross-platform path variables rather than a Windows-only state path.
- **FR-006**: Desktop launch scripts MUST use Node as the shared launcher and select the native release executable by platform.
- **FR-007**: Tauri build configuration MUST compile on Windows and macOS without applying Windows-only build attributes on macOS.
- **FR-008**: The daemon MUST remain bound to `127.0.0.1` with the existing Host/Origin restrictions.
- **FR-009**: macOS support MUST NOT add target-specific branching to the generic supervisor/check/runner core.
- **FR-010**: The implementation MUST be validated on the user's Apple Silicon Mac, not only by cross-platform unit tests on Windows.

## Success Criteria

- **SC-001**: Windows Node regression suite and Tauri Rust tests/clippy remain green.
- **SC-002**: macOS Node regression suite and Tauri Rust tests/clippy pass on the actual Mac.
- **SC-003**: `npm run desktop:build` succeeds on the Mac and launches a Swibo native window backed by a healthy loopback daemon.
- **SC-004**: A new macOS live registry is created under `~/Library/Application Support/mcp-supervisor` and not inside the repository.
- **SC-005**: No public-repository file contains workstation-specific Mac paths or credentials.

## Assumptions

- macOS desktop support targets the user's current Apple Silicon Mac first.
- Node 24+, Rust 1.98+, and Xcode Command Line Tools are available on that Mac.
- Repository-local development/run support is the scope; distributable signed/notarized `.app`/DMG packaging is a separate feature.
