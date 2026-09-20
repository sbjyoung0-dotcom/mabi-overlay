'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLock, PRIORITY } = require('../main/cli-lock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('run: 순차 실행, 동시에 두 개가 돌지 않는다', async () => {
  const lock = createLock();
  const log = [];
  const job = (name, ms) => async () => { log.push(name + ':start'); await sleep(ms); log.push(name + ':end'); };
  await Promise.all([lock.run(PRIORITY.POLL, job('a', 20)), lock.run(PRIORITY.POLL, job('b', 5))]);
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('run: 대기열은 우선순위 숫자가 낮은 것 먼저', async () => {
  const lock = createLock();
  const log = [];
  const p0 = lock.run(PRIORITY.POLL, () => sleep(20));
  const pAuto = lock.run(PRIORITY.AUTO, async () => log.push('auto'));
  const pGather = lock.run(PRIORITY.GATHER, async () => log.push('gather'));
  await Promise.all([p0, pAuto, pGather]);
  assert.deepEqual(log, ['gather', 'auto']);
});

test('tryRun: 바쁘면 null, 비어 있으면 실행', async () => {
  const lock = createLock();
  const p = lock.run(PRIORITY.GATHER, () => sleep(10));
  assert.equal(lock.isBusy(), true);
  assert.equal(lock.busyPriority(), PRIORITY.GATHER);
  assert.equal(lock.tryRun(PRIORITY.POLL, async () => 1), null);
  await p;
  assert.equal(lock.isBusy(), false);
  assert.equal(await lock.tryRun(PRIORITY.POLL, async () => 1), 1);
});

test('run: 작업이 던져도 다음 작업은 계속', async () => {
  const lock = createLock();
  await assert.rejects(lock.run(PRIORITY.MANUAL, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await lock.run(PRIORITY.MANUAL, async () => 'ok'), 'ok');
});
