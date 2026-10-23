const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sizeAPI', {
  // 0.5~1.3 사이 현재 배율 (기본 1.0)
  currentScale: ipcRenderer.sendSync('get-current-size'),
  submit: (scale) => ipcRenderer.send('size-submit', scale),
});
