import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

test("Windows scheduled daemon starts hidden and retains ownership of Node lifetime", () => {
  const task = read("scripts/manage-daemon-task.ps1");
  const wrapper = read("scripts/run-daemon-hidden.ps1");
  assert.match(task, /-WindowStyle Hidden/);
  assert.match(task, /New-ScheduledTaskAction -Execute \$powershell/);
  assert.match(task, /-RestartCount 30/);
  assert.match(wrapper, /& \$node \$script/);
  assert.doesNotMatch(wrapper, /Start-Process|taskkill|Stop-Process/);
});

test("desktop daemon control remains usable independently of its HTTP dashboard", () => {
  const rust = read("src-tauri/src/main.rs");
  const fallback = read("ui-shell/index.html");
  const dashboard = read("ui/index.html");
  const ui = read("ui/app.js");
  assert.match(rust, /swibo_daemon_start/);
  assert.match(rust, /swibo_daemon_stop/);
  assert.match(rust, /Start daemon/);
  assert.match(rust, /Stop daemon/);
  assert.match(rust, /schtasks\.exe/);
  assert.match(fallback, /id="start-daemon"/);
  assert.match(fallback, /__TAURI__/);
  assert.match(dashboard, /id="daemon-stop"/);
  assert.match(ui, /\/api\/shutdown/);
  assert.match(ui, /tauri\.localhost\/index\.html/);
});
