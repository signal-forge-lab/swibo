# Swibo

[日本語](README.ja.md)

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

```powershell
npm.cmd run desktop
```

The desktop launcher builds the release executable when needed. To force a rebuild:

```powershell
npm.cmd run desktop:build
```

Daemon only:

```powershell
node .\src\cli.js daemon start
```

## CLI

```powershell
node .\src\cli.js status
node .\src\cli.js status example-service

node .\src\cli.js start --all
node .\src\cli.js stop --all

node .\src\cli.js start example-service
node .\src\cli.js restart example-service
node .\src\cli.js stop example-service

node .\src\cli.js daemon status
node .\src\cli.js daemon stop
```

## Registry

The checked-in registry is intentionally a **disabled generic example**:

```text
config/default-registry.json
```

Swibo copies that file only when no live registry exists. The live user configuration is stored outside the repository:

```text
%LOCALAPPDATA%\mcp-supervisor\registry.json
```

Configure real services in the live registry through the UI/API instead of committing workstation-specific paths or credentials.

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

```powershell
npm.cmd run check
cargo test --manifest-path .\src-tauri\Cargo.toml
cargo clippy --manifest-path .\src-tauri\Cargo.toml -- -D warnings
cargo build --release --manifest-path .\src-tauri\Cargo.toml
```
