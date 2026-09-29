import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const daemon = fs.readFileSync(new URL("../src/daemon.js", import.meta.url), "utf8");
const cli = fs.readFileSync(new URL("../src/cli.js", import.meta.url), "utf8");

test("cached status endpoint does not invoke a fresh status sweep", () => {
  const block = daemon.match(/req\.method === "GET" && url\.pathname === "\/api\/status"[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(block, /statusCache\.snapshot\(\)/);
  assert.doesNotMatch(block, /statusAll\(/);
});

test("explicit refresh endpoint performs the full status sweep", () => {
  assert.match(daemon, /req\.method === "POST" && url\.pathname === "\/api\/refresh"/);
  assert.match(daemon, /refreshAllStatus\(/);
});

test("daemon exposes event-driven SSE without a monitoring timer", () => {
  assert.match(daemon, /text\/event-stream/);
  assert.match(daemon, /\/api\/events/);
  assert.doesNotMatch(daemon, /setInterval\(/);
});

test("CLI status preserves fresh semantics through the explicit refresh endpoint", () => {
  assert.match(cli, /command === "status"[\s\S]*request\("\/api\/refresh", \{ method: "POST" \}\)/);
});
