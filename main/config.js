'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  gatherFavorites: [],   // [{ displayName, repeat }]
  alterFavorites: [],    // [{ displayName, count, autoRequeue, collectThreshold }]
  craftFavorites: [],    // [{ displayName, craftCount }]
  visibleFacilities: { metal: true, wood: true, leather: true, cloth: true, medicine: true, food: true },
  // 위젯 표시 여부. 가공 현황은 툴바를 품고 있어 항상 보인다.
  visibleWidgets: { gather: true, alter: true, craft: true },
  layout: '2row',        // '1row' | '2row'
  positions: { altering: { x: 100, y: 100 }, gather: { x: 100, y: 320 }, alter: { x: 100, y: 460 }, craft: { x: 100, y: 600 } },
  locked: true,
  notifyOnComplete: true,  // 가공 완료 시 Windows 알림
  displayId: null,         // 오버레이를 띄울 모니터 (null = 주 모니터)
  displayBounds: null,     // 그 모니터의 좌표 — 재연결로 id가 바뀌어도 같은 모니터를 찾기 위해
  autoSpentWings: { date: null, amount: 0 },
});

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function createConfig({ filePath, fsImpl = fs }) {
  let data = clone(DEFAULTS);
  try {
    data = { ...clone(DEFAULTS), ...JSON.parse(fsImpl.readFileSync(filePath, 'utf8')) };
  } catch { /* 파일 없음 또는 깨짐 → 기본값 */ }

  function save() {
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    fsImpl.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  return {
    filePath,
    get: () => clone(data),
    set(patch) { data = { ...data, ...clone(patch) }; save(); return clone(data); },
  };
}

module.exports = { DEFAULTS, createConfig };
