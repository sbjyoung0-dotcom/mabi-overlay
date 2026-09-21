'use strict';
const { PRIORITY } = require('./cli-lock');

// MoFo와 같은 6개 시설 분류. keywords는 FacilityName(없으면 DisplayName)에 부분 일치.
const FACILITIES = [
  { key: 'metal', name: '금속 가공 시설', short: '금속', color: '#94a3b8', keywords: ['금속'] },
  { key: 'wood', name: '목재 가공 시설', short: '목재', color: '#a16207', keywords: ['목재', '나무'] },
  { key: 'leather', name: '가죽 가공 시설', short: '가죽', color: '#c2410c', keywords: ['가죽'] },
  { key: 'cloth', name: '옷감 가공 시설', short: '옷감', color: '#7c3aed', keywords: ['옷감', '직물', '천 '] },
  { key: 'medicine', name: '약품 가공 시설', short: '약품', color: '#16a34a', keywords: ['약품', '포자', '진액', '연금'] },
  { key: 'food', name: '식재료 가공 시설', short: '식재료', color: '#fbbf24', keywords: ['식재료', '요리', '음식'] },
];

function isCompleted(w) { return w.IsCompleted === true || w.State === 'Completed'; }

function classifyFacility(name) {
  const n = name || '';
  const f = FACILITIES.find((fac) => fac.keywords.some((k) => n.includes(k)));
  return f ? f.key : 'other';
}

function groupWorks(works) {
  const groups = {};
  for (const f of FACILITIES) groups[f.key] = { key: f.key, facilityName: null, works: [], completed: [] };
  groups.other = { key: 'other', facilityName: null, works: [], completed: [] };
  for (const w of works || []) {
    const g = groups[classifyFacility(w.FacilityName || w.DisplayName)];
    g.facilityName = g.facilityName || w.FacilityName || null;
    g.works.push(w);
    if (isCompleted(w)) g.completed.push(w);
  }
  return groups;
}

function createAlteringPoller({ cli, lock, intervalMs = 3000, onUpdate, onError, setInterval: si = setInterval, clearInterval: ci = clearInterval }) {
  let timer = null;
  let running = false;

  async function poll() {
    if (running) return;
    running = true;
    try {
      const p = lock.tryRun(PRIORITY.POLL, () => cli.run('get_altering_works'));
      if (!p) return; // CLI 사용 중 → 이번 주기 건너뜀
      const r = await p;
      if (r.ok && r.body && Array.isArray(r.body.works)) {
        onUpdate({ completedCount: r.body.completedCount || 0, works: r.body.works, groups: groupWorks(r.body.works), fetchedAt: Date.now() });
      } else {
        onError(r);
      }
    } finally {
      running = false;
    }
  }

  return {
    start() { if (!timer) { timer = si(poll, intervalMs); poll(); } },
    stop() { if (timer) { ci(timer); timer = null; } },
    refreshNow: poll,
  };
}

module.exports = { FACILITIES, isCompleted, classifyFacility, groupWorks, createAlteringPoller };
