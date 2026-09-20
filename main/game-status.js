'use strict';
const { PRIORITY } = require('./cli-lock');

function findWings(currencies) {
  const c = (currencies || []).find((x) => x.DisplayName === '정령의 날개');
  return c ? c.Amount : null;
}

// 날개 잔량 + 무게. 잠금이 바쁘면(채집/가공 중) null — 호출자는 이전 값을 유지한다.
async function fetchGameStatus({ cli, lock }) {
  const job = lock.tryRun(PRIORITY.POLL, async () => ({ cur: await cli.run('get_currencies'), inv: await cli.run('get_inventory') }));
  if (!job) return null;
  const { cur, inv } = await job;
  return {
    wings: cur.ok ? findWings(cur.body) : null,
    weight: inv.ok && inv.body ? { current: inv.body.CurrentInventoryWeightAsDecimal, max: inv.body.MaxInventoryWeightAsDecimal } : null,
  };
}

module.exports = { findWings, fetchGameStatus };
