import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { RegistryStore, validateRegistry } from "../src/registry.js";

const target = (id = "example") => ({
  id,
  name: "Example",
  enabled: true,
  startupPolicy: "manual",
  lifecycle: {
    start: [{ command: "node", args: ["server.js"] }],
    stop: [{ command: "node", args: ["stop.js"] }]
  },
  checks: {
    server: { type: "tcp", host: "127.0.0.1", port: 9000 },
    tunnel: { type: "none" }
  },
  components: {
    monitor: {
      label: "Monitor",
      lifecycle: {
        start: [{ command: "monitor-start", args: [] }],
        stop: [{ command: "monitor-stop", args: [] }]
      },
      check: { type: "pidFile", path: "${LOCALAPPDATA}/example/monitor.pid" }
    }
  }
});

test("validateRegistry accepts a minimal declarative target", () => {
  const registry = validateRegistry({ version: 1, targets: [target()] });
  assert.equal(registry.targets[0].id, "example");
});

test("validateRegistry rejects duplicate target ids", () => {
  assert.throws(
    () => validateRegistry({ version: 1, targets: [target(), target()] }),
    /duplicate target id/i
  );
});

test("validateRegistry rejects invalid automatic startup dependencies", () => {
  const workbridge = { ...target("workbridge"), startupPolicy: "auto" };
  const gateway = { ...target("gateway"), startupPolicy: "auto", dependsOn: ["workbridge"] };
  assert.equal(validateRegistry({ version: 1, targets: [gateway, workbridge] }).targets.length, 2);
  assert.throws(() => validateRegistry({ version: 1, targets: [gateway] }), /unknown startup dependency/i);
  assert.throws(() => validateRegistry({ version: 1, targets: [gateway, target("workbridge")] }), /auto-enabled/i);
  assert.throws(() => validateRegistry({ version: 1, targets: [{ ...gateway, dependsOn: ["workbridge", "workbridge"] }, workbridge] }), /duplicate startup dependency/i);
  assert.throws(() => validateRegistry({ version: 1, targets: [{ ...gateway, dependsOn: ["gateway"] }] }), /cycle/i);
  assert.throws(() => validateRegistry({ version: 1, targets: [gateway, { ...workbridge, dependsOn: ["gateway"] }] }), /cycle/i);
});

test("validateRegistry rejects shell command strings", () => {
  const invalid = target();
  invalid.lifecycle.start = [{ command: "node server.js" }];
  assert.throws(
    () => validateRegistry({ version: 1, targets: [invalid] }),
    /command must be an executable/i
  );
});

test("validateRegistry accepts optional independently managed components", () => {
  const registry = validateRegistry({ version: 1, targets: [target()] });
  assert.equal(registry.targets[0].components.monitor.label, "Monitor");
  assert.equal(registry.targets[0].components.monitor.lifecycle.start[0].command, "monitor-start");
});

test("validateRegistry rejects malformed component lifecycle", () => {
  const invalid = target();
  invalid.components.monitor.lifecycle.start = "monitor-start";
  assert.throws(
    () => validateRegistry({ version: 1, targets: [invalid] }),
    /components\.monitor\.lifecycle\.start must be an array/i
  );
});

test("RegistryStore tolerates a UTF-8 BOM in registry.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swibo-registry-"));
  try {
    const registryPath = path.join(root, "registry.json");
    fs.writeFileSync(
      registryPath,
      `\uFEFF${JSON.stringify({ version: 1, targets: [target()] })}`,
      "utf8"
    );
    const store = new RegistryStore({ defaultPath: registryPath, registryPath });
    assert.equal(store.load().targets[0].id, "example");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
