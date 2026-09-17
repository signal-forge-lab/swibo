# Research: macOS support

## Current platform facts

- Swibo uses a shared Node daemon/CLI plus a Tauri 2 desktop shell.
- The current macOS machine is Apple Silicon and already has Node 24, npm, Rust 1.98, Cargo, Apple clang, and the macOS SDK via Xcode Command Line Tools.
- The current Windows launcher is PowerShell-specific, while the daemon and CLI already use Node APIs that are portable to macOS.
- `src/paths.js` currently falls back to Windows-shaped `AppData` paths on non-Windows systems.
- `src-tauri/build.rs` currently installs Windows build attributes unconditionally.

## Official platform guidance

Tauri 2 documents Xcode Command Line Tools as sufficient for macOS desktop development; full Xcode is required for iOS development. Tauri builds platform-native desktop artifacts on the platform being targeted.

Sources:

- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/distribute/
- https://v2.tauri.app/distribute/macos-application-bundle/

## Decision

Use one shared source tree. Keep the Node supervisor and registry contract platform-neutral, add native platform path resolution at the existing `src/paths.js` seam, replace the PowerShell-only top-level launcher with a Node launcher, and gate Windows-only Tauri build metadata with Rust `cfg(target_os = "windows")`.

Do not add a separate macOS supervisor implementation, shell-script launcher, signing pipeline, or bundle/notarization configuration in this feature.
