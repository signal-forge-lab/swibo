import test from "node:test";
import assert from "node:assert/strict";

import { runCommand } from "../src/runner.js";

test("detached command rejects a missing executable instead of crashing the daemon", async () => {
  await assert.rejects(
    runCommand({ command: "definitely-missing-mcp-supervisor-executable.exe", detached: true }),
    /ENOENT|not found/i
  );
});

test("command completion is not held open by a long-lived grandchild inheriting stdout", async () => {
  const grandchild = "setTimeout(() => process.stdout.write('late\\n'), 3000); setTimeout(() => {}, 4000)";
  const parent = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {`,
    "  detached: true,",
    "  stdio: ['ignore', 'inherit', 'ignore']",
    "});",
    "child.unref();"
  ].join("\n");

  const started = Date.now();
  const result = await runCommand({
    command: process.execPath,
    args: ["-e", parent],
    timeoutMs: 1500
  });

  assert.equal(result.code, 0);
  assert.ok(Date.now() - started < 1500, "parent completion should not wait for grandchild stdout");
});
