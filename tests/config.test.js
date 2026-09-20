'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createConfig, DEFAULTS } = require('../main/config');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mabi-cfg-'));
  return path.join(dir, 'sub', 'config.json');
}

test('파일이 없으면 기본값', () => {
  const cfg = createConfig({ filePath: tmpFile() });
  assert.deepEqual(cfg.get(), DEFAULTS);
});

test('set은 얕은 병합 후 저장하고, 다시 열면 유지된다', () => {
  const file = tmpFile();
  const cfg = createConfig({ filePath: file });
  cfg.set({ locked: false, gatherFavorites: [{ displayName: '통나무', repeat: 10 }] });
  const again = createConfig({ filePath: file });
  assert.equal(again.get().locked, false);
  assert.deepEqual(again.get().gatherFavorites, [{ displayName: '통나무', repeat: 10 }]);
  assert.equal(again.get().layout, '2row');
});

test('get은 복사본을 준다', () => {
  const cfg = createConfig({ filePath: tmpFile() });
  cfg.get().gatherFavorites.push({ displayName: 'x', repeat: 1 });
  assert.equal(cfg.get().gatherFavorites.length, 0);
});

test('깨진 파일은 기본값으로 대체', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{oops', 'utf8');
  assert.deepEqual(createConfig({ filePath: file }).get(), DEFAULTS);
});
