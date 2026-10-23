const { contextBridge, ipcRenderer } = require('electron');

// 고정 메시지 입력창 preload - 지금 저장된 메시지를 미리 채워주고, 저장/지우기를 메인 프로세스로 보냄.
contextBridge.exposeInMainWorld('messageAPI', {
  currentMessage: ipcRenderer.sendSync('get-current-message'),
  submit: (text) => ipcRenderer.send('message-submit', text),
  clear: () => ipcRenderer.send('message-submit', ''),
});
