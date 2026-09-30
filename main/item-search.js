'use strict';

// get_items는 접속 중인 캐릭터 기준으로 가방(inventory), 그 캐릭터 창고(character_storage),
// 공용 계정 창고(account_storage)를 한 번에 준다. 계정 창고는 모든 캐릭터가 공유하므로
// 캐릭터별 스냅샷에는 넣지 않고 항상 실시간 값만 1회 집계한다(중복 집계 방지).

function addCount(map, name, count) {
  if (!name) return;
  map[name] = (map[name] || 0) + (Number(count) || 0);
}

function splitByLocation(items) {
  const out = { inventory: {}, characterStorage: {}, accountStorage: {} };
  for (const it of items || []) {
    if (it.Location === 'inventory') addCount(out.inventory, it.DisplayName, it.Count);
    else if (it.Location === 'character_storage') addCount(out.characterStorage, it.DisplayName, it.Count);
    else if (it.Location === 'account_storage') addCount(out.accountStorage, it.DisplayName, it.Count);
  }
  return out;
}

// 직업 하나를 캐릭터 한 명으로 본다(CLI가 캐릭터 이름을 주지 않음). label은 사용자가 바꿀 수 있다.
function buildSnapshot({ items, job, label, savedAt }) {
  const { inventory, characterStorage } = splitByLocation(items);
  return { job, label: label || job, savedAt, inventory, characterStorage };
}

function searchItems({ query, liveItems, liveJob, snapshots }) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const live = splitByLocation(liveItems);
  // 현재 접속 중인 직업은 실시간 값이 우선이므로 그 직업의 스냅샷은 버린다.
  const others = (snapshots || []).filter((s) => s && s.job !== liveJob);

  const rows = new Map(); // displayName → row
  const rowFor = (name) => {
    if (!rows.has(name)) rows.set(name, { displayName: name, total: 0, account: 0, sources: [] });
    return rows.get(name);
  };
  const matches = (name) => name.toLowerCase().includes(q);

  for (const [name, count] of Object.entries(live.accountStorage)) {
    if (!matches(name)) continue;
    const row = rowFor(name);
    row.account += count;
    row.total += count;
  }

  const addSource = ({ job, label, savedAt, isLive, inventory, characterStorage }) => {
    const names = new Set([...Object.keys(inventory || {}), ...Object.keys(characterStorage || {})]);
    for (const name of names) {
      if (!matches(name)) continue;
      const inv = (inventory && inventory[name]) || 0;
      const storage = (characterStorage && characterStorage[name]) || 0;
      const subtotal = inv + storage;
      if (subtotal <= 0) continue;
      const row = rowFor(name);
      row.total += subtotal;
      row.sources.push({ job, label, savedAt, isLive, inventory: inv, storage, subtotal });
    }
  };

  if (liveJob) {
    addSource({ job: liveJob, label: liveJob, savedAt: null, isLive: true, inventory: live.inventory, characterStorage: live.characterStorage });
  }
  for (const s of others) {
    addSource({ job: s.job, label: s.label || s.job, savedAt: s.savedAt, isLive: false, inventory: s.inventory, characterStorage: s.characterStorage });
  }

  const result = [...rows.values()].filter((r) => r.total > 0);
  // 보유량이 많은 것부터, 같으면 이름순
  result.sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName, 'ko'));
  for (const row of result) row.sources.sort((a, b) => b.subtotal - a.subtotal || a.label.localeCompare(b.label, 'ko'));
  return result;
}

module.exports = { splitByLocation, buildSnapshot, searchItems };
