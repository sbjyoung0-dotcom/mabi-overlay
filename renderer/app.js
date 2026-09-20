(async () => {
  const M = window.mabi;
  const $ = (id) => document.getElementById(id);
  let config = await M.invoke(CH.CONFIG_GET);
  let lastUpdate = null;

  async function collect(displayName) {
    const r = await M.invoke(CH.ALTER_COLLECT, { displayName });
    UI.flash($('altering-msg'), r.ok ? `수령 완료${r.collected != null ? ` ${r.collected}건` : ''}` : `수령 실패: ${r.message}`);
  }

  async function setConfig(patch) { config = await M.invoke(CH.CONFIG_SET, patch); rerender(); return config; }

  function rerender() {
    document.body.classList.toggle('unlocked', !config.locked);
    $('btn-lock').textContent = config.locked ? '🔒' : '✋';
    Interact.applyPositions(config.positions);
    AlteringHud.render(lastUpdate, config, collect);
  }

  Interact.init({ isLocked: () => config.locked, onMove: (positions) => setConfig({ positions }) });
  M.on(CH.EV_ALTERING, (u) => { lastUpdate = u; AlteringHud.render(u, config, collect); });
  $('btn-layout').addEventListener('click', () => setConfig({ layout: config.layout === '1row' ? '2row' : '1row' }));
  $('btn-lock').addEventListener('click', () => setConfig({ locked: !config.locked }));
  $('btn-quit').addEventListener('click', () => M.invoke(CH.WINDOW_QUIT));
  M.on(CH.EV_CONN, (s) => {
    const b = $('badge-conn');
    b.textContent = s.connected ? '' : `연결 없음: ${s.reason}`;
    b.classList.toggle('hidden', s.connected);
  });
  rerender();
})();
