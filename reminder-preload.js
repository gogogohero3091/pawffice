const { contextBridge, ipcRenderer } = require('electron');

// 커스텀 리마인더 설정창 preload - 지금 저장된 리마인더 값을 미리 채워주고, 저장/끄기를 메인 프로세스로 보냄.
contextBridge.exposeInMainWorld('reminderAPI', {
  current: ipcRenderer.sendSync('get-current-reminder'),
  submit: (data) => ipcRenderer.send('reminder-submit', data),
  turnOff: () => ipcRenderer.send('reminder-submit', { enabled: false }),
});
