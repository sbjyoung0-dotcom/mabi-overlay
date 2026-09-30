'use strict';
const { isCompleted } = require('./altering');
const { shouldCollect } = require('./alter-queue');

// 가공이 끝났는데 자동 재가공이 꺼져 있으면 수령 타이밍을 놓치기 쉽다.
// 폴링 결과에서 "새로 완료됐고, 자동으로 수령되지도 않을 것"만 골라 Windows 알림을 띄운다.
const BATCH_THRESHOLD = 3; // 이보다 많은 시설이 한꺼번에 끝나면 알림 하나로 묶는다

function clampThreshold(v) {
  return Math.max(1, Math.min(7, Number(v) || 1));
}

function createCompletionNotifier({ notify, getConfig, isAutoPaused = () => false }) {
  let seen = new Set(); // `${시설}\u0000${아이템}` — 완료 상태로 이미 알린 것

  function handleWorksUpdate(update) {
    const cfg = getConfig() || {};
    const favs = cfg.alterFavorites || [];
    const autoFavs = new Map(favs.filter((f) => f.autoRequeue).map((f) => [f.displayName, f]));
    const works = (update && update.works) || [];

    // 수령은 시설 단위라, 자동 아이템이 수령 조건을 채운 시설은 통째로 곧 비워진다.
    // 그 시설의 수동 아이템까지 "수령 가능"이라고 알리면 곧 사라질 것을 알리는 셈이라 막는다.
    const autoCollecting = new Set();
    if (!isAutoPaused()) {
      const stats = new Map(); // `${시설}\u0000${아이템}` → { completed, pending }
      for (const w of works) {
        if (!autoFavs.has(w.DisplayName)) continue;
        const facility = w.FacilityName || '가공 시설';
        const key = `${facility}\u0000${w.DisplayName}`;
        if (!stats.has(key)) stats.set(key, { facility, name: w.DisplayName, completed: 0, pending: 0 });
        const st = stats.get(key);
        if (isCompleted(w)) st.completed += 1; else st.pending += 1;
      }
      for (const st of stats.values()) {
        const threshold = clampThreshold(autoFavs.get(st.name).collectThreshold);
        if (shouldCollect({ completed: st.completed, pending: st.pending, threshold })) autoCollecting.add(st.facility);
      }
    }

    const nowDone = new Set();
    const fresh = new Map(); // 시설 → 아이템 이름들
    for (const w of works) {
      if (!isCompleted(w)) continue;
      const facility = w.FacilityName || '가공 시설';
      const key = `${facility}\u0000${w.DisplayName}`;
      nowDone.add(key);
      if (autoFavs.has(w.DisplayName) || autoCollecting.has(facility) || seen.has(key)) continue;
      if (!fresh.has(facility)) fresh.set(facility, new Set());
      fresh.get(facility).add(w.DisplayName);
    }

    // 수령해서 사라진 항목은 잊는다 → 다음에 다시 완료되면 또 알린다.
    // 알림이 꺼져 있어도 이 갱신은 해야 나중에 켰을 때 밀린 알림이 쏟아지지 않는다.
    seen = nowDone;

    if (cfg.notifyOnComplete === false || fresh.size === 0) return;
    if (fresh.size >= BATCH_THRESHOLD) {
      notify('가공 완료', `${fresh.size}곳 수령 가능 · ${[...fresh.keys()].join(', ')}`);
      return;
    }
    for (const [facility, names] of fresh) {
      notify('가공 완료', `${facility} · ${[...names].join(', ')} 수령 가능`);
    }
  }

  return { handleWorksUpdate };
}

module.exports = { BATCH_THRESHOLD, createCompletionNotifier };
