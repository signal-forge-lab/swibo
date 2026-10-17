import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../ui/app.js", import.meta.url), "utf8");
const begin = source.indexOf("const STALE_AFTER_MS");
const end = source.indexOf("const rows = document.querySelector");
assert.ok(begin >= 0 && end > begin, "freshness helpers must remain at the start of app.js");
const { STALE_AFTER_MS, isStatusStale, nextFreshnessTransition, isVerifiedActionAllowed } = vm.runInNewContext(
  source.slice(begin, end) + "\n({ STALE_AFTER_MS, isStatusStale, nextFreshnessTransition, isVerifiedActionAllowed })",
  { Date, Number, Math },
);

const now = Date.parse("2026-10-13T08:00:00.000Z");
const at = (ms) => new Date(now - ms).toISOString();

test("a fresh observed READY result stays fresh until the threshold", () => {
  assert.equal(isStatusStale(at(0), now), false);
  assert.equal(isStatusStale(at(STALE_AFTER_MS - 1), now), false);
  assert.equal(isStatusStale(at(STALE_AFTER_MS), now), true);
});

test("missing, malformed, or aged timestamps never imply a live READY state", () => {
  assert.equal(isStatusStale(undefined, now), true);
  assert.equal(isStatusStale("invalid date", now), true);
  assert.equal(isStatusStale(at(STALE_AFTER_MS + 1), now), true);
});

test("one-shot transition is scheduled for the earliest fresh target", () => {
  const targets = [{ checkedAt: at(10_000) }, { checkedAt: at(50_000) }, { checkedAt: at(STALE_AFTER_MS + 2) }];
  assert.equal(nextFreshnessTransition(targets, now), STALE_AFTER_MS - 50_000 + 20);
  assert.equal(nextFreshnessTransition([{ checkedAt: at(STALE_AFTER_MS) }], now), null);
  assert.equal(nextFreshnessTransition([{ checkedAt: undefined }], now), null);
});

test("future timestamps do not wrap JavaScript timeout limits", () => {
  const future = new Date(now + 10_000_000_000).toISOString();
  assert.equal(nextFreshnessTransition([{ checkedAt: future }], now), 2_147_483_647);
});

test("only the originally requested start or stop can execute after a fresh observation", () => {
  assert.equal(isVerifiedActionAllowed({ state: "STOPPED", enabled: true }, "start"), true);
  assert.equal(isVerifiedActionAllowed({ state: "READY", enabled: true }, "start"), false);
  assert.equal(isVerifiedActionAllowed({ state: "READY", enabled: true }, "stop"), true);
  assert.equal(isVerifiedActionAllowed({ state: "STOPPED", enabled: true }, "stop"), false);
  assert.equal(isVerifiedActionAllowed({ state: "STARTING", enabled: true }, "stop"), false);
  assert.equal(isVerifiedActionAllowed({ state: "READY", enabled: false }, "start"), false);
  assert.equal(isVerifiedActionAllowed({ state: "READY", enabled: true }, "restart"), true);
  assert.equal(isVerifiedActionAllowed(null, "restart"), false);
});

test("component actions use the newly checked component, not cached target readiness", () => {
  const target = { enabled: true, state: "READY", components: { monitor: { state: "STOPPED" } } };
  assert.equal(isVerifiedActionAllowed(target, "start", "monitor"), true);
  assert.equal(isVerifiedActionAllowed(target, "stop", "monitor"), false);
  assert.equal(isVerifiedActionAllowed(target, "restart", "monitor"), true);
  assert.equal(isVerifiedActionAllowed(target, "start", "unknown"), false);
  assert.equal(isVerifiedActionAllowed({ enabled: true, components: { monitor: { state: "N/A", notApplicable: true } } }, "start", "monitor"), false);
});
