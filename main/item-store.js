'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 캐릭터별 아이템 스냅샷. config.json과 분리한다 — 수백 KB까지 커질 수 있어
// 설정 저장/읽기가 느려지면 안 되기 때문.
const VERSION = 1;

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function createItemStore({ filePath, fsImpl = fs }) {
  let characters = {}; // job → snapshot
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed.characters === 'object' && parsed.characters) characters = parsed.characters;
  } catch { /* 파일 없음 또는 깨짐 → 빈 목록 */ }

  function save() {
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    fsImpl.writeFileSync(filePath, JSON.stringify({ version: VERSION, characters }, null, 2), 'utf8');
  }

  function all() {
    return Object.values(clone(characters)).sort((a, b) => a.job.localeCompare(b.job, 'ko'));
  }

  return {
    filePath,
    all,
    // 자동 저장이므로, 사용자가 바꿔 둔 라벨을 스냅샷이 되돌리지 않게 한다.
    save(snapshot) {
      const prev = characters[snapshot.job];
      characters[snapshot.job] = { ...clone(snapshot), label: (prev && prev.label) || snapshot.label || snapshot.job };
      save();
      return all();
    },
    rename(job, label) {
      if (characters[job] && label) { characters[job].label = label; save(); }
      return all();
    },
    forget(job) {
      if (characters[job]) { delete characters[job]; save(); }
      return all();
    },
  };
}

module.exports = { VERSION, createItemStore };
