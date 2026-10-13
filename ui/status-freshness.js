// Cached health results remain observational, not a live service monitor.
export const STALE_AFTER_MS = 2 * 60 * 1000;

export function isStatusStale(checkedAt, now = Date.now()) {
  const timestamp = Date.parse(checkedAt ?? "");
  return !Number.isFinite(timestamp) || now - timestamp >= STALE_AFTER_MS;
}

// Schedule only the next cached-status expiry. No network polling is involved.
export function nextFreshnessTransition(targets, now = Date.now()) {
  let next = Infinity;
  for (const target of targets) {
    const timestamp = Date.parse(target.checkedAt ?? "");
    if (!Number.isFinite(timestamp)) continue;
    const remaining = timestamp + STALE_AFTER_MS - now;
    if (remaining > 0 && remaining < next) next = remaining;
  }
  return Number.isFinite(next) ? Math.min(Math.ceil(next) + 20, 2_147_483_647) : null;
}
