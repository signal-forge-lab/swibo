import test from "node:test";
import assert from "node:assert/strict";

import { allowedLoopbackRequest, securityHeaders } from "../src/http-policy.js";

test("HTTP policy only accepts loopback host and same-loopback origin", () => {
  assert.equal(allowedLoopbackRequest({ host: "127.0.0.1:17991" }, 17991), true);
  assert.equal(allowedLoopbackRequest({ host: "localhost:17991", origin: "http://localhost:17991" }, 17991), true);
  assert.equal(allowedLoopbackRequest({ host: "127.0.0.1:17991", origin: "https://example.com" }, 17991), false);
  assert.equal(allowedLoopbackRequest({ host: "example.com:17991" }, 17991), false);
});

test("HTTP policy prevents dashboard framing and MIME sniffing", () => {
  const headers = securityHeaders();
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(headers["content-security-policy"], /connect-src 'self'/);
});
