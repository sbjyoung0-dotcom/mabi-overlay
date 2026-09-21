// 가공 시설 6타일. MoFo 규칙: 완료=주황, 진행=파랑(남은 시간), 대기=회색, 빈 슬롯=투명. 완료 건이 있으면 "완료 N" 버튼.
window.AlteringHud = (() => {
  const FACILITIES = [
    { key: 'metal', short: '금속', color: '#94a3b8' },
    { key: 'wood', short: '목재', color: '#a16207' },
    { key: 'leather', short: '가죽', color: '#c2410c' },
    { key: 'cloth', short: '옷감', color: '#7c3aed' },
    { key: 'medicine', short: '약품', color: '#16a34a' },
    { key: 'food', short: '식재료', color: '#fbbf24' },
  ];
  const isDone = (w) => w.IsCompleted === true || w.State === 'Completed';

  function slotDots(works) {
    const dots = [];
    for (let i = 0; i < 7; i++) {
      const w = works[i];
      let cls = 'slot empty';
      let title = `${i + 1}번 슬롯: 빈 슬롯`;
      if (w && isDone(w)) { cls = 'slot done'; title = `${i + 1}번 슬롯: [완료] ${w.DisplayName}`; }
      else if (w && w.State === 'InProgress') { cls = 'slot progress'; title = `${i + 1}번 슬롯: [진행 중] ${w.DisplayName} (${UI.fmtTime(w.RemainingSeconds)})`; }
      else if (w) { cls = 'slot queued'; title = `${i + 1}번 슬롯: [대기열] ${w.DisplayName}`; }
      dots.push(UI.el('span', { class: cls, title }));
    }
    return dots;
  }

  function render(update, config, onCollect, disabled) {
    const body = document.getElementById('altering-body');
    body.className = `facility-grid ${config.layout === '1row' ? 'rows-1' : 'rows-2'}`;
    body.replaceChildren();
    let total = 0;
    for (const f of FACILITIES) {
      if (config.visibleFacilities[f.key] === false) continue;
      const g = update ? update.groups[f.key] : { works: [], completed: [] };
      const inProg = g.works.find((w) => w.State === 'InProgress');
      total += g.completed.length;
      const status = g.completed.length > 0
        ? UI.el('button', {
            class: 'btn collect', text: `완료 ${g.completed.length}`,
            title: `${g.completed.length}개 완료됨 - 클릭하여 수령`,
            disabled, onclick: (e) => { e.stopPropagation(); onCollect(g.completed[0].DisplayName); },
          })
        : UI.el('span', { class: 'sub', text: inProg ? UI.fmtTime(inProg.RemainingSeconds) : (g.works.length ? '대기' : '-') });
      body.append(UI.el('div', { class: 'facility', style: `border-color:${f.color}` }, [
        UI.el('div', { class: 'facility-top' }, [UI.el('span', { class: 'facility-name', text: f.short, style: `color:${f.color}` }), status]),
        UI.el('div', { class: 'slots' }, slotDots(g.works)),
      ]));
    }
    const badge = document.getElementById('badge-collectable');
    badge.textContent = `수령 가능 ${total}건`;
    badge.classList.toggle('hidden', total === 0);
  }

  return { render };
})();
