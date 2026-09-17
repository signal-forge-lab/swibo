import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import * as paths from "../src/paths.js";

test("platform paths preserve Windows state and use Application Support on macOS", () => {
  assert.equal(typeof paths.resolvePlatformPaths, "function", "paths module should expose a testable platform resolver");

  const windows = paths.resolvePlatformPaths({
    platform: "win32",
    home: "C:\\Users\\example",
    env: { LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local", APPDATA: "C:\\Users\\example\\AppData\\Roaming" }
  });
  assert.equal(windows.SWIBO_STATE_HOME, "C:\\Users\\example\\AppData\\Local\\mcp-supervisor");
  assert.equal(windows.LOCALAPPDATA, "C:\\Users\\example\\AppData\\Local");

  const mac = paths.resolvePlatformPaths({
    platform: "darwin",
    home: "/Users/example",
    env: {}
  });
  assert.equal(mac.LOCALAPPDATA, "/Users/example/Library/Application Support");
  assert.equal(mac.APPDATA, "/Users/example/Library/Application Support");
  assert.equal(mac.SWIBO_STATE_HOME, "/Users/example/Library/Application Support/mcp-supervisor");
});

test("explicit Swibo state override wins on every platform", () => {
  assert.equal(typeof paths.resolvePlatformPaths, "function", "paths module should expose a testable platform resolver");
  const resolved = paths.resolvePlatformPaths({
    platform: "darwin",
    home: "/Users/example",
    env: { MCP_SUPERVISOR_STATE_DIR: "/tmp/swibo-state" }
  });
  assert.equal(resolved.SWIBO_STATE_HOME, "/tmp/swibo-state");
});

test("public example uses the cross-platform Swibo state variable", () => {
  const configText = fs.readFileSync(new URL("../config/config.example.json", import.meta.url), "utf8");
  assert.match(configText, /\$\{SWIBO_STATE_HOME\}/);
  assert.doesNotMatch(configText, /\$\{LOCALAPPDATA\}/);
});

test("desktop npm scripts use the shared Node launcher", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.desktop, "node scripts/launch.mjs");
  assert.equal(pkg.scripts["desktop:build"], "node scripts/launch.mjs --build");
  assert.equal(fs.existsSync(new URL("../scripts/launch.mjs", import.meta.url)), true);
});
