#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { createRuntime } from "./runtime.js";
import { allowedLoopbackRequest, securityHeaders } from "./http-policy.js";
import { stateRoot } from "./paths.js";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.MCP_SUPERVISOR_PORT || "17991", 10);
const runtime = createRuntime();
const uiRoot = path.join(runtime.projectRoot, "ui");
const iconPath = path.join(runtime.projectRoot, "assets", "swibo-icon.png");
const iconBody = fs.readFileSync(iconPath);
const stateDir = stateRoot();
const eventPath = path.join(stateDir, "events.jsonl");
const pidPath = path.join(stateDir, "daemon.pid");

fs.mkdirSync(stateDir, { recursive: true });

function appendEvent(type, fields = {}) {
  fs.appendFileSync(eventPath, `${JSON.stringify({ time: new Date().toISOString(), type, ...fields })}\n`, "utf8");
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy(new Error("Request body too large."));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid JSON body.")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, file, contentType) {
  const body = fs.readFileSync(path.join(uiRoot, file));
  res.writeHead(200, {
    ...securityHeaders(),
    "content-type": `${contentType}; charset=utf-8`,
    "content-length": body.length,
    "cache-control": "no-cache"
  });
  res.end(body);
}

function serveBinary(res, body, contentType) {
  res.writeHead(200, {
    ...securityHeaders(),
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": "no-cache"
  });
  res.end(body);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/status") {
    const targets = await runtime.supervisor.statusAll();
    return sendJson(res, 200, { targets, registry: runtime.supervisor.registry });
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, pid: process.pid });
  }
  if (req.method === "POST" && url.pathname === "/api/start-all") {
    const results = await runtime.supervisor.startAll();
    appendEvent("start_all", { results });
    return sendJson(res, 200, { results });
  }
  if (req.method === "POST" && url.pathname === "/api/stop-all") {
    const results = await runtime.supervisor.stopAll();
    appendEvent("stop_all", { results });
    return sendJson(res, 200, { results });
  }
  if (req.method === "POST" && url.pathname === "/api/shutdown") {
    sendJson(res, 202, { ok: true });
    setImmediate(() => server.close(() => process.exit(0)));
    return;
  }

  const actionMatch = url.pathname.match(/^\/api\/targets\/([^/]+)\/(start|stop|restart)$/);
  if (req.method === "POST" && actionMatch) {
    const [, id, action] = actionMatch;
    const status = await runtime.supervisor[action](decodeURIComponent(id));
    appendEvent(`target_${action}`, { id: decodeURIComponent(id), state: status.state });
    return sendJson(res, 200, status);
  }
  const componentActionMatch = url.pathname.match(/^\/api\/targets\/([^/]+)\/components\/([^/]+)\/(start|stop|restart)$/);
  if (req.method === "POST" && componentActionMatch) {
    const [, rawId, rawComponent, action] = componentActionMatch;
    const id = decodeURIComponent(rawId);
    const component = decodeURIComponent(rawComponent);
    const method = action === "start" ? "startComponent" : action === "stop" ? "stopComponent" : "restartComponent";
    const status = await runtime.supervisor[method](id, component);
    appendEvent(`target_component_${action}`, { id, component, state: status.state });
    return sendJson(res, 200, status);
  }
  if (req.method === "POST" && url.pathname === "/api/targets") {
    const target = await readJson(req);
    runtime.store.add(target);
    runtime.reload();
    appendEvent("target_add", { id: target.id });
    return sendJson(res, 201, target);
  }
  const targetMatch = url.pathname.match(/^\/api\/targets\/([^/]+)$/);
  if (targetMatch && req.method === "PUT") {
    const id = decodeURIComponent(targetMatch[1]);
    const target = await readJson(req);
    runtime.store.update(id, target);
    runtime.reload();
    appendEvent("target_update", { id, nextId: target.id });
    return sendJson(res, 200, target);
  }
  if (targetMatch && req.method === "DELETE") {
    const id = decodeURIComponent(targetMatch[1]);
    runtime.store.remove(id);
    runtime.reload();
    appendEvent("target_remove", { id });
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 404, { error: "Not found." });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!allowedLoopbackRequest(req.headers, PORT)) return sendJson(res, 403, { error: "Loopback origin required." });
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    if (url.pathname === "/" || url.pathname === "/index.html") return serveStatic(res, "index.html", "text/html");
    if (url.pathname === "/app.js") return serveStatic(res, "app.js", "text/javascript");
    if (url.pathname === "/styles.css") return serveStatic(res, "styles.css", "text/css");
    if (url.pathname === "/swibo-icon.png") return serveBinary(res, iconBody, "image/png");
    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    appendEvent("request_error", { error: error.message });
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, async () => {
  fs.writeFileSync(pidPath, `${process.pid}\n`, "ascii");
  appendEvent("daemon_start", { pid: process.pid, port: PORT });
  console.log(`Swibo listening on http://${HOST}:${PORT}`);
  const autoTargets = runtime.supervisor.registry.targets.filter((target) => target.enabled !== false && target.startupPolicy === "auto");
  if (autoTargets.length) {
    const results = await runtime.supervisor.startAll({ autoOnly: true });
    appendEvent("auto_start", { results });
  }
});

function shutdown(signal) {
  appendEvent("daemon_stop", { signal });
  fs.rmSync(pidPath, { force: true });
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("exit", () => fs.rmSync(pidPath, { force: true }));
