(async () => {
  const M = window.mabi;
  const $ = (id) => document.getElementById(id);
  let config = await M.invoke(CH.CONFIG_GET);
  let lastUpdate = null;

  async function collect(displayName) {
    const r = await M.invoke(CH.ALTER_COLLECT, { displayName });
    UI.flash($('altering-msg'), r.ok ? `수령 완료${r.collected != null ? ` ${r.collected}건` : ''}` : `수령 실패: ${r.message}`);
  }

  let gameStatus = null;
  let autoPaused = false;

  async function refreshStatus() {
    if (GatherPanel.isRunning() || AlterPanel.isRunning()) return;
    const s = await M.invoke(CH.STATUS_GET);
    if (s) gameStatus = s;
  }

  function renderButtons() {
    GatherPanel.renderButtons(config, startGather);
    AlterPanel.renderButtons(config, startAlter);
    $('auto-count').textContent = String(config.alterFavorites.filter((f) => f.autoRequeue).length || '');
  }

  const busy = () => GatherPanel.isRunning() || AlterPanel.isRunning();

  async function startGather(fav) {
    if (busy()) return;
    await refreshStatus();
    const list = await M.invoke(CH.LIST_GATHERABLE);
    const item = list.items ? list.items.find((i) => i.DisplayName === fav.displayName) : null;
    let warn = '';
    if (!list.items) warn = `\n⚠ 목록 조회 실패: ${list.message}`;
    else if (!item) warn = '\n⚠ 현재 채집 가능 목록에 없습니다 (레벨/도구 확인)';
    else if (item.ToolOk === false) warn = '\n⚠ 도구가 없거나 내구도가 0입니다';
    const ok = await UI.confirm(
      `${fav.displayName} × ${fav.repeat}회 (최대 ${fav.repeat * 100}개)\n정령의 날개 ${fav.repeat * 5}개 소모 · 현재 잔량 ${gameStatus?.wings ?? '?'}개${warn}\n시작할까요?`,
    );
    if (ok) M.invoke(CH.GATHER_START, { displayName: fav.displayName, repeat: fav.repeat });
  }

  async function startAlter(fav) {
    if (busy()) return;
    await refreshStatus();
    const list = await M.invoke(CH.LIST_ALTERABLE);
    const item = list.items ? list.items.find((i) => i.DisplayName === fav.displayName) : null;
    const per = item && item.ProducedPerWork ? ` (예상 ${item.ProducedPerWork * fav.count}개)` : '';
    let warn = '';
    if (!list.items) warn = `\n⚠ 목록 조회 실패: ${list.message}`;
    else if (item && item.Alterable === false) {
      const missing = (item.MissingIngredients || []).map((m) => `${m.DisplayName} ${m.Owned}/${m.Required}`).join(', ');
      warn = `\n⚠ 지금은 가공 불가: ${item.Reason || ''} ${missing}`.trimEnd();
    }
    const ok = await UI.confirm(
      `${fav.displayName} × ${fav.count}건${per}\n정령의 날개 ${fav.count * 5}개 소모 · 현재 잔량 ${gameStatus?.wings ?? '?'}개${warn}\n시작할까요?`,
    );
    if (ok) M.invoke(CH.ALTER_ENQUEUE, { displayName: fav.displayName, count: fav.count });
  }

  async function setConfig(patch) { config = await M.invoke(CH.CONFIG_SET, patch); rerender(); return config; }

  function rerender() {
    document.body.classList.toggle('unlocked', !config.locked);
    $('btn-lock').textContent = config.locked ? '🔒' : '✋';
    Interact.applyPositions(config.positions);
    AlteringHud.render(lastUpdate, config, collect);
    renderButtons();
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
  M.on(CH.EV_GATHER, (p) => { GatherPanel.renderProgress(p, gameStatus); renderButtons(); if (p.done) refreshStatus(); });
  M.on(CH.EV_ALTER, (p) => { AlterPanel.renderProgress(p); renderButtons(); if (!p.running) refreshStatus(); });
  M.on(CH.EV_AUTO, async (e) => { AlterPanel.renderAutoEvent(e); if (e.type === 'disabled') { config = await M.invoke(CH.CONFIG_GET); rerender(); } });
  $('btn-auto').addEventListener('click', async () => {
    autoPaused = await M.invoke(CH.AUTO_PAUSE, !autoPaused);
    $('btn-auto').classList.toggle('paused', autoPaused);
    $('btn-auto').title = autoPaused ? '자동 재가공 일시정지됨 (클릭하여 재개)' : '자동 재가공 일시정지/재개';
  });
  setInterval(refreshStatus, 30000);
  refreshStatus();
  rerender();
})();
