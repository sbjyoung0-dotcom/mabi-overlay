'use strict';
const { PRIORITY } = require('./cli-lock');

function findWings(currencies) {
  const c = (currencies || []).find((x) => x.DisplayName === '정령의 날개');
  return c ? c.Amount : null;
}

// 날개 잔량 + 무게. priority가 없으면 폴링과 같은 취급 — 잠금이 바쁘면(채집/가공 중) null, 호출자는 이전 값을 유지한다.
// priority를 지정하면(확인창 직전 등) 잠금이 바빠도 차례를 기다렸다가 최신 값을 반환한다.
async function fetchGameStatus({ cli, lock, priority }) {
  const job = async () => ({ cur: await cli.run('get_currencies'), inv: await cli.run('get_inventory') });
  const p = priority !== undefined ? lock.run(priority, job) : lock.tryRun(PRIORITY.POLL, job);
  if (!p) return null;
  const { cur, inv } = await p;
  return {
    wings: cur.ok ? findWings(cur.body) : null,
    weight: inv.ok && inv.body ? { current: inv.body.CurrentInventoryWeightAsDecimal, max: inv.body.MaxInventoryWeightAsDecimal } : null,
  };
}

module.exports = { findWings, fetchGameStatus };
