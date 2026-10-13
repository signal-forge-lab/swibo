# Swibo

[日本語](README_ja.md)

Swibo is a local service switchboard for starting, stopping, restarting, and checking development tools from one loopback-only daemon, CLI, and desktop UI.

MCP servers and Secure MCP Tunnels are supported, but the core supervisor is generic. A target can expose a Server check, an optional Tunnel check, and independently controlled components such as a Monitor.

## Dashboard model

Each target stays on one compact row:

- **Runtime** is the aggregate target state derived from the configured Server and Tunnel checks.
- **Monitor** is an independent optional component with its own lifecycle.
- Runtime and Monitor each expose one state-dependent **Start / Stop** button plus **Restart**.
- Expand a target to inspect Server/Tunnel details, startup policy, technical status, and target editing.

Runtime states are primarily:

- `READY`: every applicable Runtime check is ready.
- `DEGRADED`: some applicable Runtime checks are ready and others are down.
- `STOPPED`: every applicable Runtime check is down.
- `STARTING` / `STOPPING`: a lifecycle action is currently running.

## Start

From the repository root:

```text
Windows: npm.cmd run desktop
macOS:   npm run desktop
```

The desktop launcher builds the release executable when needed. To force a rebuild:

```text
Windows: npm.cmd run desktop:build
macOS:   npm run desktop:build
```

Daemon only:

```text
node src/cli.js daemon start
```

## CLI

```text
node src/cli.js status
node src/cli.js status example-service

node src/cli.js start --all
node src/cli.js stop --all

node src/cli.js start example-service
node src/cli.js restart example-service
node src/cli.js stop example-service

node src/cli.js daemon status
node src/cli.js daemon stop
```

## Registry

The checked-in registry is intentionally a **disabled generic example**:

```text
config/config.example.json
```

Swibo copies that file only when no live registry exists. The live user configuration is stored outside the repository:

```text
Windows: %LOCALAPPDATA%\mcp-supervisor\registry.json
macOS:   ~/Library/Application Support/mcp-supervisor/registry.json
```

Registry paths may use `${SWIBO_STATE_HOME}` when they need to live beside Swibo's platform-specific state. Existing `${LOCALAPPDATA}` / `${APPDATA}` references remain supported for compatibility.

Configure real services in the live registry through the UI/API instead of committing workstation-specific paths or credentials.

### Non-MCP CLI/daemon tools

Swibo can supervise local AI utilities that are not MCP servers when they expose a deterministic lifecycle and a side-effect-free readiness check. Keep product-specific behavior in the tool itself; Swibo should only own process lifecycle and observation.

For example, BrowserSkill can be represented by starting its foreground daemon as a detached owned process, checking its loopback WebSocket port, and using the tool's own stop command:

```json
{
  "id": "browser-skill",
  "name": "BrowserSkill",
  "enabled": true,
  "startupPolicy": "auto",
  "lifecycle": {
    "start": [{
      "command": "${HOME}/.local/bin/bsk.exe",
      "args": ["daemon", "start", "--foreground"],
      "detached": true,
      "processKey": "server",
      "unlessReady": "server",
      "waitFor": "server"
    }],
    "stop": [
      { "command": "${HOME}/.local/bin/bsk.exe", "args": ["daemon", "stop"] },
      { "kind": "terminate", "processKey": "server" }
    ]
  },
  "checks": {
    "server": { "type": "tcp", "host": "127.0.0.1", "port": 52800 },
    "tunnel": { "type": "none" }
  }
}
```

This is a lifecycle target, not an MCP declaration. Browser extension installation and browser permission prompts remain outside Swibo.

### Automatic startup dependencies

An auto-start target can specify `"dependsOn": ["workbridge", "cua-driver"]` when those
targets must be READY first. Dependencies must refer to enabled `auto` targets; unknown
targets and cycles are rejected. Independent targets still start concurrently (up to three).
If a dependency fails, its dependent target is not started. Explicit manual Start is unchanged.

## Git and local/private data

Swibo keeps development flow and confidentiality as separate concerns:

```text
main
  ↑
develop
  ↑
feature/*
```

- `main` is the stable, public-ready branch.
- `develop` may contain in-progress work, but everything committed there must still be safe to publish.
- `feature/*` is used for isolated changes before they are merged into `develop`.
- Public/private separation is **not** implemented with branches. Secrets, workstation-specific paths, and local-only data must stay outside Git.
- The public remote is named `origin`. A separate private repository may be added as `private` only when internal-only source code is actually required.

The checked-in example is `config/config.example.json`. Local-only material belongs in ignored paths such as `.env`, `config.local.json`, `secrets/`, or `local/`. Swibo's actual live target registry remains outside the repository under the user-local application data directory.

Example target:

```json
{
  "id": "example-service",
  "name": "Example Service",
  "enabled": false,
  "startupPolicy": "manual",
  "lifecycle": {
    "start": [
      {
        "command": "node",
        "args": ["scripts/service.js", "start"],
        "cwd": "${HOME}/path/to/example-service",
        "waitFor": "server"
      }
    ],
    "stop": [
      {
        "command": "node",
        "args": ["scripts/service.js", "stop"],
        "cwd": "${HOME}/path/to/example-service"
      }
    ]
  },
  "checks": {
    "server": { "type": "tcp", "host": "127.0.0.1", "port": 8000 },
    "tunnel": { "type": "none" }
  }
}
```

### Supported checks

- `http`
- `httpUrlFile`
- `tcp`
- `command`
- `pidFile`
- `none`

### Lifecycle rules

- Keep `command` and `args` separate; registry commands are not shell pipelines.
- `unlessReady` can skip work that is already ready.
- `waitFor` waits for a Server or Tunnel check after an action.
- Start/Stop operations are expected to be idempotent.
- Prefer an existing service-owned wrapper instead of duplicating service-specific lifecycle logic inside Swibo.
- Components such as `monitor` have an independent lifecycle and check.
- Do not store API keys, passwords, OAuth tokens, or tunnel credentials in registry JSON.

Removing a target from the registry does not implicitly kill unrelated external processes.

## Local security boundary

The daemon listens only on `127.0.0.1:17991` and applies loopback Host/Origin restrictions. Service credentials remain the responsibility of the service wrappers Swibo launches; Swibo does not need to persist them.

Generated/local runtime state is excluded from source control.

## Verification

```text
npm run check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo build --release --manifest-path src-tauri/Cargo.toml
```

On Windows, `npm.cmd` can be used in place of `npm`. macOS desktop development requires Node, Rust, and Xcode Command Line Tools. The current launcher is for repository-local development; signing, notarization, and DMG distribution are not part of this workflow.
