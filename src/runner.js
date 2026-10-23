import { spawn } from "node:child_process";

import { expandPath, expandValue } from "./paths.js";

function resolvedSpec(spec) {
  return {
    ...spec,
    command: expandValue(spec.command),
    args: (spec.args || []).map(expandValue),
    cwd: spec.cwd ? expandPath(spec.cwd) : undefined
  };
}

export function runCommand(spec) {
  const resolved = resolvedSpec(spec);
  if (resolved.detached) {
    return new Promise((resolve, reject) => {
      const child = spawn(resolved.command, resolved.args, {
        cwd: resolved.cwd,
        env: process.env,
        detached: true,
        windowsHide: true,
        stdio: "ignore",
        shell: false
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.removeListener("error", reject);
        child.unref();
        resolve({ code: 0, stdout: "", stderr: "", pid: child.pid, detached: true });
      });
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, resolved.args, {
      cwd: resolved.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });
    let stdout = "";
    let stderr = "";
    const maxOutput = 256 * 1024;
    const onStdout = (chunk) => { if (stdout.length < maxOutput) stdout += chunk; };
    const onStderr = (chunk) => { if (stderr.length < maxOutput) stderr += chunk; };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    let settled = false;

    const releaseStream = (stream, listener) => {
      if (!stream) return;
      stream.off("data", listener);
      stream.resume();
      stream.unref?.();
    };

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      releaseStream(child.stdout, onStdout);
      releaseStream(child.stderr, onStderr);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill();
      settle(() => reject(new Error(`Command timed out after ${resolved.timeoutMs || 120000}ms: ${resolved.command}`)));
    }, resolved.timeoutMs || 120000);
    child.once("error", (error) => {
      settle(() => reject(error));
    });
    child.once("exit", (code) => {
      setImmediate(() => settle(() => {
        resolve({ code: code ?? -1, stdout, stderr, pid: child.pid, detached: false });
      }));
    });
  });
}
