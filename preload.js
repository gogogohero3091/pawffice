const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { BREEDS } = require('./breeds-config');

// 견종 목록은 이제 breeds-config.js 하나에만 있어요(온보딩 화면도 같은 목록을 봐야 해서
// main.js/onboarding-preload.js와 공유). 새 견종 추가할 땐 breeds-config.js만 고치면 됨.
// 여기서 만드는 breeds 객체는 "화면에 보일 견종 하나"가 아니라 그림이 있는 견종 전부를
// 담아요(온보딩에서 고른 견종을 renderer.js가 새로고침 없이 바로 전환할 수 있게 하려고,
// preload 시점에 전부 다 미리 로드해둠 - 실제로 어떤 걸 보여줄지는 온보딩에서 고른 값을
// renderer.js가 받아서 결정).

// 견종별 기본(대표) 털색 - 지금은 색칠 로직 자체가 코드에서 빠져서(그림에 이미 색이 들어있거나,
// 라인아트면 사용자가 직접 색칠) 실제로는 안 쓰이는 값이에요. 나중에 다시 쓸 수도 있어서 남겨둠.
const DEFAULT_COLORS = {
  maltese: '#f2ede3',
  frenchbulldog: '#e8e8e8',
};

function loadCalibration(jsonPath) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 그림 파일(SVG 또는 PNG)을 file:// 경로가 아니라 data URI로 통째로 인라인해서 넘겨요.
// (렌더러에서 그림을 캔버스에 그린 다음 getImageData로 픽셀을 읽어서 털색을 자동으로 칠하는데,
// file:// 경로로 불러온 이미지는 크로스오리진 취급돼서 캔버스가 "오염"되고 getImageData가
// SecurityError를 던져요 - 화면에 아무것도 안 그려지는 원인이 이거였어요. data URI는 이 문제가 없어요.)
function fileToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/svg+xml';
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// 확장자 없는 경로(예: .../idle)를 주면 .svg -> .png 순서로 실제 존재하는 파일을 찾아줘요.
// (벡터로 그린 건 .svg, 손그림을 스캔/내보낸 건 .png - 둘 다 같은 방식으로 취급합니다.)
function findAsset(pathNoExt) {
  for (const ext of ['.svg', '.png']) {
    const p = pathNoExt + ext;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 한 견종의 포즈들을 읽어요.
// - idle: assets/breeds/<견종>/idle/center.svg|png, left.*, right.*, up.*, down.* - 가만히 있을 때
//   보여줄 5방향 그림. 캘리브레이션/코드로 그리는 눈동자는 이제 안 써요 - 커서 방향에 따라 이 중
//   맞는 그림을 통째로 바꿔 보여주는 방식이라, 눈뿐 아니라 코/털 표현도 그림째로 같이 바뀝니다.
//   center 말고는 없는 방향이 있어도(예: up.png가 없으면) 조용히 center로 대체돼요.
// - running: assets/breeds/<견종>/running/1.svg, 2.svg, ... - 있는 만큼 순서대로 읽어서
//   프레임 배열로 만들고, 반복 재생(fps)해요. 캘리브레이션은 없음(아직 눈 하이라이트 없음).
function loadBreedPoses(breed) {
  const dir = path.join(__dirname, 'assets', 'breeds', breed);
  const poses = {};

  const idleDir = path.join(dir, 'idle');
  const directions = {};
  for (const dirName of ['center', 'left', 'right', 'up', 'down']) {
    const framePath = findAsset(path.join(idleDir, dirName));
    if (framePath) directions[dirName] = fileToDataUri(framePath);
  }
  // base.png(눈/코입을 지운 얼굴) + feature.png(눈/코입만 있는 레이어) - 있으면 렌더러가
  // 커서 방향에 따라 feature.png를 연속적인 값(px)으로 실시간으로 옮겨 그려서, 예전처럼
  // 5장(center/left/right/up/down) 중 하나로 뚝뚝 끊기며 바뀌는 대신 시선이 부드럽게 따라가게
  // 해요. 둘 다 idle/center.png에서 자동 생성(gaze_pipeline.py) - 없는 예전 견종은 기존 5방향
  // 전환 방식으로 조용히 대체돼요.
  const gazeBasePath = findAsset(path.join(idleDir, 'base'));
  const gazeFeaturePath = findAsset(path.join(idleDir, 'feature'));
  const gazeLayers = (gazeBasePath && gazeFeaturePath)
    ? { base: fileToDataUri(gazeBasePath), feature: fileToDataUri(gazeFeaturePath) }
    : null;
  if (directions.center) {
    // face.json: idle/center.png에서 눈 위치를 자동 분석해서 만든 { x, y } (캔버스 대비 0~1 비율).
    // 이름표를 "얼굴 가운데 위"에 정확히 띄우는 데 씀 - 없으면(예전에 만든 견종) renderer.js가
    // 적당한 기본값으로 대체함. face.json 만드는 법: 8번(이름표) TODO 참고.
    const face = loadCalibration(path.join(idleDir, 'face.json'));
    poses.idle = { fps: null, calibration: null, directions, face: face || null, gazeLayers };
  }

  const runningDir = path.join(dir, 'running');
  const runFrames = [];
  for (let i = 1; ; i++) {
    const framePath = findAsset(path.join(runningDir, String(i)));
    if (!framePath) break;
    runFrames.push({ src: fileToDataUri(framePath) });
  }
  if (runFrames.length) {
    poses.running = { fps: 6, frames: runFrames, calibration: null };
  }

  // lying: assets/breeds/<견종>/lying.svg|png (+ lying.json, 선택) - 엎드려 쉬는 정지 포즈 1장.
  // 일정 시간 동안 아무 상호작용 없으면 렌더러가 이 포즈로 바꿔요. 파일 없으면 조용히 건너뜀.
  const lyingPath = findAsset(path.join(dir, 'lying'));
  if (lyingPath) {
    poses.lying = {
      fps: null,
      frames: [{ src: fileToDataUri(lyingPath) }],
      calibration: loadCalibration(path.join(dir, 'lying.json')), // 없으면 null(눈 안 움직임) - 쉬는 자세라 자연스러움
    };
  }

  // touched: assets/breeds/<견종>/touched.svg|png - 커서가 얼굴/머리 위에 있을 때(쓰다듬는 상황)
  // 보여줄 정지 포즈 1장(만족스러운/애교 부리는 표정). lying처럼 한 장짜리 정지 포즈라 같은 방식으로
  // 읽어요. 파일 없으면 조용히 건너뜀 - 그러면 렌더러가 기존 earsback(있으면) 또는 idle로 대체해요.
  const touchedPath = findAsset(path.join(dir, 'touched'));
  if (touchedPath) {
    poses.touched = {
      fps: null,
      frames: [{ src: fileToDataUri(touchedPath) }],
      calibration: null,
    };
  }

  // typing: assets/breeds/<견종>/typing/1.svg|png, 2.svg|png... - 타이핑 감지되면 도는 반응용 프레임.
  // running과 같은 방식(있는 만큼 순서대로) - 귀 쫑긋/눈 커짐 같은 미묘한 변화용이라 idle과 같은 정면 구도 추천.
  const typingDir = path.join(dir, 'typing');
  const typingFrames = [];
  for (let i = 1; ; i++) {
    const framePath = findAsset(path.join(typingDir, String(i)));
    if (!framePath) break;
    typingFrames.push({ src: fileToDataUri(framePath) });
  }
  if (typingFrames.length) {
    poses.typing = { fps: 6, frames: typingFrames, calibration: null };
  }

  // eating: assets/breeds/<견종>/eating/1.svg|png, 2.svg|png... - 아직 어떤 상황에 보여줄지
  // 정해지지 않아서 렌더러에서는 안 쓰고 있어요. 그림만 미리 읽어둠.
  const eatingDir = path.join(dir, 'eating');
  const eatingFrames = [];
  for (let i = 1; ; i++) {
    const framePath = findAsset(path.join(eatingDir, String(i)));
    if (!framePath) break;
    eatingFrames.push({ src: fileToDataUri(framePath) });
  }
  if (eatingFrames.length) {
    poses.eating = { fps: 4, frames: eatingFrames, calibration: null };
  }

  // earsback: assets/breeds/<견종>/earsback/1.svg|png, 2... - 커서가 머리 위에서 왔다갔다할 때
  // (쓰다듬는 듯한 반응) 보여줄 프레임. 귀가 뒤로 넘어가는 짧은 동작. 다른 반응 포즈처럼 있는
  // 만큼 순서대로 읽어서 프레임 배열로 만들고 반복 재생해요.
  const earsbackDir = path.join(dir, 'earsback');
  const earsbackFrames = [];
  for (let i = 1; ; i++) {
    const framePath = findAsset(path.join(earsbackDir, String(i)));
    if (!framePath) break;
    earsbackFrames.push({ src: fileToDataUri(framePath) });
  }
  if (earsbackFrames.length) {
    poses.earsback = { fps: 6, frames: earsbackFrames, calibration: null };
  }

  // licking: assets/breeds/<견종>/licking/1.svg|png, 2... - 스크롤(마우스 휠)이 감지되면
  // 보여줄 프레임. 혀로 핥는 짧은 반복 동작.
  const lickingDir = path.join(dir, 'licking');
  const lickingFrames = [];
  for (let i = 1; ; i++) {
    const framePath = findAsset(path.join(lickingDir, String(i)));
    if (!framePath) break;
    lickingFrames.push({ src: fileToDataUri(framePath) });
  }
  if (lickingFrames.length) {
    poses.licking = { fps: 12, frames: lickingFrames, calibration: null }; // 조금 더 빠르게(기존 8 -> 12)
  }

  return poses;
}

function loadBreeds() {
  const breeds = {};
  for (const name of BREEDS) {
    const poses = loadBreedPoses(name);
    if (!poses.idle) continue; // idle이 없으면 아직 쓸 수 없는 견종
    breeds[name] = {
      defaultColor: DEFAULT_COLORS[name] || '#e8ddc8',
      poses,
    };
  }
  return breeds;
}

contextBridge.exposeInMainWorld('petAPI', {
  breeds: loadBreeds(),
  onFrame: (cb) => ipcRenderer.on('pet-frame', (evt, data) => cb(data)),
  onType: (cb) => ipcRenderer.on('type-pulse', (evt, data) => cb(data)),
  // 마우스 휠(스크롤) 신호 - 전역 후킹이라 이 앱에 포커스가 없어도 옴. 혀로 핥는(licking) 반응용.
  onScroll: (cb) => ipcRenderer.on('scroll-pulse', (evt, data) => cb(data)),
  // 커스텀 리마인더가 울릴 때(설정한 주기마다) - { text } 형태로 옴. 말풍선에 잠깐 띄우는 데 씀.
  onReminder: (cb) => ipcRenderer.on('reminder-fire', (evt, data) => cb(data)),
  // renderer.js가 시작할 때 호출하지만 메인 프로세스에는 아직 이 기능(뽀모도로)이 없어요 -
  // 비워두면 "window.petAPI.onPomodoro is not a function" 에러로 renderer.js의 나머지 시작
  // 코드가 안 돌 수 있어서, 안전하게 아무것도 안 하는 빈 채널을 하나 걸어둠.
  onPomodoro: (cb) => ipcRenderer.on('pomodoro-phase', (evt, data) => cb(data)),
  // 온보딩(트레이 메뉴 "견종/이름 설정 변경")에서 새로 고른 값이 왔을 때 renderer.js가
  // 페이지를 새로고침하지 않고 바로 반영할 수 있게 알려주는 채널. { breed, name } 형태.
  onSettingsUpdate: (cb) => ipcRenderer.on('settings-updated', (evt, data) => cb(data)),
  dragStart: (offset) => ipcRenderer.send('drag-start', offset),
  dragEnd: () => ipcRenderer.send('drag-end'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  // 캐릭터 우클릭 시 트레이 메뉴와 같은 메뉴를 띄워달라고 메인 프로세스에 요청.
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
});
