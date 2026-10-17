'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain, globalShortcut, Notification, screen, Tray, Menu, nativeImage } = require('electron');
const CH = require('../shared/channels');
const { createConfig } = require('./config');
const { findCliPath, createCli } = require('./cli');
const { createLock } = require('./cli-lock');
const { createAlteringPoller } = require('./altering');
const { createGatherLoop } = require('./gather-loop');
const { createAlterQueue } = require('./alter-queue');
const { createCraftRunner } = require('./craft-runner');
const { createCompletionNotifier } = require('./completion-notify');
const { createConnectionMonitor } = require('./connection');
const { createItemStore } = require('./item-store');
const { createItemService } = require('./item-service');
const { registerIpc } = require('./ipc');
const { isOverAny, toWindowPoint } = require('./hit-test');
const { unionBounds } = require('./display-union');

const POLL_MS = 50;
const DEFAULT_POSITIONS = Object.freeze({ altering: { x: 100, y: 100 }, gather: { x: 100, y: 320 }, alter: { x: 100, y: 460 }, craft: { x: 100, y: 600 } });

let win = null;
let fullClickThrough = false;
let cli = null; // before-quit에서 진행 중인 CLI 프로세스를 죽이기 위해 모듈 스코프로 둔다
let rects = []; // 렌더러가 보고한 위젯 사각형 (창 기준 CSS px)
let lastOver = null;
let pollTimer = null;
let tray = null; // GC 방지용 모듈 스코프 참조
let refreshTrayMenu = () => {};

// 모든 모니터를 덮는 하나의 창. 주 모니터만 덮으면 위젯을 보조 모니터로 끌었을 때 사라진다.
function overlayBounds() {
  return unionBounds(screen.getAllDisplays()) || { x: 0, y: 0, ...screen.getPrimaryDisplay().bounds };
}

function createWindow() {
  const bounds = overlayBounds();
  win = new BrowserWindow({
    ...bounds,
    // resizable:false면 Windows가 창 최대 크기를 "한 모니터의 작업 영역"으로 제한해
    // 여러 모니터를 덮을 수 없다. 생성 후 setBounds로 전체 영역을 잡는다.
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: true, hasShadow: false,
    minWidth: 1, minHeight: 1, maximizable: false, fullscreenable: false, movable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setBounds(bounds);            // 생성 시 제한을 받았을 수 있어 다시 지정
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// 모니터를 꽂거나 빼거나 해상도를 바꾸면 창 크기를 다시 맞춘다.
// 위젯 좌표는 창 기준이라, 렌더러가 창 안으로 다시 당겨 넣도록 알린다.
function syncWindowToDisplays() {
  if (!win || win.isDestroyed()) return;
  const b = overlayBounds();
  win.setBounds(b);
  if (win.getBounds().width < b.width) win.setBounds(b); // 제한에 걸리면 한 번 더
  lastOver = null;
  win.webContents.send(CH.EV_DISPLAYS);
}

// 위젯 위에 마우스가 있을 때만 클릭을 받는다. F8 완전 관통 중에는 무시.
function setInteractive(on) {
  if (!win || fullClickThrough) return;
  win.setIgnoreMouseEvents(!on, { forward: true });
}

// 렌더러가 보고한 사각형 목록을 저장한다. 배열이 아니거나 좌표가 유한하지 않은 항목은 버린다.
function setRects(newRects) {
  if (!Array.isArray(newRects)) return;
  rects = newRects.filter((r) => r
    && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h));
}

// 게임 창이 앞에 있으면 마우스 훅/전역 단축키가 전달되지 않으므로, 커서 위치를 직접 폴링해서 판정한다.
function startCursorPolling() {
  pollTimer = setInterval(() => {
    if (!win || win.isDestroyed() || fullClickThrough) return;
    const over = isOverAny(toWindowPoint(screen.getCursorScreenPoint(), win.getBounds()), rects);
    if (over !== lastOver) {
      lastOver = over;
      setInteractive(over);
    }
  }, POLL_MS);
}

function toggleFullClickThrough() {
  fullClickThrough = !fullClickThrough;
  if (fullClickThrough) {
    win.setIgnoreMouseEvents(true, { forward: true });
  } else {
    lastOver = null; // 폴링이 다음 tick에서 다시 판정하도록 강제
  }
  win.webContents.send(CH.EV_CLICKTHROUGH, fullClickThrough);
  refreshTrayMenu();
}

// 16x16 BGRA 비트맵: 주황 사각형(#f59e0b) + 2px 투명 테두리. 런타임 생성이라 별도 아이콘 파일이 필요 없다.
function createTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const border = x < 2 || x >= size - 2 || y < 2 || y >= size - 2;
      if (border) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0; // 투명
      } else {
        buf[i] = 0x0b; buf[i + 1] = 0x9e; buf[i + 2] = 0xf5; buf[i + 3] = 255; // BGRA: #f59e0b
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function createTray({ config, send }) {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('mabi-overlay');

  function buildTrayMenu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '완전 관통 모드', type: 'checkbox', checked: fullClickThrough, click: toggleFullClickThrough },
      {
        label: '위치 잠금',
        type: 'checkbox',
        checked: config.get().locked,
        click: () => {
          const next = !config.get().locked;
          config.set({ locked: next });
          send(CH.EV_CONFIG, config.get());
          buildTrayMenu();
        },
      },
      {
        label: '위젯 위치 초기화',
        click: () => {
          config.set({ positions: DEFAULT_POSITIONS });
          send(CH.EV_CONFIG, config.get());
        },
      },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ]));
  }

  refreshTrayMenu = buildTrayMenu;
  buildTrayMenu();
}

app.whenReady().then(() => {
  const config = createConfig({ filePath: path.join(app.getPath('appData'), 'mabi-overlay', 'config.json') });
  cli = createCli({ cliPath: findCliPath() });
  const lock = createLock();
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

  const itemStore = createItemStore({ filePath: path.join(app.getPath('appData'), 'mabi-overlay', 'items-cache.json') });
  const itemService = createItemService({ cli, lock, store: itemStore });
  const alterQueue = createAlterQueue({ cli, lock, config, onProgress: (p) => send(CH.EV_ALTER, p), onAutoEvent: (e) => send(CH.EV_AUTO, e) });
  const conn = createConnectionMonitor({ cli, lock, onChange: (s) => send(CH.EV_CONN, s) });
  const completionNotifier = createCompletionNotifier({
    getConfig: () => config.get(),
    isAutoPaused: () => alterQueue.isAutoPaused(),
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
    },
  });
  const poller = createAlteringPoller({
    cli, lock,
    onUpdate: (u) => {
      send(CH.EV_ALTERING, u);
      completionNotifier.handleWorksUpdate(u);
      alterQueue.handleWorksUpdate(u).catch(() => {});
    },
    onError: (r) => conn.report(r),
  });
  const craftRunner = createCraftRunner({ cli, lock, onProgress: (p) => send(CH.EV_CRAFT, p) });
  const gather = createGatherLoop({ cli, lock, onProgress: (p) => send(CH.EV_GATHER, p) });

  createWindow();
  createTray({ config, send });
  registerIpc({
    ipcMain,
    services: {
      config, cli, lock, gather, alterQueue, craftRunner, poller, itemService, setRects,
      toggleClickThrough: toggleFullClickThrough,
      onConfigChanged: () => refreshTrayMenu(),
      quit: () => app.quit(),
    },
  });
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, syncWindowToDisplays);
  }
  globalShortcut.register('F8', toggleFullClickThrough);
  win.webContents.on('did-finish-load', () => { conn.start(); poller.start(); });
  startCursorPolling();
});

app.on('before-quit', () => { if (cli) cli.killCurrent(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (pollTimer) clearInterval(pollTimer); });
app.on('window-all-closed', () => app.quit());
