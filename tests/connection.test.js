'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnectionMonitor } = require('../main/connection');
const { createCli } = require('../main/cli');
const { createLock } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

function mon(responses, cliPath = 'X:\\cli.exe') {
  const { spawn } = createFakeSpawn(responses);
  const cli = createCli({ cliPath, spawn });
  const changes = [];
  const m = createConnectionMonitor({ cli, lock: createLock(), onChange: (s) => changes.push(s) });
  return { m, changes };
}

test('check: connected', async () => {
  const { m, changes } = mon([{ stdout: '{"pipe":"connected"}' }]);
  await m.check();
  assert.deepEqual(changes, [{ connected: true, reason: null }]);
  assert.deepEqual(m.current(), { connected: true, reason: null });
});

test('check: exit 5 option_off', async () => {
  const { m, changes } = mon([{ stdout: '{"pipe":"disconnected","reason":"option_off"}', exitCode: 5 }]);
  await m.check();
  assert.deepEqual(changes, [{ connected: false, reason: 'option_off' }]);
});

test('check: cliPath 없음 → cli_missing', async () => {
  const { m, changes } = mon([], null);
  await m.check();
  assert.deepEqual(changes, [{ connected: false, reason: 'cli_missing' }]);
});

test('같은 상태는 다시 알리지 않는다', async () => {
  const { m, changes } = mon([{ stdout: '{"pipe":"connected"}' }]);
  await m.check(); await m.check();
  assert.equal(changes.length, 1);
});

test('report: 폴러가 본 disconnected를 반영', async () => {
  const { m, changes } = mon([{ stdout: '{"pipe":"connected"}' }]);
  await m.check();
  m.report({ ok: false, kind: 'disconnected', reason: 'game_off' });
  assert.deepEqual(changes.at(-1), { connected: false, reason: 'game_off' });
  m.report({ ok: false, kind: 'rejected' });
  assert.equal(changes.length, 2);
});
