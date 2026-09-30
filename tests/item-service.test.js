'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createItemService } = require('../main/item-service');
const { createItemStore } = require('../main/item-store');
const { createCli } = require('../main/cli');
const { createLock } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mabi-svc-'));
  return createItemStore({ filePath: path.join(dir, 'items-cache.json') });
}

const ITEMS = [
  { DisplayName: '새록 버섯', Count: 12, Location: 'inventory' },
  { DisplayName: '새록 버섯', Count: 400, Location: 'account_storage' },
  { DisplayName: '통나무', Count: 5, Location: 'character_storage' },
];
const okInfo = { stdout: JSON.stringify({ EnabledCombatJobDisplayName: '사제', RealmName: '던컨' }) };
const okItems = { stdout: JSON.stringify(ITEMS) };
const disconnected = { stdout: '{"pipe":"disconnected","reason":"game_off"}', exitCode: 5 };

function setup(responses, store = tmpStore()) {
  const { spawn, calls } = createFakeSpawn(responses);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const service = createItemService({ cli, lock: createLock(), store, now: () => 1000 });
  return { service, calls, store };
}

test('refresh: 현재 직업으로 스냅샷을 자동 저장한다', async () => {
  const { service, calls, store } = setup((command) => (command === 'get_my_info' ? okInfo : okItems));
  const r = await service.refresh();
  assert.equal(r.ok, true);
  assert.equal(r.liveJob, '사제');
  assert.equal(r.refreshedAt, 1000);
  assert.deepEqual(calls.map((c) => c.command), ['get_my_info', 'get_items']);
  assert.deepEqual(store.all(), [
    { job: '사제', label: '사제', savedAt: 1000, inventory: { '새록 버섯': 12 }, characterStorage: { 통나무: 5 } },
  ]);
  assert.deepEqual(r.characters.map((c) => c.label), ['사제']);
});

test('refresh: 계정창고는 스냅샷에 저장하지 않는다', async () => {
  const { service, store } = setup((command) => (command === 'get_my_info' ? okInfo : okItems));
  await service.refresh();
  assert.equal(JSON.stringify(store.all()).includes('400'), false);
});

test('refresh: 연결이 없으면 실패를 알리고 기존 기록은 지키지 않는다(그대로 둔다)', async () => {
  const store = tmpStore();
  store.save({ job: '전사', label: '전사', savedAt: 5, inventory: { 통나무: 7 }, characterStorage: {} });
  const { service } = setup([disconnected], store);
  const r = await service.refresh();
  assert.equal(r.ok, false);
  assert.match(r.message, /게임 연결/);
  assert.equal(r.liveJob, null);
  assert.deepEqual(r.characters.map((c) => c.job), ['전사']);
  assert.equal(store.all().length, 1);
});

test('refresh: 직업을 못 읽으면 스냅샷을 저장하지 않는다', async () => {
  const { service, store } = setup((command) => (command === 'get_my_info' ? { stdout: '{"RealmName":"던컨"}' } : okItems));
  const r = await service.refresh();
  assert.equal(r.ok, true);
  assert.equal(r.liveJob, null);
  assert.deepEqual(store.all(), []);
});

test('search: 새로고침 뒤에는 실시간 + 다른 직업 기록을 합쳐 준다', async () => {
  const store = tmpStore();
  store.save({ job: '전사', label: '전사', savedAt: 500, inventory: { '새록 버섯': 35 }, characterStorage: {} });
  const { service } = setup((command) => (command === 'get_my_info' ? okInfo : okItems), store);
  await service.refresh();
  const r = service.search('버섯');
  assert.equal(r.liveJob, '사제');
  assert.equal(r.results[0].displayName, '새록 버섯');
  assert.equal(r.results[0].total, 400 + 12 + 35);
  assert.deepEqual(r.results[0].sources.map((s) => s.label), ['전사', '사제']);
});

test('search: 새로고침 전(게임 연결 없음)에도 저장된 기록만으로 검색된다', () => {
  const store = tmpStore();
  store.save({ job: '전사', label: '전사', savedAt: 500, inventory: { 통나무: 7 }, characterStorage: {} });
  const { service } = setup([disconnected], store);
  const r = service.search('통나무');
  assert.equal(r.liveJob, null);
  assert.equal(r.results[0].total, 7);
  assert.equal(r.refreshedAt, null);
});

test('rename / forget은 갱신된 캐릭터 목록을 돌려준다', async () => {
  const { service } = setup((command) => (command === 'get_my_info' ? okInfo : okItems));
  await service.refresh();
  assert.deepEqual(service.rename('사제', '사제(본캐)').map((c) => c.label), ['사제(본캐)']);
  assert.deepEqual(service.forget('사제'), []);
});

test('refresh를 다시 하면 라벨은 지키고 개수만 갱신한다', async () => {
  let items = ITEMS;
  const { service, store } = setup((command) => (command === 'get_my_info' ? okInfo : { stdout: JSON.stringify(items) }));
  await service.refresh();
  service.rename('사제', '사제(본캐)');
  items = [{ DisplayName: '새록 버섯', Count: 99, Location: 'inventory' }];
  await service.refresh();
  assert.deepEqual(store.all(), [
    { job: '사제', label: '사제(본캐)', savedAt: 1000, inventory: { '새록 버섯': 99 }, characterStorage: {} },
  ]);
});

test('search: 직업을 못 읽어도 실시간 수치가 결과에 포함된다', async () => {
  const { service } = setup((command) => (command === 'get_my_info' ? { stdout: '{"RealmName":"던컨"}' } : okItems));
  await service.refresh();
  const r = service.search('새록');
  assert.equal(r.results[0].total, 400 + 12);
  assert.equal(r.liveJob, null);
  assert.equal(r.jobUnknown, true);
});

test('search: 이름을 바꾼 현재 캐릭터는 결과에도 바뀐 라벨로 나온다', async () => {
  const { service } = setup((command) => (command === 'get_my_info' ? okInfo : okItems));
  await service.refresh();
  service.rename('사제', '사제(본캐)');
  assert.equal(service.search('새록').results[0].sources[0].label, '사제(본캐)');
});
