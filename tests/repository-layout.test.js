import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const gitignore = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");

test("public repository layout keeps docs and example config in publishable paths", () => {
  for (const relativePath of [
    "docs/README.md",
    "docs/README_ja.md",
    "config/config.example.json"
  ]) {
    assert.equal(fs.existsSync(new URL(`../${relativePath}`, import.meta.url)), true, `${relativePath} should exist`);
  }

  for (const legacyPath of [
    "README.md",
    "README.ja.md",
    "config/default-registry.json"
  ]) {
    assert.equal(fs.existsSync(new URL(`../${legacyPath}`, import.meta.url)), false, `${legacyPath} should not be the canonical public file`);
  }
});

test("local-only files are explicitly ignored", () => {
  for (const pattern of [".env", ".env.*", "secrets/", "*.key", "*.pem", "config.local.json", "local/"]) {
    assert.match(gitignore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});

test("public example config remains disabled and generic", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../config/config.example.json", import.meta.url), "utf8"));
  assert.equal(config.targets.length, 1);
  assert.equal(config.targets[0].enabled, false);
  assert.equal(config.targets[0].id, "example-service");
});
