import path from "node:path";
import { fileURLToPath } from "node:url";

import { RegistryStore } from "./registry.js";
import { Supervisor } from "./supervisor.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createRuntime() {
  const store = new RegistryStore({ defaultPath: path.join(projectRoot, "config", "default-registry.json") });
  const registry = store.ensure();
  const supervisor = new Supervisor({ registry });
  return {
    projectRoot,
    store,
    supervisor,
    reload() {
      const next = store.load();
      supervisor.setRegistry(next);
      return next;
    }
  };
}
