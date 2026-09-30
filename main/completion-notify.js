'use strict';
const { isCompleted } = require('./altering');

// 가공이 끝났는데 자동 재가공이 꺼져 있으면 수령 타이밍을 놓치기 쉽다.
// 폴링 결과에서 "새로 완료된 것"만 골라 Windows 알림을 띄운다.
function createCompletionNotifier({ notify, getConfig }) {
  let seen = new Set(); // `${시설}\u0000${아이템}` — 완료 상태로 이미 알린 것

  function handleWorksUpdate(update) {
    const cfg = getConfig() || {};
    const autoNames = new Set((cfg.alterFavorites || []).filter((f) => f.autoRequeue).map((f) => f.displayName));

    const nowDone = new Set();
    const fresh = new Map(); // 시설 → 아이템 이름들
    for (const w of (update && update.works) || []) {
      if (!isCompleted(w)) continue;
      const facility = w.FacilityName || '가공 시설';
      const key = `${facility}\u0000${w.DisplayName}`;
      nowDone.add(key);
      // 자동 재가공이 켜진 아이템은 오버레이가 알아서 수령하므로 알리지 않는다.
      if (autoNames.has(w.DisplayName) || seen.has(key)) continue;
      if (!fresh.has(facility)) fresh.set(facility, new Set());
      fresh.get(facility).add(w.DisplayName);
    }

    // 수령해서 사라진 항목은 잊는다 → 다음에 다시 완료되면 또 알린다.
    seen = nowDone;

    if (cfg.notifyOnComplete === false) return;
    for (const [facility, names] of fresh) {
      notify('가공 완료', `${facility} · ${[...names].join(', ')} 수령 가능`);
    }
  }

  return { handleWorksUpdate };
}

module.exports = { createCompletionNotifier };
