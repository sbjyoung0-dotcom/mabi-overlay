// 위젯 위에서만 클릭을 받고(그 외는 게임으로 관통), 잠금 해제 시 헤더 드래그로 이동한다.
// 클릭 판정 자체는 main이 커서 좌표를 폴링해서 하므로(게임 창이 앞에 있어도 동작), 여기서는 위젯 사각형만 보고한다.
window.Interact = (() => {
  const M = window.mabi;
  let isLocked = () => true;
  let onMove = () => {};
  let drag = null;
  let getPositions = () => null;
  let rectsPending = false;

  // 저장된 좌표가 창 밖이면(모니터를 빼거나 배치가 바뀐 뒤) 위젯이 화면에서 사라진다.
  // 항상 창 안으로 당겨 넣고, 당겨졌으면 저장된 좌표도 고쳐 둔다.
  let clampSaving = false; // 클램프가 유발한 저장이 다시 클램프 저장을 부르지 않게
  function applyPositions(positions) {
    let fixed = false;
    for (const [key, pos] of Object.entries(positions || {})) {
      const el = document.querySelector(`.widget[data-widget="${key}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // 숨긴 위젯은 건너뛴다
      const c = Geometry.clampToBounds({ x: pos.x, y: pos.y, w: r.width, h: r.height },
        { width: window.innerWidth, height: window.innerHeight });
      el.style.left = `${c.x}px`;
      el.style.top = `${c.y}px`;
      if (c.changed) fixed = true;
    }
    if (fixed && !clampSaving) {
      clampSaving = true;
      try { onMove(readPositions()); } finally { clampSaving = false; }
    }
  }

  function readPositions() {
    const out = {};
    for (const w of document.querySelectorAll('.widget[data-widget]')) {
      if (w.classList.contains('modal')) continue; // 모달은 CSS로 화면 중앙에 고정된다
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
    getPositions = opts.getPositions || (() => null);

    // 창 크기가 바뀌면(모니터 변경 등) 레이아웃이 반영된 뒤에 다시 당겨 넣는다.
    // 메인의 setBounds 직후에는 innerWidth가 아직 옛 값일 수 있어 resize를 기다린다.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { applyPositions(getPositions()); reportRects(); }, 120);
    });

    document.addEventListener('mousemove', (e) => {
      if (drag) { drag.el.style.left = `${e.clientX - drag.dx}px`; drag.el.style.top = `${e.clientY - drag.dy}px`; }
    });
    document.addEventListener('mousedown', (e) => {
      if (isLocked()) return;
      const header = e.target.closest('.widget-header');
      if (!header || e.target.closest('button')) return;
      const el = header.closest('.widget');
      if (el.classList.contains('modal')) return; // 모달은 드래그 대상이 아니다
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
