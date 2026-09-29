const nowIso = () => new Date().toISOString();

function stamp(status, checkedAt) {
  return { ...status, checkedAt };
}

export class StatusCache {
  constructor(registry) {
    this.registry = registry;
    this.targets = [];
    this.checkedAt = null;
    this.updatedAt = null;
  }

  snapshot() {
    return {
      targets: this.targets,
      registry: this.registry,
      checkedAt: this.checkedAt,
      updatedAt: this.updatedAt
    };
  }

  setRegistry(registry, updatedAt = nowIso()) {
    this.registry = registry;
    const byId = new Map(this.targets.map((target) => [target.id, target]));
    this.targets = registry.targets.map((target) => byId.get(target.id)).filter(Boolean);
    this.updatedAt = updatedAt;
    return this.snapshot();
  }

  replaceAll(targets, checkedAt = nowIso()) {
    const byId = new Map(targets.map((target) => [target.id, stamp(target, checkedAt)]));
    this.targets = this.registry.targets.map((target) => byId.get(target.id)).filter(Boolean);
    this.checkedAt = checkedAt;
    this.updatedAt = checkedAt;
    return this.snapshot();
  }

  upsert(target, checkedAt = nowIso()) {
    const byId = new Map(this.targets.map((item) => [item.id, item]));
    byId.set(target.id, stamp(target, checkedAt));
    this.targets = this.registry.targets.map((item) => byId.get(item.id)).filter(Boolean);
    this.updatedAt = checkedAt;
    return this.snapshot();
  }

}
