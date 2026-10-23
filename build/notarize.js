// build/notarize.js
//
// electron-builder의 afterSign 훅이에요 - 서명(codesign)까지 끝난 직후, 앱을 .dmg/.zip으로
// 묶기 전에 자동으로 실행돼요. 여기서 두 가지를 해요:
//
// 1) native/scrollwatch(Swift로 만든 전역 스크롤 감지 헬퍼)에 서명.
//    electron-builder는 앱 번들 안의 주요 실행파일/네이티브 모듈(.node)은 알아서 서명하지만,
//    extraResources로 끼워 넣은(package.json build.extraResources) scrollwatch처럼 "임의의
//    실행파일"까지는 자동으로 서명해주지 않아요. 서명 안 된 실행파일이 번들 안에 하나라도
//    있으면 공증(notarization) 심사에서 바로 거부돼요 - 그래서 여기서 수동으로 서명해줌.
//
// 2) Apple 공증 서버에 앱을 올려서 공증받기(@electron/notarize).
//    환경변수(APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID)가 없으면 - 아직
//    Apple Developer Program 가입 전이거나 테스트 빌드일 수 있으니 - 에러로 멈추지 않고
//    "공증 건너뜀" 안내만 남기고 넘어가요(로컬에서 서명 없이 빌드만 확인하고 싶을 때도 있어서).
//
// 필요한 사전 준비(전부 사용자가 터미널에서 한 번 해야 함 - 여기선 할 수 없음):
//   - Apple Developer Program 가입(연 $99) 후 developer.apple.com에서 "Developer ID Application"
//     인증서를 만들어서 이 Mac의 키체인(Keychain)에 설치해둬야 함(Xcode로 로그인하면 자동으로
//     만들어주는 게 제일 쉬움: Xcode -> Settings -> Accounts -> Apple ID 추가 -> Manage
//     Certificates -> "+" -> Developer ID Application).
//   - appleid.apple.com에서 "앱 암호(App-Specific Password)" 하나 발급(2단계 인증 필요).
//   - 터미널에서 빌드하기 전에 아래 환경변수를 설정:
//       export APPLE_ID="본인 Apple ID 이메일"
//       export APPLE_APP_SPECIFIC_PASSWORD="위에서 발급받은 앱 암호(xxxx-xxxx-xxxx-xxxx 형태)"
//       export APPLE_TEAM_ID="Apple Developer 계정의 Team ID(developer.apple.com -> Membership에서 확인)"
//       export CSC_NAME="Developer ID Application: 이름 (TEAMID)"   # 키체인에 설치된 인증서 이름 그대로
//   - 그 다음: npm run dist

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return; // mac 전용 처리

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  // ---- 1) scrollwatch 바이너리 서명 ----
  // (2026-10-23 수정) scrollwatch는 이제 extraResources가 아니라 asarUnpack으로 빼내고 있어서
  // (package.json build.asarUnpack, main.js의 getScrollwatchHelperPath() 참고) 실제 경로가
  // Resources/native/scrollwatch가 아니라 Resources/app.asar.unpacked/native/scrollwatch예요.
  const scrollwatchPath = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'native', 'scrollwatch');
  if (fs.existsSync(scrollwatchPath)) {
    const identity = process.env.CSC_NAME;
    if (!identity) {
      console.log('[notarize] CSC_NAME 환경변수가 없어서 scrollwatch 바이너리를 서명 못 했어요 - ' +
        '공증은 실패할 거예요(서명 안 된 실행파일이 번들에 남아있으면 안 됨). ' +
        'CSC_NAME="Developer ID Application: 이름 (TEAMID)" 형태로 설정 후 다시 빌드해주세요.');
    } else {
      console.log(`[notarize] scrollwatch 바이너리 서명 중... (identity: ${identity})`);
      execFileSync('codesign', [
        '--force',
        '--options', 'runtime', // hardened runtime - 공증 필수 조건
        '--entitlements', path.join(__dirname, 'entitlements.mac.plist'),
        '--sign', identity,
        scrollwatchPath,
      ], { stdio: 'inherit' });
      console.log('[notarize] scrollwatch 서명 완료');
    }
  } else {
    console.log('[notarize] native/scrollwatch 바이너리가 빌드 결과물에 없음 - ' +
      '빌드 전에 swiftc로 먼저 컴파일했는지 확인해주세요(native/scrollwatch.swift 참고).');
  }

  // ---- 2) 공증(notarize) ----
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 환경변수가 ' +
      '없어서 공증을 건너뜀 - 로컬 테스트 빌드면 괜찮지만, 실제로 판매/배포할 땐 이 세 개를 ' +
      '설정하고 다시 빌드해야 받는 사람들이 보안 경고 없이 실행할 수 있어요.');
    return;
  }

  console.log('[notarize] Apple 공증 서버에 업로드 중... (몇 분~십몇 분 걸릴 수 있어요)');
  const { notarize } = require('@electron/notarize');
  await notarize({
    appBundleId: 'com.pawffice.app', // package.json build.appId와 동일하게 유지해야 함
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log('[notarize] 공증 완료!');
};
