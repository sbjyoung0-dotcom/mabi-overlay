'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompletionNotifier } = require('../main/completion-notify');

const work = (name, fac, done) => ({ DisplayName: name, FacilityName: fac, State: done ? 'Completed' : 'InProgress', IsCompleted: done });
const update = (works) => ({ completedCount: works.filter((w) => w.IsCompleted).length, works });

function setup(config = {}) {
  const shown = [];
  const n = createCompletionNotifier({
    notify: (t, b) => shown.push([t, b]),
    getConfig: () => ({ notifyOnComplete: true, alterFavorites: [], ...config }),
  });
  return { n, shown };
}

test('새로 완료된 시설이 생기면 알린다', () => {
  const { n, shown } = setup();
  n.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  assert.equal(shown.length, 1);
  assert.match(shown[0][0], /가공 완료/);
  assert.match(shown[0][1], /가죽 가공 시설/);
  assert.match(shown[0][1], /상급 가죽/);
});

test('같은 상태가 이어지면 다시 알리지 않는다', () => {
  const { n, shown } = setup();
  const u = update([work('상급 가죽', '가죽 가공 시설', true)]);
  n.handleWorksUpdate(u);
  n.handleWorksUpdate(u);
  assert.equal(shown.length, 1);
});

test('수령해서 완료가 사라졌다가 다시 완료되면 또 알린다', () => {
  const { n, shown } = setup();
  n.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  n.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', false)]));
  n.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  assert.equal(shown.length, 2);
});

test('시설이 여러 곳이면 각각 알린다', () => {
  const { n, shown } = setup();
  n.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true), work('말린 찻잎', '식재료 가공 시설', true)]));
  assert.equal(shown.length, 2);
});

test('자동 재가공이 켜진 아이템은 알리지 않는다 (알아서 수령하므로)', () => {
  const { n, shown } = setup({ alterFavorites: [{ displayName: '상급 가죽', autoRequeue: true }] });
  n.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  assert.equal(shown.length, 0);
});

test('같은 시설에 자동 아이템과 수동 아이템이 섞이면 수동 것만 알린다', () => {
  const { n, shown } = setup({ alterFavorites: [{ displayName: '상급 가죽', autoRequeue: true }] });
  n.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true), work('일반 가죽', '가죽 가공 시설', true)]));
  assert.equal(shown.length, 1);
  assert.match(shown[0][1], /일반 가죽/);
});

test('설정이 꺼져 있으면 알리지 않지만 상태는 따라간다', () => {
  const { n, shown } = setup({ notifyOnComplete: false });
  n.handleWorksUpdate(update([work('상급 가죽', '가죽 가공 시설', true)]));
  assert.equal(shown.length, 0);
});

test('첫 폴링에서 이미 완료돼 있던 것도 알린다 (프로그램을 늦게 켠 경우)', () => {
  const { n, shown } = setup();
  n.handleWorksUpdate(update([work('말린 찻잎', '식재료 가공 시설', true)]));
  assert.equal(shown.length, 1);
});
