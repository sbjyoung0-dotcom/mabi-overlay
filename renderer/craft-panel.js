// 제작 위젯. 가공과 달리 버튼 한 번이 이동·제작·수령까지 끝내고,
// craftCount를 몇 번으로 하든 정령의 날개는 5개만 든다.
window.CraftPanel = (() => {
  let running = false;

  function renderButtons(config, onStart, disabled) {
    const row = document.getElementById('craft-buttons');
    row.replaceChildren();
    if (config.craftFavorites.length === 0) {
      row.append(UI.el('span', { class: 'sub', text: '⚙에서 제작 즐겨찾기를 추가하세요' }));
      return;
    }
    for (const f of config.craftFavorites) {
      row.append(UI.el('button', {
        class: 'btn fav', text: `${f.displayName} ×${f.craftCount}회`,
        title: `${f.craftCount}회 제작 · 정령의 날개 5개 (횟수와 무관)`,
        disabled: running || disabled, onclick: () => onStart(f),
      }));
    }
  }

  function renderProgress(p) {
    const box = document.getElementById('craft-progress');
    running = !!p.running;
    box.classList.remove('hidden');
    clearTimeout(box._hideTimer);
    if (p.running) {
      box.replaceChildren(UI.el('div', { text: `${p.displayName} ×${p.craftCount}회 제작 중... (이동 포함)` }));
      return;
    }
    const detail = p.ok
      ? `${p.displayName} ×${p.craftCount != null ? p.craftCount : ''}회 제작 완료`
      : `${p.displayName} 제작 중단: ${p.message}`;
    box.replaceChildren(UI.el('div', { text: detail }));
    box._hideTimer = setTimeout(() => box.classList.add('hidden'), 10000);
  }

  return { renderButtons, renderProgress, isRunning: () => running };
})();
