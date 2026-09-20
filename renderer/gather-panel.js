window.GatherPanel = (() => {
  let running = false;

  function renderButtons(config, onStart) {
    const row = document.getElementById('gather-buttons');
    row.replaceChildren();
    if (config.gatherFavorites.length === 0) {
      row.append(UI.el('span', { class: 'sub', text: '⚙에서 채집 즐겨찾기를 추가하세요' }));
      return;
    }
    for (const f of config.gatherFavorites) {
      row.append(UI.el('button', {
        class: 'btn fav', text: `${f.displayName} ×${f.repeat}`,
        title: `최대 ${f.repeat * 100}개 · 정령의 날개 ${f.repeat * 5}개`,
        disabled: running, onclick: () => onStart(f),
      }));
    }
  }

  function renderProgress(p, gameStatus) {
    const box = document.getElementById('gather-progress');
    running = !!p.running;
    box.classList.remove('hidden');
    clearTimeout(box._hideTimer);
    if (p.done) {
      box.replaceChildren(UI.el('div', { text: `종료: ${p.message} · ${p.i}/${p.repeat}회 · 누적 ${p.gainedTotal}개` }));
      box._hideTimer = setTimeout(() => box.classList.add('hidden'), 10000);
      return;
    }
    const statusText = gameStatus
      ? `날개 ${gameStatus.wings ?? '?'} · 무게 ${gameStatus.weight ? `${gameStatus.weight.current}/${gameStatus.weight.max}` : '?'}`
      : '';
    box.replaceChildren(
      UI.el('div', { text: `${p.displayName} ${p.i}/${p.repeat}회 · 누적 ${p.gainedTotal}개${p.lastMessage ? ` · ${p.lastMessage}` : ''}` }),
      UI.el('div', { class: 'sub', text: statusText }),
      UI.el('button', {
        class: 'btn danger', text: p.status === 'stopping' ? '중단 중...' : '중단',
        disabled: p.status === 'stopping', onclick: () => window.mabi.invoke(CH.GATHER_STOP),
      }),
    );
  }

  return { renderButtons, renderProgress, isRunning: () => running };
})();
