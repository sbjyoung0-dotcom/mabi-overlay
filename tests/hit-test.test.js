'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isOverAny, toWindowPoint } = require('../main/hit-test');

test('isOverAny: 사각형 안쪽 좌표는 true', () => {
  assert.equal(isOverAny({ x: 15, y: 15 }, [{ x: 10, y: 10, w: 20, h: 20 }]), true);
});

test('isOverAny: x+w, y+h는 배타적 경계 (바깥)', () => {
  assert.equal(isOverAny({ x: 30, y: 15 }, [{ x: 10, y: 10, w: 20, h: 20 }]), false);
  assert.equal(isOverAny({ x: 15, y: 30 }, [{ x: 10, y: 10, w: 20, h: 20 }]), false);
});

test('isOverAny: x, y 시작 경계는 포함 (안쪽)', () => {
  assert.equal(isOverAny({ x: 10, y: 10 }, [{ x: 10, y: 10, w: 20, h: 20 }]), true);
});

test('isOverAny: 사각형 밖 좌표는 false', () => {
  assert.equal(isOverAny({ x: 5, y: 5 }, [{ x: 10, y: 10, w: 20, h: 20 }]), false);
});

test('isOverAny: 빈 rects는 항상 false', () => {
  assert.equal(isOverAny({ x: 15, y: 15 }, []), false);
  assert.equal(isOverAny({ x: 15, y: 15 }, undefined), false);
});

test('isOverAny: 여러 사각형 중 하나라도 맞으면 true', () => {
  const rects = [{ x: 0, y: 0, w: 5, h: 5 }, { x: 10, y: 10, w: 20, h: 20 }];
  assert.equal(isOverAny({ x: 15, y: 15 }, rects), true);
});

test('toWindowPoint: 창 bounds가 (0,0)이 아닐 때 상대 좌표로 변환', () => {
  assert.deepEqual(toWindowPoint({ x: 150, y: 220 }, { x: 100, y: 200, width: 800, height: 600 }), { x: 50, y: 20 });
});

test('toWindowPoint: bounds가 (0,0)이면 좌표 동일', () => {
  assert.deepEqual(toWindowPoint({ x: 50, y: 20 }, { x: 0, y: 0, width: 800, height: 600 }), { x: 50, y: 20 });
});
