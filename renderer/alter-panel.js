window.AlterPanel = (() => {
  let running = false;

  function renderButtons(config, onStart) {
    const row = document.getElementById('alter-buttons');
    row.replaceChildren();
    if (config.alterFavorites.length === 0) {
      row.append(UI.el('span', { class: 'sub', text: '⚙에서 가공 즐겨찾기를 추가하세요' }));
      return;
    }
    for (const f of config.alterFavorites) {
      row.append(UI.el('button', {
        class: 'btn fav', text: `${f.displayName} ×${f.count}건${f.autoRequeue ? ' 🔁' : ''}`,
        title: `정령의 날개 ${f.count * 5}개${f.autoRequeue ? ' · 자동 재가공 켜짐' : ''}`,
        disabled: running, onclick: () => onStart(f),
      }));
    }
  }

  function renderProgress(p) {
    const box = document.getElementById('alter-progress');
    running = !!p.running;
    box.classList.remove('hidden');
    clearTimeout(box._hideTimer);
    if (!p.running) {
      const tail = p.stoppedReason ? ` 후 중단: ${p.stoppedMessage}` : ' 완료';
      box.replaceChildren(UI.el('div', { text: `${p.displayName} ${p.registered}/${p.count}건 등록${tail}` }));
      box._hideTimer = setTimeout(() => box.classList.add('hidden'), 10000);
      return;
    }
    box.replaceChildren(UI.el('div', { text: `${p.displayName} ${p.registered}/${p.count}건 등록 중...` }));
  }

  function renderAutoEvent(e) {
    const s = document.getElementById('alter-status');
    const map = {
      collecting: () => `자동: ${e.displayName} 수령 중`,
      requeued: () => `자동 재등록 ${e.index}/${e.count} · 오늘 자동 소모 날개 ${e.autoSpentWings.amount}`,
      paused: () => `자동 일시정지(${e.displayName}): ${e.message}`,
      disabled: () => `자동 재가공 해제(${e.displayName}): ${e.message}`,
    };
    s.textContent = (map[e.type] || (() => ''))();
  }

  return { renderButtons, renderProgress, renderAutoEvent, isRunning: () => running };
})();
