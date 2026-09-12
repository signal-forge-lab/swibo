import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../ui/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../ui/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../ui/styles.css", import.meta.url), "utf8");

test("dashboard uses compact Target / Runtime / Monitor columns", () => {
  for (const label of ["Target", "Runtime", "Monitor"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  for (const legacy of ["State", "Server", "Tunnel", "Info", "Actions"]) {
    assert.doesNotMatch(html, new RegExp(`>${legacy}<`));
  }
  assert.match(html, /Start all runtimes/);
  assert.match(html, /Stop all runtimes/);
});

test("target rows keep primary lifecycle controls visible and details expandable", () => {
  assert.match(js, /runtimeControl/);
  assert.match(js, /componentControl/);
  assert.match(js, /data-expand-target/);
  assert.match(js, /Runtime composition/);
  assert.match(js, /Last check/);
  assert.match(js, /Technical details/);
  assert.doesNotMatch(js, /moreMenu/);
  assert.doesNotMatch(js, /Start Monitor[\s\S]*more-menu/);
});

test("expanded details expose Server and Tunnel without restoring permanent columns", () => {
  assert.match(js, /componentDetailRow\(target, "server"/);
  assert.match(js, /componentDetailRow\(target, "tunnel"/);
  assert.match(css, /\.target-detail\s*\{/);
  assert.match(css, /\.target-summary\s*\{/);
});

test("dashboard keeps its operational region scrollable", () => {
  assert.match(css, /html, body \{[^}]*height:\s*100%/s);
  assert.match(css, /\.target-list-wrap \{[^}]*overflow:\s*auto/s);
});
