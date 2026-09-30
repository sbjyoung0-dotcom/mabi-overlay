(function (root) {
  'use strict';
  const CH = {
    // renderer → main (invoke)
    CONFIG_GET: 'config:get',
    CONFIG_SET: 'config:set',
    GATHER_START: 'gather:start',
    GATHER_STOP: 'gather:stop',
    ALTER_ENQUEUE: 'alter:enqueue',
    CRAFT_RUN: 'craft:run',
    ALTER_COLLECT: 'alter:collect',
    ALTER_REFRESH: 'alter:refresh',
    AUTO_PAUSE: 'auto:pause',
    LIST_GATHERABLE: 'lists:gatherable',
    LIST_ALTERABLE: 'lists:alterable',
    LIST_CRAFTABLE: 'lists:craftable',
    STATUS_GET: 'status:get',
    ITEMS_REFRESH: 'items:refresh',
    ITEMS_SEARCH: 'items:search',
    ITEMS_RENAME: 'items:rename',
    ITEMS_FORGET: 'items:forget',
    WINDOW_QUIT: 'window:quit',
    WINDOW_RECTS: 'window:set-rects',
    CLICKTHROUGH_TOGGLE: 'window:toggle-clickthrough',
    // main → renderer (send)
    EV_ALTERING: 'altering:update',
    EV_GATHER: 'gather:progress',
    EV_ALTER: 'alter:progress',
    EV_CRAFT: 'craft:progress',
    EV_AUTO: 'auto:event',
    EV_CONN: 'conn:status',
    EV_CLICKTHROUGH: 'clickthrough:changed',
    EV_CONFIG: 'config:changed',
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CH;
  else root.CH = CH;
})(typeof window !== 'undefined' ? window : globalThis);
