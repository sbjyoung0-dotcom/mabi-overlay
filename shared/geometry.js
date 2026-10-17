(function (root) {
  'use strict';
  // 저장된 위젯 좌표가 창 밖을 가리키면(모니터 구성이 바뀐 뒤 등) 화면에서 사라진다.
  // 항상 창 안으로 당겨 넣어 "위젯을 잃어버리는" 상황을 막는다.
  function clampToBounds(rect, bounds) {
    const maxX = Math.max(0, bounds.width - (rect.w || 0));
    const maxY = Math.max(0, bounds.height - (rect.h || 0));
    const x = Math.min(Math.max(0, rect.x), maxX);
    const y = Math.min(Math.max(0, rect.y), maxY);
    return { x, y, changed: x !== rect.x || y !== rect.y };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { clampToBounds };
  else root.Geometry = { clampToBounds };
})(typeof window !== 'undefined' ? window : globalThis);
