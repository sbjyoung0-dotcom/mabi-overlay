'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { unionBounds } = require('../main/display-union');

test('모니터 하나면 그 영역 그대로', () => {
  assert.deepEqual(unionBounds([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    { x: 0, y: 0, width: 1920, height: 1080 });
});

test('좌우로 늘어선 3개 모니터를 모두 덮는다', () => {
  const displays = [
    { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
  ];
  assert.deepEqual(unionBounds(displays), { x: -1920, y: 0, width: 5760, height: 1080 });
});

test('위아래로 걸치고 해상도가 다른 배치도 덮는다', () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
    { bounds: { x: 300, y: -1080, width: 1920, height: 1080 } },
  ];
  assert.deepEqual(unionBounds(displays), { x: 0, y: -1080, width: 2560, height: 2520 });
});

test('목록이 비면 null (호출자가 기본 동작을 쓰도록)', () => {
  assert.equal(unionBounds([]), null);
  assert.equal(unionBounds(null), null);
});

test('잘못된 항목은 건너뛴다', () => {
  const displays = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, {}, { bounds: null }];
  assert.deepEqual(unionBounds(displays), { x: 0, y: 0, width: 1920, height: 1080 });
});
