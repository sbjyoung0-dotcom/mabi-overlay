'use strict';
const CH = require('../shared/channels');
const { PRIORITY } = require('./cli-lock');
const { interpretAlterResult } = require('./alter-queue');
const { fetchGameStatus } = require('./game-status');

function listOf(r) {
  if (!r.ok) {
    return { items: null, message: r.kind === 'disconnected' ? '게임 연결 후 추가할 수 있습니다' : (r.message || r.kind) };
  }
  const items = Array.isArray(r.body) ? r.body : (r.body && r.body.items) || [];
  return { items };
}

function registerIpc({ ipcMain, services }) {
  const { config, cli, lock, gather, alterQueue, poller, setRects, toggleClickThrough, onConfigChanged, quit } = services;
  const h = (ch, fn) => ipcMain.handle(ch, (_event, payload) => fn(payload));

  h(CH.CONFIG_GET, () => config.get());
  // 렌더러가 스스로 트리거한 변경이므로 EV_CONFIG는 쏘지 않는다(이미 최신 config를 갖고 있음).
  // 트레이 메뉴(위치 잠금 체크박스)만 갱신한다.
  h(CH.CONFIG_SET, (patch) => { const c = config.set(patch); onConfigChanged(); return c; });

  h(CH.GATHER_START, ({ displayName, repeat }) => {
    if (!gather.isRunning()) gather.start({ displayName, repeat }).catch(() => {});
    return true;
  });
  h(CH.GATHER_STOP, () => gather.stop());

  h(CH.ALTER_ENQUEUE, ({ displayName, count }) => {
    alterQueue.enqueue({ displayName, count }).then(() => poller.refreshNow()).catch(() => {});
    return true;
  });
  h(CH.ALTER_COLLECT, async ({ displayName }) => {
    const r = interpretAlterResult(await lock.run(PRIORITY.MANUAL, () => cli.run('complete_altering_work', { displayName })));
    await poller.refreshNow();
    return r;
  });
  h(CH.ALTER_REFRESH, () => poller.refreshNow());
  h(CH.AUTO_PAUSE, (paused) => { alterQueue.pauseAuto(paused); return alterQueue.isAutoPaused(); });

  h(CH.LIST_GATHERABLE, async () => listOf(await lock.run(PRIORITY.MANUAL, () => cli.run('get_gatherable_items'))));
  h(CH.LIST_ALTERABLE, async () => listOf(await lock.run(PRIORITY.MANUAL, () => cli.run('get_alterable_items'))));
  h(CH.STATUS_GET, ({ fresh } = {}) => fetchGameStatus({ cli, lock, priority: fresh ? PRIORITY.MANUAL : undefined }));

  h(CH.WINDOW_QUIT, () => { quit(); return true; });
  h(CH.WINDOW_RECTS, (rects) => { setRects(rects); return true; });
  h(CH.CLICKTHROUGH_TOGGLE, () => { toggleClickThrough(); return true; });
}

module.exports = { registerIpc, listOf };
