'use strict';
const path = require('node:path');
const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const CH = require('../shared/channels');
const { createConfig } = require('./config');
const { findCliPath, createCli } = require('./cli');
const { createLock } = require('./cli-lock');
const { createAlteringPoller } = require('./altering');
const { createGatherLoop } = require('./gather-loop');
const { createAlterQueue } = require('./alter-queue');
const { createConnectionMonitor } = require('./connection');
const { registerIpc } = require('./ipc');

let win = null;
let fullClickThrough = false;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x: 0, y: 0, width, height,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// 위젯 위에 마우스가 있을 때만 클릭을 받는다. F8 완전 관통 중에는 무시.
function setInteractive(on) {
  if (!win || fullClickThrough) return;
  win.setIgnoreMouseEvents(!on, { forward: true });
}

function toggleFullClickThrough() {
  fullClickThrough = !fullClickThrough;
  if (fullClickThrough) win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.send(CH.EV_CLICKTHROUGH, fullClickThrough);
}

app.whenReady().then(() => {
  const config = createConfig({ filePath: path.join(app.getPath('appData'), 'mabi-overlay', 'config.json') });
  const cli = createCli({ cliPath: findCliPath() });
  const lock = createLock();
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

  const alterQueue = createAlterQueue({ cli, lock, config, onProgress: (p) => send(CH.EV_ALTER, p), onAutoEvent: (e) => send(CH.EV_AUTO, e) });
  const conn = createConnectionMonitor({ cli, lock, onChange: (s) => send(CH.EV_CONN, s) });
  const poller = createAlteringPoller({
    cli, lock,
    onUpdate: (u) => { send(CH.EV_ALTERING, u); alterQueue.handleWorksUpdate(u).catch(() => {}); },
    onError: (r) => conn.report(r),
  });
  const gather = createGatherLoop({ cli, lock, onProgress: (p) => send(CH.EV_GATHER, p) });

  createWindow();
  registerIpc({ ipcMain, services: { config, cli, lock, gather, alterQueue, poller, setInteractive, quit: () => app.quit() } });
  globalShortcut.register('F8', toggleFullClickThrough);
  win.webContents.on('did-finish-load', () => { conn.start(); poller.start(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
