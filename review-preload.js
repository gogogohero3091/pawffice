const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reviewAPI', {
  submit: (text) => ipcRenderer.invoke('review-submit', text),
});
