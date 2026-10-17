'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clampToBounds } = require('../shared/geometry');

test('안에 있으면 그대로', () => {
  assert.deepEqual(clampToBounds({ x: 100, y: 100, w: 260, h: 80 }, { width: 1920, height: 1080 }),
    { x: 100, y: 100, changed: false });
});

test('오른쪽·아래로 넘치면 안으로 당긴다', () => {
  assert.deepEqual(clampToBounds({ x: 5000, y: 2000, w: 260, h: 80 }, { width: 1920, height: 1080 }),
    { x: 1660, y: 1000, changed: true });
});

test('음수 좌표는 0으로', () => {
  assert.deepEqual(clampToBounds({ x: -50, y: -10, w: 260, h: 80 }, { width: 1920, height: 1080 }),
    { x: 0, y: 0, changed: true });
});

test('위젯이 창보다 크면 0으로 둔다 (음수 위치를 만들지 않는다)', () => {
  assert.deepEqual(clampToBounds({ x: 10, y: 10, w: 3000, h: 2000 }, { width: 1920, height: 1080 }),
    { x: 0, y: 0, changed: true });
});

test('크기를 모르면 창 안으로만 제한한다', () => {
  assert.deepEqual(clampToBounds({ x: 5000, y: 10, w: 0, h: 0 }, { width: 1920, height: 1080 }),
    { x: 1920, y: 10, changed: true });
});

test('소수점 크기에서도 정수 좌표를 돌려준다 (저장↔재적용 왕복 루프 방지)', () => {
  // 위젯 폭이 259.4면 maxX = 1660.6 → offsetLeft는 1661로 반올림되어 다시 클램프되는 왕복이 생긴다
  const r = clampToBounds({ x: 5000, y: 10, w: 259.4, h: 80 }, { width: 1920, height: 1080 });
  assert.equal(Number.isInteger(r.x), true);
  assert.equal(r.x, 1660);
  // 클램프된 값을 그대로 다시 넣으면 더 이상 바뀌지 않아야 한다
  const again = clampToBounds({ x: r.x, y: r.y, w: 259.4, h: 80 }, { width: 1920, height: 1080 });
  assert.deepEqual(again, { x: 1660, y: 10, changed: false });
});
