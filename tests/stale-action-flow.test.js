import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../ui/app.js", import.meta.url), "utf8");
const helper = source.match(/function isVerifiedActionAllowed[\s\S]*?\n\}/)?.[0];
const handler = source.match(/async function runTargetAction[\s\S]*?\n\}/)?.[0];
assert.ok(helper && handler, "preflight helper and handler must exist");

async function simulate({ target, action, component = "", checked, checkError, stale = true }) {
  const calls = [];
  const toasts = [];
  const sandbox = {
    actionBusy: false,
    renderFingerprint: "initial",
    render() {},
    isStatusStale: () => stale,
    async api(path, options) {
      calls.push({ path, method: options.method });
      if (checkError) throw new Error(checkError);
      return checked;
    },
    async syncCachedStatus() { calls.push({ path: "cached-status" }); },
    showToast(message) { toasts.push(message); },
    async runAction(path) { calls.push({ path, method: "POST" }); },
    encodeURIComponent
  };
  const fn = vm.runInNewContext([helper, handler, "runTargetAction"].join("\n"), sandbox);
  await fn(target, action, component);
  return { calls, toasts, busy: sandbox.actionBusy };
}

test("stale start checks one target, then executes only a verified start", async () => {
  const target = { id: "demo", name: "Demo", checkedAt: "old", state: "STOPPED" };
  const result = await simulate({ target, action: "start", checked: { state: "STOPPED", enabled: true } });
  assert.deepEqual(result.calls.map((call) => call.path), [
    "/api/targets/demo/refresh", "cached-status", "/api/targets/demo/start"
  ]);
  assert.equal(result.busy, false);
});

test("changed fresh state prevents stale Start from becoming Stop or touching lifecycle", async () => {
  const target = { id: "demo", name: "Demo", checkedAt: "old", state: "STOPPED" };
  const result = await simulate({ target, action: "start", checked: { state: "READY", enabled: true } });
  assert.deepEqual(result.calls.map((call) => call.path), ["/api/targets/demo/refresh", "cached-status"]);
  assert.match(result.toasts[0], /changed or is unavailable/);
  assert.equal(result.busy, false);
});

test("stale component action verifies the target's component state", async () => {
  const target = { id: "demo", name: "Demo", checkedAt: "old" };
  const result = await simulate({
    target, action: "start", component: "monitor",
    checked: { state: "READY", enabled: true, components: { monitor: { state: "STOPPED" } } }
  });
  assert.deepEqual(result.calls.map((call) => call.path), [
    "/api/targets/demo/refresh", "cached-status", "/api/targets/demo/components/monitor/start"
  ]);
});

test("failed fresh check blocks stale operation and releases busy state", async () => {
  const target = { id: "demo", name: "Demo", checkedAt: "old", state: "READY" };
  const result = await simulate({ target, action: "stop", checkError: "health check failed" });
  assert.deepEqual(result.calls.map((call) => call.path), ["/api/targets/demo/refresh"]);
  assert.match(result.toasts[0], /health check failed/);
  assert.equal(result.busy, false);
});

test("recently checked action keeps the existing fast path without extra checks", async () => {
  const target = { id: "demo", name: "Demo", checkedAt: "fresh", state: "READY" };
  const result = await simulate({ target, action: "stop", stale: false });
  assert.deepEqual(result.calls.map((call) => call.path), ["/api/targets/demo/stop"]);
});
