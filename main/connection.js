'use strict';
const { PRIORITY } = require('./cli-lock');

function createConnectionMonitor({ cli, lock, onChange, intervalMs = 10_000, setInterval: si = setInterval, clearInterval: ci = clearInterval }) {
  let last = null;
  let timer = null;
  let parseErrorStreak = 0; // 연속 parse_error 횟수. 성공한 check()나 다른 report()로 리셋

  function publish(next) {
    if (JSON.stringify(next) !== JSON.stringify(last)) { last = next; onChange(next); }
  }

  async function check() {
    if (!cli.cliPath) { publish({ connected: false, reason: 'cli_missing' }); return; }
    const p = lock.tryRun(PRIORITY.POLL, () => cli.run('status'));
    if (!p) return;
    const r = await p;
    if (r.ok && r.body && r.body.pipe === 'connected') { parseErrorStreak = 0; publish({ connected: true, reason: null }); }
    else publish({ connected: false, reason: r.reason || r.kind });
  }

  return {
    start() { if (!timer) { timer = si(check, intervalMs); check(); } },
    stop() { if (timer) { ci(timer); timer = null; } },
    check,
    report(result) {
      if (result && result.kind === 'parse_error') {
        parseErrorStreak += 1;
        if (parseErrorStreak >= 3) publish({ connected: false, reason: 'parse_error' });
        return;
      }
      parseErrorStreak = 0;
      if (result && result.kind === 'disconnected') publish({ connected: false, reason: result.reason || 'disconnected' });
    },
    current: () => last,
  };
}

module.exports = { createConnectionMonitor };
