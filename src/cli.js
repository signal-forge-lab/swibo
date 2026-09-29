#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = `http://127.0.0.1:${process.env.MCP_SUPERVISOR_PORT || 17991}`;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

async function daemonStart() {
  try {
    await request("/api/health");
    console.log("Swibo daemon is already running.");
    return;
  } catch {}
  const child = spawn(process.execPath, [path.join(projectRoot, "src", "daemon.js")], {
    cwd: projectRoot,
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      await request("/api/health");
      console.log(`Swibo daemon started. PID ${child.pid}`);
      return;
    } catch {}
  }
  throw new Error("Swibo daemon did not become ready.");
}

function printStatus(targets) {
  const rows = targets.map((target) => ({
    target: target.name,
    state: target.state,
    server: target.server.ready ? "READY" : "DOWN",
    tunnel: target.tunnel.notApplicable ? "N/A" : target.tunnel.ready ? "READY" : "DOWN",
    startup: target.startupPolicy,
    error: target.error || ""
  }));
  console.table(rows);
}

async function main() {
  const [command = "status", arg] = process.argv.slice(2);
  if (command === "daemon") {
    if (arg === "start") return daemonStart();
    if (arg === "stop") return void console.log(await request("/api/shutdown", { method: "POST" }));
    if (arg === "status") return void console.log(await request("/api/health"));
    throw new Error("Usage: mcpctl daemon start|stop|status");
  }
  if (command === "status") {
    const value = await request("/api/refresh", { method: "POST" });
    const targets = arg ? value.targets.filter((target) => target.id === arg) : value.targets;
    printStatus(targets);
    return;
  }
  if (["start", "stop"].includes(command) && arg === "--all") {
    console.log(JSON.stringify(await request(`/api/${command}-all`, { method: "POST" }), null, 2));
    return;
  }
  if (["start", "stop", "restart"].includes(command) && arg) {
    console.log(JSON.stringify(await request(`/api/targets/${encodeURIComponent(arg)}/${command}`, { method: "POST" }), null, 2));
    return;
  }
  throw new Error("Usage: mcpctl status [id] | start|stop --all | start|stop|restart <id> | daemon start|stop|status");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
