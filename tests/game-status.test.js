'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findWings, fetchGameStatus } = require('../main/game-status');
const { createCli } = require('../main/cli');
const { createLock, PRIORITY } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

test('findWings', () => {
  assert.equal(findWings([{ DisplayName: '골드', Amount: 1 }, { DisplayName: '정령의 날개', Amount: 28255 }]), 28255);
  assert.equal(findWings([]), null);
  assert.equal(findWings(null), null);
});

test('fetchGameStatus: 날개와 무게', async () => {
  const { spawn } = createFakeSpawn((command) => (command === 'get_currencies'
    ? { stdout: '[{"DisplayName":"정령의 날개","Amount":50}]' }
    : { stdout: '{"CurrentInventoryWeightAsDecimal":1449,"MaxInventoryWeightAsDecimal":1700}' }));
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  assert.deepEqual(await fetchGameStatus({ cli, lock: createLock() }), { wings: 50, weight: { current: 1449, max: 1700 } });
});

test('fetchGameStatus: 잠금이 바쁘면 null', async () => {
  const lock = createLock();
  const hold = lock.run(PRIORITY.GATHER, () => new Promise((r) => setTimeout(r, 10)));
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn: () => { throw new Error('no'); } });
  assert.equal(await fetchGameStatus({ cli, lock }), null);
  await hold;
});

test('fetchGameStatus: priority를 주면 잠금이 바빠도 기다렸다가 최신 값을 반환한다', async () => {
  const lock = createLock();
  let release;
  const hold = lock.run(PRIORITY.GATHER, () => new Promise((r) => { release = r; }));
  const { spawn } = createFakeSpawn((command) => (command === 'get_currencies'
    ? { stdout: '[{"DisplayName":"정령의 날개","Amount":50}]' }
    : { stdout: '{"CurrentInventoryWeightAsDecimal":1449,"MaxInventoryWeightAsDecimal":1700}' }));
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const p = fetchGameStatus({ cli, lock, priority: PRIORITY.MANUAL });
  await new Promise((r) => setTimeout(r, 10));
  release();
  await hold;
  assert.deepEqual(await p, { wings: 50, weight: { current: 1449, max: 1700 } });
});
