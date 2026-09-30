// 아이템 찾기 모달. 열 때 CLI를 한 번만 부르고(ITEMS_REFRESH), 타이핑할 때마다는
// 메인 프로세스 메모리에서 거른다(ITEMS_SEARCH). CLI는 캐릭터 이름을 주지 않으므로
// 직업(사제/전사/…)을 캐릭터 키로 쓴다.
window.ItemSearch = (() => {
  const M = window.mabi;
  const $ = (id) => document.getElementById(id);
  let input = null;
  let resultsBox = null;
  let charsBox = null;
  let noticeBox = null;
  let state = { liveJob: null, refreshedAt: null, characters: [] };

  function fmtWhen(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function renderNotice({ message, stale, jobUnknown } = {}) {
    let left = '현재 캐릭터 정보 없음';
    if (state.liveJob) left = `${stale ? '마지막 갱신' : '현재 캐릭터'}: ${state.liveJob} · ${fmtWhen(state.refreshedAt)}${stale ? ' (새로고침 실패)' : ' 기준'}`;
    else if (jobUnknown) left = `현재 캐릭터: 직업 확인 불가 · ${fmtWhen(state.refreshedAt)} 기준`;
    noticeBox.replaceChildren(
      UI.el('span', { class: 'sub', text: left }),
      UI.el('span', {
        class: 'warn',
        text: message || (jobUnknown
          ? '직업을 읽지 못해 저장되지 않았고, 다른 캐릭터 기록과 겹칠 수 있습니다'
          : '장비·의상·펫은 검색되지 않습니다 (CLI 미제공)'),
      }),
    );
  }

  function renderChars() {
    charsBox.replaceChildren();
    if (state.characters.length === 0) {
      charsBox.append(UI.el('span', { class: 'sub', text: '저장된 캐릭터 없음 — 캐릭터를 바꿔 접속하면 자동으로 쌓입니다' }));
      return;
    }
    for (const c of state.characters) {
      const isLive = c.job === state.liveJob;
      const chip = UI.el('span', { class: `chip${isLive ? ' chip-live' : ''}`, title: isLive ? '접속 중 (실시간)' : `${fmtWhen(c.savedAt)} 기록` }, [
        UI.el('span', { text: c.label }),
        UI.el('button', {
          class: 'icon-btn', text: '✎', title: '이름 바꾸기',
          onclick: () => startRename(chip, c),
        }),
        UI.el('button', {
          class: 'icon-btn', text: '✕', title: '이 캐릭터 기록 삭제',
          onclick: async () => { state.characters = await M.invoke(CH.ITEMS_FORGET, { job: c.job }); renderChars(); doSearch(); },
        }),
      ]);
      charsBox.append(chip);
    }
  }

  // Electron 렌더러에서는 window.prompt를 쓸 수 없어 칩을 입력창으로 바꾼다.
  function startRename(chip, c) {
    const box = UI.el('input', { type: 'text', value: c.label, maxlength: '20' });
    // Escape로 renderChars()를 하면 입력창이 DOM에서 빠지며 blur가 뒤따라 터진다.
    // 그대로 두면 "취소"가 오히려 저장되므로 플래그로 막는다.
    let cancelled = false;
    const commit = async () => {
      if (cancelled) return;
      cancelled = true;
      const label = box.value.trim();
      if (label && label !== c.label) state.characters = await M.invoke(CH.ITEMS_RENAME, { job: c.job, label });
      renderChars();
      doSearch();
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') { cancelled = true; renderChars(); }
    });
    box.addEventListener('blur', commit);
    chip.replaceChildren(box);
    box.focus();
    box.select();
  }

  function renderResults(results) {
    resultsBox.replaceChildren();
    const q = input.value.trim();
    if (!q) { resultsBox.append(UI.el('div', { class: 'sub', text: '아이템 이름의 일부를 입력하세요 (예: 버섯)' })); return; }
    if (results.length === 0) { resultsBox.append(UI.el('div', { class: 'sub', text: `"${q}" 검색 결과 없음` })); return; }

    for (const r of results) {
      const lines = [];
      if (r.account > 0) lines.push(UI.el('div', { class: 'item-src', text: `계정창고(공용) ${r.account.toLocaleString()}` }));
      for (const s of r.sources) {
        const parts = [];
        if (s.inventory > 0) parts.push(`가방 ${s.inventory.toLocaleString()}`);
        if (s.storage > 0) parts.push(`개인창고 ${s.storage.toLocaleString()}`);
        lines.push(UI.el('div', { class: `item-src${s.isLive ? ' live' : ''}` }, [
          UI.el('span', { text: `${s.label} · ${parts.join(' · ')}` }),
          s.isLive ? null : UI.el('span', { class: 'ago', text: ` ${fmtWhen(s.savedAt)} 기록` }),
        ]));
      }
      resultsBox.append(UI.el('div', { class: 'item-row' }, [
        UI.el('div', { class: 'item-head' }, [
          UI.el('span', { class: 'item-name', text: r.displayName }),
          UI.el('span', { class: 'item-total', text: `총 ${r.total.toLocaleString()}` }),
        ]),
        ...lines,
      ]));
    }
  }

  async function doSearch() {
    const r = await M.invoke(CH.ITEMS_SEARCH, { query: input.value });
    state.liveJob = r.liveJob;
    state.refreshedAt = r.refreshedAt;
    state.characters = r.characters;
    state.jobUnknown = r.jobUnknown;
    renderResults(r.results);
  }

  function buildShell() {
    input = UI.el('input', { type: 'text', class: 'search-input', placeholder: '아이템 이름 검색' });
    input.addEventListener('input', doSearch);
    noticeBox = UI.el('div', { class: 'items-notice' });
    charsBox = UI.el('div', { class: 'chips' });
    resultsBox = UI.el('div', { class: 'items-results' });
    $('items-body').replaceChildren(input, noticeBox, charsBox, resultsBox);
  }

  async function open() {
    buildShell();
    renderNotice();
    resultsBox.replaceChildren(UI.el('div', { class: 'sub', text: '불러오는 중...' }));
    $('items').classList.remove('hidden');
    input.focus();

    const r = await M.invoke(CH.ITEMS_REFRESH);
    state.liveJob = r.liveJob;
    state.refreshedAt = r.refreshedAt;
    state.characters = r.characters || [];
    state.jobUnknown = !r.ok ? false : !r.liveJob;
    renderNotice({ message: r.ok ? '' : r.message, stale: !r.ok, jobUnknown: state.jobUnknown });
    renderChars();
    await doSearch();
  }

  function close() { $('items').classList.add('hidden'); }

  return { open, close };
})();
