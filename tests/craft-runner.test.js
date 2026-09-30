'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretCraftResult, createCraftRunner } = require('../main/craft-runner');
const { createCli } = require('../main/cli');
const { createLock, PRIORITY } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

const accepted = (body) => ({ stdout: JSON.stringify({ status: 'accepted', body }) });
const rejected = (body) => ({ stdout: JSON.stringify({ status: 'rejected', body }) });

test('interpret: completed는 성공, 보상·비용을 전달한다', () => {
  const it = interpretCraftResult({ ok: true, body: { result: 'completed', craftCount: 3, cost: '5 사용', rewards: ['가죽'] } });
  assert.equal(it.ok, true);
  assert.equal(it.reason, 'completed');
  assert.equal(it.craftCount, 3);
  assert.equal(it.cost, '5 사용');
});

test('interpret: 게임에서 직접 중단하면 실패가 아니라 중단으로 본다', () => {
  const it = interpretCraftResult({ ok: true, body: { result: 'stopped_by_user' } });
  assert.equal(it.ok, false);
  assert.equal(it.reason, 'stopped_by_user');
  assert.match(it.message, /게임에서 중단/);
});

test('interpret: 거부 사유를 한글로 바꾼다', () => {
  assert.equal(interpretCraftResult({ ok: false, kind: 'rejected', error: 'not_enough_ingredient' }).message, '재료 부족');
  assert.equal(interpretCraftResult({ ok: false, kind: 'rejected', error: 'crafting_locked' }).message, '제작 기능이 아직 열리지 않았습니다');
  assert.equal(interpretCraftResult({ ok: false, kind: 'disconnected', reason: 'game_off' }).reason, 'disconnected');
});

test('interpret: invalid_count는 최대 횟수를 함께 알려준다', () => {
  const it = interpretCraftResult({ ok: true, body: { error: 'invalid_count', maxCount: 5 } });
  assert.equal(it.ok, false);
  assert.equal(it.maxCount, 5);
  assert.match(it.message, /최대 5회/);
});

test('interpret: blocked는 어떤 화면인지 알려준다', () => {
  const it = interpretCraftResult({ ok: true, body: { error: 'blocked', kind: 'Popup' } });
  assert.equal(it.ok, false);
  assert.match(it.message, /Popup/);
});

function setup(responses) {
  const { spawn, calls } = createFakeSpawn(responses);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const events = [];
  const runner = createCraftRunner({ cli, lock: createLock(), onProgress: (p) => events.push(p) });
  return { runner, calls, events };
}

test('run: 한 번의 호출로 craftCount만큼 제작한다 (날개는 5개)', async () => {
  const { runner, calls, events } = setup([accepted({ result: 'completed', craftCount: 3, cost: '5 사용' })]);
  const r = await runner.run({ displayName: '실', craftCount: 3 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'execute_crafting');
  assert.equal(Buffer.from(calls[0].bodyArg.slice(7), 'base64').toString('utf8'), '{"displayName":"실","craftCount":3}');
  assert.equal(r.ok, true);
  assert.equal(events[0].running, true);
  assert.equal(events.at(-1).running, false);
  assert.equal(runner.isRunning(), false);
});

test('run: 실패해도 진행 이벤트가 종료 상태로 끝난다', async () => {
  const { runner, events } = setup([rejected({ error: 'not_enough_ingredient' })]);
  const r = await runner.run({ displayName: '실', craftCount: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.message, '재료 부족');
  assert.equal(events.at(-1).running, false);
  assert.equal(events.at(-1).message, '재료 부족');
});

test('run: 실행 중 다시 호출하면 거부한다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { runner } = setup([{ ...accepted({ result: 'completed', craftCount: 1 }), wait: gate }]);
  const p = runner.run({ displayName: '실', craftCount: 1 });
  await new Promise((r) => setImmediate(r));
  assert.equal(runner.isRunning(), true);
  await assert.rejects(runner.run({ displayName: '실', craftCount: 1 }), /already running/);
  release();
  await p;
});

test('run: 채집 루프가 잠금을 잡고 있으면 끝날 때까지 기다린다', async () => {
  const { spawn, calls } = createFakeSpawn([accepted({ result: 'completed', craftCount: 1 })]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const lock = createLock();
  let release;
  const hold = lock.run(PRIORITY.GATHER, () => new Promise((r) => { release = r; }));
  const runner = createCraftRunner({ cli, lock, onProgress: () => {} });
  const p = runner.run({ displayName: '실', craftCount: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 0);
  release(); await hold; await p;
  assert.equal(calls.length, 1);
});
