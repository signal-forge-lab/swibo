import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui-shell', 'unified.html'), 'utf8');
const tauri = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'unified_bridge.rs'), 'utf8');
const launcher = fs.readFileSync(path.join(root, 'scripts', 'launch-unified-preview.mjs'), 'utf8');

test('unified preview is one local WebView with opt-in-only commands and rollback-safe launcher', () => {
  assert.match(tauri, /WebviewUrl::App\("unified\.html"\.into\(\)\)/);
  assert.match(tauri, /SWIBO_UNIFIED_PREVIEW/);
  assert.match(tauri, /WindowEvent::Destroyed/);
  assert.match(tauri, /window\.app_handle\(\)\.exit\(0\)/);
  assert.match(bridge, /Unified preview is disabled/);
  assert.match(bridge, /127\.0\.0\.1:17991/);
  assert.doesNotMatch(html, /<iframe\b|setInterval\s*\(/);
  assert.match(launcher, /launch-unified-preview|SWIBO_UNIFIED_PREVIEW/);
  assert.match(launcher, /SWIBO_UNIFIED_LOCTL_EXE/);
  assert.match(launcher, /--headless-rpc/);
  assert.match(launcher, /timeout:\s*3000/);
  assert.match(launcher, /response\.ok === true/);
  assert.match(launcher, /--release/);
  assert.match(launcher, /CARGO_TARGET_DIR/);
  assert.match(launcher, /staleBinary/);
  assert.doesNotMatch(launcher, /taskkill|Stop-Process|kill\(/);
});

test('unified UI covers pinned launcher, selected detail, status facets and autostart', () => {
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline);
  assert.doesNotThrow(() => new Function(inline));
  for (const id of ['runtime-tab','launcher-tab','module-search','module-stage','targets','modules','stream-state']) {
    assert.ok(html.includes(`id="${id}"`), `Missing UI element: ${id}`);
  }
  for (const feature of ['m.pinned','payload.signals','payload.quickView','payload.activity','unified_swibo_autostart','module_status','module_action']) {
    assert.ok(html.includes(feature), `Missing feature wiring: ${feature}`);
  }
  assert.match(html, /unified-swibo-status/);
  assert.match(html, /unified_swibo_watch/);
  assert.match(html, /module_icon/);
  assert.match(html, /moduleGlyph/);
  assert.match(html, /iconSequence/);
  for (const feature of ['target-editor','add-target','save-target','delete-target','expandedTargets','start-all','stop-all','unified_swibo_registry']) {
    assert.ok(html.includes(feature), `Missing target management: ${feature}`);
  }
  assert.match(bridge, /registry_route/);
  assert.match(bridge, /Invalid target ID/);
});


test('unified status honors cached freshness without periodic status requests', () => {
  assert.match(html, /CACHE_STALE_AFTER_MS = 2 \* 60 \* 1000/);
  assert.match(html, /function targetIsStale/);
  assert.match(html, /scheduleFreshnessRender\(\)/);
  assert.match(html, /clearTimeout\(freshnessTimer\)/);
  assert.match(html, /status\.className = stale \? "stale"/);
  assert.match(html, /control\.disabled = busy \|\| !t\.enabled \|\| stale/);
  assert.doesNotMatch(html, /setInterval\s*\(/);
});
