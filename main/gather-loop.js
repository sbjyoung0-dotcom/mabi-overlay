'use strict';
const { PRIORITY } = require('./cli-lock');

const STOP_MESSAGES = {
  overweight: '무게 초과', tool_broken: '도구 파손', tool_missing: '도구 없음', canceled: '게임에서 취소됨',
  not_enough_currency: '정령의 날개 부족', no_route: '경로 없음', not_in_field: '필드가 아님',
  required_consumable_missing: '필요 소모품 없음', insufficient_living_skill_level: '생활 스킬 레벨 부족',
  not_found: '아이템 없음', cost_payment_failed: '날개 결제 실패',
};

// execute_gathering 한 번의 결과 → 루프를 계속할지
function interpretGatherResult(r) {
  if (!r.ok) {
    if (r.kind === 'disconnected') return { action: 'stop', reason: 'disconnected', message: '게임 연결 끊김', gained: 0 };
    const reason = r.error || r.kind;
    return { action: 'stop', reason, message: STOP_MESSAGES[reason] || r.message || reason, gained: 0 };
  }
  const b = r.body || {};
  const gained = Number(b.gained) || 0;
  if (b.error === 'timeout') return { action: 'continue', reason: 'timeout', message: '9분 제한, 이어서 진행', gained, target: b.target, cost: b.cost };
  if (b.error === 'blocked') return { action: 'stop', reason: 'blocked', message: `게임 화면 확인 필요: ${b.kind || ''}`.trim(), gained, cost: b.cost };
  if (b.error) return { action: 'stop', reason: b.error, message: STOP_MESSAGES[b.error] || b.message || b.error, gained, cost: b.cost };
  if (b.result === 'stopped') return { action: 'stop', reason: 'stopped', message: b.message || '중지됨', gained, cost: b.cost };
  return { action: 'continue', reason: 'completed', message: '', gained, target: b.target, cost: b.cost };
}

function createGatherLoop({ cli, lock, onProgress }) {
  let state = null; // { displayName, repeat, i, gainedTotal, lastCost, stopRequested }

  function emit(extra) { onProgress({ running: true, ...state, ...extra }); }

  async function start({ displayName, repeat }) {
    if (state) throw new Error('already running');
    state = { displayName, repeat, i: 0, gainedTotal: 0, lastCost: null, stopRequested: false };
    emit({ status: 'started' });
    let reason = 'completed';
    let message = `${repeat}회 완료`;
    await lock.run(PRIORITY.GATHER, async () => {
      for (let i = 1; i <= repeat; i++) {
        if (state.stopRequested) { reason = 'user_stop'; message = '사용자 중단'; break; }
        state.i = i;
        emit({ status: 'gathering' });
        const it = interpretGatherResult(await cli.run('execute_gathering', { displayName }));
        state.gainedTotal += it.gained;
        state.lastCost = it.cost || state.lastCost;
        if (state.stopRequested) { reason = 'user_stop'; message = '사용자 중단'; break; }
        if (it.action === 'stop') { reason = it.reason; message = it.message; break; }
        emit({ status: 'iteration_done', lastMessage: it.message });
      }
    });
    const summary = { done: true, status: 'done', reason, message, displayName, repeat, i: state.i, gainedTotal: state.gainedTotal, lastCost: state.lastCost };
    state = null;
    onProgress({ running: false, ...summary });
    return summary;
  }

  // 잠금을 거치지 않고 stop_action을 바로 보낸다 — 진행 중인 채집을 게임에서 멈추게 하기 위해
  async function stop() {
    if (!state) return false;
    state.stopRequested = true;
    emit({ status: 'stopping' });
    const r = await cli.run('stop_action');
    if (!r.ok && state) {
      emit({ status: 'stopping', lastMessage: `중지 요청 실패: ${r.message || r.error || r.kind}` });
    }
    return r.ok;
  }

  return { start, stop, isRunning: () => state !== null };
}

module.exports = { interpretGatherResult, createGatherLoop };
