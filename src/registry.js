import fs from "node:fs";
import path from "node:path";

import { expandPath, stateRoot } from "./paths.js";

const checkTypes = new Set(["none", "http", "httpUrlFile", "tcp", "command", "pidFile"]);
const startupPolicies = new Set(["manual", "auto"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function validateCommand(spec, label) {
  assertObject(spec, label);
  if (spec.kind === "terminate") {
    if (!spec.processKey || typeof spec.processKey !== "string") {
      throw new Error(`${label}.processKey is required for terminate actions.`);
    }
    return;
  }
  if (typeof spec.command !== "string" || !spec.command.trim()) {
    throw new Error(`${label}.command is required.`);
  }
  if (/[&|><;\r\n]/.test(spec.command) || (/\s/.test(spec.command) && !/[\\/:]/.test(spec.command))) {
    throw new Error(`${label}.command must be an executable; put arguments in args.`);
  }
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string"))) {
    throw new Error(`${label}.args must be an array of strings.`);
  }
  if (spec.waitFor !== undefined && !["server", "tunnel"].includes(spec.waitFor)) {
    throw new Error(`${label}.waitFor must be server or tunnel.`);
  }
  if (spec.unlessReady !== undefined && !["server", "tunnel"].includes(spec.unlessReady)) {
    throw new Error(`${label}.unlessReady must be server or tunnel.`);
  }
}

function validateCheck(check, label) {
  assertObject(check, label);
  if (!checkTypes.has(check.type)) throw new Error(`${label}.type is unsupported: ${check.type}`);
  if (check.type === "http" && typeof check.url !== "string") throw new Error(`${label}.url is required.`);
  if (check.type === "httpUrlFile") {
    if (typeof check.path !== "string") throw new Error(`${label}.path is required.`);
    if (check.pathSuffix !== undefined && (typeof check.pathSuffix !== "string" || !check.pathSuffix.startsWith("/"))) {
      throw new Error(`${label}.pathSuffix must start with /.`);
    }
  }
  if (check.type === "tcp" && (!Number.isInteger(check.port) || check.port < 1 || check.port > 65535)) {
    throw new Error(`${label}.port must be a valid TCP port.`);
  }
  if (check.type === "command") validateCommand(check, label);
  if (check.type === "pidFile" && typeof check.path !== "string") throw new Error(`${label}.path is required.`);
}

function validateComponent(component, label) {
  assertObject(component, label);
  if (component.label !== undefined && (typeof component.label !== "string" || !component.label.trim())) {
    throw new Error(`${label}.label must be a non-empty string.`);
  }
  assertObject(component.lifecycle, `${label}.lifecycle`);
  for (const phase of ["start", "stop"]) {
    if (!Array.isArray(component.lifecycle[phase])) throw new Error(`${label}.lifecycle.${phase} must be an array.`);
    component.lifecycle[phase].forEach((spec, index) => validateCommand(spec, `${label}.lifecycle.${phase}[${index}]`));
  }
  validateCheck(component.check, `${label}.check`);
}

export function validateTarget(target) {
  assertObject(target, "target");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(target.id || "")) throw new Error("target.id is invalid.");
  if (typeof target.name !== "string" || !target.name.trim()) throw new Error("target.name is required.");
  if (target.enabled !== undefined && typeof target.enabled !== "boolean") throw new Error("target.enabled must be boolean.");
  if (!startupPolicies.has(target.startupPolicy || "manual")) throw new Error("target.startupPolicy is invalid.");
  assertObject(target.lifecycle, `${target.id}.lifecycle`);
  for (const phase of ["start", "stop"]) {
    if (!Array.isArray(target.lifecycle[phase])) throw new Error(`${target.id}.lifecycle.${phase} must be an array.`);
    target.lifecycle[phase].forEach((spec, index) => validateCommand(spec, `${target.id}.${phase}[${index}]`));
  }
  assertObject(target.checks, `${target.id}.checks`);
  validateCheck(target.checks.server, `${target.id}.checks.server`);
  validateCheck(target.checks.tunnel, `${target.id}.checks.tunnel`);
  if (target.components !== undefined) {
    assertObject(target.components, `${target.id}.components`);
    for (const [key, component] of Object.entries(target.components)) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(key)) throw new Error(`${target.id}.components key is invalid: ${key}`);
      validateComponent(component, `${target.id}.components.${key}`);
    }
  }
  return structuredClone(target);
}

export function validateRegistry(input) {
  assertObject(input, "registry");
  if (input.version !== 1) throw new Error("registry.version must be 1.");
  if (!Array.isArray(input.targets)) throw new Error("registry.targets must be an array.");
  const targets = input.targets.map(validateTarget);
  const ids = new Set();
  for (const target of targets) {
    if (ids.has(target.id)) throw new Error(`Duplicate target id: ${target.id}`);
    ids.add(target.id);
  }
  return { version: 1, targets };
}

export class RegistryStore {
  constructor({ defaultPath, registryPath = path.join(stateRoot(), "registry.json") }) {
    this.defaultPath = defaultPath;
    this.registryPath = registryPath;
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    if (!fs.existsSync(this.registryPath)) {
      fs.copyFileSync(this.defaultPath, this.registryPath);
    }
    return this.load();
  }

  load() {
    const text = fs.readFileSync(this.registryPath, "utf8").replace(/^\uFEFF/, "");
    return validateRegistry(JSON.parse(text));
  }

  save(registry) {
    const validated = validateRegistry(registry);
    const temp = `${this.registryPath}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    fs.renameSync(temp, this.registryPath);
    return validated;
  }

  add(target) {
    const registry = this.load();
    registry.targets.push(validateTarget(target));
    return this.save(registry);
  }

  update(id, target) {
    const registry = this.load();
    const index = registry.targets.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Unknown target: ${id}`);
    const validated = validateTarget(target);
    if (validated.id !== id && registry.targets.some((item) => item.id === validated.id)) {
      throw new Error(`Duplicate target id: ${validated.id}`);
    }
    registry.targets[index] = validated;
    return this.save(registry);
  }

  remove(id) {
    const registry = this.load();
    const next = registry.targets.filter((item) => item.id !== id);
    if (next.length === registry.targets.length) throw new Error(`Unknown target: ${id}`);
    registry.targets = next;
    return this.save(registry);
  }
}
