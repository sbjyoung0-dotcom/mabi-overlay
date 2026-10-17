(function (root) {
  'use strict';
  // 저장된 위젯 좌표가 창 밖을 가리키면(모니터 구성이 바뀐 뒤 등) 화면에서 사라진다.
  // 항상 창 안으로 당겨 넣어 "위젯을 잃어버리는" 상황을 막는다.
  // 좌표는 항상 정수로 내린다 — offsetLeft는 반올림된 정수를 주므로, 소수점 경계값을
  // 돌려주면 "저장 → 다시 클램프 → 저장"이 끝없이 반복될 수 있다.
  function clampToBounds(rect, bounds) {
    const maxX = Math.floor(Math.max(0, bounds.width - (rect.w || 0)));
    const maxY = Math.floor(Math.max(0, bounds.height - (rect.h || 0)));
    const x = Math.min(Math.max(0, Math.round(rect.x)), maxX);
    const y = Math.min(Math.max(0, Math.round(rect.y)), maxY);
    return { x, y, changed: x !== rect.x || y !== rect.y };
  }
  // 숨긴 위젯은 화면에서 좌표를 읽을 수 없어 보고 대상에서 빠진다.
  // 보고된 값만 덮어쓰고 나머지는 지켜야 다시 켰을 때 원래 자리로 돌아온다.
  function mergePositions(prev, next) {
    return { ...(prev || {}), ...(next || {}) };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { clampToBounds, mergePositions };
  else root.Geometry = { clampToBounds, mergePositions };
})(typeof window !== 'undefined' ? window : globalThis);
