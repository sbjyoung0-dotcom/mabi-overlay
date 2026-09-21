'use strict';
// point {x,y}, rects [{x,y,w,h}] — all in the same coordinate space
function isOverAny(point, rects) {
  return (rects || []).some((r) => point.x >= r.x && point.x < r.x + r.w && point.y >= r.y && point.y < r.y + r.h);
}
// Cursor in screen DIPs → window-relative using the window bounds
function toWindowPoint(cursor, bounds) { return { x: cursor.x - bounds.x, y: cursor.y - bounds.y }; }
module.exports = { isOverAny, toWindowPoint };
