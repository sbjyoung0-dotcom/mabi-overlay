'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickDisplay, displayLabel } = require('../main/display-pick');

const D = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
  { id: 3, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
];

test('저장된 모니터를 쓴다', () => {
  assert.equal(pickDisplay(D, { preferredId: 3, primaryId: 1 }).id, 3);
});

test('저장된 모니터가 없어졌으면 주 모니터로 돌아간다', () => {
  assert.equal(pickDisplay(D, { preferredId: 99, primaryId: 1 }).id, 1);
});

test('id가 바뀌어도 저장된 좌표로 같은 모니터를 찾는다', () => {
  const moved = [
    { id: 11, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 12, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
  ];
  const picked = pickDisplay(moved, { preferredId: 3, preferredBounds: { x: 1920, y: 0, width: 1920, height: 1080 }, primaryId: 11 });
  assert.equal(picked.id, 12);
});

test('저장된 좌표의 모니터도 사라졌으면 주 모니터', () => {
  const picked = pickDisplay(D, { preferredId: 99, preferredBounds: { x: 5000, y: 0, width: 1920, height: 1080 }, primaryId: 1 });
  assert.equal(picked.id, 1);
});

test('설정이 없으면 주 모니터', () => {
  assert.equal(pickDisplay(D, { primaryId: 1 }).id, 1);
});

test('모니터 목록이 비면 null', () => {
  assert.equal(pickDisplay([], { primaryId: 1 }), null);
});

test('displayLabel: 사람이 읽을 이름', () => {
  assert.equal(displayLabel(D[0], 0, 1), '모니터 1 (주) 1920×1080');
  assert.equal(displayLabel(D[2], 2, 1), '모니터 3 1920×1080');
});
