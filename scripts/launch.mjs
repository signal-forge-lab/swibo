#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = path.join(root, "src-tauri", "Cargo.toml");
const executable = path.join(
  root,
  "src-tauri",
  "target",
  "release",
  process.platform === "win32" ? "mcp-supervisor.exe" : "mcp-supervisor"
);
const forceBuild = process.argv.includes("--build");

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
}

run(process.execPath, [path.join(root, "src", "cli.js"), "daemon", "start"], "Swibo daemon start");

if (forceBuild || !fs.existsSync(executable)) {
  run("cargo", ["build", "--release", "--manifest-path", manifest], "Swibo desktop build");
}

const child = spawn(executable, [], {
  cwd: root,
  detached: true,
  windowsHide: true,
  stdio: "ignore",
  env: { ...process.env, MCP_SUPERVISOR_ROOT: root }
});
child.once("error", (error) => {
  console.error(`Failed to launch Swibo: ${error.message}`);
  process.exitCode = 1;
});
child.once("spawn", () => {
  child.unref();
  console.log(`Swibo started. PID ${child.pid}`);
});
