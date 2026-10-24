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

### Windows: independently managed daemon

Swibo is a local control plane, not just a status display: it owns explicit
target start/stop/restart actions and optional automatic startup. Its Tauri
desktop is a client of a separate loopback-only Node daemon, so the control
plane can continue working while the desktop is closed.

The desktop only ensures the daemon is started at desktop launch; it does
not repair a later daemon exit. On Windows, install the daemon as a per-user
Task Scheduler task instead. It starts on logon and can restart on failure
up to 30 times at one-minute intervals. No periodic UI status sweep is added.
The task runs Node through a hidden PowerShell wrapper, so a console window
cannot accidentally be closed during normal desktop use.

```powershell
pwsh -NoProfile -File scripts/manage-daemon-task.ps1 -Mode Status
pwsh -NoProfile -File scripts/manage-daemon-task.ps1 -Mode Install
```

To transfer an existing standalone daemon or legacy visible-console task,
explicitly use `-Mode Install -AdoptRunning`. Only the management daemon is transferred;
target services are not stopped. Repeating Install when an owned task is
already running is a no-op. `-Mode Uninstall` removes only the task.
The desktop offers **Stop daemon** in its header and **Start daemon** on its
local offline screen. The native Windows **Daemon** menu offers the same
controls even when the dashboard fails to load. Neither operation stops any
managed target. **Stop all runtimes** is a separate, explicit action.
Use `http://127.0.0.1:17991/api/health` to check runtime readiness.
An exit code indicating failure is retried by the scheduler; an intentional
clean exit or a process that remains alive but hangs is not automatically
repaired by this policy.

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

For example, BrowserSkill can be represented by starting its foreground daemon as a detached process, checking its loopback WebSocket port, and using the tool's own stop command:

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
      "unlessReady": "server",
      "waitFor": "server"
    }],
    "stop": [
      { "command": "${HOME}/.local/bin/bsk.exe", "args": ["daemon", "stop"] }
    ]
  },
  "checks": {
    "server": { "type": "tcp", "host": "127.0.0.1", "port": 52800 },
    "tunnel": { "type": "none" }
  }
}
```

Swibo does not terminate services using a cached PID alone. Legacy
`kind: "terminate"` and `processKey` registry fields are unsupported.
Use a target-owned stop command that verifies process identity.

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
