'use strict';
const { PRIORITY } = require('./cli-lock');

const WINGS_PER_CALL = 5;

const REJECT_MESSAGES = {
  not_enough_ingredient: '재료 부족', not_available: '큐가 가득 참', not_enough_currency: '정령의 날개 부족',
  requires_user_interaction: '게임에서 직접 시작해야 하는 레시피', insufficient_facility_level: '시설 레벨 부족',
  ingredient_locked: '재료 잠김', insufficient_transfer_cost: '이송 비용 부족', blocked: '게임 화면 확인 필요',
  not_in_field: '필드가 아님', overweight: '무게 초과', facility_not_found: '시설 없음', not_found: '레시피 없음',
  no_completed_work_at_facility: '해당 시설에 완료된 가공 없음', not_completed_yet: '아직 완료되지 않음',
  no_altering: '가공 중인 작업 없음', timeout: '응답 시간 초과', canceled: '취소됨', cost_payment_failed: '날개 결제 실패',
  unknown_command: '게임이 이 명령을 지원하지 않습니다 — 게임 업데이트 확인',
};

// execute_altering / complete_altering_work 결과 해석
function interpretAlterResult(r) {
  if (!r.ok) {
    const reason = r.error || r.kind;
    return { ok: false, reason, message: REJECT_MESSAGES[reason] || r.message || reason };
  }
  const b = r.body || {};
  if (b.error) return { ok: false, reason: b.error, message: REJECT_MESSAGES[b.error] || b.message || b.error, cost: b.cost };
  return { ok: true, result: b.result, cost: b.cost, collected: b.collected };
}

function todayKey(nowMs) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 자동 재가공으로 쓴 날개를 오늘 기준으로 누적 (자정 리셋)
function addAutoSpent(config, amount, nowMs) {
  const cur = config.get().autoSpentWings || { date: null, amount: 0 };
  const date = todayKey(nowMs);
  const next = cur.date === date ? { date, amount: cur.amount + amount } : { date, amount };
  config.set({ autoSpentWings: next });
  return next;
}

function createAlterQueue({ cli, lock, config, onProgress = () => {}, onAutoEvent = () => {}, now = Date.now, retryMs = 60_000, maxFailures = 3 }) {
  let autoPaused = false;
  let autoBusy = false;
  const itemState = {}; // displayName → { failures, retryAfter }

  async function enqueue({ displayName, count }) {
    let registered = 0; let stoppedReason = null; let stoppedMessage = null; let lastCost = null;
    onProgress({ running: true, displayName, count, registered });
    await lock.run(PRIORITY.MANUAL, async () => {
      for (let i = 0; i < count; i++) {
        const it = interpretAlterResult(await cli.run('execute_altering', { displayName }));
        if (!it.ok) { stoppedReason = it.reason; stoppedMessage = it.message; break; }
        registered++;
        lastCost = it.cost || lastCost;
        onProgress({ running: true, displayName, count, registered });
      }
    });
    const summary = { running: false, displayName, count, registered, stoppedReason, stoppedMessage, lastCost };
    onProgress(summary);
    return summary;
  }

  function failItem(displayName, message) {
    const s = itemState[displayName] || { failures: 0, retryAfter: 0 };
    s.failures += 1;
    s.retryAfter = now() + retryMs;
    itemState[displayName] = s;
    if (s.failures >= maxFailures) {
      const favs = config.get().alterFavorites.map((f) => (f.displayName === displayName ? { ...f, autoRequeue: false } : f));
      config.set({ alterFavorites: favs });
      s.failures = 0;
      onAutoEvent({ type: 'disabled', displayName, message });
    } else {
      onAutoEvent({ type: 'paused', displayName, message, retryAfter: s.retryAfter });
    }
  }

  // 폴링 결과에서 자동 재가공 대상(완료 + 토글 켜짐)을 골라 시설 단위로 한 번만 수령 → 아이템별로 같은 수만큼 재등록
  async function handleWorksUpdate(update) {
    if (autoPaused || autoBusy) return;
    const autoNames = new Set(config.get().alterFavorites.filter((f) => f.autoRequeue).map((f) => f.displayName));
    if (autoNames.size === 0) return;
    const t = now();
    const groupTargets = [];
    for (const g of Object.values(update.groups)) {
      const items = {};
      for (const w of g.completed) {
        if (!autoNames.has(w.DisplayName)) continue;
        const s = itemState[w.DisplayName];
        if (s && s.retryAfter > t) continue;
        items[w.DisplayName] = (items[w.DisplayName] || 0) + 1;
      }
      if (Object.keys(items).length > 0) groupTargets.push(items);
    }
    if (groupTargets.length === 0) return;
    autoBusy = true;
    try {
      await lock.run(PRIORITY.AUTO, async () => {
        for (const items of groupTargets) {
          const names = Object.keys(items);
          const firstName = names[0];
          const totalCount = names.reduce((sum, n) => sum + items[n], 0);
          onAutoEvent({ type: 'collecting', displayName: firstName, count: totalCount });
          // 시설 단위로 한 번만 수령 — 같은 시설의 다른 아이템까지 함께 수령된다
          const col = interpretAlterResult(await cli.run('complete_altering_work', { displayName: firstName }));
          if (!col.ok) {
            if (col.reason === 'no_completed_work_at_facility') {
              // 다른 곳(수동/타 도구)이 이미 수령했다는 뜻 — 실패로 세지 않는다
              onAutoEvent({ type: 'skipped', displayName: firstName, message: col.message });
              continue;
            }
            for (const name of names) failItem(name, col.message);
            continue;
          }
          for (const [displayName, count] of Object.entries(items)) {
            let ok = true;
            for (let i = 0; i < count; i++) {
              const it = interpretAlterResult(await cli.run('execute_altering', { displayName }));
              if (!it.ok) { failItem(displayName, it.message); ok = false; break; }
              const autoSpentWings = addAutoSpent(config, WINGS_PER_CALL, now());
              onAutoEvent({ type: 'requeued', displayName, index: i + 1, count, autoSpentWings });
            }
            if (ok) itemState[displayName] = { failures: 0, retryAfter: 0 };
          }
        }
      });
    } finally {
      autoBusy = false;
    }
  }

  return {
    enqueue,
    handleWorksUpdate,
    pauseAuto: (v) => { autoPaused = !!v; },
    isAutoPaused: () => autoPaused,
  };
}

module.exports = { WINGS_PER_CALL, interpretAlterResult, addAutoSpent, createAlterQueue };
