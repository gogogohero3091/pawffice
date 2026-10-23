const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('featureAPI', {
  submit: (payload) => ipcRenderer.invoke('feature-submit', payload),
});
