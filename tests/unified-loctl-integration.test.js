import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const executable = process.env.SWIBO_UNIFIED_TEST_LOCTL_EXE;

test('real Loctl headless RPC isolates one failed module from healthy modules and registry discovery', {
  skip: !executable || !fs.existsSync(executable) ? 'Set SWIBO_UNIFIED_TEST_LOCTL_EXE to a current Loctl executable' : false
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swibo-unified-loctl-'));
  try {
    const manifest = (id, command) => ({
      schema: 'loctl.module/v1',
      id,
      name: id,
      description: 'Isolated test fixture',
      enabled: true,
      capabilities: ['status'],
      adapter: {
        protocol: 'process-json-v1',
        command,
        args: command === process.execPath ? [path.join(dir, 'adapter.mjs')] : [],
        timeoutMs: 2000
      }
    });
    fs.writeFileSync(path.join(dir, 'adapter.mjs'),
      'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({ok:true,state:"READY",detail:"fixture"})));\n');
    const healthy = path.join(dir, 'healthy.json');
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(healthy, JSON.stringify(manifest('fixture-healthy', process.execPath)));
    fs.writeFileSync(broken, JSON.stringify(manifest('fixture-broken', path.join(dir, 'no-such-executable'))));
    const missing = path.join(dir, 'missing.json');
    const registry = path.join(dir, 'registry.json');
    fs.writeFileSync(registry, JSON.stringify({schema:'loctl.registry/v1',modules:[healthy,missing,broken]}));

    function rpc(request) {
      const child = spawnSync(executable, ['--headless-rpc'], {
        input: JSON.stringify(request),
        encoding: 'utf8',
        timeout: 6000,
        windowsHide: true,
        env: {...process.env, LOCTL_REGISTRY_PATH: registry}
      });
      assert.equal(child.error, undefined, child.error?.message);
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    }

    const discovery = rpc({kind:'registry'});
    assert.equal(discovery.ok, true);
    assert.deepEqual(discovery.value.modules.map(module => module.id).sort(),
      ['fixture-broken', 'fixture-healthy']);
    assert.equal(discovery.value.issues.length, 1);
    assert.equal(rpc({kind:'module_status',module_id:'fixture-healthy'}).value.state, 'READY');
    assert.equal(rpc({kind:'module_status',module_id:'fixture-broken'}).ok, false);
    assert.equal(rpc({kind:'module_status',module_id:'fixture-healthy'}).value.state, 'READY');
    assert.equal(rpc({kind:'module_action',module_id:'fixture-healthy',operation:'stop'}).ok, false);
    assert.equal(rpc({kind:'module_status',module_id:'../unsafe'}).ok, false);
  } finally {
    fs.rmSync(dir, {recursive:true,force:true});
  }
});
