import os from "node:os";
import path from "node:path";

export function resolvePlatformPaths({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const applicationData = platform === "darwin"
    ? pathApi.join(home, "Library", "Application Support")
    : platform === "win32"
      ? pathApi.join(home, "AppData", "Local")
      : env.XDG_STATE_HOME || pathApi.join(home, ".local", "state");
  const localAppData = env.LOCALAPPDATA || applicationData;
  const appData = env.APPDATA || (platform === "win32" ? pathApi.join(home, "AppData", "Roaming") : applicationData);
  const stateHome = env.MCP_SUPERVISOR_STATE_DIR || pathApi.join(localAppData, "mcp-supervisor");
  return {
    HOME: home,
    USERPROFILE: env.USERPROFILE || home,
    LOCALAPPDATA: localAppData,
    APPDATA: appData,
    SWIBO_STATE_HOME: stateHome
  };
}

const variables = () => resolvePlatformPaths();

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
  return variables().SWIBO_STATE_HOME;
}
