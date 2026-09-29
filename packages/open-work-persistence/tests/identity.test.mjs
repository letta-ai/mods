import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import activate, { defaultRegistryRoot, registryPath, MAX_AGE_MS, MAX_BUDGET } from '../mods/open-work-persistence.ts';

const event = (agentId = 'A', conversationId = 'default') => ({ agentId, conversationId, stopReason: 'end_turn' });
function host(root) {
  process.env.OPEN_WORK_REGISTRY_ROOT = root;
  let handler;
  let unsubscribed = false;
  const dispose = activate({ capabilities: { events: { turns: true } }, events: {
    on(name, fn) { assert.equal(name, 'turn_end'); handler = fn; return () => { unsubscribed = true; }; },
  } });
  return { call: e => handler(e), dispose, unsubscribed: () => unsubscribed };
}
function fixture(t) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'open-work-offline-'));
  const prior = process.env.OPEN_WORK_REGISTRY_ROOT;
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); if (prior === undefined) delete process.env.OPEN_WORK_REGISTRY_ROOT; else process.env.OPEN_WORK_REGISTRY_ROOT = prior; });
  function arm(agent = 'A', conversation = 'default', changes = {}) {
    const path = registryPath(root, agent, conversation);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, JSON.stringify({ schema_version: 2, agent_id: agent, conversation_id: conversation,
      status: 'open', task: `synthetic ${agent}/${conversation}`, chain_budget: 3,
      updated_at: new Date().toISOString(), ...changes }));
    return path;
  }
  return { root, arm, ...host(root), read: (a = 'A', c = 'default') => JSON.parse(fs.readFileSync(registryPath(root, a, c))) };
}

if (process.env.OPEN_WORK_TEST_WORKER === '1') {
  const h = host(process.env.OPEN_WORK_REGISTRY_ROOT);
  process.send('ready');
  process.once('message', () => { process.send(Boolean(h.call(event()))); process.disconnect(); });
} else {
  test('default registry root lives under the runtime home, not a deployment path', () => {
    assert.equal(defaultRegistryRoot('/tmp/synthetic-home'), join('/tmp/synthetic-home', '.letta', 'open-work-v2'));
    assert.equal(defaultRegistryRoot(), join(os.homedir(), '.letta', 'open-work-v2'));
  });
  test('agents A/B default and different conversations have independent budgets and tasks', t => {
    const f = fixture(t); f.arm(); f.arm('B'); f.arm('A', 'other');
    process.env.LETTA_AGENT_ID = 'B';
    try {
      assert.match(f.call(event()).continue, /synthetic A\/default/);
      assert.equal(f.read().chain_budget, 2); assert.equal(f.read('B').chain_budget, 3);
      assert.equal(f.read('A', 'other').chain_budget, 3);
      assert.match(f.call(event('B')).continue, /synthetic B\/default/);
      assert.match(f.call(event('A', 'other')).continue, /synthetic A\/other/);
    } finally { delete process.env.LETTA_AGENT_ID; }
  });
  test('missing and malicious identities fail closed without touching records', t => {
    const f = fixture(t); f.arm();
    for (const id of [undefined, null, '', '../A', '/A', 'a/b', 'a\\b', '.', '..', 'a\0b', 'a'.repeat(129), 12, {}, 'é']) {
      assert.equal(f.call({ ...event(), agentId: id }), undefined);
      assert.equal(f.call({ ...event(), conversationId: id }), undefined);
    }
    assert.equal(f.call(null), undefined); assert.equal(f.call({}), undefined);
    assert.equal(f.read().chain_budget, 3);
    assert.equal(registryPath('relative', 'A', 'default'), undefined);
  });
  test('mismatched identities, legacy schema, and shared legacy override are refused', t => {
    const f = fixture(t);
    for (const change of [{ agent_id: 'B' }, { conversation_id: 'other' }, { schema_version: undefined }, { schema_version: 1 }]) {
      f.arm('A', 'default', change); assert.equal(f.call(event()), undefined);
    }
    const path = f.arm();
    fs.writeFileSync(path, JSON.stringify({ task: 'legacy', status: 'open', conversation: 'default', chain_budget: 15, updated_at: new Date().toISOString() }));
    process.env.OPEN_WORK_REGISTRY = path;
    try { assert.equal(f.call(event()), undefined); assert.equal(f.call(event('B')), undefined); }
    finally { delete process.env.OPEN_WORK_REGISTRY; }
  });
  test('budgets are finite bounded integers; states and timestamps strictly valid', t => {
    const f = fixture(t);
    for (const chain_budget of [0, -1, 1.5, '2', null, true, MAX_BUDGET + 1, 1e100]) {
      f.arm('A', 'default', { chain_budget }); assert.equal(f.call(event()), undefined);
    }
    for (const updated_at of ['invalid', null, 123, '2026-02-30T00:00:00.000Z', new Date(Date.now() + 60000).toISOString(), new Date(Date.now() - MAX_AGE_MS).toISOString()]) {
      f.arm('A', 'default', { updated_at }); assert.equal(f.call(event()), undefined);
    }
    for (const change of [{ status: 'done' }, { status: 'blocked' }, { task: '' }, { task: 12 }, { task: 'x'.repeat(4097) }]) {
      f.arm('A', 'default', change); assert.equal(f.call(event()), undefined);
    }
    const path = f.arm();
    for (const text of ['{', 'null', '[]', 'x'.repeat(17000)]) { fs.writeFileSync(path, text); assert.equal(f.call(event()), undefined); }
  });
  test('exact budget bound survives reactivation and never refreshes declaration age', t => {
    const f = fixture(t); f.arm('A', 'default', { chain_budget: MAX_BUDGET });
    const stamp = f.read().updated_at;
    for (let i = 0; i < MAX_BUDGET; i++) assert.ok(host(f.root).call(event())?.continue);
    for (let i = 0; i < 5; i++) assert.equal(host(f.root).call(event()), undefined);
    assert.equal(f.read().chain_budget, 0); assert.equal(f.read().updated_at, stamp);
  });
  test('only verified end_turn reason accepted; capability and disposal guards', t => {
    const f = fixture(t); f.arm();
    for (const stopReason of [undefined, '', 'cancelled', 'requires_approval', 'tool_rule', 'error', 'unknown']) assert.equal(f.call({ ...event(), stopReason }), undefined);
    assert.equal(f.read().chain_budget, 3);
    f.dispose(); assert.ok(f.unsubscribed()); assert.equal(f.call(event()), undefined);
    assert.equal(activate({}), undefined);
    assert.equal(activate({ capabilities: { events: { turns: false } }, events: { on() { throw Error('registered'); } } }), undefined);
    assert.equal(activate({ capabilities: { events: { turns: true } }, events: {} }), undefined);
  });
  test('read, lock, write, sync, rename, cleanup failures never continue', t => {
    const f = fixture(t);
    for (const method of ['openSync', 'readFileSync', 'writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync']) {
      const path = f.arm();
      const original = fs[method];
      fs[method] = () => { throw Error(`synthetic ${method} failure`); };
      try { assert.equal(f.call(event()), undefined, method); } finally { fs[method] = original; }
      for (const name of fs.readdirSync(dirname(path))) if (name !== 'default.json') fs.rmSync(join(dirname(path), name));
    }
    f.arm(); const path = registryPath(f.root, 'A', 'default');
    fs.writeFileSync(path + '.lock', 'abandoned');
    assert.equal(f.call(event()), undefined); assert.equal(f.read().chain_budget, 3);
    fs.unlinkSync(path + '.lock'); fs.unlinkSync(path);
    assert.equal(f.call(event()), undefined);
  });
  test('post-rename directory fsync failure loses a unit safely without continuation', t => {
    const f = fixture(t); f.arm();
    const original = fs.fsyncSync;
    let calls = 0;
    fs.fsyncSync = fd => { if (++calls === 2) throw Error('synthetic directory sync failure'); return original(fd); };
    try { assert.equal(f.call(event()), undefined); } finally { fs.fsyncSync = original; }
    assert.equal(calls, 2); assert.equal(f.read().chain_budget, 2);
    assert.ok(f.call(event())?.continue); assert.equal(f.read().chain_budget, 1);
  });
  test('cleanup failure loses a unit safely without continuation', t => {
    const f = fixture(t); f.arm();
    const original = fs.unlinkSync;
    fs.unlinkSync = () => { throw Error('synthetic lock cleanup failure'); };
    try { assert.equal(f.call(event()), undefined); } finally { fs.unlinkSync = original; }
    assert.equal(f.read().chain_budget, 2);
    assert.ok(fs.existsSync(registryPath(f.root, 'A', 'default') + '.lock'));
  });
  test('a replaced lock pathname is never removed by the old owner', t => {
    const f = fixture(t); const path = f.arm();
    const lock = path + '.lock';
    const original = fs.fsyncSync;
    let calls = 0;
    fs.fsyncSync = fd => {
      if (++calls === 2) {
        fs.renameSync(lock, lock + '.original');
        fs.writeFileSync(lock, 'replacement lock');
      }
      return original(fd);
    };
    try { assert.equal(f.call(event()), undefined); } finally { fs.fsyncSync = original; }
    assert.equal(calls, 2);
    assert.equal(f.read().chain_budget, 2);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'replacement lock');
  });
  test('registry symlinks refused', t => {
    const f = fixture(t); const path = f.arm(); const target = f.arm('B');
    fs.unlinkSync(path); fs.symlinkSync(target, path);
    assert.equal(f.call(event()), undefined); assert.equal(f.read('B').chain_budget, 3);
  });
  test('symlinked root or agent directory is refused', t => {
    const f = fixture(t); f.arm();
    const alias = f.root + '-alias';
    fs.symlinkSync(f.root, alias);
    t.after(() => fs.unlinkSync(alias));
    assert.equal(host(alias).call(event()), undefined);
    assert.equal(f.read().chain_budget, 3);

    const agentDir = dirname(registryPath(f.root, 'A', 'default'));
    const actualDir = join(f.root, 'underlying');
    fs.renameSync(agentDir, actualDir);
    fs.symlinkSync(actualDir, agentDir);
    assert.equal(f.call(event()), undefined);
    assert.equal(JSON.parse(fs.readFileSync(join(actualDir, 'default.json'))).chain_budget, 3);
  });
  test('independent concurrent processes cannot overspend one remaining unit', async t => {
    const f = fixture(t); f.arm('A', 'default', { chain_budget: 1 });
    const children = Array.from({ length: 12 }, () => fork(fileURLToPath(import.meta.url), [], {
      execArgv: ['--loader', fileURLToPath(new URL('./typescript-loader.mjs', import.meta.url))], env: { ...process.env, OPEN_WORK_TEST_WORKER: '1', OPEN_WORK_REGISTRY_ROOT: f.root }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    }));
    t.after(() => children.forEach(c => c.kill()));
    await Promise.all(children.map(c => new Promise((resolve, reject) => { c.once('message', resolve); c.once('error', reject); })));
    const results = children.map(c => new Promise((resolve, reject) => { c.once('message', resolve); c.once('error', reject); }));
    children.forEach(c => c.send('go'));
    assert.equal((await Promise.all(results)).filter(Boolean).length, 1);
    assert.equal(f.read().chain_budget, 0);
  });
}
