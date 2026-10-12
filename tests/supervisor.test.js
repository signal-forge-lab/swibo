import test from "node:test";
import assert from "node:assert/strict";

import { Supervisor, deriveTargetState } from "../src/supervisor.js";

const exampleTarget = {
  id: "example",
  name: "Example",
  enabled: true,
  startupPolicy: "manual",
  lifecycle: {
    start: [
      { command: "server-start", args: [] },
      { command: "tunnel-start", args: [] }
    ],
    stop: [
      { command: "tunnel-stop", args: [] },
      { command: "server-stop", args: [] }
    ]
  },
  checks: {
    server: { type: "fake", key: "server" },
    tunnel: { type: "fake", key: "tunnel" }
  },
  components: {
    monitor: {
      label: "Monitor",
      lifecycle: {
        start: [{ command: "monitor-start", args: [] }],
        stop: [{ command: "monitor-stop", args: [] }]
      },
      check: { type: "fake", key: "monitor" }
    }
  }
};

test("deriveTargetState distinguishes ready, degraded and stopped", () => {
  assert.equal(deriveTargetState({ server: { ready: true }, tunnel: { ready: true } }), "READY");
  assert.equal(deriveTargetState({ server: { ready: true }, tunnel: { ready: false } }), "DEGRADED");
  assert.equal(deriveTargetState({ server: { ready: false }, tunnel: { ready: false } }), "STOPPED");
  assert.equal(deriveTargetState({ server: { ready: false }, tunnel: { ready: true, notApplicable: true } }), "STOPPED");
  assert.equal(deriveTargetState({ server: { ready: true, notApplicable: true }, tunnel: { ready: false } }), "STOPPED");
  assert.equal(deriveTargetState({ server: { ready: true, notApplicable: true }, tunnel: { ready: true } }), "READY");
});

test("start executes the declared lifecycle in order and waits for readiness", async () => {
  const calls = [];
  const readiness = { server: false, tunnel: false };
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [exampleTarget] },
    runCommand: async (spec) => {
      calls.push(spec.command);
      if (spec.command === "server-start") readiness.server = true;
      if (spec.command === "tunnel-start") readiness.tunnel = true;
      return { code: 0, stdout: "", stderr: "" };
    },
    runCheck: async (spec) => ({ ready: readiness[spec.key], detail: spec.key }),
    wait: async () => {}
  });

  const status = await supervisor.start("example");
  assert.deepEqual(calls, ["server-start", "tunnel-start"]);
  assert.equal(status.state, "READY");
});

test("stop follows the explicit safe shutdown order", async () => {
  const calls = [];
  const readiness = { server: true, tunnel: true };
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [exampleTarget] },
    runCommand: async (spec) => {
      calls.push(spec.command);
      if (spec.command === "tunnel-stop") readiness.tunnel = false;
      if (spec.command === "server-stop") readiness.server = false;
      return { code: 0, stdout: "", stderr: "" };
    },
    runCheck: async (spec) => ({ ready: readiness[spec.key] }),
    wait: async () => {}
  });

  const status = await supervisor.stop("example");
  assert.deepEqual(calls, ["tunnel-stop", "server-stop"]);
  assert.equal(status.state, "STOPPED");
});

test("restart runs safe stop even when readiness incorrectly reports STOPPED", async () => {
  const calls = [];
  const readiness = { server: false, tunnel: false };
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [exampleTarget] },
    runCommand: async (spec) => {
      calls.push(spec.command);
      if (spec.command === "server-start") readiness.server = true;
      if (spec.command === "tunnel-start") readiness.tunnel = true;
      return { code: 0, stdout: "", stderr: "" };
    },
    runCheck: async (spec) => ({ ready: readiness[spec.key] }),
    wait: async () => {}
  });

  const before = await supervisor.stop("example");
  assert.equal(before.state, "STOPPED");
  assert.deepEqual(calls, [], "ordinary Stop remains idempotent");

  const result = await supervisor.restart("example");
  assert.deepEqual(calls, ["tunnel-stop", "server-stop", "server-start", "tunnel-start"]);
  assert.equal(result.state, "READY");
});

test("restart refuses to start if the forced stop wrapper fails", async () => {
  const calls = [];
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [exampleTarget] },
    runCheck: async () => ({ ready: false }),
    runCommand: async (spec) => {
      calls.push(spec.command);
      if (spec.command === "tunnel-stop") {
        return { code: 1, stderr: "refusing to stop an unverified process" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }
  });

  await assert.rejects(
    supervisor.restart("example"),
    /refusing to stop an unverified process/
  );
  assert.deepEqual(calls, ["tunnel-stop"], "no start before verified stop");
});

test("stop does not wait for a not-applicable server on a tunnel-only target", async () => {
  const target = structuredClone(exampleTarget);
  target.checks.server = { type: "none", key: "server" };
  target.lifecycle.stop = [{ command: "tunnel-stop", args: [] }];
  const readiness = { tunnel: true };
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [target] },
    runCommand: async () => {
      readiness.tunnel = false;
      return { code: 0, stdout: "", stderr: "" };
    },
    runCheck: async (spec) => spec.type === "none"
      ? { ready: true, notApplicable: true, detail: "not configured" }
      : { ready: readiness[spec.key], detail: spec.key },
    wait: async () => {}
  });

  const status = await supervisor.stop("example");
  assert.equal(status.state, "STOPPED");
  assert.equal(status.server.notApplicable, true);
});

test("start skips an action whose dependency is already ready", async () => {
  const calls = [];
  const target = structuredClone(exampleTarget);
  target.lifecycle.start[0].unlessReady = "server";
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [target] },
    runCommand: async (spec) => {
      calls.push(spec.command);
      return { code: 0, stdout: "", stderr: "" };
    },
    runCheck: async (spec) => ({ ready: spec.key === "server" || spec.key === "tunnel" }),
    wait: async () => {}
  });

  await supervisor.start("example");
  assert.deepEqual(calls, []);
});

test("component lifecycle is independent from target readiness", async () => {
  const calls = [];
  const readiness = { server: true, tunnel: true, monitor: false };
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [exampleTarget] },
    runCommand: async (spec) => {
      calls.push(spec.command);
      if (spec.command === "monitor-start") readiness.monitor = true;
      if (spec.command === "monitor-stop") readiness.monitor = false;
      return { code: 0, stdout: "", stderr: "" };
    },
    runCheck: async (spec) => ({ ready: readiness[spec.key], detail: spec.key }),
    wait: async () => {}
  });

  const before = await supervisor.status("example");
  assert.equal(before.state, "READY");
  assert.equal(before.components.monitor.state, "STOPPED");

  const started = await supervisor.startComponent("example", "monitor");
  assert.equal(started.state, "READY");
  assert.deepEqual(calls, ["monitor-start"]);

  const targetStillReady = await supervisor.status("example");
  assert.equal(targetStillReady.state, "READY");

  const stopped = await supervisor.stopComponent("example", "monitor");
  assert.equal(stopped.state, "STOPPED");
  assert.deepEqual(calls, ["monitor-start", "monitor-stop"]);
});

test("status clears a stale target error after the target has recovered to READY", async () => {
  const readiness = { server: true, tunnel: true };
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [exampleTarget] },
    runCheck: async (spec) => ({ ready: readiness[spec.key], detail: spec.key })
  });

  supervisor.lastErrors.set("example", "startup failed earlier");
  const status = await supervisor.status("example");

  assert.equal(status.state, "READY");
  assert.equal(status.error, "");
  assert.equal(supervisor.lastErrors.has("example"), false);
});

test("status keeps a target error while the target has not recovered", async () => {
  const readiness = { server: false, tunnel: false };
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [exampleTarget] },
    runCheck: async (spec) => ({ ready: readiness[spec.key], detail: spec.key })
  });

  supervisor.lastErrors.set("example", "startup failed earlier");
  const status = await supervisor.status("example");

  assert.equal(status.state, "STOPPED");
  assert.equal(status.error, "startup failed earlier");
});

test("component status clears a stale error after the component recovers", async () => {
  const readiness = { monitor: true };
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [exampleTarget] },
    runCheck: async (spec) => ({ ready: readiness[spec.key] ?? true, detail: spec.key })
  });

  const key = supervisor.componentOperationKey("example", "monitor");
  supervisor.componentErrors.set(key, "monitor startup failed earlier");
  const status = await supervisor.checkComponent(exampleTarget, "monitor");

  assert.equal(status.state, "READY");
  assert.equal(status.error, "");
  assert.equal(supervisor.componentErrors.has(key), false);
});

test("statusAll coalesces concurrent callers and bounds target-check fanout", async () => {
  const targets = Array.from({ length: 6 }, (_, index) => ({
    id: `target-${index}`,
    name: `Target ${index}`,
    enabled: true,
    startupPolicy: "manual",
    lifecycle: { start: [], stop: [] },
    checks: {
      server: { type: "fake", key: `server-${index}` },
      tunnel: { type: "fake", key: `tunnel-${index}` }
    },
    components: {}
  }));

  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const supervisor = new Supervisor({
    registry: { version: 1, targets },
    runCheck: async (spec) => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { ready: true, detail: spec.key };
    }
  });

  const [first, second, third] = await Promise.all([
    supervisor.statusAll(),
    supervisor.statusAll(),
    supervisor.statusAll()
  ]);

  assert.equal(calls, 12, "concurrent callers should share one status sweep");
  assert.ok(maxActive <= 6, `expected at most 3 targets × 2 checks, saw ${maxActive} checks`);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test("auto-start waits for declared dependencies while unrelated targets remain concurrent", async () => {
  const calls = [];
  const ready = new Set();
  const makeTarget = (id, dependsOn = []) => ({
    ...structuredClone(exampleTarget), id, name: id, startupPolicy: "auto", dependsOn,
    components: {}, lifecycle: { start: [{ command: id }], stop: [] },
    checks: { server: { key: id }, tunnel: { type: "none" } }
  });
  const targets = [makeTarget("gateway", ["workbridge", "cua"]), makeTarget("workbridge"), makeTarget("cua"), makeTarget("unrelated")];
  const supervisor = new Supervisor({
    registry: { version: 1, targets },
    runCheck: async (check) => check.type === "none" ? { ready: true, notApplicable: true } : { ready: ready.has(check.key) },
    runCommand: async (spec) => {
      calls.push(`start:${spec.command}`);
      if (spec.command === "gateway") assert.ok(ready.has("workbridge") && ready.has("cua"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      ready.add(spec.command);
      return { code: 0, stdout: "", stderr: "" };
    }
  });
  const results = await supervisor.startAll({ autoOnly: true });
  assert.ok(calls.indexOf("start:gateway") > calls.indexOf("start:workbridge"));
  assert.ok(calls.indexOf("start:gateway") > calls.indexOf("start:cua"));
  assert.equal(results.length, targets.length);
  assert.equal(results[0].value.id, "gateway", "results retain registry order for dashboard caching");
  assert.ok(results.every((r) => r.ok));
});

test("auto-start does not attempt a target when a required service fails", async () => {
  const calls = [];
  const make = (id, dependsOn = []) => ({
    ...structuredClone(exampleTarget), id, startupPolicy: "auto", dependsOn, components: {},
    lifecycle: { start: [{ command: id }], stop: [] },
    checks: { server: { key: id }, tunnel: { type: "none" } }
  });
  const supervisor = new Supervisor({
    registry: { version: 1, targets: [make("gateway", ["workbridge"]), make("workbridge")] },
    runCheck: async (spec) => spec.type === "none" ? { ready: true, notApplicable: true } : { ready: false },
    runCommand: async (spec) => {
      calls.push(spec.command);
      return { code: 1, stderr: "backend failed" };
    }
  });
  const results = await supervisor.startAll({ autoOnly: true });
  assert.deepEqual(calls, ["workbridge"]);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /startup dependency workbridge failed/i);
  assert.equal(results[1].ok, false);
});
