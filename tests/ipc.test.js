'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CH = require('../shared/channels');
const { registerIpc, listOf } = require('../main/ipc');
const { createCli } = require('../main/cli');
const { createLock } = require('../main/cli-lock');
const { createFakeSpawn } = require('./helpers/fake-spawn');
const { createMemoryConfig } = require('./helpers/memory-config');

function fakeIpcMain() {
  const handlers = {};
  return { handlers, ipcMain: { handle: (ch, fn) => { handlers[ch] = (payload) => fn({}, payload); } } };
}

function setup(responses) {
  const { spawn, calls } = createFakeSpawn(responses);
  const cli = createCli({ cliPath: 'X:\\cli.exe', spawn });
  const lock = createLock();
  const config = createMemoryConfig();
  const log = [];
  const services = {
    config, cli, lock,
    gather: { isRunning: () => false, start: async (a) => { log.push(['gather.start', a]); }, stop: async () => log.push(['gather.stop']) },
    alterQueue: { enqueue: async (a) => { log.push(['enqueue', a]); }, pauseAuto: (v) => log.push(['pause', v]), isAutoPaused: () => true },
    poller: { refreshNow: async () => log.push(['refresh']) },
    setInteractive: (v) => log.push(['interactive', v]),
    quit: () => log.push(['quit']),
  };
  const { handlers, ipcMain } = fakeIpcMain();
  registerIpc({ ipcMain, services });
  return { handlers, calls, config, log };
}

test('모든 renderer→main 채널에 핸들러가 등록된다', () => {
  const { handlers } = setup([]);
  for (const key of Object.keys(CH).filter((k) => !k.startsWith('EV_'))) assert.ok(handlers[CH[key]], key);
});

test('config get/set', async () => {
  const { handlers } = setup([]);
  assert.equal((await handlers[CH.CONFIG_GET]()).locked, true);
  assert.equal((await handlers[CH.CONFIG_SET]({ locked: false })).locked, false);
});

test('gather start/stop, alter enqueue, auto pause, window', async () => {
  const { handlers, log } = setup([]);
  await handlers[CH.GATHER_START]({ displayName: '통나무', repeat: 2 });
  await handlers[CH.GATHER_STOP]();
  await handlers[CH.ALTER_ENQUEUE]({ displayName: 'x', count: 1 });
  await new Promise((r) => setImmediate(r));
  assert.equal(await handlers[CH.AUTO_PAUSE](true), true);
  await handlers[CH.WINDOW_INTERACTIVE](true);
  await handlers[CH.WINDOW_QUIT]();
  assert.deepEqual(log.map((l) => l[0]), ['gather.start', 'gather.stop', 'enqueue', 'refresh', 'pause', 'interactive', 'quit']);
});

test('alter collect: CLI 호출 후 해석 결과를 돌려주고 재폴링', async () => {
  const { handlers, calls, log } = setup([{ stdout: '{"status":"accepted","body":{"collected":2,"message":"ok"}}' }]);
  const r = await handlers[CH.ALTER_COLLECT]({ displayName: '상급 가죽' });
  assert.equal(calls[0].command, 'complete_altering_work');
  assert.equal(r.ok, true); assert.equal(r.collected, 2);
  assert.deepEqual(log, [['refresh']]);
});

test('lists: 정상/연결 없음', async () => {
  const ok = setup([{ stdout: '{"items":[{"DisplayName":"통나무","ToolOk":true}]}' }]);
  assert.deepEqual(await ok.handlers[CH.LIST_GATHERABLE](), { items: [{ DisplayName: '통나무', ToolOk: true }] });
  const off = setup([{ stdout: '{"pipe":"disconnected","reason":"game_off"}', exitCode: 5 }]);
  const r = await off.handlers[CH.LIST_ALTERABLE]();
  assert.equal(r.items, null); assert.match(r.message, /게임 연결/);
});

test('listOf: 배열 응답도 items로', () => {
  assert.deepEqual(listOf({ ok: true, body: [{ a: 1 }] }), { items: [{ a: 1 }] });
});
