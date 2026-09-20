'use strict';
const { PRIORITY } = require('./cli-lock');

function createConnectionMonitor({ cli, lock, onChange, intervalMs = 10_000, setInterval: si = setInterval, clearInterval: ci = clearInterval }) {
  let last = null;
  let timer = null;

  function publish(next) {
    if (JSON.stringify(next) !== JSON.stringify(last)) { last = next; onChange(next); }
  }

  async function check() {
    if (!cli.cliPath) { publish({ connected: false, reason: 'cli_missing' }); return; }
    const p = lock.tryRun(PRIORITY.POLL, () => cli.run('status'));
    if (!p) return;
    const r = await p;
    if (r.ok && r.body && r.body.pipe === 'connected') publish({ connected: true, reason: null });
    else publish({ connected: false, reason: r.reason || r.kind });
  }

  return {
    start() { if (!timer) { timer = si(check, intervalMs); check(); } },
    stop() { if (timer) { ci(timer); timer = null; } },
    check,
    report(result) {
      if (result && result.kind === 'disconnected') publish({ connected: false, reason: result.reason || 'disconnected' });
    },
    current: () => last,
  };
}

module.exports = { createConnectionMonitor };
