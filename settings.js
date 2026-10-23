// 사용자가 고른 견종/이름을 저장해두는 파일(settings.json) 읽고 쓰기.
// app.getPath('userData') 밑에 저장해요 - 앱을 나중에 패키징해도(asar) 이 폴더는 항상
// 쓰기 가능하고, 앱 지웠다 다시 깔아도 보통 유지되는 위치라 여기 씀.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch (e) {
    return null; // 파일이 없으면(첫 실행) null - 온보딩을 보여줘야 한다는 신호로 씀
  }
}

function saveSettings(data) {
  try {
    fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
    fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.log('[mypet] 설정 저장 실패:', e.message);
    return false;
  }
}

module.exports = { getSettingsPath, loadSettings, saveSettings };
