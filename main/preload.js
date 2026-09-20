'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mabi', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
