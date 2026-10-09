#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = process.platform === 'win32' ? '.exe' : '';
const release = process.argv.includes('--release');
const targetDir = release
  ? path.join(process.env.LOCALAPPDATA || path.join(root, 'local'), 'IntelligenceWorks', 'cargo-target', 'swibo-unified-release')
  : path.join(root, 'src-tauri', 'target');
const binary = path.join(targetDir, release ? 'release' : 'debug', `mcp-supervisor${extension}`);
const loctlRoot = path.resolve(root, '..', '..', 'tools', 'loctl');
const loctlSource = path.join(loctlRoot, 'src-tauri', 'src', 'main.rs');
const candidates = [
  process.env.SWIBO_UNIFIED_LOCTL_EXE,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'IntelligenceWorks', 'cargo-target', 'loctl-unified', 'debug', `loctl${extension}`),
  path.join(loctlRoot, 'src-tauri', 'target', 'debug', `loctl${extension}`),
  path.join(loctlRoot, 'src-tauri', 'target', 'release', `loctl${extension}`),
].filter(Boolean);

function compatibleLoctl(candidate) {
  if (!fs.existsSync(candidate)) return false;
  // Source and executable are not necessarily in the same target directory.
  // An older GUI-only executable can treat --headless-rpc as an ordinary GUI
  // launch and hang indefinitely. Reject known-stale binaries before probing.
  if (fs.existsSync(loctlSource) && fs.statSync(candidate).mtimeMs < fs.statSync(loctlSource).mtimeMs) {
    return false;
  }
  const check = spawnSync(candidate, ['--headless-rpc'], {
    input: '{"kind":"registry"}',
    encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (check.status !== 0 || check.error) return false;
  try {
    const response = JSON.parse(check.stdout);
    return response.ok === true && Array.isArray(response.value?.modules);
  } catch { return false; }
}
const loctl = candidates.find(compatibleLoctl);
if (!loctl) {
  throw new Error('No compatible Loctl headless executable. Build Loctl from current sources or set SWIBO_UNIFIED_LOCTL_EXE.');
}
const sourcePaths = [
  path.join(root, 'ui-shell', 'unified.html'),
  path.join(root, 'src-tauri', 'src', 'main.rs'),
  path.join(root, 'src-tauri', 'src', 'unified_bridge.rs'),
  path.join(root, 'src-tauri', 'tauri.conf.json'),
  path.join(root, 'src-tauri', 'capabilities', 'unified-events.json')
];
const staleBinary = fs.existsSync(binary)
  && sourcePaths.some(file => fs.existsSync(file) && fs.statSync(file).mtimeMs > fs.statSync(binary).mtimeMs);
if (process.argv.includes('--build') || !fs.existsSync(binary) || staleBinary) {
  const build = spawnSync('cargo', [
    'build', ...(release ? ['--release'] : []),
    '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml')
  ], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: {...process.env, ...(release ? {CARGO_TARGET_DIR:targetDir} : {})}
  });
  if (build.error || build.status !== 0) throw new Error(`Swibo preview build failed: ${build.error?.message ?? build.status}`);
}
// The existing Swibo CLI starts only the daemon, without replacing a running UI.
const start = spawnSync(process.execPath, [path.join(root, 'src', 'cli.js'), 'daemon', 'start'], {
  cwd: root, stdio: 'inherit', windowsHide: true
});
if (start.error || start.status !== 0) throw new Error('Swibo daemon start failed');
const child = spawn(binary, [], {
  cwd: root, detached: true, windowsHide: true, stdio: 'ignore',
  env: {
    ...process.env, MCP_SUPERVISOR_ROOT: root,
    SWIBO_UNIFIED_PREVIEW: '1', SWIBO_UNIFIED_LOCTL_EXE: loctl,
  },
});
child.once('error', error => {
  console.error(`Unable to launch unified preview: ${error.message}`);
  process.exitCode = 1;
});
child.once('spawn', () => {
  console.log(`Unified ${release ? 'release' : 'debug'} preview launched (PID ${child.pid}); existing Swibo and Loctl GUIs unchanged.`);
  child.unref();
});
