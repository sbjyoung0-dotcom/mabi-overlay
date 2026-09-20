// ⚙ 설정: 채집/가공 즐겨찾기 추가·삭제, 자동 재가공 토글, 시설 표시.
window.Settings = (() => {
  const $ = (id) => document.getElementById(id);
  let cfg = null;
  let save = null;

  function favRow(text, onDelete, extra) {
    return UI.el('div', { class: 'fav-row' }, [UI.el('span', { text }), extra || null, UI.el('button', { class: 'icon-btn', text: '✕', title: '삭제', onclick: onDelete })]);
  }

  async function loadList(channel, select, format) {
    select.replaceChildren(UI.el('option', { text: '불러오는 중...' }));
    const r = await window.mabi.invoke(channel);
    select.replaceChildren();
    if (!r || !r.items) { select.append(UI.el('option', { value: '', text: (r && r.message) || '게임 연결 후 추가할 수 있습니다' })); return; }
    if (r.items.length === 0) { select.append(UI.el('option', { value: '', text: '항목 없음' })); return; }
    for (const it of r.items) select.append(UI.el('option', { value: it.DisplayName, text: format(it) }));
  }

  const clamp = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Number(v) || dflt));

  function render() {
    const root = $('settings-body');
    root.replaceChildren();

    root.append(UI.el('h3', { text: '채집 즐겨찾기' }));
    cfg.gatherFavorites.forEach((f, i) => root.append(favRow(`${f.displayName} ×${f.repeat}회`,
      () => save({ gatherFavorites: cfg.gatherFavorites.filter((_, j) => j !== i) }))));
    const gSel = UI.el('select');
    const gRep = UI.el('input', { type: 'number', min: '1', max: '20', value: '10' });
    root.append(UI.el('div', { class: 'add-row' }, [
      UI.el('button', { class: 'btn', text: '목록 불러오기', onclick: () => loadList(CH.LIST_GATHERABLE, gSel, (it) => it.DisplayName + (it.ToolOk === false ? ' (도구 없음)' : '')) }),
      gSel, gRep, UI.el('span', { text: '회' }),
      UI.el('button', { class: 'btn primary', text: '추가', onclick: () => {
        if (!gSel.value) return;
        save({ gatherFavorites: [...cfg.gatherFavorites, { displayName: gSel.value, repeat: clamp(gRep.value, 1, 20, 10) }] });
      } }),
    ]));

    root.append(UI.el('h3', { text: '가공 즐겨찾기' }));
    cfg.alterFavorites.forEach((f, i) => {
      const chk = UI.el('input', { type: 'checkbox', onchange: (e) => save({ alterFavorites: cfg.alterFavorites.map((x, j) => (j === i ? { ...x, autoRequeue: e.target.checked } : x)) }) });
      chk.checked = !!f.autoRequeue;
      root.append(favRow(`${f.displayName} ×${f.count}건`,
        () => save({ alterFavorites: cfg.alterFavorites.filter((_, j) => j !== i) }),
        UI.el('label', { class: 'sub' }, [chk, ' 자동 재가공'])));
    });
    const aSel = UI.el('select');
    const aCnt = UI.el('input', { type: 'number', min: '1', max: '7', value: '6' });
    root.append(UI.el('div', { class: 'add-row' }, [
      UI.el('button', { class: 'btn', text: '목록 불러오기', onclick: () => loadList(CH.LIST_ALTERABLE, aSel, (it) =>
        `${it.DisplayName} (1건=${it.ProducedPerWork ?? '?'}개)` + (it.Alterable === false ? ` [불가: ${it.Reason || ''}]` : '')) }),
      aSel, aCnt, UI.el('span', { text: '건' }),
      UI.el('button', { class: 'btn primary', text: '추가', onclick: () => {
        if (!aSel.value) return;
        save({ alterFavorites: [...cfg.alterFavorites, { displayName: aSel.value, count: clamp(aCnt.value, 1, 7, 6), autoRequeue: false }] });
      } }),
    ]));
    root.append(UI.el('p', { class: 'warn', text: '⚠ 자동 재가공은 클릭 없이 캐릭터를 시설로 이동시키고 건당 정령의 날개 5개를 씁니다. 전투/던전 중에는 거부되며, 3회 연속 실패하면 자동으로 꺼집니다.' }));

    root.append(UI.el('h3', { text: '시설 표시' }));
    const facRow = UI.el('div', { class: 'add-row' });
    for (const [key, label] of [['metal', '금속'], ['wood', '목재'], ['leather', '가죽'], ['cloth', '옷감'], ['medicine', '약품'], ['food', '식재료']]) {
      const c = UI.el('input', { type: 'checkbox', onchange: (e) => save({ visibleFacilities: { ...cfg.visibleFacilities, [key]: e.target.checked } }) });
      c.checked = cfg.visibleFacilities[key] !== false;
      facRow.append(UI.el('label', {}, [c, ` ${label}`]));
    }
    root.append(facRow);
  }

  function open(config, saveFn) {
    cfg = config;
    save = async (patch) => { cfg = await saveFn(patch); render(); };
    render();
    $('settings').classList.remove('hidden');
  }
  function close() { $('settings').classList.add('hidden'); }

  return { open, close };
})();
