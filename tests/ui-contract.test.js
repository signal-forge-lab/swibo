import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../ui/index.html", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../ui/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../ui/styles.css", import.meta.url), "utf8");


test("cached freshness module loads from the loopback daemon without polling", () => {
  const daemon = fs.readFileSync(new URL("../src/daemon.js", import.meta.url), "utf8");
  assert.match(js, /const STALE_AFTER_MS = 2 \* 60 \* 1000/);
  assert.doesNotMatch(daemon, /status-freshness\.js/);
  assert.match(js, /clearTimeout\(freshnessTimer\)/);
  assert.match(js, /nextFreshnessTransition\(snapshot\.targets\)/);
  assert.doesNotMatch(js, /setInterval\(/);
});

test("dashboard uses compact Target / Runtime / Monitor / row-menu columns", () => {
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
  assert.match(js, /rowMenu/);
  assert.match(js, /data-more-menu/);
  assert.match(js, /data-menu-action="edit"/);
  assert.doesNotMatch(js, /Technical details/);
  assert.doesNotMatch(js, /data-inspect/);
});

test("expanded details are informational and keep actions in the summary row", () => {
  assert.doesNotMatch(js, /detail-actions/);
  assert.doesNotMatch(js, /targetDetail[\s\S]*data-action="edit"/);
  assert.doesNotMatch(html, /inspection-popover/);
  assert.match(js, /<div class="more-cell">/);
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

test("target rows do not force a 900px layout and reserve a fixed menu column", () => {
  assert.doesNotMatch(css, /\.target-columns, \.target-summary \{[^}]*min-width:\s*900px/s);
  assert.match(css, /\.target-columns, \.target-summary \{[^}]*grid-template-columns:[^}]*42px/s);
  assert.match(css, /\.target-columns, \.target-summary \{[^}]*min-width:\s*560px/s);
});

test("desktop-width toolbar and summary stay on one row until a narrow breakpoint", () => {
  assert.match(css, /@media \(max-width:\s*900px\) \{\s*\.shell[^}]*\}\s*\.content[^}]*\}\s*\}/s);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?\.summary \{\s*grid-template-columns:\s*repeat\(2/s);
  assert.match(css, /\.signal \{[^}]*align-items:\s*center/s);
  assert.match(css, /\.toolbar-group \{[^}]*flex-wrap:\s*nowrap[^}]*white-space:\s*nowrap/s);
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

test("target list exposes Auto Start as a first-class row control", () => {
  assert.match(html, />Auto Start</);
  assert.match(js, /data-autostart-toggle/);
  assert.match(js, /role="switch"/);
  assert.match(js, /aria-checked="/);
  assert.match(css, /\.autostart-switch\s*\{/);
});

test("Auto Start summary and filter are visible without opening target JSON", () => {
  assert.match(html, /id="auto-start-count"/);
  assert.match(html, /data-target-filter="all"/);
  assert.match(html, /data-target-filter="auto"/);
  assert.match(js, /startupPolicy === "auto"/);
  assert.match(js, /targetFilter/);
});

test("Auto Start changes reuse target PUT and do not invoke lifecycle actions", () => {
  assert.match(js, /async function setAutoStart/);
  assert.match(js, /startupPolicy:\s*enabled \? "auto" : "manual"/);
  assert.match(js, /method:\s*"PUT"/);
  const body = js.match(/async function setAutoStart[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(body, /\/start|\/stop|\/restart|runAction/);
});

test("dashboard uses explicit refresh plus SSE instead of periodic polling", () => {
  assert.match(js, /new EventSource\("\/api\/events"\)/);
  assert.match(js, /api\("\/api\/refresh", \{ method: "POST" \}\)/);
  assert.doesNotMatch(js, /setInterval\(/);
  assert.match(js, /nextFreshnessTransition/);
  assert.match(js, /scheduleFreshnessUpdate/);
  assert.match(js, /visibilitychange/);
});

test("target details render each target's own last health-check timestamp", () => {
  assert.match(js, /target\.checkedAt/);
  assert.doesNotMatch(js, /lastCheckedLabel/);
});
