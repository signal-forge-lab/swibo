import test from "node:test";
import assert from "node:assert/strict";

import { StatusCache } from "../src/status-cache.js";

const registry = {
  version: 1,
  targets: [
    { id: "one", name: "One" },
    { id: "two", name: "Two" }
  ]
};

const status = (id, state) => ({
  id,
  name: id === "one" ? "One" : "Two",
  enabled: true,
  startupPolicy: "manual",
  state,
  server: { ready: state === "READY", notApplicable: false },
  tunnel: { ready: false, notApplicable: true },
  components: {},
  ownedPids: {},
  error: ""
});

test("full refresh stamps every target and records a full-check time", () => {
  const cache = new StatusCache(registry);
  const snapshot = cache.replaceAll([status("one", "READY"), status("two", "STOPPED")], "2026-09-29T00:00:00.000Z");
  assert.equal(snapshot.checkedAt, "2026-09-29T00:00:00.000Z");
  assert.deepEqual(snapshot.targets.map((target) => target.checkedAt), [
    "2026-09-29T00:00:00.000Z",
    "2026-09-29T00:00:00.000Z"
  ]);
});

test("single-target refresh updates only that target check timestamp", () => {
  const cache = new StatusCache(registry);
  cache.replaceAll([status("one", "STOPPED"), status("two", "READY")], "2026-09-29T00:00:00.000Z");
  const snapshot = cache.upsert(status("one", "READY"), "2026-09-29T00:01:00.000Z");
  assert.equal(snapshot.targets[0].checkedAt, "2026-09-29T00:01:00.000Z");
  assert.equal(snapshot.targets[1].checkedAt, "2026-09-29T00:00:00.000Z");
  assert.equal(snapshot.checkedAt, "2026-09-29T00:00:00.000Z");
});

test("registry replacement reorders cached targets and drops removed targets", () => {
  const cache = new StatusCache(registry);
  cache.replaceAll([status("one", "READY"), status("two", "READY")], "2026-09-29T00:00:00.000Z");
  cache.setRegistry({ version: 1, targets: [{ id: "two", name: "Two" }] });
  const snapshot = cache.snapshot();
  assert.deepEqual(snapshot.targets.map((target) => target.id), ["two"]);
  assert.deepEqual(snapshot.registry.targets.map((target) => target.id), ["two"]);
});

test("registry removal mutates cached membership without pretending a fresh health check occurred", () => {
  const cache = new StatusCache(registry);
  cache.replaceAll([status("one", "READY"), status("two", "READY")], "2026-09-29T00:00:00.000Z");
  const snapshot = cache.setRegistry(
    { version: 1, targets: [{ id: "two", name: "Two" }] },
    "2026-09-29T00:02:00.000Z"
  );
  assert.deepEqual(snapshot.targets.map((target) => target.id), ["two"]);
  assert.equal(snapshot.checkedAt, "2026-09-29T00:00:00.000Z");
  assert.equal(snapshot.updatedAt, "2026-09-29T00:02:00.000Z");
});
