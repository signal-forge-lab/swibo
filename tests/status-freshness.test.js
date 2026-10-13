import assert from "node:assert/strict";
import test from "node:test";
import { STALE_AFTER_MS, isStatusStale, nextFreshnessTransition } from "../ui/status-freshness.js";

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
