'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitByLocation, buildSnapshot, searchItems } = require('../main/item-search');

const item = (DisplayName, Count, Location, CategoryDisplayName = '재료') => ({
  DisplayName, Count, Location, CategoryDisplayName, Category: 'Ingredient', IsLocked: false,
});

const LIVE = [
  item('새록 버섯', 12, 'inventory'),
  item('새록 버섯', 400, 'account_storage'),
  item('튼튼 버섯', 88, 'account_storage'),
  item('통나무', 5, 'character_storage'),
];

test('splitByLocation: 위치별로 이름→개수 맵을 만든다', () => {
  const s = splitByLocation(LIVE);
  assert.deepEqual(s.inventory, { '새록 버섯': 12 });
  assert.deepEqual(s.characterStorage, { 통나무: 5 });
  assert.deepEqual(s.accountStorage, { '새록 버섯': 400, '튼튼 버섯': 88 });
});

test('splitByLocation: 같은 위치의 같은 이름은 합산, 빈 입력은 빈 맵', () => {
  const s = splitByLocation([item('돌멩이', 3, 'inventory'), item('돌멩이', 4, 'inventory')]);
  assert.deepEqual(s.inventory, { 돌멩이: 7 });
  const empty = splitByLocation(null);
  assert.deepEqual(empty, { inventory: {}, characterStorage: {}, accountStorage: {} });
});

test('buildSnapshot: 계정창고는 공용이라 스냅샷에 넣지 않는다', () => {
  const snap = buildSnapshot({ items: LIVE, job: '사제', savedAt: 1000 });
  assert.equal(snap.job, '사제');
  assert.equal(snap.label, '사제');
  assert.equal(snap.savedAt, 1000);
  assert.deepEqual(snap.inventory, { '새록 버섯': 12 });
  assert.deepEqual(snap.characterStorage, { 통나무: 5 });
  assert.equal(snap.accountStorage, undefined);
});

test('buildSnapshot: 라벨을 주면 그대로 쓴다', () => {
  assert.equal(buildSnapshot({ items: [], job: '사제', label: '사제(본캐)', savedAt: 1 }).label, '사제(본캐)');
});

const SNAPSHOTS = [
  { job: '전사', label: '전사', savedAt: 500, inventory: { '새록 버섯': 35 }, characterStorage: { '새록 버섯': 10 } },
  { job: '궁수', label: '궁수(창고캐)', savedAt: 700, inventory: {}, characterStorage: { 통나무: 20 } },
];

test('searchItems: 총계 = 계정창고 + 현재 캐릭터 + 다른 직업 스냅샷', () => {
  const r = searchItems({ query: '버섯', liveItems: LIVE, liveJob: '사제', snapshots: SNAPSHOTS });
  const mushroom = r.find((x) => x.displayName === '새록 버섯');
  assert.equal(mushroom.total, 400 + 12 + 35 + 10);
  assert.equal(mushroom.account, 400);
  assert.deepEqual(mushroom.sources, [
    { job: '전사', label: '전사', savedAt: 500, isLive: false, inventory: 35, storage: 10, subtotal: 45 },
    { job: '사제', label: '사제', savedAt: null, isLive: true, inventory: 12, storage: 0, subtotal: 12 },
  ]);
});

test('searchItems: 부분일치·대소문자 무시, 총계 내림차순 정렬', () => {
  const r = searchItems({ query: '버', liveItems: LIVE, liveJob: '사제', snapshots: SNAPSHOTS });
  assert.deepEqual(r.map((x) => x.displayName), ['새록 버섯', '튼튼 버섯']);
  const en = searchItems({ query: 'ab', liveItems: [item('AB Potion', 1, 'inventory')], liveJob: '사제', snapshots: [] });
  assert.equal(en.length, 1);
});

test('searchItems: 계정창고에만 있으면 sources는 비고 account만 잡힌다', () => {
  const r = searchItems({ query: '튼튼', liveItems: LIVE, liveJob: '사제', snapshots: SNAPSHOTS });
  assert.equal(r[0].total, 88);
  assert.equal(r[0].account, 88);
  assert.deepEqual(r[0].sources, []);
});

test('searchItems: 현재 직업의 옛 스냅샷은 무시하고 실시간 값만 쓴다', () => {
  const stale = [{ job: '사제', label: '사제', savedAt: 1, inventory: { '새록 버섯': 9999 }, characterStorage: {} }];
  const r = searchItems({ query: '새록', liveItems: LIVE, liveJob: '사제', snapshots: stale });
  assert.equal(r[0].total, 400 + 12);
  assert.equal(r[0].sources.length, 1);
  assert.equal(r[0].sources[0].isLive, true);
});

test('searchItems: 빈 검색어는 빈 결과, 공백만 있어도 동일', () => {
  assert.deepEqual(searchItems({ query: '', liveItems: LIVE, liveJob: '사제', snapshots: SNAPSHOTS }), []);
  assert.deepEqual(searchItems({ query: '   ', liveItems: LIVE, liveJob: '사제', snapshots: SNAPSHOTS }), []);
});

test('searchItems: 게임 연결이 없어 실시간 값이 없어도 스냅샷만으로 검색된다', () => {
  const r = searchItems({ query: '통나무', liveItems: null, liveJob: null, snapshots: SNAPSHOTS });
  assert.equal(r[0].total, 20);
  assert.equal(r[0].account, 0);
  assert.deepEqual(r[0].sources.map((s) => s.label), ['궁수(창고캐)']);
});

test('searchItems: 일치 항목이 없으면 빈 배열', () => {
  assert.deepEqual(searchItems({ query: '없는아이템', liveItems: LIVE, liveJob: '사제', snapshots: SNAPSHOTS }), []);
});
