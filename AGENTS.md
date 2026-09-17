# Swibo agent guide

Swibo is the local AI tool switchboard for starting, stopping, restarting, and checking local development services. MCP servers and Secure MCP Tunnels are the first managed workload, but the architecture may also represent independently controlled companion components such as desktop monitors. The product/display name is **Swibo**. Internal compatibility names such as the repository name `mcp-supervisor`, the `mcpctl` CLI, the loopback daemon port, and existing target IDs must not be renamed casually.

## What agents are allowed to change

Agents may add or update target definitions when the user asks Swibo to manage another local MCP service or related AI development tool. Keep the core supervisor generic. Do not add target-specific branching to `src/supervisor.js`, `src/runner.js`, or `src/checks.js` when the difference can be expressed declaratively in the registry or in the managed target's own wrapper script.

Primary target-definition locations:

- `config/config.example.json` — public, disabled generic example checked into Git. Do not replace it with workstation-specific targets.
- `%LOCALAPPDATA%\mcp-supervisor\registry.json` on Windows or `~/Library/Application Support/mcp-supervisor/registry.json` on macOS — live persisted registry used by the running daemon. Prefer the Swibo HTTP API for live changes instead of editing this file by hand.
- `POST /api/targets` — add one target to the live registry.
- `PUT /api/targets/:id` — replace one live target definition.
- `DELETE /api/targets/:id` — remove one live target definition. Removal does not imply killing unrelated processes.

Targets are not limited to MCP servers. A local AI utility may be represented when it has a deterministic lifecycle/check contract. Prefer the target's existing lifecycle wrappers instead of duplicating service-specific process management in Swibo.

Real workstation targets belong in the live registry. Keep `config/config.example.json` generic and safe to publish.

## Target contract

Each target uses this shape:

```json
{
  "id": "example-mcp",
  "name": "Example MCP",
  "enabled": true,
  "startupPolicy": "manual",
  "lifecycle": {
    "start": [
      {
        "command": "pwsh",
        "args": ["-NoProfile", "-File", "${HOME}/path/to/start.ps1"],
        "cwd": "${HOME}/path/to/project",
        "waitFor": "server"
      }
    ],
    "stop": [
      {
        "command": "pwsh",
        "args": ["-NoProfile", "-File", "${HOME}/path/to/stop.ps1"],
        "cwd": "${HOME}/path/to/project"
      }
    ]
  },
  "checks": {
    "server": { "type": "tcp", "host": "127.0.0.1", "port": 8000 },
    "tunnel": { "type": "none" }
  },
  "components": {
    "monitor": {
      "label": "Monitor",
      "lifecycle": {
        "start": [{ "command": "pwsh", "args": ["-NoProfile", "-File", "start-monitor.ps1"] }],
        "stop": [{ "command": "pwsh", "args": ["-NoProfile", "-File", "stop-monitor.ps1"] }]
      },
      "check": { "type": "pidFile", "path": "${SWIBO_STATE_HOME}/example-monitor.pid" }
    }
  }
}
```

Supported startup policy values are `manual` and `auto`.

Use the existing registry schema and tests as the source of truth for supported lifecycle/check fields. Current check implementations include `none`, `http`, `tcp`, `command`, `pidFile`, and `httpUrlFile`.

## Lifecycle rules

1. Keep `command` and `args` separate. Never encode shell pipelines, `&&`, redirections, or compound shell strings into a registry command.
2. Prefer an existing target-owned start/stop wrapper when one exists. Swibo should orchestrate it, not duplicate target-specific lifecycle knowledge.
3. Start and stop must be idempotent. Repeated Start on READY and repeated Stop on STOPPED must be safe.
4. A stop definition must identify only the intended service. Do not use broad `taskkill`, name-only process killing, wildcard process deletion, or unrelated port eviction.
5. For a service plus tunnel, keep server and tunnel checks separate. A server-up/tunnel-down state should remain repairable as DEGRADED rather than being treated as fully stopped.
6. Use `unlessReady`/`waitFor` declaratively where applicable instead of adding special-case code to the supervisor core.
7. Do not place API keys, OAuth tokens, passwords, tunnel credentials, or other secrets in registry JSON, source files, logs, or AGENTS.md. Runtime wrappers must resolve credentials from the project's canonical secret mechanism.
8. Do not change the loopback-only security boundary. The dashboard daemon remains bound to `127.0.0.1` and retains Host/Origin restrictions.
9. Optional companion processes such as GUI monitors belong under `components`. Component lifecycle is independent from the target's Server/Tunnel READY state: a target may be READY while its Monitor is STOPPED.
10. Component keys are generic. `monitor` is the first UI-exposed component, but core supervisor code must not hard-code any product-specific process name.
11. Use `${SWIBO_STATE_HOME}` for Swibo-owned cross-platform state paths. Existing `${LOCALAPPDATA}` and `${APPDATA}` expansion remains available for compatibility with Windows-specific target wrappers.

## AI procedure for adding a target

When the user asks an AI agent to add a new MCP to Swibo:

1. Inspect the target project's existing start, stop, status, health, and tunnel wrappers.
2. Reuse those wrappers whenever they are safe and deterministic.
3. Choose independent server/tunnel checks that do not create side effects. Add optional `components` only when a companion process needs independent lifecycle control.
4. Add/update the real target in the live registry via the loopback API. Do not put workstation-specific targets in the public default registry.
5. Keep the checked-in `config/config.example.json` as a disabled generic example unless the public schema example itself needs to change.
6. Verify the specific target Start → READY, Restart → READY, and Stop → STOPPED unless stopping it would disrupt the user's current work. If disruption is possible, verify non-destructively and report the remaining live test.
7. Run the Swibo regression gate before considering a code/config change complete.

Example live add from PowerShell 7:

```powershell
$target = Get-Content '.\target.json' -Raw
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:17991/api/targets' -ContentType 'application/json' -Body $target
```

Example live update:

```powershell
$id = 'example-mcp'
$target = Get-Content '.\target.json' -Raw
Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:17991/api/targets/$id" -ContentType 'application/json' -Body $target
```

## Validation gate

For Swibo source or durable registry changes, run:

```text
npm run check
cd src-tauri && cargo test && cargo clippy -- -D warnings
```

On Windows, `npm.cmd` may be used instead of `npm`. The shared desktop launcher is `node scripts/launch.mjs`; `scripts/launch.ps1` is only a Windows compatibility wrapper.

For desktop/icon changes also run a release build and launch the resulting app. Confirm the main window opens, the dashboard loads, and the native window icon is correct.

For a target-definition change, also inspect:

```text
node src/cli.js status <target-id>
```

The final state must not leave a false error string behind when the target is actually READY.

## Repository conventions

- Use Git for code/config changes.
- Keep `main` stable and public-ready, use `develop` for publishable in-progress integration, and use `feature/*` for isolated work.
- Do not use branches to separate public and secret/local data. Everything committed to this repository must be safe to publish.
- Keep the public remote named `origin`. Add a `private` remote only if a separate internal-only repository is explicitly required.
- Keep `.env`, `.env.*`, `secrets/`, `*.key`, `*.pem`, `config.local.json`, and `local/` outside Git.
- Preserve existing target IDs unless the user explicitly requests migration.
- Keep generated Tauri directories (`src-tauri/target`, `src-tauri/gen`, `src-tauri/icons`) untracked.
- Keep the static design sheet under `design/` as a reference; the live UI is `ui/index.html`, `ui/styles.css`, and `ui/app.js`.
- If the registry schema, lifecycle semantics, or AI add/update procedure changes, update this AGENTS.md in the same change.

<!-- iw-spec-kit-policy:start -->
## Spec Kit development authority

- This repository follows the formal Intelligence Works Spec Kit baseline. Small changes that do not introduce a new behavior contract may use direct Engineering Skills; behavior/interface/acceptance-criteria/design changes use Spec Kit Agentic SDD; DSH External Workflow is added only for durable/parallel/resumable execution.
- Authority is split deliberately: `AGENTS.md` = operational policy; `.specify/memory/constitution.md` = repository development principles; `spec.md` = requirements/AC; `plan.md` = technical design; `tasks.md` = development state; DSH/External Workflow = execution state; Code/Tests/verification = implemented and verified facts.
- External Workflow may execute/retry/resume/recover Spec Kit tasks and return evidence, but it must not silently change requirements, weaken acceptance criteria, replace plan decisions, or create a competing canonical task hierarchy.
- Memory is supplemental context only; do not mirror current repository-authoritative Spec Kit/Git/code/test state into Memory.
- Shared version pin, rollout policy, and detailed rationale are owned by `tools/dsh-workflow-dispatch/docs/SPECKIT_FORMAL_ADOPTION_20260914.md` from the Intelligence Works root.
<!-- iw-spec-kit-policy:end -->
