const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licenseAPI', {
  activate: (key) => ipcRenderer.invoke('license-activate', key),
  openPurchasePage: () => ipcRenderer.send('license-open-purchase'),
});
