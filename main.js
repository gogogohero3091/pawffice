const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadSettings, saveSettings } = require('./settings');
const { activateLicense, validateStoredLicense } = require('./license');

// (2026-10-23 추가) 구매 페이지 주소 - Lemon Squeezy에서 상품/라이선스 키 기능 설정 끝나면
// 실제 체크아웃 링크로 바꿔주세요 (예: https://pawffice.lemonsqueezy.com/buy/xxxxxxxx-xxxx-...).
const PURCHASE_URL = 'https://pawffice.lemonsqueezy.com';

// ---- 자동 업데이트 (electron-updater, GitHub Releases 기반) ----
// package.json build.publish에 설정된 GitHub 저장소(gogogohero3091/pawffice)의 최신 릴리즈를
// 확인해서, 새 버전 있으면 자동으로 받아뒀다가 사용자가 앱을 재시작할 때(또는 "지금 재시작" 눌렀을
// 때) 설치해요. 개발 모드(npm start)에서는 업데이트 서버 자체가 없어서 그냥 건너뜀.
let autoUpdater = null;
if (app.isPackaged) {
  try {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  } catch (e) {
    console.log('[mypet] electron-updater 로드 실패(무시 가능):', e.message);
  }
}

function setupAutoUpdate() {
  if (!autoUpdater) return;

  autoUpdater.on('error', (err) => {
    console.log('[mypet] 업데이트 확인 실패(무시 가능 - 네트워크 없거나 릴리즈 없음):', err.message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    const { dialog } = require('electron');
    dialog.showMessageBox({
      type: 'info',
      title: 'Pawffice 업데이트',
      message: `새 버전(${info.version})이 준비됐어요. 지금 재시작해서 적용할까요?`,
      buttons: ['지금 재시작', '나중에(다음 실행 때 자동 적용)'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.checkForUpdates().catch((e) => {
    console.log('[mypet] checkForUpdates 실패(무시 가능):', e.message);
  });
}


const WIN_WIDTH = 260;  // 캐릭터 + 여백(스트레치용) 가로 크기 - renderer.js 캔버스 width(260), CX(130)와 맞춰야 함
const WIN_HEIGHT = 370; // 세로는 정사각형이 아니라, 캐릭터 위쪽 말풍선 자리 + 아래쪽 이름표 자리까지
                         // 포함한 크기예요 - renderer.js 캔버스 height(370), CY(210)와 맞춰야 함
                         // (말풍선/이름표가 창 밖으로 잘리지 않게 하려고 정사각형보다 늘렸어요).
const CHAR_CY = 210;     // 캐릭터 화면상 세로 중심(창 top 기준 오프셋) - renderer.js의 CY와 같은 값.
                         // 눈 추적(커서 방향 계산)에서 창 중심이 아니라 캐릭터 실제 중심을 기준으로 쓰려고 필요.

let win = null;
let licenseWin = null;
let onboardingWin = null;
let reviewWin = null;
let featureWin = null;
let sizeWin = null;
let messageWin = null;
let reminderWin = null;
let tray = null;

// (2026-10-23 추가) 캐릭터 크기 배율 - settings.sizeScale(기본 1.0, 0.5~1.3)을 창 생성 때
// 반영해두고, tick()에서 CHAR_CY 계산할 때도 이 배율을 같이 곱해줘야 눈 추적이 안 어긋나요.
let currentScale = 1.0;

// 드래그 상태
let dragging = false;
let dragOffset = { x: 0, y: 0 };
let currentPos = { x: 0, y: 0 }; // float, 실제 창 위치(부드럽게 따라감)
let targetPos = { x: 0, y: 0 };  // 커서가 있는 "목표" 위치

// 무활동(idle) 감지 - 마우스가 안 움직이고, 드래그도 없고, 타이핑도 없으면 이 시각이 계속 과거로 남아요.
// 렌더러가 (지금 시각 - lastActivityTime)이 일정 시간 넘으면 "엎드리기" 자세로 바꿔요.
// (키보드 활동은 setupTypingHook 안에서 이 값을 직접 갱신합니다.)
let lastActivityTime = Date.now();
let lastCursorForActivity = null;

// 커스텀 리마인더 - 사용자가 정한 주기(분)마다 정한 문구를 화면에 잠깐 띄워줘요.
// settings.reminder = { enabled, intervalMin, text } - scheduleReminder()가 이 값을 보고
// setInterval을 (다시) 잡아요(리마인더 설정을 바꿀 때마다 다시 호출).
let reminderTimer = null;

// settings: { breed, name } - 온보딩(또는 저장돼 있던 값)에서 정해진 견종/이름.
// 렌더러가 페이지를 그리기 시작할 때부터 바로 알 수 있게 loadFile의 query로 넘겨요
// (IPC 왕복을 기다리지 않아도 돼서, 처음에 엉뚱한 견종이 잠깐 보였다 바뀌는 깜빡임이 없어요).
function createWindow(settings) {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;

  const scale = (settings && settings.sizeScale) || 1.0;
  currentScale = scale;
  const winW = Math.round(WIN_WIDTH * scale);
  const winH = Math.round(WIN_HEIGHT * scale);

  const startX = Math.round(width - winW - 40);
  const startY = Math.round(height - winH - 40);

  win = new BrowserWindow({
    width: winW,
    height: winH,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 최신 Electron은 기본값이 sandbox:true라서 preload 스크립트 안에서 require('fs') 같은
      // Node 내장 모듈을 못 써요 ("module not found: fs" 에러가 이거였어요). preload.js는
      // 그림/캘리브레이션 파일을 직접 읽어야 해서 sandbox를 꺼야 해요 - contextIsolation은
      // 그대로 켜져 있어서 렌더러(페이지) 쪽은 여전히 격리돼 있어요.
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html', {
    query: {
      breed: settings.breed || '',
      name: settings.name || '',
      message: settings.message || '',
    },
  });
  // 캔버스/렌더링 코드는 그대로 두고, 전체 페이지를 Electron의 줌 기능으로 배율만큼
  // 확대/축소해요 - renderer.js의 좌표 계산을 하나도 안 건드려도 되는 제일 간단한 방법.
  win.webContents.setZoomFactor(scale);

  currentPos = { x: startX, y: startY };
  targetPos = { x: startX, y: startY };

  win.on('closed', () => {
    win = null;
  });
}

// 라이선스 입력창 - 유효한 라이선스가 없을 때(처음 실행, 환불/만료 등) 이게 대신 뜨고,
// 평소 펫 창/온보딩 창은 안 뜸. 활성화 성공하면 이 창이 스스로 닫히고 proceedAfterLicense()로 이어짐.
function createLicenseWindow() {
  if (licenseWin && !licenseWin.isDestroyed()) {
    licenseWin.focus();
    return;
  }
  licenseWin = new BrowserWindow({
    width: 380,
    height: 360,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: 'Pawffice 라이선스',
    webPreferences: {
      preload: path.join(__dirname, 'license-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  licenseWin.setMenuBarVisibility(false);
  licenseWin.loadFile('license.html');
  licenseWin.on('closed', () => {
    licenseWin = null;
  });
}

// 라이선스 확인이 끝난 뒤(또는 이미 유효했을 때) 실제로 펫을 띄우고 모든 백그라운드 기능을 켬.
// app.whenReady()와 라이선스 창의 활성화 성공 콜백, 두 군데서 공통으로 호출돼요.
function proceedAfterLicense() {
  const settings = loadSettings();
  if (settings && settings.breed) {
    createWindow(settings);
  } else {
    createOnboardingWindow(); // 처음 실행 - 견종/이름부터 고르게 함
  }
  setInterval(tick, 16);
  setupTypingHook();
  setupScrollHelper();
  scheduleReminder();
  setupAutoUpdate();
}

// 온보딩(견종/이름 고르기) 창 - 처음 실행이거나, 트레이 메뉴로 "설정 변경"을 눌렀을 때 뜸.
// 이미 열려있으면 새로 만들지 않고 포커스만 줌.
function createOnboardingWindow() {
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.focus();
    return;
  }
  onboardingWin = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: '내 반려동물 설정',
    webPreferences: {
      preload: path.join(__dirname, 'onboarding-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  onboardingWin.setMenuBarVisibility(false);
  onboardingWin.loadFile('onboarding.html');
  onboardingWin.on('closed', () => {
    onboardingWin = null;
  });
}

// 고정 메시지 입력창 - 트레이 메뉴에서 아무 때나 열어서 캐릭터 머리 위 말풍선 문구를 바꿀 수 있음.
function createMessageWindow() {
  if (messageWin && !messageWin.isDestroyed()) {
    messageWin.focus();
    return;
  }
  messageWin = new BrowserWindow({
    width: 380,
    height: 350,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: '고정 메시지',
    webPreferences: {
      preload: path.join(__dirname, 'message-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  messageWin.setMenuBarVisibility(false);
  messageWin.loadFile('message.html');
  messageWin.on('closed', () => {
    messageWin = null;
  });
}

// 커스텀 리마인더 설정창 - 트레이 메뉴에서 열어서 몇 분마다 어떤 문구로 알려줄지 정함.
function createReminderWindow() {
  if (reminderWin && !reminderWin.isDestroyed()) {
    reminderWin.focus();
    return;
  }
  reminderWin = new BrowserWindow({
    width: 380,
    height: 520,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: '커스텀 리마인더',
    webPreferences: {
      preload: path.join(__dirname, 'reminder-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  reminderWin.setMenuBarVisibility(false);
  reminderWin.loadFile('reminder.html');
  reminderWin.on('closed', () => {
    reminderWin = null;
  });
}

// settings.reminder를 보고 반복 알림 타이머를 (다시) 잡아요. 꺼져있거나(enabled:false) 문구가
// 비어있으면 아무것도 안 함. 설정을 바꿀 때마다(reminder-submit) 새로 호출해서 기존 타이머를 교체해요.
function scheduleReminder() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
  const reminder = (loadSettings() || {}).reminder;
  if (!reminder || !reminder.enabled || !reminder.text) return;
  const intervalMs = Math.max(1, reminder.intervalMin || 60) * 60 * 1000;
  reminderTimer = setInterval(() => {
    const cur = (loadSettings() || {}).reminder;
    if (!cur || !cur.enabled || !cur.text) return;
    if (win && !win.isDestroyed()) {
      win.webContents.send('reminder-fire', { text: cur.text });
    }
    try {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        new Notification({ title: '🐾 리마인더', body: cur.text }).show();
      }
    } catch (e) {
      // 알림 실패는 조용히 무시(캐릭터 위 말풍선으로는 어차피 표시됨)
    }
  }, intervalMs);
}

// 트레이(메뉴바) - 설정 변경 + 고정 메시지 + 커스텀 리마인더 + 종료. 앱이 뜰 때(온보딩이든 캐릭터든) 한 번만 만들면 돼요.
// 후기 입력창 - 트레이 메뉴에서 열어서 자유 텍스트 후기를 보냄(개발자 이메일로 전달).
function createReviewWindow() {
  if (reviewWin && !reviewWin.isDestroyed()) {
    reviewWin.focus();
    return;
  }
  reviewWin = new BrowserWindow({
    width: 380,
    height: 320,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: '후기 보내기',
    webPreferences: {
      preload: path.join(__dirname, 'review-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  reviewWin.setMenuBarVisibility(false);
  reviewWin.loadFile('review.html');
  reviewWin.on('closed', () => {
    reviewWin = null;
  });
}

// 기능 제안 입력창 - 이메일(선택) + 자유 텍스트 제안을 개발자 이메일로 전달.
function createFeatureWindow() {
  if (featureWin && !featureWin.isDestroyed()) {
    featureWin.focus();
    return;
  }
  featureWin = new BrowserWindow({
    width: 380,
    height: 360,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: '기능 제안하기',
    webPreferences: {
      preload: path.join(__dirname, 'feature-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  featureWin.setMenuBarVisibility(false);
  featureWin.loadFile('feature.html');
  featureWin.on('closed', () => {
    featureWin = null;
  });
}

// 캐릭터 크기 조정 창 - 슬라이더로 0.5~1.3배 사이에서 고르고 저장하면 바로 적용됨.
function createSizeWindow() {
  if (sizeWin && !sizeWin.isDestroyed()) {
    sizeWin.focus();
    return;
  }
  sizeWin = new BrowserWindow({
    width: 360,
    height: 290,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    title: '캐릭터 크기 조정',
    webPreferences: {
      preload: path.join(__dirname, 'size-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  sizeWin.setMenuBarVisibility(false);
  sizeWin.loadFile('size.html');
  sizeWin.on('closed', () => {
    sizeWin = null;
  });
}

function ensureTray() {
  if (tray) return;
  try {
    tray = new Tray(nativeImage.createEmpty());
    if (process.platform === 'darwin') tray.setTitle('🐾');
    tray.setToolTip('내 반려동물');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '견종/이름 설정 변경', click: () => createOnboardingWindow() },
        { label: '고정 메시지 설정', click: () => createMessageWindow() },
        { label: '커스텀 리마인더 설정', click: () => createReminderWindow() },
        { label: '캐릭터 크기 조정', click: () => createSizeWindow() },
        { type: 'separator' },
        { label: '후기 보내기', click: () => createReviewWindow() },
        { label: '기능 제안하기', click: () => createFeatureWindow() },
        { type: 'separator' },
        { label: '업데이트 확인', click: () => setupAutoUpdate() },
        { label: '라이선스 정보', click: () => createLicenseWindow() },
        { type: 'separator' },
        { label: '종료', click: () => app.quit() },
      ])
    );
  } catch (e) {
    console.log('[mypet] 트레이 생성 실패(무시 가능):', e.message);
  }
}

// ---- 커서 폴링 + 드래그 물리 루프 (60fps) ----
function tick() {
  if (!win || win.isDestroyed()) return;

  // (2026-10-22 추가) 빠르게 왔다갔다 드래그하면 가끔 win.setPosition에 NaN이 들어가서
  // "Error processing argument at index 0, conversion failure" 네이티브 에러로 앱이 통째로
  // 죽는 버그가 있었어요(정확한 발생 조건은 재현이 어려웠지만, 커서/오프셋 계산이 아주 드물게
  // 순간적으로 비정상값이 되는 것으로 보임). try/catch로 한 프레임 전체를 감싸서, 어떤 값이
  // 깨지더라도 그 프레임만 건너뛰고 다음 16ms 틱에서 정상적으로 이어지게 했어요(앱이 죽지 않음).
  try {
    const cursor = screen.getCursorScreenPoint();
    if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return; // 커서 좌표를 못 읽어온 드문 프레임은 건너뜀

    const bounds = win.getBounds();
    const centerX = bounds.x + bounds.width / 2;
    // 창 세로 중앙이 아니라 캐릭터가 실제로 그려지는 위치(CHAR_CY) 기준으로 잡아야, 창 위쪽(말풍선
    // 자리)/아래쪽(이름표 자리) 여백 때문에 눈이 커서를 쫓는 방향이 실제 캐릭터 눈 위치와 안 어긋나요.
    const centerY = bounds.y + CHAR_CY * currentScale;

    // 무활동 감지: 커서가 (트랙패드 미세 떨림 이상으로) 움직였거나 드래그 중이면 "활동 중"으로 침
    if (lastCursorForActivity) {
      const moved = Math.hypot(cursor.x - lastCursorForActivity.x, cursor.y - lastCursorForActivity.y);
      if (moved > 3 || dragging) lastActivityTime = Date.now();
    }
    lastCursorForActivity = { x: cursor.x, y: cursor.y };

    // 1) 눈 추적: 창 중심 -> 커서 방향 (정규화, 클램프)
    let dx = cursor.x - centerX;
    let dy = cursor.y - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const maxRange = 400; // 이 거리 이상이면 최대치로 고정
    const norm = Math.min(dist, maxRange) / maxRange;
    const eyeX = (dx / dist) * norm;
    const eyeY = (dy / dist) * norm;

    // 2) 드래그 물리: 목표 위치로 부드럽게(램핑) 이동 -> 그 차이가 "당겨짐(스트레치)"
    // dragOffset이 (드물게) 숫자가 아니면 이번 프레임은 targetPos 갱신을 건너뛰어요 - 아래에서
    // 어차피 NaN 가드가 한 번 더 걸리긴 하지만, 애초에 안 좋은 값을 안 흘려보내는 게 안전해요.
    if (dragging && dragOffset && Number.isFinite(dragOffset.x) && Number.isFinite(dragOffset.y)) {
      targetPos = { x: cursor.x - dragOffset.x, y: cursor.y - dragOffset.y };
    }
    const lerp = dragging ? 0.28 : 0.18; // 드래그 중엔 더 탱탱하게 따라옴
    currentPos.x += (targetPos.x - currentPos.x) * lerp;
    currentPos.y += (targetPos.y - currentPos.y) * lerp;

    if (!dragging) {
      // 놓았을 때는 목표=현재위치로 서서히 수렴시켜 완전히 멈추게 함
      targetPos.x += (currentPos.x - targetPos.x) * 0.4;
      targetPos.y += (currentPos.y - targetPos.y) * 0.4;
    }

    // currentPos/targetPos가 어떤 이유로든 NaN/Infinity가 됐으면(바로 위 버그 설명 참고)
    // win.setPosition에 그대로 넘기지 않고, 지금 실제 창 위치(bounds)로 리셋해서 복구해요.
    if (!Number.isFinite(currentPos.x) || !Number.isFinite(currentPos.y)) {
      console.log('[mypet] currentPos가 비정상값이 돼서 창 위치로 복구함:', currentPos);
      currentPos = { x: bounds.x, y: bounds.y };
      targetPos = { x: bounds.x, y: bounds.y };
      return;
    }

    const stretchX = targetPos.x - currentPos.x;
    const stretchY = targetPos.y - currentPos.y;

    win.setPosition(Math.round(currentPos.x), Math.round(currentPos.y));

    // 3) 좌우 반전: 창이 "지금 놓인 화면"의 중앙보다 오른쪽에 있으면 캐릭터가 화면 안쪽(왼쪽)을
    // 보도록 반전. screen.getDisplayMatching으로 실제 놓인 모니터를 찾아서 그 모니터 기준 중앙과
    // 비교해요(멀티 모니터에서 두 번째 모니터에 있어도 정확하게 동작하도록).
    const display = screen.getDisplayMatching(bounds);
    const screenCenterX = display.bounds.x + display.bounds.width / 2;
    const flip = centerX > screenCenterX;

    win.webContents.send('pet-frame', {
      eye: { x: eyeX, y: eyeY },
      stretch: { x: stretchX, y: stretchY },
      dragging,
      idleMs: Date.now() - lastActivityTime,
      flip,
    });
  } catch (e) {
    console.log('[mypet] tick() 중 에러(이 프레임만 건너뛰고 계속 동작함):', e && e.message);
  }
}

// ---- IPC: 렌더러 <-> 메인 ----
// 국가 코드 추정 - IP 기반 조회 서버 없이, OS/Electron에 이미 설정된 지역 정보로 대충 유추.
// 후기를 나중에 랜딩페이지에 보여줄 때 "어느 나라에서" 정도의 참고용이라 정확도가 중요하진 않음.
function detectCountry() {
  try {
    if (typeof app.getLocaleCountryCode === 'function') {
      const c = app.getLocaleCountryCode();
      if (c) return c;
    }
  } catch (e) {
    // 무시 - 아래 폴백으로
  }
  try {
    const locale = app.getLocale(); // 예: "ko-KR"
    const parts = locale.split('-');
    if (parts.length > 1) return parts[1].toUpperCase();
  } catch (e) {
    // 무시
  }
  return '';
}

// FormSubmit.co의 ajax 엔드포인트로 JSON 전송 - 웹사이트(pawffice-site)에서 쓰는 것과 같은
// 무료/가입불필요 서비스라서 별도 백엔드 없이 바로 이메일로 옴.
async function sendToFormSubmit(subject, fields) {
  try {
    const res = await fetch('https://formsubmit.co/ajax/gogogohero3091@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.assign({ _subject: subject, _template: 'table' }, fields)),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('review-submit', async (evt, text) => {
  const clean = (text || '').trim().slice(0, 2000);
  if (!clean) return { ok: false, error: '후기 내용을 입력해줘.' };
  const settings = loadSettings() || {};
  const result = await sendToFormSubmit('Pawffice 후기', {
    review: clean,
    country: detectCountry(),
    breed: settings.breed || '',
    pet_name: settings.name || '',
  });
  if (!result.ok) return { ok: false, error: '전송에 실패했어. 인터넷 연결을 확인해줘.' };
  return { ok: true };
});

ipcMain.handle('feature-submit', async (evt, payload) => {
  const text = ((payload && payload.text) || '').trim().slice(0, 2000);
  const email = ((payload && payload.email) || '').trim().slice(0, 200);
  if (!text) return { ok: false, error: '제안 내용을 입력해줘.' };
  const result = await sendToFormSubmit('Pawffice 기능 제안', {
    suggestion: text,
    email: email || '(비공개)',
  });
  if (!result.ok) return { ok: false, error: '전송에 실패했어. 인터넷 연결을 확인해줘.' };
  return { ok: true };
});

ipcMain.on('get-current-size', (evt) => {
  const settings = loadSettings() || {};
  evt.returnValue = settings.sizeScale || 1.0;
});

ipcMain.on('size-submit', (evt, scale) => {
  const clamped = Math.min(1.3, Math.max(0.5, Number(scale) || 1.0));
  const settings = Object.assign({}, loadSettings() || {}, { sizeScale: clamped });
  saveSettings(settings);

  if (sizeWin && !sizeWin.isDestroyed()) {
    sizeWin.close();
  }

  // 이미 캐릭터 창이 떠 있으면 다시 켤 필요 없이 그 자리에서 바로 크기만 바꿔줌.
  if (win && !win.isDestroyed()) {
    currentScale = clamped;
    const winW = Math.round(WIN_WIDTH * clamped);
    const winH = Math.round(WIN_HEIGHT * clamped);
    win.setSize(winW, winH);
    win.webContents.setZoomFactor(clamped);
  }
});

ipcMain.handle('license-activate', async (evt, key) => {
  const result = await activateLicense(key);
  if (result.ok) {
    if (licenseWin && !licenseWin.isDestroyed()) licenseWin.close();
    proceedAfterLicense();
  }
  return result;
});

ipcMain.on('license-open-purchase', () => {
  shell.openExternal(PURCHASE_URL);
});

ipcMain.on('drag-start', (evt, offset) => {
  dragging = true;
  // offset(e.clientX/Y)은 렌더러의 CSS 좌표계(WIN_WIDTH/HEIGHT 기준, setZoomFactor로 확대/축소된
  // 뒤에도 안 바뀜 - renderer.js의 CX/CY 계산이 배율 상관없이 그대로 동작하게 하려고 일부러 그렇게
  // 함)인데, 아래 tick()에서는 screen.getCursorScreenPoint()가 주는 실제 화면(물리) 픽셀과
  // 같은 단위로 빼야 해요. 창을 축소(currentScale<1)했을 때 물리 크기는 CSS 크기보다 작으니까,
  // 여기서 실제 화면 픽셀 단위로 환산(곱하기 currentScale)해둬야 드래그 시작점이 클릭한 위치랑
  // 어긋나서 창이 우상단 등 엉뚱한 곳으로 튀는 문제가 안 생겨요.
  dragOffset = { x: offset.x * currentScale, y: offset.y * currentScale };
  const bounds = win.getBounds();
  currentPos = { x: bounds.x, y: bounds.y };
  targetPos = { x: bounds.x, y: bounds.y };
});

ipcMain.on('drag-end', () => {
  dragging = false;
});

ipcMain.on('set-ignore-mouse', (evt, ignore) => {
  if (!win) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
});

// ---- IPC: 온보딩 창 <-> 메인 ----
// 온보딩 창이 뜰 때 "기존에 골라둔 값이 있으면 미리 채워주기" 용도 - 동기로 바로 받아야
// 화면이 깜빡이지 않아서 sendSync로 처리.
ipcMain.on('get-current-settings', (evt) => {
  evt.returnValue = loadSettings() || {};
});

ipcMain.on('onboarding-submit', (evt, data) => {
  // 기존 설정(특히 고정 메시지)을 덮어쓰지 않게 불러온 값 위에 breed/name만 갱신해요.
  const settings = Object.assign({}, loadSettings() || {}, {
    breed: data.breed,
    name: (data.name || '').slice(0, 20),
  });
  saveSettings(settings);

  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.close();
  }

  if (win && !win.isDestroyed()) {
    // 이미 캐릭터 창이 떠 있으면(설정 나중에 바꾼 경우) - 새로고침 없이 바로 반영.
    // 견종 그림들은 preload가 시작할 때 이미 다 읽어놨어서(모든 견종을 한 번에 로드) 즉시 전환돼요.
    win.webContents.send('settings-updated', settings);
  } else {
    createWindow(settings);
  }
  ensureTray();
});

// ---- IPC: 고정 메시지 창 <-> 메인 ----
ipcMain.on('get-current-message', (evt) => {
  evt.returnValue = (loadSettings() || {}).message || '';
});

ipcMain.on('message-submit', (evt, text) => {
  const settings = Object.assign({}, loadSettings() || {}, {
    message: (text || '').slice(0, 40),
  });
  saveSettings(settings);

  if (messageWin && !messageWin.isDestroyed()) {
    messageWin.close();
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send('settings-updated', { message: settings.message });
  }
});

// ---- IPC: 커스텀 리마인더 설정창 <-> 메인 ----
ipcMain.on('get-current-reminder', (evt) => {
  evt.returnValue = (loadSettings() || {}).reminder || { enabled: false, intervalMin: 60, text: '' };
});

ipcMain.on('reminder-submit', (evt, data) => {
  const prevReminder = (loadSettings() || {}).reminder || {};
  const reminder = Object.assign({}, prevReminder, data);
  const settings = Object.assign({}, loadSettings() || {}, { reminder });
  saveSettings(settings);
  scheduleReminder();

  if (reminderWin && !reminderWin.isDestroyed()) {
    reminderWin.close();
  }
});

app.whenReady().then(async () => {
  ensureTray(); // 트레이는 라이선스 통과 전에도 떠 있어야 "구매/라이선스" 접근이 가능함
  if (!app.isPackaged) {
    // 개발 중(npm start / electron .)에는 라이선스 체크를 건너뜀 - 실제 구매자는 패키징된
    // dmg/zip 빌드만 실행하므로 여기 해당 안 됨. 패키징된 빌드는 항상 아래 else 분기로 감.
    console.log('[mypet] 개발 모드 - 라이선스 체크 생략');
    proceedAfterLicense();
    return;
  }
  const licenseResult = await validateStoredLicense();
  if (licenseResult.ok) {
    proceedAfterLicense();
  } else {
    createLicenseWindow();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

// ---- 타이핑/스크롤 반응(전역 키보드+마우스휠 후킹) ----
// 이 앱 창에 포커스가 없어도(다른 앱에서 타이핑/스크롤해도) 반응하게 하려고 OS 전역 후킹을 써요.
function setupTypingHook() {
  let uIOhook;
  try {
    ({ uIOhook } = require('uiohook-napi'));
  } catch (e) {
    console.log('[mypet] uiohook-napi 로드 실패 - 타이핑/스크롤 반응 비활성화:', e.message);
    return;
  }

  // 키 누를 때마다 렌더러로 신호만 보냄 (렌더러가 마지막 신호 시각 기준으로 타이핑 포즈 유지/해제를
  // 직접 판단해요 - 여기서 속도를 서서히 식히지 않으니, 타이핑을 멈추면 거의 바로 원래대로 돌아옵니다.)
  try {
    uIOhook.on('keydown', () => {
      const now = Date.now();
      lastActivityTime = now; // 타이핑도 활동으로 침 (엎드리기 방지)

      if (win && !win.isDestroyed()) {
        win.webContents.send('type-pulse', {});
      }
    });

    // 마우스 휠(스크롤)도 같은 방식으로 신호만 보냄 - 혀로 핥는 반응(licking)용. 키보드처럼
    // 이 앱에 포커스가 없어도(다른 창에서 스크롤해도) 반응해요.
    uIOhook.on('wheel', () => {
      lastActivityTime = Date.now(); // 스크롤도 활동으로 침 (엎드리기 방지)

      if (win && !win.isDestroyed()) {
        win.webContents.send('scroll-pulse', {});
      }
    });

    uIOhook.start();
    console.log('[mypet] 전역 키보드/휠 후킹 시작됨');
  } catch (e) {
    console.log('[mypet] uiohook 시작 실패(권한 필요할 수 있음):', e.message);
  }
}

// ---- 스크롤(마우스 휠) 전역 감지 보조: macOS 네이티브 헬퍼 ----
// uiohook-napi가 이 환경에서는 키보드(keydown)는 잡으면서 휠(wheel)만 전혀 못 잡는 문제가
// 있어서(권한도 다 켜져 있고 라이브러리도 최신인데 안 됨 - 라이브러리의 macOS 쪽 버그로 보임),
// macOS가 직접 제공하는 NSEvent 전역 모니터링을 쓰는 작은 Swift 헬퍼(native/scrollwatch)를
// 따로 실행해서 그 출력(줄마다 "scroll")으로 스크롤을 감지해요. 헬퍼가 아직 빌드 안 돼 있으면
// (native/scrollwatch.swift만 있고 컴파일된 바이너리가 없으면) 조용히 건너뛰어요 - 빌드 방법은
// native/scrollwatch.swift 맨 위 주석 참고(터미널에서 swiftc 한 번).
// (2026-10-23 복원) 패키징된 앱에서는 __dirname이 app.asar 내부를 가리키는데, 실행 파일(바이너리)은
// asar 안에서 직접 spawn할 수 없어서(가상 아카이브라 실제 디스크 경로가 아님) - electron-builder의
// asarUnpack 설정으로 "app.asar.unpacked/native/scrollwatch"에 압축 안 풀린 실제 파일로 따로
// 빠져나가 있어요. 개발 모드(app.isPackaged=false)에서는 예전처럼 __dirname 기준 그대로 찾아요.
function getScrollwatchHelperPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'native', 'scrollwatch');
  }
  return path.join(__dirname, 'native', 'scrollwatch');
}

function setupScrollHelper() {
  if (process.platform !== 'darwin') return;

  const helperPath = getScrollwatchHelperPath();
  if (!fs.existsSync(helperPath)) {
    console.log('[mypet] native/scrollwatch 바이너리가 없음 - swiftc로 빌드 전까지 스크롤 전역 감지는 비활성화(터미널: swiftc -O native/scrollwatch.swift -o native/scrollwatch)');
    return;
  }

  try {
    const { spawn } = require('child_process');
    const child = spawn(helperPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });

    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line === 'scroll') {
          lastActivityTime = Date.now(); // 스크롤도 활동으로 침 (엎드리기 방지)
          if (win && !win.isDestroyed()) {
            win.webContents.send('scroll-pulse', {});
          }
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      console.log('[mypet] scrollwatch stderr:', chunk.toString('utf8').trim());
    });
    child.on('error', (e) => {
      console.log('[mypet] scrollwatch 실행 실패:', e.message);
    });
    child.on('exit', (code, signal) => {
      console.log(`[mypet] scrollwatch 종료됨 (code=${code}, signal=${signal})`);
    });
    app.on('before-quit', () => {
      try { child.kill(); } catch (e) { /* 이미 죽었으면 무시 */ }
    });

    console.log('[mypet] scrollwatch 헬퍼 시작됨(처음 실행이면 macOS가 "손쉬운 사용" 권한을 따로 물어볼 수 있어요)');
  } catch (e) {
    console.log('[mypet] scrollwatch 시작 실패:', e.message);
  }
}
