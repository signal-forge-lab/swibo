import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DASHBOARD_STATUS_URL = "http://127.0.0.1:17991/api/status";

async function readRequest() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

function reply(value) {
  process.stdout.write(JSON.stringify(value));
}

function canonicalTargetState(state) {
  if (state === "READY") return "READY";
  if (state === "DEGRADED") return "ATTENTION";
  if (state === "STARTING" || state === "STOPPING") return "RUNNING";
  if (state === "STOPPED") return "STOPPED";
  return "UNKNOWN";
}

async function status() {
  try {
    const response = await fetch(DASHBOARD_STATUS_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    const ready = targets.filter((target) => target.state === "READY").length;
    const attention = targets.filter((target) => target.state === "DEGRADED").length;
    const stopped = targets.filter((target) => target.state === "STOPPED").length;
    return {
      ok: true,
      state: "READY",
      detail: `${ready}/${targets.length} targets ready`,
      updatedAt: new Date().toISOString(),
      signals: [
        { id: "targets", label: "Targets", value: String(targets.length), detail: "registered services" },
        { id: "ready", label: "Ready", value: String(ready), detail: "currently ready" },
        { id: "attention", label: "Attention", value: String(attention), detail: `${stopped} stopped` }
      ],
      quickView: targets.slice(0, 8).map((target) => ({
        id: String(target.id),
        label: String(target.name),
        state: canonicalTargetState(target.state),
        detail: String(target.error || target.server?.detail || "")
      })),
      activity: []
    };
  } catch (error) {
    return {
      ok: true,
      state: "STOPPED",
      detail: "Swibo daemon is not reachable",
      updatedAt: new Date().toISOString(),
      signals: [
        { id: "daemon", label: "Daemon", value: "OFF", detail: String(error?.message || error) }
      ],
      quickView: [],
      activity: []
    };
  }
}

function openSwibo(moduleDir) {
  const cli = path.join(moduleDir, "src", "cli.js");
  const exe = path.join(moduleDir, "src-tauri", "target", "release", "mcp-supervisor.exe");
  if (!fs.existsSync(exe)) {
    return { ok: false, message: "Swibo release executable is missing; run npm run desktop:build" };
  }

  const daemon = spawnSync(process.execPath, [cli, "daemon", "start"], {
    cwd: moduleDir,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000
  });
  if (daemon.status !== 0) {
    return { ok: false, message: `Unable to start Swibo daemon: ${(daemon.stderr || daemon.stdout || "").trim()}` };
  }

  const child = spawn(
    exe,
    [],
    { cwd: moduleDir, detached: true, stdio: "ignore", windowsHide: false }
  );
  child.unref();
  return { ok: true, message: "Swibo launch requested" };
}

const request = await readRequest();
if (request.protocol !== "modora.adapter/v1" || request.moduleId !== "swibo") {
  reply({ ok: false, message: "Unsupported Modora request" });
} else if (request.action === "status") {
  reply(await status());
} else if (request.action === "open") {
  reply(openSwibo(request.context.manifestDir));
} else {
  reply({ ok: false, message: `Unsupported action: ${request.action}` });
}
