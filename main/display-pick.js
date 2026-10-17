'use strict';

// 오버레이 창은 한 모니터 안에만 둔다. 여러 모니터를 한 창으로 덮으면
// 주사율이 다른 환경에서 해당 모니터 출력이 멈추는 문제가 생긴다(실측: 144/120/60Hz).
// 대신 어느 모니터에 띄울지 사용자가 고를 수 있게 한다.
function pickDisplay(displays, { preferredId, preferredBounds, primaryId } = {}) {
  const list = displays || [];
  if (list.length === 0) return null;
  const byId = (id) => list.find((d) => d.id === id);

  const preferred = preferredId != null ? byId(preferredId) : null;
  if (preferred) return preferred;

  // 모니터를 다시 연결하면 id가 바뀔 수 있다. 저장해 둔 좌표·크기로 같은 모니터를 다시 찾는다.
  if (preferredBounds) {
    const sameSpot = list.find((d) => d.bounds.x === preferredBounds.x && d.bounds.y === preferredBounds.y
      && d.bounds.width === preferredBounds.width && d.bounds.height === preferredBounds.height);
    if (sameSpot) return sameSpot;
  }

  return byId(primaryId) || list[0];
}

function displayLabel(display, index, primaryId) {
  const primary = display.id === primaryId ? ' (주)' : '';
  return `모니터 ${index + 1}${primary} ${display.bounds.width}×${display.bounds.height}`;
}

module.exports = { pickDisplay, displayLabel };
