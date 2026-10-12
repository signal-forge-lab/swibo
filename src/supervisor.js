import { runCheck as defaultRunCheck } from "./checks.js";
import { runCommand as defaultRunCommand, terminateOwnedProcess } from "./runner.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function deriveTargetState({ server, tunnel }) {
  const applicable = [server, tunnel].filter((check) => !check.notApplicable);
  if (!applicable.length) return "STOPPED";
  if (applicable.every((check) => check.ready)) return "READY";
  if (applicable.every((check) => !check.ready)) return "STOPPED";
  return "DEGRADED";
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = { ok: true, value: await worker(items[current]) };
      } catch (error) {
        results[current] = { ok: false, error: error.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

async function mapValuesLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

export class Supervisor {
  constructor({ registry, runCommand = defaultRunCommand, runCheck = defaultRunCheck, wait = sleep }) {
    this.registry = registry;
    this.runCommand = runCommand;
    this.runCheck = runCheck;
    this.wait = wait;
    this.operations = new Map();
    this.componentOperations = new Map();
    this.ownedPids = new Map();
    this.lastErrors = new Map();
    this.componentErrors = new Map();
    this.statusAllInFlight = null;
  }

  setRegistry(registry) {
    this.registry = registry;
    this.statusAllInFlight = null;
  }

  target(id) {
    const target = this.registry.targets.find((item) => item.id === id);
    if (!target) throw new Error(`Unknown target: ${id}`);
    return target;
  }

  component(target, key) {
    const component = target.components?.[key];
    if (!component) throw new Error(`${target.name} has no component: ${key}`);
    return component;
  }

  componentOperationKey(id, key) {
    return `${id}::${key}`;
  }

  hasComponentOperation(id) {
    const prefix = `${id}::`;
    return [...this.componentOperations.keys()].some((key) => key.startsWith(prefix));
  }

  async checkComponent(target, key, { includeOperation = true } = {}) {
    const component = this.component(target, key);
    const check = await this.runCheck(component.check);
    const operationKey = this.componentOperationKey(target.id, key);
    const operation = includeOperation ? this.componentOperations.get(operationKey) : undefined;
    if (!operation && check.ready) {
      this.componentErrors.delete(operationKey);
    }
    return {
      key,
      label: component.label || key,
      state: operation || (check.notApplicable ? "N/A" : check.ready ? "READY" : "STOPPED"),
      ...check,
      error: this.componentErrors.get(operationKey) || ""
    };
  }

  async checkTarget(target, { includeOperation = true } = {}) {
    const componentEntries = Object.entries(target.components || {});
    const [server, tunnel, componentResults] = await Promise.all([
      this.runCheck(target.checks.server),
      this.runCheck(target.checks.tunnel),
      Promise.all(componentEntries.map(async ([key]) => [key, await this.checkComponent(target, key, { includeOperation })]))
    ]);
    const operation = includeOperation ? this.operations.get(target.id) : undefined;
    const stableState = deriveTargetState({ server, tunnel });
    if (!operation && stableState === "READY") {
      this.lastErrors.delete(target.id);
    }
    return {
      id: target.id,
      name: target.name,
      enabled: target.enabled !== false,
      startupPolicy: target.startupPolicy || "manual",
      state: operation || stableState,
      server,
      tunnel,
      components: Object.fromEntries(componentResults),
      ownedPids: Object.fromEntries(this.ownedPids.get(target.id) || []),
      error: this.lastErrors.get(target.id) || ""
    };
  }

  status(id) {
    return this.checkTarget(this.target(id));
  }

  statusAll() {
    if (this.statusAllInFlight) return this.statusAllInFlight;
    const targets = [...this.registry.targets];
    let task;
    task = (async () => {
      try {
        return await mapValuesLimit(targets, 3, (target) => this.checkTarget(target));
      } finally {
        if (this.statusAllInFlight === task) this.statusAllInFlight = null;
      }
    })();
    this.statusAllInFlight = task;
    return task;
  }

  async waitForCheck(target, key, expected = true, timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = await this.runCheck(target.checks[key]);
      if (result.ready === expected) return result;
      await this.wait(250);
    }
    throw new Error(`${target.name} ${key} did not become ${expected ? "ready" : "stopped"}.`);
  }

  async waitForComponentCheck(target, key, expected = true, timeoutMs = 15000) {
    const component = this.component(target, key);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = await this.runCheck(component.check);
      if (result.ready === expected) return result;
      await this.wait(250);
    }
    throw new Error(`${target.name} ${component.label || key} did not become ${expected ? "ready" : "stopped"}.`);
  }

  async executeAction(target, action) {
    if (action.unlessReady) {
      const current = await this.runCheck(target.checks[action.unlessReady]);
      if (current.ready) return;
    }
    if (action.kind === "terminate") {
      const pids = this.ownedPids.get(target.id);
      const pid = pids?.get(action.processKey);
      if (pid) {
        terminateOwnedProcess(pid);
        pids.delete(action.processKey);
      }
      return;
    }
    const result = await this.runCommand(action);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || `exit ${result.code}`).trim();
      throw new Error(`${target.name}: ${detail}`);
    }
    if (action.processKey && result.pid) {
      if (!this.ownedPids.has(target.id)) this.ownedPids.set(target.id, new Map());
      this.ownedPids.get(target.id).set(action.processKey, result.pid);
    }
    if (action.waitFor) await this.waitForCheck(target, action.waitFor, true, action.waitTimeoutMs || 30000);
  }

  async runLifecycle(id, phase, { forceStop = false } = {}) {
    const target = this.target(id);
    if (target.enabled === false && phase === "start") throw new Error(`${target.name} is disabled.`);
    if (this.operations.has(id)) throw new Error(`${target.name} already has an active operation.`);
    if (this.hasComponentOperation(id)) throw new Error(`${target.name} already has an active component operation.`);
    const before = await this.checkTarget(target, { includeOperation: false });
    if (phase === "start" && before.state === "READY") return before;
    if (phase === "stop" && before.state === "STOPPED" && !forceStop) return before;
    this.operations.set(id, phase === "start" ? "STARTING" : "STOPPING");
    this.lastErrors.delete(id);
    try {
      for (const action of target.lifecycle[phase]) await this.executeAction(target, action);
      const status = await this.checkTarget(target, { includeOperation: false });
      if (phase === "start" && status.state !== "READY") {
        throw new Error(`${target.name} finished startup but is ${status.state}.`);
      }
      if (phase === "stop") {
        const waits = [];
        if (target.checks.server.type !== "none") waits.push(this.waitForCheck(target, "server", false, 15000));
        if (target.checks.tunnel.type !== "none") waits.push(this.waitForCheck(target, "tunnel", false, 15000));
        await Promise.all(waits);
      }
      return await this.checkTarget(target, { includeOperation: false });
    } catch (error) {
      this.lastErrors.set(id, error.message);
      throw error;
    } finally {
      this.operations.delete(id);
    }
  }

  start(id) { return this.runLifecycle(id, "start"); }
  stop(id) { return this.runLifecycle(id, "stop"); }

  async runComponentLifecycle(id, key, phase) {
    const target = this.target(id);
    const component = this.component(target, key);
    if (target.enabled === false && phase === "start") throw new Error(`${target.name} is disabled.`);
    if (this.operations.has(id)) throw new Error(`${target.name} already has an active operation.`);
    if (this.hasComponentOperation(id)) throw new Error(`${target.name} already has an active component operation.`);

    const before = await this.checkComponent(target, key, { includeOperation: false });
    if (phase === "start" && before.ready) return before;
    if (phase === "stop" && !before.ready) return before;

    const operationKey = this.componentOperationKey(id, key);
    this.componentOperations.set(operationKey, phase === "start" ? "STARTING" : "STOPPING");
    this.componentErrors.delete(operationKey);
    try {
      for (const action of component.lifecycle[phase]) await this.executeAction(target, action);
      await this.waitForComponentCheck(target, key, phase === "start", 15000);
      return await this.checkComponent(target, key, { includeOperation: false });
    } catch (error) {
      this.componentErrors.set(operationKey, error.message);
      throw error;
    } finally {
      this.componentOperations.delete(operationKey);
    }
  }

  startComponent(id, key) { return this.runComponentLifecycle(id, key, "start"); }
  stopComponent(id, key) { return this.runComponentLifecycle(id, key, "stop"); }

  async restartComponent(id, key) {
    await this.stopComponent(id, key);
    return this.startComponent(id, key);
  }

  async restart(id) {
    // A failed readiness check does not prove the process has exited.
    // Restart must run the target-owned (idempotent) stop wrapper even when
    // cached readiness says STOPPED, or the subsequent start can double-spawn.
    await this.runLifecycle(id, "stop", { forceStop: true });
    return this.start(id);
  }

  startAll({ autoOnly = false } = {}) {
    const targets = this.registry.targets.filter((target) =>
      target.enabled !== false && (!autoOnly || target.startupPolicy === "auto")
    );
    const byId = new Map(targets.map((target) => [target.id, target]));
    const ordered = [];
    const visited = new Set();
    function visit(target) {
      if (visited.has(target.id)) return;
      visited.add(target.id);
      for (const id of target.dependsOn || []) visit(byId.get(id));
      ordered.push(target);
    }
    for (const target of targets) visit(target);
    const gates = new Map(targets.map((target) => {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      return [target.id, { promise, resolve }];
    }));
    return mapLimit(ordered, 3, async (target) => {
      try {
        for (const id of target.dependsOn || []) {
          if (!(await gates.get(id).promise)) throw new Error(`${target.id} startup dependency ${id} failed.`);
        }
        const status = await this.start(target.id);
        gates.get(target.id).resolve(true);
        return status;
      } catch (error) {
        gates.get(target.id).resolve(false);
        throw error;
      }
    }).then((results) => {
      const byResult = new Map(ordered.map((target, i) => [target.id, results[i]]));
      return targets.map((target) => byResult.get(target.id));
    });
  }

  stopAll() {
    const targets = [...this.registry.targets].reverse().filter((target) => target.enabled !== false);
    return mapLimit(targets, 3, (target) => this.stop(target.id));
  }
}
