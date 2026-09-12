import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { runCheck } from "../src/checks.js";

test("httpUrlFile check reads a dynamic tunnel health URL without spawning a command", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-supervisor-check-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const server = http.createServer((req, res) => {
    res.writeHead(req.url === "/readyz" ? 200 : 404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const port = server.address().port;
  const urlFile = path.join(dir, "health.url");
  fs.writeFileSync(urlFile, `http://127.0.0.1:${port}\n`, "utf8");

  const result = await runCheck({ type: "httpUrlFile", path: urlFile, pathSuffix: "/readyz" });
  assert.equal(result.ready, true);
  assert.equal(result.detail, "HTTP 200");
});

test("default HTTP checks tolerate short local event-loop stalls without false timeout", async (t) => {
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200);
      res.end();
    }, 1200);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const port = server.address().port;
  const result = await runCheck({ type: "http", url: `http://127.0.0.1:${port}/healthz` });
  assert.equal(result.ready, true);
  assert.equal(result.detail, "HTTP 200");
});
