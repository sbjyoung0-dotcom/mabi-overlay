(async () => {
  const M = window.mabi;
  const $ = (id) => document.getElementById(id);
  let config = await M.invoke(CH.CONFIG_GET);

  async function setConfig(patch) { config = await M.invoke(CH.CONFIG_SET, patch); rerender(); return config; }

  function rerender() {
    document.body.classList.toggle('unlocked', !config.locked);
    $('btn-lock').textContent = config.locked ? '🔒' : '✋';
    Interact.applyPositions(config.positions);
  }

  Interact.init({ isLocked: () => config.locked, onMove: (positions) => setConfig({ positions }) });
  $('btn-lock').addEventListener('click', () => setConfig({ locked: !config.locked }));
  $('btn-quit').addEventListener('click', () => M.invoke(CH.WINDOW_QUIT));
  M.on(CH.EV_CONN, (s) => {
    const b = $('badge-conn');
    b.textContent = s.connected ? '' : `연결 없음: ${s.reason}`;
    b.classList.toggle('hidden', s.connected);
  });
  rerender();
})();
