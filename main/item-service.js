'use strict';
const { PRIORITY } = require('./cli-lock');
const { buildSnapshot, searchItems } = require('./item-search');

// 검색창을 열 때 한 번만 CLI를 부르고(refresh), 타이핑할 때마다는 메모리에서 거른다(search).
function createItemService({ cli, lock, store, now = Date.now }) {
  let live = null; // { items, job, at }

  async function refresh() {
    const { info, items } = await lock.run(PRIORITY.MANUAL, async () => ({
      info: await cli.run('get_my_info'),
      items: await cli.run('get_items'),
    }));

    if (!items.ok) {
      const message = items.kind === 'disconnected'
        ? '게임 연결 없음 — 저장된 기록만 검색합니다'
        : (items.message || items.error || items.kind);
      return { ok: false, message, liveJob: live ? live.job : null, refreshedAt: live ? live.at : null, characters: store.all() };
    }

    const job = (info.ok && info.body && info.body.EnabledCombatJobDisplayName) || null;
    const at = now();
    live = { items: Array.isArray(items.body) ? items.body : (items.body && items.body.items) || [], job, at };

    // 직업을 못 읽으면 어느 캐릭터 것인지 알 수 없으므로 저장하지 않는다(남의 칸을 덮어쓰지 않기 위해).
    let characters = store.all();
    if (job) characters = store.save(buildSnapshot({ items: live.items, job, savedAt: at }));

    return { ok: true, liveJob: job, refreshedAt: at, characters };
  }

  function search(query) {
    return {
      results: searchItems({
        query,
        liveItems: live ? live.items : null,
        liveJob: live ? live.job : null,
        snapshots: store.all(),
      }),
      liveJob: live ? live.job : null,
      refreshedAt: live ? live.at : null,
      characters: store.all(),
    };
  }

  return {
    refresh,
    search,
    rename: (job, label) => store.rename(job, label),
    forget: (job) => store.forget(job),
    characters: () => store.all(),
  };
}

module.exports = { createItemService };
