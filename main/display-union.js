'use strict';

// 오버레이 창은 모든 모니터를 한 번에 덮어야 한다. 주 모니터만 덮으면
// 위젯을 보조 모니터로 끌었을 때 창 밖으로 나가 보이지 않는다.
function unionBounds(displays) {
  const rects = (displays || []).map((d) => d && d.bounds).filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y));
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((b) => b.x));
  const top = Math.min(...rects.map((b) => b.y));
  const right = Math.max(...rects.map((b) => b.x + b.width));
  const bottom = Math.max(...rects.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

module.exports = { unionBounds };
