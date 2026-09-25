const rows = document.querySelector("#target-rows");
const connection = document.querySelector("#connection");
const connectionLabel = document.querySelector("#connection-label");
const updated = document.querySelector("#updated");
const dialog = document.querySelector("#target-dialog");
const editor = document.querySelector("#target-json");
const editorError = document.querySelector("#editor-error");
const deleteButton = document.querySelector("#delete-target");
const toast = document.querySelector("#toast");

let snapshot = { targets: [], registry: { targets: [] } };
let editingId = null;
let refreshing = false;
let actionBusy = false;
let targetFilter = "all";
let renderFingerprint = "";
let lastCheckedLabel = "—";
let openMenuTarget = null;
let toastTimer;
const expandedTargets = new Set();
const autoStartBusy = new Set();

const icons = {
  start: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8V4l-2 2a8 8 0 1 0 2.2 8M19 4h-4"/></svg>`,
  disclosure: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`,
  tool: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14v10H5zM9 4v3M15 4v3M9 17v3M15 17v3"/></svg>`,
  more: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.35"/><circle cx="12" cy="12" r="1.35"/><circle cx="12" cy="19" r="1.35"/></svg>`
};

const template = {
  id: "new-service",
  name: "New Service",
  enabled: false,
  startupPolicy: "manual",
  lifecycle: {
    start: [{ command: "node", args: ["scripts/service.js", "start"], cwd: "${HOME}/path/to/service", waitFor: "server" }],
    stop: [{ command: "node", args: ["scripts/service.js", "stop"], cwd: "${HOME}/path/to/service" }]
  },
  checks: {
    server: { type: "tcp", host: "127.0.0.1", port: 8000 },
    tunnel: { type: "none" }
  }
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast visible${isError ? " error" : ""}`;
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

function stateClass(state) {
  const value = String(state || "STOPPED").toLowerCase();
  if (["degraded", "starting", "stopping"].includes(value)) return "warn";
  if (["error", "down"].includes(value)) return "danger";
  if (value === "ready") return "ready";
  return "stopped";
}

function stateReadout(state, { muted = false } = {}) {
  if (muted) return `<span class="state-readout muted">—</span>`;
  const label = String(state || "STOPPED");
  return `<span class="state-readout ${stateClass(label)}"><span class="lamp" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

function actionButton(action, label, { disabled = false, component = "" } = {}) {
  const componentAttrs = component
    ? ` data-component="${escapeHtml(component)}" data-component-action="${action}"`
    : ` data-action="${action}"`;
  return `<button class="compact-btn ${action === "start" ? "start" : action === "stop" ? "stop" : ""}" type="button"${componentAttrs} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"${disabled ? " disabled" : ""}>${icons[action]}</button>`;
}

function runtimeControl(target) {
  const state = String(target.state || "STOPPED");
  const busy = actionBusy || ["STARTING", "STOPPING"].includes(state);
  const stopped = state === "STOPPED";
  const primaryAction = stopped ? "start" : "stop";
  const primaryDisabled = busy || (primaryAction === "start" && !target.enabled);
  const restartDisabled = busy || stopped || !target.enabled;
  return `${stateReadout(state)}<span class="inline-controls">
    ${actionButton(primaryAction, `${primaryAction === "start" ? "Start" : "Stop"} Runtime`, { disabled: primaryDisabled })}
    ${actionButton("restart", "Restart Runtime", { disabled: restartDisabled })}
  </span>`;
}

function componentControl(target, key) {
  const component = target.components?.[key];
  if (!component || component.notApplicable) return `${stateReadout("N/A", { muted: true })}<span></span>`;
  const state = String(component.state || (component.ready ? "READY" : "STOPPED"));
  const busy = actionBusy || ["STARTING", "STOPPING"].includes(state);
  const stopped = state === "STOPPED" || state === "N/A";
  const primaryAction = stopped ? "start" : "stop";
  const primaryDisabled = busy || (primaryAction === "start" && !target.enabled);
  const restartDisabled = busy || stopped || !target.enabled;
  const label = component.label || key;
  return `${stateReadout(state)}<span class="inline-controls">
    ${actionButton(primaryAction, `${primaryAction === "start" ? "Start" : "Stop"} ${label}`, { disabled: primaryDisabled, component: key })}
    ${actionButton("restart", `Restart ${label}`, { disabled: restartDisabled, component: key })}
  </span>`;
}

function autoStartControl(target) {
  const enabled = target.startupPolicy === "auto";
  const busy = autoStartBusy.has(target.id);
  return `<button class="autostart-switch" type="button" role="switch" data-autostart-toggle aria-checked="${enabled}" aria-label="Auto Start for ${escapeHtml(target.name)}"${busy ? " disabled" : ""}>
    <span class="autostart-track" aria-hidden="true"><span class="autostart-thumb"></span></span>
    <span>Auto</span>
  </button>`;
}

function rowMenu(target) {
  const open = openMenuTarget === target.id;
  return `<div class="more-cell">
    <button class="more-trigger" type="button" data-more-menu aria-label="More actions for ${escapeHtml(target.name)}" aria-haspopup="menu" aria-expanded="${open}">${icons.more}</button>
    ${open ? `<div class="row-menu" role="menu">
      <button type="button" role="menuitem" data-menu-action="edit">Edit target</button>
      <button class="danger" type="button" role="menuitem" data-menu-action="remove">Remove target</button>
    </div>` : ""}
  </div>`;
}

function checkState(check) {
  if (!check || check.notApplicable) return "N/A";
  return check.ready ? "READY" : "DOWN";
}

function checkDetail(check) {
  if (!check || check.notApplicable) return "";
  const detail = String(check.detail || "").trim();
  return detail && detail !== "not configured" ? detail : "No additional detail";
}

function componentDetailRow(target, key, label) {
  const check = target[key];
  if (!check || check.notApplicable) return "";
  const state = checkState(check);
  return `<div class="component-line">
    <span class="component-name">${escapeHtml(label)}</span>
    ${stateReadout(state)}
    <span class="component-detail">${escapeHtml(checkDetail(check))}</span>
  </div>`;
}

function runtimeReason(target) {
  if (target.state !== "DEGRADED") return "Runtime = configured Server + Tunnel checks";
  const down = [];
  if (!target.server?.notApplicable && !target.server?.ready) down.push("Server");
  if (!target.tunnel?.notApplicable && !target.tunnel?.ready) down.push("Tunnel");
  return down.length ? `DEGRADED because ${down.join(" + ")} is DOWN` : "Runtime is DEGRADED";
}

function targetDetail(target) {
  const server = componentDetailRow(target, "server", "Server");
  const tunnel = componentDetailRow(target, "tunnel", "Tunnel");
  return `<div class="target-detail">
    <div class="target-detail-inner">
      <div class="detail-block">
        <div class="detail-title"><strong>Runtime composition</strong><span>${escapeHtml(runtimeReason(target))}</span></div>
        ${server || `<div class="component-line"><span class="component-name">Server</span>${stateReadout("N/A", { muted: true })}<span class="component-detail"></span></div>`}
        ${tunnel}
        ${target.error ? `<p class="runtime-error">${escapeHtml(target.error)}</p>` : ""}
      </div>
      <div class="detail-block">
        <div class="detail-title"><strong>Target details</strong></div>
        <div class="meta-line"><span>Startup</span><strong>${escapeHtml(target.startupPolicy || "manual")}</strong></div>
        <div class="meta-line"><span>Last check</span><strong class="mono">${escapeHtml(lastCheckedLabel)}</strong></div>
        <div class="meta-line"><span>Target ID</span><strong class="mono">${escapeHtml(target.id)}</strong></div>
      </div>
    </div>
  </div>`;
}

function targetRow(target) {
  const expanded = expandedTargets.has(target.id);
  return `<article class="target-item${expanded ? " expanded" : ""}" data-id="${escapeHtml(target.id)}">
    <div class="target-summary">
      <div class="target-identity">
        <button class="expand-target" type="button" data-expand-target aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(target.name)}" aria-expanded="${expanded}">${icons.disclosure}</button>
        <span class="tool-icon" aria-hidden="true">${icons.tool}</span>
        <span class="target-name"><strong>${escapeHtml(target.name)}</strong><small>${escapeHtml(target.id)}${target.enabled ? "" : " · disabled"}</small></span>
        ${autoStartControl(target)}
      </div>
      <div class="runtime-cell">${runtimeControl(target)}</div>
      <div class="monitor-cell">${componentControl(target, "monitor")}</div>
      ${rowMenu(target)}
    </div>
    ${expanded ? targetDetail(target) : ""}
  </article>`;
}

function render() {
  const validIds = new Set(snapshot.targets.map((target) => target.id));
  for (const id of expandedTargets) if (!validIds.has(id)) expandedTargets.delete(id);
  if (openMenuTarget && !validIds.has(openMenuTarget)) openMenuTarget = null;
  const fingerprint = JSON.stringify([snapshot.targets, [...expandedTargets].sort(), openMenuTarget, actionBusy, targetFilter, [...autoStartBusy].sort(), lastCheckedLabel]);
  if (fingerprint === renderFingerprint) return;
  renderFingerprint = fingerprint;

  const targets = snapshot.targets;
  const autoStartCount = targets.filter((target) => target.startupPolicy === "auto").length;
  const visibleTargets = targetFilter === "auto"
    ? targets.filter((target) => target.startupPolicy === "auto")
    : targets;
  document.querySelector("#count-ready").textContent = targets.filter((target) => target.state === "READY").length;
  document.querySelector("#count-degraded").textContent = targets.filter((target) => target.state === "DEGRADED").length;
  document.querySelector("#count-stopped").textContent = targets.filter((target) => target.state === "STOPPED").length;
  document.querySelector("#count-total").textContent = targets.length;
  document.querySelector("#target-count").textContent = `${targets.length} target${targets.length === 1 ? "" : "s"}`;
  document.querySelector("#auto-start-count").textContent = `${autoStartCount} auto start`;
  document.querySelectorAll("[data-target-filter]").forEach((button) => {
    const active = button.dataset.targetFilter === targetFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  rows.innerHTML = visibleTargets.length
    ? visibleTargets.map(targetRow).join("")
    : `<div class="empty-row">${targetFilter === "auto" ? "No Auto Start targets." : "No targets. Add one from “Add target”."}</div>`;
}

async function refresh({ silent = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  try {
    snapshot = await api("/api/status");
    lastCheckedLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    connection.dataset.state = "ready";
    connectionLabel.textContent = "Daemon connected";
    updated.textContent = `Updated ${lastCheckedLabel}`;
    render();
  } catch (error) {
    connection.dataset.state = "error";
    connectionLabel.textContent = "Daemon unavailable";
    if (!silent) showToast(error.message, true);
  } finally {
    refreshing = false;
  }
}

async function runAction(path, label) {
  if (actionBusy) return;
  actionBusy = true;
  render();
  try {
    await api(path, { method: "POST" });
    showToast(label);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionBusy = false;
    renderFingerprint = "";
    await refresh({ silent: true });
  }
}

async function setAutoStart(target, enabled) {
  const registryTarget = snapshot.registry.targets.find((candidate) => candidate.id === target.id);
  if (!registryTarget || autoStartBusy.has(target.id)) return;
  autoStartBusy.add(target.id);
  renderFingerprint = "";
  render();
  try {
    const updatedTarget = { ...registryTarget, startupPolicy: enabled ? "auto" : "manual" };
    await api(`/api/targets/${encodeURIComponent(target.id)}`, { method: "PUT", body: JSON.stringify(updatedTarget) });
    showToast(`Auto Start ${enabled ? "enabled" : "disabled"} for ${target.name}. Applies next time Swibo starts.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    autoStartBusy.delete(target.id);
    renderFingerprint = "";
    await refresh({ silent: true });
  }
}

function openEditor(target = null) {
  editingId = target?.id || null;
  document.querySelector("#dialog-title").textContent = target ? `Edit ${target.name}` : "Add target";
  editor.value = JSON.stringify(target || template, null, 2);
  editorError.textContent = "";
  deleteButton.classList.toggle("hidden", !target);
  dialog.showModal();
  requestAnimationFrame(() => editor.focus());
}

document.querySelector("#refresh").addEventListener("click", () => refresh());
document.querySelector("#start-all").addEventListener("click", () => runAction("/api/start-all", "Start all runtimes completed"));
document.querySelector("#stop-all").addEventListener("click", () => runAction("/api/stop-all", "Stop all runtimes completed"));
document.querySelector("#add-target").addEventListener("click", () => openEditor());
document.querySelector("#target-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-target-filter]");
  if (!button) return;
  targetFilter = button.dataset.targetFilter;
  renderFingerprint = "";
  render();
});

rows.addEventListener("click", async (event) => {
  const item = event.target.closest(".target-item[data-id]");
  const id = item?.dataset.id;
  if (!id) return;
  const target = snapshot.targets.find((candidate) => candidate.id === id);
  if (!target) return;

  if (event.target.closest("[data-autostart-toggle]")) {
    await setAutoStart(target, target.startupPolicy !== "auto");
    return;
  }

  if (event.target.closest("[data-expand-target]")) {
    expandedTargets.has(id) ? expandedTargets.delete(id) : expandedTargets.add(id);
    renderFingerprint = "";
    render();
    return;
  }

  if (event.target.closest("[data-more-menu]")) {
    event.stopPropagation();
    openMenuTarget = openMenuTarget === id ? null : id;
    renderFingerprint = "";
    render();
    return;
  }

  const menuButton = event.target.closest("button[data-menu-action]");
  if (menuButton) {
    event.stopPropagation();
    const action = menuButton.dataset.menuAction;
    openMenuTarget = null;
    renderFingerprint = "";
    if (action === "edit") {
      render();
      const registryTarget = snapshot.registry.targets.find((candidate) => candidate.id === id);
      if (registryTarget) openEditor(registryTarget);
      return;
    }
    if (action === "remove") {
      render();
      if (!confirm(`Remove ${id} from the registry? Running processes are not killed by removal.`)) return;
      try {
        await api(`/api/targets/${encodeURIComponent(id)}`, { method: "DELETE" });
        showToast("Target removed");
        await refresh();
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }
  }

  const componentButton = event.target.closest("button[data-component-action]");
  if (componentButton) {
    const component = componentButton.dataset.component;
    const action = componentButton.dataset.componentAction;
    await runAction(`/api/targets/${encodeURIComponent(id)}/components/${encodeURIComponent(component)}/${action}`, `${action} ${target.name} ${component} completed`);
    return;
  }

  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "edit") {
    const registryTarget = snapshot.registry.targets.find((candidate) => candidate.id === id);
    if (registryTarget) openEditor(registryTarget);
    return;
  }
  await runAction(`/api/targets/${encodeURIComponent(id)}/${action}`, `${action} ${target.name} completed`);
});

document.addEventListener("click", (event) => {
  if (openMenuTarget && !event.target.closest(".more-cell")) {
    openMenuTarget = null;
    renderFingerprint = "";
    render();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openMenuTarget) {
    openMenuTarget = null;
    renderFingerprint = "";
    render();
  }
});

document.querySelector("#save-target").addEventListener("click", async () => {
  editorError.textContent = "";
  let target;
  try { target = JSON.parse(editor.value); } catch (error) {
    editorError.textContent = `Invalid JSON: ${error.message}`;
    return;
  }
  try {
    const path = editingId ? `/api/targets/${encodeURIComponent(editingId)}` : "/api/targets";
    await api(path, { method: editingId ? "PUT" : "POST", body: JSON.stringify(target) });
    dialog.close();
    showToast(editingId ? "Target updated" : "Target added");
    await refresh();
  } catch (error) {
    editorError.textContent = error.message;
  }
});

deleteButton.addEventListener("click", async () => {
  if (!editingId) return;
  if (!confirm(`Remove ${editingId} from the registry? Running processes are not killed by removal.`)) return;
  try {
    await api(`/api/targets/${encodeURIComponent(editingId)}`, { method: "DELETE" });
    dialog.close();
    showToast("Target removed");
    await refresh();
  } catch (error) {
    editorError.textContent = error.message;
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh({ silent: true });
});

refresh();
setInterval(() => { if (!document.hidden) refresh({ silent: true }); }, 3000);
