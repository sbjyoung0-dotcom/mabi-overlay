'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createItemStore } = require('../main/item-store');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mabi-items-'));
  return path.join(dir, 'sub', 'items-cache.json');
}

const snap = (job, inventory = {}, savedAt = 100) => ({ job, label: job, savedAt, inventory, characterStorage: {} });

test('파일이 없으면 빈 목록', () => {
  assert.deepEqual(createItemStore({ filePath: tmpFile() }).all(), []);
});

test('save는 저장하고, 다시 열면 유지된다', () => {
  const file = tmpFile();
  const store = createItemStore({ filePath: file });
  store.save(snap('사제', { 통나무: 3 }));
  const again = createItemStore({ filePath: file });
  assert.deepEqual(again.all(), [{ job: '사제', label: '사제', savedAt: 100, inventory: { 통나무: 3 }, characterStorage: {} }]);
});

test('같은 직업을 다시 save하면 덮어쓰되 사용자가 바꾼 라벨은 지킨다', () => {
  const store = createItemStore({ filePath: tmpFile() });
  store.save(snap('사제', { 통나무: 3 }));
  store.rename('사제', '사제(본캐)');
  store.save(snap('사제', { 통나무: 9 }, 200));
  assert.deepEqual(store.all(), [{ job: '사제', label: '사제(본캐)', savedAt: 200, inventory: { 통나무: 9 }, characterStorage: {} }]);
});

test('여러 직업이 각각 쌓이고, 직업명 순으로 반환된다', () => {
  const store = createItemStore({ filePath: tmpFile() });
  store.save(snap('전사'));
  store.save(snap('궁수'));
  assert.deepEqual(store.all().map((s) => s.job), ['궁수', '전사']);
});

test('rename은 모르는 직업이면 아무 일도 하지 않는다', () => {
  const store = createItemStore({ filePath: tmpFile() });
  store.save(snap('사제'));
  store.rename('없는직업', 'x');
  assert.deepEqual(store.all().map((s) => s.label), ['사제']);
});

test('forget은 해당 직업만 지운다', () => {
  const store = createItemStore({ filePath: tmpFile() });
  store.save(snap('사제'));
  store.save(snap('전사'));
  assert.deepEqual(store.forget('사제').map((s) => s.job), ['전사']);
});

test('깨진 파일은 빈 목록으로 시작한다', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{깨짐', 'utf8');
  assert.deepEqual(createItemStore({ filePath: file }).all(), []);
});

test('all()은 복사본을 준다', () => {
  const store = createItemStore({ filePath: tmpFile() });
  store.save(snap('사제', { 통나무: 3 }));
  store.all()[0].inventory.통나무 = 999;
  assert.equal(store.all()[0].inventory.통나무, 3);
});
