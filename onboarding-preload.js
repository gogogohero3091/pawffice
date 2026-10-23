const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { BREEDS, BREED_LABELS } = require('./breeds-config');

function findAsset(pathNoExt) {
  for (const ext of ['.svg', '.png']) {
    const p = pathNoExt + ext;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function fileToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/svg+xml';
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// 견종 선택 카드에 쓸 대표 그림(idle/center) + 한글 이름을 미리 읽어둠.
// 그림이 아직 없는 견종(예: idle 폴더가 비어있는 새 견종)은 고를 수 없게 목록에서 조용히 빠져요.
const breedChoices = BREEDS.map((name) => {
  const thumbPath = findAsset(path.join(__dirname, 'assets', 'breeds', name, 'idle', 'center'));
  return {
    id: name,
    label: BREED_LABELS[name] || name,
    thumb: thumbPath ? fileToDataUri(thumbPath) : null,
  };
}).filter((b) => b.thumb);

contextBridge.exposeInMainWorld('onboardingAPI', {
  breeds: breedChoices,
  // 설정을 나중에 바꾸러 다시 열었을 때 기존 값(견종/이름)을 미리 채워주기 위함.
  // 처음 실행이면 저장된 게 없어서 {} 가 옴.
  currentSettings: ipcRenderer.sendSync('get-current-settings'),
  submit: (data) => ipcRenderer.send('onboarding-submit', data),
});
