'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  gatherFavorites: [],   // [{ displayName, repeat }]
  alterFavorites: [],    // [{ displayName, count, autoRequeue }]
  visibleFacilities: { metal: true, wood: true, leather: true, cloth: true, medicine: true, food: true },
  layout: '2row',        // '1row' | '2row'
  positions: { altering: { x: 100, y: 100 }, gather: { x: 100, y: 320 }, alter: { x: 100, y: 460 } },
  locked: true,
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
