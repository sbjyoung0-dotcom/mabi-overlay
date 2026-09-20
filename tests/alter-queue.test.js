'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretAlterResult, addAutoSpent, createAlterQueue, WINGS_PER_CALL } = require('../main/alter-queue');
const { createCli } = require('../main/cli');
const { createLock, PRIORITY } = require('../main/cli-lock');
const { groupWorks } = require('../main/altering');
const { createFakeSpawn } = require('./helpers/fake-spawn');
const { createMemoryConfig } = require('./helpers/memory-config');

const accepted = (body) => ({ stdout: JSON.stringify({ status: 'accepted', body }) });
const rejected = (body) => ({ stdout: JSON.stringify({ status: 'rejected', body }) });
const started = accepted({ result: 'started', cost: '5 spent' });
const work = (name, fac, done) => ({ DisplayName: name, FacilityName: fac, State: done ? 'Completed' : 'InProgress', IsCompleted: done, RemainingSeconds: done ? 0 : 100 });
const update = (works) => ({ completedCount: works.filter((w) => w.IsCompleted).length, works, groups: groupWorks(works), fetchedAt: 0 });

function setup(responses, cfg, opts = {}) {
  const { spawn, calls } = createFakeSpawn(responses);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const lock = opts.lock || createLock();
  const config = createMemoryConfig(cfg);
  const events = [];
  const q = createAlterQueue({ cli, lock, config, onAutoEvent: (e) => events.push(e), ...opts });
  return { q, calls, config, events, lock };
}

test('interpretAlterResult: started/rejected/body.error', () => {
  assert.deepEqual(interpretAlterResult({ ok: true, body: { result: 'started', cost: 'c' } }), { ok: true, result: 'started', cost: 'c', collected: undefined });
  assert.equal(interpretAlterResult({ ok: false, kind: 'rejected', error: 'not_enough_ingredient' }).message, '재료 부족');
  assert.equal(interpretAlterResult({ ok: true, body: { error: 'blocked', kind: 'Dialog' } }).reason, 'blocked');
});

test('addAutoSpent: 같은 날은 누적, 날짜 바뀌면 리셋', () => {
  const config = createMemoryConfig();
  const day1 = new Date(2026, 8, 21, 10).getTime();
  const day2 = new Date(2026, 8, 22, 1).getTime();
  assert.deepEqual(addAutoSpent(config, 5, day1), { date: '2026-09-21', amount: 5 });
  assert.deepEqual(addAutoSpent(config, 5, day1), { date: '2026-09-21', amount: 10 });
  assert.deepEqual(addAutoSpent(config, 5, day2), { date: '2026-09-22', amount: 5 });
});

test('enqueue: N건 모두 started', async () => {
  const { q, calls } = setup([started]);
  const s = await q.enqueue({ displayName: '상급 가죽', count: 3 });
  assert.equal(calls.length, 3);
  assert.equal(s.registered, 3); assert.equal(s.stoppedReason, null); assert.equal(s.lastCost, '5 spent');
});

test('enqueue: 2건째 거부되면 멈춘다', async () => {
  const { q, calls } = setup([started, rejected({ error: 'not_enough_ingredient' })]);
  const s = await q.enqueue({ displayName: '상급 가죽', count: 5 });
  assert.equal(calls.length, 2);
  assert.equal(s.registered, 1); assert.equal(s.stoppedReason, 'not_enough_ingredient'); assert.equal(s.stoppedMessage, '재료 부족');
});

test('auto: 켜진 즐겨찾기의 완료 건을 수령하고 같은 수만큼 재등록', async () => {
  const { q, calls, config, events } = setup(
    (command) => (command === 'complete_altering_work' ? accepted({ collected: 2 }) : started),
    { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: true }] },
    { now: () => new Date(2026, 8, 21).getTime() },
  );
  await q.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true), work('상급 가죽', '가죽 가공 시설', true), work('상급 가죽', '가죽 가공 시설', false)]));
  assert.deepEqual(calls.map((c) => c.command), ['complete_altering_work', 'execute_altering', 'execute_altering']);
  assert.equal(config.get().autoSpentWings.amount, 2 * WINGS_PER_CALL);
  assert.deepEqual(events.map((e) => e.type), ['collecting', 'requeued', 'requeued']);
});

test('auto: 꺼진 즐겨찾기나 일시정지 상태면 아무것도 안 한다', async () => {
  const { q, calls } = setup([started], { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: false }] });
  await q.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  assert.equal(calls.length, 0);
  const on = setup([started], { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: true }] });
  on.q.pauseAuto(true);
  await on.q.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  assert.equal(on.calls.length, 0);
});

test('auto: 실패하면 60초 대기, 3회 연속이면 토글 해제', async () => {
  let t = 1_000_000;
  const { q, calls, config, events } = setup(
    (command) => (command === 'complete_altering_work' ? accepted({ collected: 1 }) : rejected({ error: 'not_enough_ingredient' })),
    { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: true }] },
    { now: () => t, retryMs: 60_000, maxFailures: 3 },
  );
  const u = update([work('상급 가죽', '가죽 가공 시설', true)]);
  await q.handleWorksUpdate(u);
  assert.equal(events.at(-1).type, 'paused');
  await q.handleWorksUpdate(u);            // 60초 안 지남 → 건너뜀
  assert.equal(calls.length, 2);
  t += 61_000; await q.handleWorksUpdate(u);
  t += 61_000; await q.handleWorksUpdate(u);
  assert.equal(events.at(-1).type, 'disabled');
  assert.equal(config.get().alterFavorites[0].autoRequeue, false);
});

test('auto: 채집 루프(GATHER)가 잠금을 잡고 있으면 끝날 때까지 기다린다', async () => {
  const lock = createLock();
  let release;
  const hold = lock.run(PRIORITY.GATHER, () => new Promise((r) => { release = r; }));
  const { q, calls } = setup(
    (command) => (command === 'complete_altering_work' ? accepted({ collected: 1 }) : started),
    { alterFavorites: [{ displayName: '상급 가죽', count: 6, autoRequeue: true }] },
    { lock },
  );
  const p = q.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 0);
  release(); await hold; await p;
  assert.equal(calls.length, 2);
});
