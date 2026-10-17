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
