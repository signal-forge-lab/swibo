import fs from "node:fs";
import net from "node:net";

import { expandPath, expandValue } from "./paths.js";
import { runCommand } from "./runner.js";

function tcpCheck({ host = "127.0.0.1", port, timeoutMs = 750 }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ready, detail) => {
      socket.destroy();
      resolve({ ready, detail });
    };
    socket.setTimeout(timeoutMs, () => done(false, "timeout"));
    socket.once("connect", () => done(true, `${host}:${port}`));
    socket.once("error", (error) => done(false, error.code || error.message));
  });
}

async function httpCheck({ url, timeoutMs = 1000, expectedStatus = 200 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(expandValue(url), { signal: controller.signal });
    return { ready: response.status === expectedStatus, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ready: false, detail: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function httpUrlFileCheck({ path: urlFilePath, pathSuffix = "/readyz", ...options }) {
  try {
    const file = expandPath(urlFilePath);
    if (!fs.existsSync(file)) return { ready: false, detail: "health URL file missing" };
    const baseUrl = fs.readFileSync(file, "utf8").trim();
    if (!baseUrl) return { ready: false, detail: "health URL file empty" };
    const url = new URL(pathSuffix, `${baseUrl.replace(/\/$/, "")}/`).toString();
    return await httpCheck({ ...options, url });
  } catch (error) {
    return { ready: false, detail: error.message };
  }
}

function readJsonPath(value, jsonPath) {
  return jsonPath.split(".").reduce((current, key) => current?.[key], value);
}

async function commandCheck(spec) {
  try {
    const result = await runCommand({ ...spec, detached: false, timeoutMs: spec.timeoutMs || 5000 });
    const expectedExitCode = spec.expectedExitCode ?? 0;
    if (result.code !== expectedExitCode) return { ready: false, detail: `exit ${result.code}` };
    if (spec.jsonPath) {
      const parsed = JSON.parse(result.stdout.trim());
      const actual = readJsonPath(parsed, spec.jsonPath);
      const ready = Object.is(actual, spec.equals ?? true);
      return { ready, detail: `${spec.jsonPath}=${JSON.stringify(actual)}` };
    }
    return { ready: true, detail: "exit 0" };
  } catch (error) {
    return { ready: false, detail: error.message };
  }
}

function pidFileCheck(spec) {
  try {
    const file = expandPath(spec.path);
    if (!fs.existsSync(file)) return { ready: false, detail: "pid file missing" };
    const pid = Number.parseInt(fs.readFileSync(file, "utf8").trim(), 10);
    if (!Number.isInteger(pid)) return { ready: false, detail: "invalid pid file" };
    process.kill(pid, 0);
    return { ready: true, detail: `PID ${pid}`, pid };
  } catch {
    return { ready: false, detail: "process not running" };
  }
}

export async function runCheck(spec) {
  if (spec.type === "none") return { ready: true, detail: "not configured", notApplicable: true };
  if (spec.type === "tcp") return tcpCheck(spec);
  if (spec.type === "http") return httpCheck(spec);
  if (spec.type === "httpUrlFile") return httpUrlFileCheck(spec);
  if (spec.type === "command") return commandCheck(spec);
  if (spec.type === "pidFile") return pidFileCheck(spec);
  throw new Error(`Unsupported check type: ${spec.type}`);
}
