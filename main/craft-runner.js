'use strict';
const { PRIORITY } = require('./cli-lock');

// 제작은 가공과 달리 큐가 없다. execute_crafting 한 번이 이동·제작·수령까지 끝내고,
// craftCount로 여러 번 제작해도 정령의 날개는 호출당 5개만 든다.
const MESSAGES = {
  crafting_locked: '제작 기능이 아직 열리지 않았습니다',
  not_found: '레시피 없음',
  not_available: '지금은 제작할 수 없습니다',
  insufficient_living_skill_level: '생활 스킬 레벨 부족',
  insufficient_facility_level: '시설 레벨 부족',
  insufficient_decor_score: '데코 점수 부족',
  not_enough_ingredient: '재료 부족',
  ingredient_locked: '재료 잠김',
  insufficient_transfer_cost: '이송 비용 부족',
  not_enough_currency: '정령의 날개 부족',
  cost_payment_failed: '날개 결제 실패',
  overweight: '무게 초과',
  not_in_field: '필드가 아님',
  facility_not_found: '시설 없음',
  blocked: '게임 화면 확인 필요',
  invalid_count: '한 번에 가능한 횟수를 넘었습니다',
  timeout: '시간 초과로 중단됨',
  canceled: '다른 명령으로 대체됨',
  unknown_command: '게임이 이 명령을 지원하지 않습니다 — 게임 업데이트 확인',
};

function interpretCraftResult(r) {
  if (!r.ok) {
    if (r.kind === 'disconnected') return { ok: false, reason: 'disconnected', message: '게임 연결 끊김' };
    const reason = r.error || r.kind;
    return { ok: false, reason, message: MESSAGES[reason] || r.message || reason };
  }
  const b = r.body || {};
  if (b.error === 'invalid_count') {
    return { ok: false, reason: 'invalid_count', maxCount: b.maxCount, message: `한 번에 최대 ${b.maxCount}회까지 제작할 수 있습니다` };
  }
  if (b.error === 'blocked') {
    return { ok: false, reason: 'blocked', message: `게임 화면 확인 필요: ${b.kind || ''}`.trim() };
  }
  if (b.error) return { ok: false, reason: b.error, message: MESSAGES[b.error] || b.message || b.error, cost: b.cost };
  // 사용자가 게임에서 직접 끝낸 것은 오류가 아니다(새로 만들어진 것도 없다).
  if (b.result === 'stopped_by_user') return { ok: false, reason: 'stopped_by_user', message: '게임에서 중단했습니다', cost: b.cost };
  return {
    ok: true, reason: 'completed', message: '제작 완료',
    craftCount: b.craftCount, rewards: b.rewards, criticalRewards: b.criticalRewards, cost: b.cost,
  };
}

function createCraftRunner({ cli, lock, onProgress }) {
  let running = null; // { displayName, craftCount }

  async function run({ displayName, craftCount }) {
    if (running) throw new Error('already running');
    running = { displayName, craftCount };
    onProgress({ running: true, displayName, craftCount, status: 'crafting' });
    try {
      const it = interpretCraftResult(
        await lock.run(PRIORITY.MANUAL, () => cli.run('execute_crafting', { displayName, craftCount })),
      );
      onProgress({ running: false, displayName, craftCount, status: 'done', ...it });
      return it;
    } finally {
      running = null;
    }
  }

  return { run, isRunning: () => running !== null };
}

module.exports = { MESSAGES, interpretCraftResult, createCraftRunner };
