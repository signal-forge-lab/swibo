import os from "node:os";
import path from "node:path";

const variables = () => ({
  HOME: os.homedir(),
  USERPROFILE: process.env.USERPROFILE || os.homedir(),
  LOCALAPPDATA: process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  APPDATA: process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
});

export function expandPath(value) {
  if (typeof value !== "string") return value;
  let expanded = value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
  for (const [name, replacement] of Object.entries(variables())) {
    expanded = expanded
      .replaceAll(`\${${name}}`, replacement)
      .replaceAll(`%${name}%`, replacement);
  }
  return path.normalize(expanded);
}

export function expandValue(value) {
  if (typeof value !== "string") return value;
  let expanded = value;
  for (const [name, replacement] of Object.entries(variables())) {
    expanded = expanded
      .replaceAll(`\${${name}}`, replacement)
      .replaceAll(`%${name}%`, replacement);
  }
  if (expanded.startsWith("~")) expanded = path.join(os.homedir(), expanded.slice(1));
  return expanded;
}

export function stateRoot() {
  return path.join(variables().LOCALAPPDATA, "mcp-supervisor");
}
