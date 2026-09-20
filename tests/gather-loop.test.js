'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretGatherResult, createGatherLoop } = require('../main/gather-loop');
const { createCli } = require('../main/cli');
const { createLock } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

const accepted = (body) => ({ stdout: JSON.stringify({ status: 'accepted', body }) });
const rejected = (body) => ({ stdout: JSON.stringify({ status: 'rejected', body }) });

test('interpret: completed → continue, gained 누적', () => {
  const it = interpretGatherResult({ ok: true, body: { result: 'completed', gained: 100, target: 100, cost: '5 spent' } });
  assert.equal(it.action, 'continue'); assert.equal(it.gained, 100); assert.equal(it.cost, '5 spent');
});

test('interpret: timeout은 계속, blocked/overweight/stopped는 정지', () => {
  assert.equal(interpretGatherResult({ ok: true, body: { error: 'timeout', gained: 30 } }).action, 'continue');
  const b = interpretGatherResult({ ok: true, body: { error: 'blocked', kind: 'Popup', gained: 0 } });
  assert.equal(b.action, 'stop'); assert.match(b.message, /Popup/);
  assert.equal(interpretGatherResult({ ok: true, body: { error: 'overweight', gained: 40 } }).message, '무게 초과');
  assert.equal(interpretGatherResult({ ok: true, body: { result: 'stopped', gained: 12 } }).reason, 'stopped');
});

test('interpret: rejected/disconnected는 정지', () => {
  assert.equal(interpretGatherResult({ ok: false, kind: 'rejected', error: 'not_enough_currency' }).message, '정령의 날개 부족');
  assert.equal(interpretGatherResult({ ok: false, kind: 'disconnected', reason: 'game_off' }).reason, 'disconnected');
});

test('loop: N회 모두 completed면 N번 호출하고 합산', async () => {
  const { spawn, calls } = createFakeSpawn([accepted({ result: 'completed', gained: 100, target: 100 })]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const events = [];
  const loop = createGatherLoop({ cli, lock: createLock(), onProgress: (p) => events.push(p) });
  const s = await loop.start({ displayName: '통나무', repeat: 3 });
  assert.equal(calls.filter((c) => c.command === 'execute_gathering').length, 3);
  assert.equal(s.reason, 'completed'); assert.equal(s.gainedTotal, 300); assert.equal(s.i, 3);
  assert.equal(events.at(-1).running, false);
  assert.equal(loop.isRunning(), false);
});

test('loop: 2회차 overweight면 거기서 멈춘다', async () => {
  const { spawn, calls } = createFakeSpawn([
    accepted({ result: 'completed', gained: 100, target: 100 }),
    accepted({ error: 'overweight', gained: 40, target: 100 }),
  ]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const s = await createGatherLoop({ cli, lock: createLock(), onProgress: () => {} }).start({ displayName: '통나무', repeat: 5 });
  assert.equal(calls.length, 2); assert.equal(s.reason, 'overweight'); assert.equal(s.gainedTotal, 140); assert.equal(s.i, 2);
});

test('loop: 첫 호출이 rejected면 0회', async () => {
  const { spawn, calls } = createFakeSpawn([rejected({ error: 'tool_missing', message: 'no tool' })]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const s = await createGatherLoop({ cli, lock: createLock(), onProgress: () => {} }).start({ displayName: '통나무', repeat: 5 });
  assert.equal(calls.length, 1); assert.equal(s.reason, 'tool_missing'); assert.equal(s.message, '도구 없음');
});

test('loop.stop: stop_action을 즉시 호출하고 다음 회차를 시작하지 않는다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { spawn, calls } = createFakeSpawn((command) => (command === 'execute_gathering'
    ? { ...accepted({ result: 'completed', gained: 100, target: 100 }), wait: gate }
    : accepted({ result: 'stopped' })));
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const loop = createGatherLoop({ cli, lock: createLock(), onProgress: () => {} });
  const done = loop.start({ displayName: '통나무', repeat: 5 });
  await new Promise((r) => setImmediate(r));
  assert.equal(loop.isRunning(), true);
  await loop.stop();
  release();
  const s = await done;
  assert.equal(s.reason, 'user_stop');
  assert.deepEqual(calls.map((c) => c.command), ['execute_gathering', 'stop_action']);
});

test('loop.stop: stop_action 거부되면 false 반환, 진행 이벤트에 실패 메시지', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { spawn, calls } = createFakeSpawn((command) => (command === 'execute_gathering'
    ? { ...accepted({ result: 'completed', gained: 100, target: 100 }), wait: gate }
    : rejected({ error: 'no_action', message: 'nothing to stop' })));
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const events = [];
  const loop = createGatherLoop({ cli, lock: createLock(), onProgress: (p) => events.push(p) });
  const done = loop.start({ displayName: '통나무', repeat: 5 });
  await new Promise((r) => setImmediate(r));
  assert.equal(loop.isRunning(), true);
  const stopped = await loop.stop();
  assert.equal(stopped, false);
  const stoppingEvent = events.find((e) => e.status === 'stopping' && e.lastMessage);
  assert(stoppingEvent);
  assert.match(stoppingEvent.lastMessage, /중지 요청 실패/);
  release();
  const s = await done;
  assert.equal(s.reason, 'user_stop');
  assert.deepEqual(calls.map((c) => c.command), ['execute_gathering', 'stop_action']);
});

test('loop: 실행 중 start는 거부', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { spawn } = createFakeSpawn([{ ...accepted({ result: 'completed', gained: 1 }), wait: gate }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const loop = createGatherLoop({ cli, lock: createLock(), onProgress: () => {} });
  const p = loop.start({ displayName: 'a', repeat: 1 });
  await assert.rejects(loop.start({ displayName: 'b', repeat: 1 }), /already running/);
  release(); await p;
});
