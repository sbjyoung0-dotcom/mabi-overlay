// 위젯 위에서만 클릭을 받고(그 외는 게임으로 관통), 잠금 해제 시 헤더 드래그로 이동한다.
window.Interact = (() => {
  const M = window.mabi;
  let interactive = false;
  let isLocked = () => true;
  let onMove = () => {};
  let drag = null;

  function applyPositions(positions) {
    for (const [key, pos] of Object.entries(positions || {})) {
      const w = document.querySelector(`.widget[data-widget="${key}"]`);
      if (w) { w.style.left = `${pos.x}px`; w.style.top = `${pos.y}px`; }
    }
  }

  function readPositions() {
    const out = {};
    for (const w of document.querySelectorAll('.widget[data-widget]')) {
      if (w.dataset.widget === 'settings') continue;
      out[w.dataset.widget] = { x: w.offsetLeft, y: w.offsetTop };
    }
    return out;
  }

  function init(opts) {
    isLocked = opts.isLocked;
    onMove = opts.onMove;

    // forward:true 덕분에 관통 상태에서도 mousemove가 온다
    document.addEventListener('mousemove', (e) => {
      const over = !!(e.target.closest && e.target.closest('.widget'));
      if (over !== interactive) { interactive = over; M.invoke(CH.WINDOW_INTERACTIVE, over); }
      if (drag) { drag.el.style.left = `${e.clientX - drag.dx}px`; drag.el.style.top = `${e.clientY - drag.dy}px`; }
    });
    document.addEventListener('mousedown', (e) => {
      if (isLocked()) return;
      const header = e.target.closest('.widget-header');
      if (!header || e.target.closest('button')) return;
      const el = header.closest('.widget');
      if (el.dataset.widget === 'settings') return;
      drag = { el, dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
      el.classList.add('dragging');
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag.el.classList.remove('dragging');
      drag = null;
      onMove(readPositions());
    });
    M.on(CH.EV_CLICKTHROUGH, (on) => {
      document.getElementById('clickthrough-banner').classList.toggle('hidden', !on);
      document.body.classList.toggle('clickthrough', on);
    });
  }

  return { init, applyPositions };
})();
