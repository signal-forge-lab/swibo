import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { validateRegistry } from "../src/registry.js";

const rawText = fs.readFileSync(new URL("../config/config.example.json", import.meta.url), "utf8");
const registry = validateRegistry(JSON.parse(rawText));

test("public default registry contains only a generic example target", () => {
  assert.deepEqual(registry.targets.map((target) => target.id), ["example-service"]);
  assert.equal(registry.targets[0].name, "Example Service");
  assert.equal(registry.targets[0].startupPolicy, "manual");
});

test("public default registry contains no workstation-specific product paths", () => {
  assert.doesNotMatch(rawText, /[A-Z]:[\\/]/i);
  assert.doesNotMatch(rawText, /[/\\]Users[/\\]/i);
  assert.doesNotMatch(rawText, /\$\{HOME\}[/\\]Documents[/\\]/i);
});

test("generic example demonstrates server, tunnel, and optional monitor contracts", () => {
  const target = registry.targets[0];
  assert.equal(target.checks.server.type, "tcp");
  assert.equal(target.checks.tunnel.type, "none");
  assert.equal(target.components.monitor.label, "Monitor");
  assert.equal(target.components.monitor.check.type, "pidFile");
});
