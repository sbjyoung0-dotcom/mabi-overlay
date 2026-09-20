// DOM 헬퍼. 다른 렌더러 스크립트가 window.UI로 쓴다.
window.UI = {
  // UI.el('div', { class: 'x', text: 'hi', onclick: fn }, [children])
  el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined) e.append(c);
    return e;
  },
  // 화면 중앙 확인 모달 (.widget이라 클릭 가능). 시작=true, 취소=false
  confirm(message) {
    return new Promise((resolve) => {
      const close = (v) => { box.remove(); resolve(v); };
      const box = UI.el('div', { class: 'widget modal confirm' }, [
        UI.el('div', { class: 'confirm-text', text: message }),
        UI.el('div', { class: 'btn-row' }, [
          UI.el('button', { class: 'btn primary', text: '시작', onclick: () => close(true) }),
          UI.el('button', { class: 'btn', text: '취소', onclick: () => close(false) }),
        ]),
      ]);
      document.body.append(box);
    });
  },
  fmtTime(sec) {
    if (!(sec > 0)) return '완료';
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  },
  // 잠깐 보여주고 숨김
  flash(elm, text, ms = 10000) {
    elm.textContent = text;
    elm.classList.remove('hidden');
    clearTimeout(elm._flashTimer);
    elm._flashTimer = setTimeout(() => elm.classList.add('hidden'), ms);
  },
};
