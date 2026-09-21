// 위젯 위에서만 클릭을 받고(그 외는 게임으로 관통), 잠금 해제 시 헤더 드래그로 이동한다.
// 클릭 판정 자체는 main이 커서 좌표를 폴링해서 하므로(게임 창이 앞에 있어도 동작), 여기서는 위젯 사각형만 보고한다.
window.Interact = (() => {
  const M = window.mabi;
  let isLocked = () => true;
  let onMove = () => {};
  let drag = null;
  let rectsPending = false;

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

  // 화면에 보이는 .widget(설정/확인 모달 포함)의 사각형을 창 기준 CSS px로 모아 main에 보고한다.
  function reportRects() {
    if (rectsPending) return;
    rectsPending = true;
    requestAnimationFrame(() => {
      rectsPending = false;
      const rects = [];
      for (const el of document.querySelectorAll('.widget')) {
        if (el.classList.contains('hidden')) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      M.invoke(CH.WINDOW_RECTS, rects);
    });
  }

  function init(opts) {
    isLocked = opts.isLocked;
    onMove = opts.onMove;

    document.addEventListener('mousemove', (e) => {
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
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F8') { e.preventDefault(); M.invoke(CH.CLICKTHROUGH_TOGGLE); }
    });
    M.on(CH.EV_CLICKTHROUGH, (on) => {
      document.getElementById('clickthrough-banner').classList.toggle('hidden', !on);
      document.body.classList.toggle('clickthrough', on);
    });

    new MutationObserver(reportRects).observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'],
    });
    window.addEventListener('resize', reportRects);
    reportRects();
  }

  return { init, applyPositions };
})();
