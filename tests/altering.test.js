'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFacility, groupWorks, isCompleted, createAlteringPoller, FACILITIES } = require('../main/altering');
const { createCli } = require('../main/cli');
const { createLock, PRIORITY } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

const SAMPLE = [
  { DisplayName: '상급 가죽', FacilityName: '가죽 가공 시설', State: 'InProgress', IsCompleted: false, RemainingSeconds: 1214 },
  { DisplayName: '상급 가죽', FacilityName: '가죽 가공 시설', State: 'Completed', IsCompleted: true, RemainingSeconds: 0 },
  { DisplayName: '말린 찻잎', FacilityName: '식재료 가공 시설', State: 'NotStarted', IsCompleted: false, RemainingSeconds: 3000 },
  { DisplayName: '버섯 포자', FacilityName: '약품 가공 시설', State: 'InProgress', IsCompleted: false, RemainingSeconds: 10 },
];

test('FACILITIES는 6개, 키 순서 고정', () => {
  assert.deepEqual(FACILITIES.map((f) => f.key), ['metal', 'wood', 'leather', 'cloth', 'medicine', 'food']);
});

test('classifyFacility: 키워드로 분류, 모르면 other', () => {
  assert.equal(classifyFacility('가죽 가공 시설'), 'leather');
  assert.equal(classifyFacility('식재료 가공 시설'), 'food');
  assert.equal(classifyFacility('연금 공방'), 'medicine');
  assert.equal(classifyFacility('알 수 없음'), 'other');
  assert.equal(classifyFacility(undefined), 'other');
});

test('isCompleted: IsCompleted 또는 State Completed', () => {
  assert.equal(isCompleted({ IsCompleted: true }), true);
  assert.equal(isCompleted({ State: 'Completed' }), true);
  assert.equal(isCompleted({ State: 'InProgress', IsCompleted: false }), false);
});

test('groupWorks: 시설별로 묶고 완료 목록을 따로 둔다', () => {
  const g = groupWorks(SAMPLE);
  assert.equal(g.leather.works.length, 2);
  assert.equal(g.leather.completed.length, 1);
  assert.equal(g.leather.facilityName, '가죽 가공 시설');
  assert.equal(g.food.works.length, 1);
  assert.equal(g.medicine.works.length, 1);
  assert.equal(g.metal.works.length, 0);
  assert.equal(g.other.works.length, 0);
});

test('poller.refreshNow: 정상 응답이면 onUpdate', async () => {
  const { spawn } = createFakeSpawn([{ stdout: JSON.stringify({ completedCount: 1, works: SAMPLE }) }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const updates = [];
  const poller = createAlteringPoller({ cli, lock: createLock(), onUpdate: (u) => updates.push(u), onError: () => assert.fail('no error') });
  await poller.refreshNow();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].completedCount, 1);
  assert.equal(updates[0].groups.leather.completed.length, 1);
});

test('poller: 잠금이 바쁘면 이번 주기를 건너뛴다', async () => {
  const { spawn, calls } = createFakeSpawn([{ stdout: '{"completedCount":0,"works":[]}' }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const lock = createLock();
  const hold = lock.run(PRIORITY.GATHER, () => new Promise((r) => setTimeout(r, 15)));
  const poller = createAlteringPoller({ cli, lock, onUpdate: () => {}, onError: () => {} });
  await poller.refreshNow();
  assert.equal(calls.length, 0);
  await hold;
  await poller.refreshNow();
  assert.equal(calls.length, 1);
});

test('poller: 연결 끊김이면 onError', async () => {
  const { spawn } = createFakeSpawn([{ stdout: '{"pipe":"disconnected","reason":"game_off"}', exitCode: 5 }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const errors = [];
  const poller = createAlteringPoller({ cli, lock: createLock(), onUpdate: () => assert.fail('no update'), onError: (r) => errors.push(r) });
  await poller.refreshNow();
  assert.equal(errors[0].kind, 'disconnected');
  assert.equal(errors[0].reason, 'game_off');
});

test('poller.start/stop: 주입한 setInterval을 쓴다', async () => {
  const { spawn } = createFakeSpawn([{ stdout: '{"completedCount":0,"works":[]}' }]);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  let registered = null; let cleared = null;
  const poller = createAlteringPoller({
    cli, lock: createLock(), intervalMs: 3000, onUpdate: () => {}, onError: () => {},
    setInterval: (fn, ms) => { registered = { fn, ms }; return 42; },
    clearInterval: (id) => { cleared = id; },
  });
  poller.start();
  assert.equal(registered.ms, 3000);
  poller.stop();
  assert.equal(cleared, 42);
});
