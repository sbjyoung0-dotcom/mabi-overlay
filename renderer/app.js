(async () => {
  const M = window.mabi;
  const $ = (id) => document.getElementById(id);
  let config = await M.invoke(CH.CONFIG_GET);
  let lastUpdate = null;

  async function collect(displayName) {
    if (busy()) return;
    const r = await M.invoke(CH.ALTER_COLLECT, { displayName });
    UI.flash($('altering-msg'), r.ok ? `수령 완료${r.collected != null ? ` ${r.collected}건` : ''}` : `수령 실패: ${r.message}`);
  }

  let gameStatus = null;
  let autoPaused = false;
  let confirming = false; // 확인 다이얼로그가 떠 있는 동안 다른 시작 버튼도 막는다 (겹쳐 뜨면 중복 등록될 수 있음)

  // fresh=true면(확인창 직전) 잠금이 바빠도 기다렸다가 최신 값을 받는다. 그 외(30초 주기, 루프 종료 후)는 바쁘면 건너뛴다.
  async function refreshStatus(fresh = false) {
    if (!fresh && (GatherPanel.isRunning() || AlterPanel.isRunning() || CraftPanel.isRunning())) return;
    const s = await M.invoke(CH.STATUS_GET, { fresh });
    if (s) gameStatus = s;
  }

  async function startCraft(fav) {
    if (busy()) return;
    confirming = true; renderButtons();
    try {
      await refreshStatus(true);
      const list = await M.invoke(CH.LIST_CRAFTABLE);
      const item = list.items ? list.items.find((i) => i.DisplayName === fav.displayName) : null;
      const per = item && item.ProducedPerCraft ? ` (예상 ${item.ProducedPerCraft * fav.craftCount}개)` : '';
      let warn = '';
      if (!list.items) warn = `
⚠ ${list.message}`;
      else if (item && item.Craftable === false) warn = await shortageWarn('제작', item);
      const ok = await UI.confirm(
        `${fav.displayName} × ${fav.craftCount}회${per}
정령의 날개 5개 소모(횟수와 무관) · 현재 잔량 ${gameStatus?.wings ?? '?'}개${warn}
시작할까요?`,
      );
      if (ok) M.invoke(CH.CRAFT_RUN, { displayName: fav.displayName, craftCount: fav.craftCount });
    } finally {
      confirming = false; renderButtons();
    }
  }

  function renderButtons() {
    GatherPanel.renderButtons(config, startGather, busy());
    AlterPanel.renderButtons(config, startAlter, busy());
    CraftPanel.renderButtons(config, startCraft, busy());
    $('auto-count').textContent = String(config.alterFavorites.filter((f) => f.autoRequeue).length || '');
  }

  const busy = () => GatherPanel.isRunning() || AlterPanel.isRunning() || CraftPanel.isRunning() || confirming;

  const fmtDay = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };

  // 재료가 부족할 때 "다른 캐릭터 어디에 있는지"를 확인창에 붙인다(저장된 스냅샷만 사용, CLI 추가 호출 없음).
  async function shortageWarn(kind, item) {
    const missing = item.MissingIngredients || [];
    const head = `\n⚠ 지금은 ${kind} 불가${item.Reason ? ` (${item.Reason})` : ''}`;
    if (missing.length === 0) return head;
    const r = await M.invoke(CH.ITEMS_LOCATE, { names: missing.map((m) => m.DisplayName) });
    const found = (r && r.found) || {};
    const lines = missing.map((m) => {
      const holders = found[m.DisplayName] || [];
      let where;
      // 기록 시각을 함께 보여준다 — 며칠 지난 수치를 현재 값으로 오해하지 않도록.
      if (holders.length > 0) where = ' → ' + holders.slice(0, 3).map((h) => `${h.label} ${h.subtotal}개${h.savedAt ? `(${fmtDay(h.savedAt)})` : ''}`).join(' · ');
      else if (!r || r.characterCount === 0) where = ' → 다른 캐릭터 기록 없음 (🔍을 캐릭터마다 한 번씩 열어두세요)';
      else where = ' → 다른 캐릭터에도 없음';
      return `  ${m.DisplayName} ${m.Owned}/${m.Required}${where}`;
    });
    const caution = r && r.currentUnknown ? '\n  (직업을 읽지 못해 현재 캐릭터 보유분이 섞여 있을 수 있습니다)' : '';
    return `${head}\n${lines.join('\n')}${caution}`;
  }

  async function startGather(fav) {
    if (busy()) return;
    confirming = true; renderButtons();
    try {
      await refreshStatus(true);
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
    } finally {
      confirming = false; renderButtons();
    }
  }

  async function startAlter(fav) {
    if (busy()) return;
    confirming = true; renderButtons();
    try {
      await refreshStatus(true);
      const list = await M.invoke(CH.LIST_ALTERABLE);
      const item = list.items ? list.items.find((i) => i.DisplayName === fav.displayName) : null;
      const per = item && item.ProducedPerWork ? ` (예상 ${item.ProducedPerWork * fav.count}개)` : '';
      let warn = '';
      if (!list.items) warn = `\n⚠ 목록 조회 실패: ${list.message}`;
      else if (item && item.Alterable === false) warn = await shortageWarn('가공', item);
      const ok = await UI.confirm(
        `${fav.displayName} × ${fav.count}건${per}\n정령의 날개 ${fav.count * 5}개 소모 · 현재 잔량 ${gameStatus?.wings ?? '?'}개${warn}\n시작할까요?`,
      );
      if (ok) M.invoke(CH.ALTER_ENQUEUE, { displayName: fav.displayName, count: fav.count });
    } finally {
      confirming = false; renderButtons();
    }
  }

  async function setConfig(patch) { config = await M.invoke(CH.CONFIG_SET, patch); rerender(); return config; }

  function rerender() {
    document.body.classList.toggle('unlocked', !config.locked);
    $('btn-lock').textContent = config.locked ? '🔒' : '✋';
    Interact.applyPositions(config.positions);
    AlteringHud.render(lastUpdate, config, collect, busy());
    renderButtons();
  }

  Interact.init({ isLocked: () => config.locked, onMove: (positions) => setConfig({ positions }) });
  M.on(CH.EV_ALTERING, (u) => { lastUpdate = u; AlteringHud.render(u, config, collect, busy()); });
  // 트레이의 위치 잠금 토글 등 외부에서 config가 바뀐 경우 (M.invoke를 거치지 않았으므로 여기서만 반영된다)
  M.on(CH.EV_CONFIG, (c) => { config = c; rerender(); Settings.refresh(); });
  $('btn-layout').addEventListener('click', () => setConfig({ layout: config.layout === '1row' ? '2row' : '1row' }));
  $('btn-lock').addEventListener('click', () => setConfig({ locked: !config.locked }));
  $('btn-quit').addEventListener('click', () => M.invoke(CH.WINDOW_QUIT));
  $('btn-items').addEventListener('click', () => ItemSearch.open());
  $('btn-items-close').addEventListener('click', () => ItemSearch.close());
  $('btn-settings').addEventListener('click', () => Settings.open(() => config, setConfig));
  $('btn-settings-close').addEventListener('click', () => Settings.close());
  const CONN_TEXT = { game_off: '게임 연결 없음 — 게임 실행 및 "MM AI 에이전트 활성화" 확인', option_off: '설정에서 MM AI 에이전트를 켜세요', cli_missing: 'CLI 없음: MABINOGI_CLI_PATH 설정', parse_error: 'CLI 응답을 읽을 수 없음 (3회 연속)' };
  M.on(CH.EV_CONN, (s) => {
    const b = $('badge-conn');
    b.textContent = s.connected ? '' : (CONN_TEXT[s.reason] || `연결 없음: ${s.reason}`);
    b.classList.toggle('hidden', s.connected);
  });
  M.on(CH.EV_GATHER, (p) => { GatherPanel.renderProgress(p, gameStatus); renderButtons(); if (p.done) refreshStatus(); });
  M.on(CH.EV_CRAFT, (p) => { CraftPanel.renderProgress(p); renderButtons(); if (!p.running) refreshStatus(); });
  M.on(CH.EV_ALTER, (p) => { AlterPanel.renderProgress(p); renderButtons(); if (!p.running) refreshStatus(); });
  M.on(CH.EV_AUTO, async (e) => { AlterPanel.renderAutoEvent(e); if (e.type === 'disabled') { config = await M.invoke(CH.CONFIG_GET); rerender(); Settings.refresh(); } });
  $('btn-auto').addEventListener('click', async () => {
    autoPaused = await M.invoke(CH.AUTO_PAUSE, !autoPaused);
    $('btn-auto').classList.toggle('paused', autoPaused);
    $('btn-auto').title = autoPaused ? '자동 재가공 일시정지됨 (클릭하여 재개)' : '자동 재가공 일시정지/재개';
  });
  setInterval(refreshStatus, 30000);
  refreshStatus();
  rerender();
})();
