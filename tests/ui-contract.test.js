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

test("expanded rows span the full target width without clipping the left separator", () => {
  assert.match(css, /\.target-detail \{[^}]*margin-left:\s*0/s);
  assert.match(css, /\.target-detail-inner \{/);
  assert.doesNotMatch(css, /\.target-detail \{[^}]*margin-left:\s*52px/s);
});

test("compact lifecycle buttons keep one shared borderless shell in every state", () => {
  assert.match(css, /\.compact-btn \{[^}]*background:\s*transparent[^}]*border:\s*1px solid transparent/s);
  assert.match(css, /\.compact-btn\.start \{[^}]*color:\s*var\(--brass-strong\)/s);
  assert.doesNotMatch(css, /\.compact-btn\.start \{[^}]*(?:background|border-color):/s);
});

test("modal close uses a centered svg icon instead of a text glyph", () => {
  assert.match(html, /class="icon-button modal-close"/);
  assert.match(html, /aria-label="Close"[\s\S]*?<svg/);
  assert.match(css, /\.modal-close \{[^}]*display:\s*inline-grid[^}]*place-items:\s*center/s);
});

test("Swibo themes its scrollbars", () => {
  assert.match(css, /scrollbar-color:/);
  assert.match(css, /::-webkit-scrollbar\s*\{/);
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{/);
});
