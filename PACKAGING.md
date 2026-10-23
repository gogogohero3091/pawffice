# 판매용 배포(패키징/서명/공증) 가이드

mypet-desktop을 앱스토어가 아니라 직접(내 웹사이트에서 다운로드+결제) 파는 걸로 결정했어요.
앱스토어는 샌드박스 때문에 지금 핵심 기능(전역 키보드/스크롤 감지)이 아예 막혀서 못 씀.

## 이미 해둔 것 (코드/설정 쪽)

- `electron-builder`, `@electron/notarize` 설치함(devDependencies).
- `package.json`에 `build` 설정 추가:
  - `appId: "com.mypetdesktop.app"`, `productName: "MyPet"` - 둘 다 임시값이에요, 실제 상품명/도메인 정하면 바꿔주세요.
  - mac 타겟: `.dmg` + `.zip` 둘 다 생성.
  - `hardenedRuntime: true` + `build/entitlements.mac.plist` - 공증받으려면 필수.
  - `LSUIElement: true` - Dock에 아이콘 안 뜨고 트레이(메뉴바)만 쓰는 앱이라서 설정함(지금 개발 모드에선 Dock에 떴었는데, 패키징된 앱부터는 안 뜸).
  - `sharp`는 `dependencies`에서 `devDependencies`로 옮김 - 에셋 생성용 개발 스크립트(generate-character.js 등)에서만 쓰고 앱 자체는 안 써서, 판매용 빌드 용량만 줄이고 뺐어요.
- `main.js`: `native/scrollwatch` 경로를 패키징된 앱 기준(`process.resourcesPath`)으로도 찾을 수 있게 수정함(안 그러면 프로그램이 asar 안에 갇혀서 실행 자체가 안 됨).
- `build/entitlements.mac.plist`: hardened runtime에서 Electron(JIT)이랑 네이티브 모듈(uiohook-napi)이 돌아가는 데 필요한 예외 권한들.
- `build/notarize.js`: 빌드 마지막 단계(afterSign)에서 자동으로 (1) `native/scrollwatch` 바이너리 서명 (2) 앱 전체를 Apple 공증 서버에 올림. 필요한 환경변수가 없으면 에러 내지 않고 "건너뜀" 안내만 하고 넘어가게 해뒀어요(서명 없이 구조만 테스트하고 싶을 때도 있어서).

이 부분은 전부 이 세션(원격 접속)에서 파일만 고친 거라 바로 반영돼 있어요. 다만 **서명/공증/실제 .dmg 빌드는 진짜 macOS 도구(codesign, Xcode)가 있어야 해서 제가 대신 실행해볼 수가 없어요** - 아래는 전부 본인 Mac 터미널에서 직접 하셔야 하는 것들이에요.

## 본인이 해야 할 일

### 1. Apple Developer Program 가입 (연 $99)
https://developer.apple.com/programs/enroll/ 에서 가입. 개인/사업자 중 선택, 본인 확인 절차 있어서 보통 하루 이틀 걸려요(가끔 더 걸릴 수 있음).

### 2. Developer ID Application 인증서 받기
제일 쉬운 방법 - Xcode 설치 후:
1. Xcode 실행 → Settings(또는 Preferences) → Accounts → "+"로 Apple ID 로그인(Developer Program 가입된 계정).
2. "Manage Certificates..." → 왼쪽 아래 "+" → "Developer ID Application" 선택.
3. 키체인 접근(Keychain Access) 앱 열어서 "로그인" 키체인에 `Developer ID Application: 본인이름 (TEAMID)` 항목이 생겼는지 확인.

### 3. 앱 암호(App-Specific Password) 발급
https://appleid.apple.com → 로그인 → 보안 → "앱 암호" → 생성. `xxxx-xxxx-xxxx-xxxx` 형태로 하나 나옴(2단계 인증 켜져 있어야 함).

### 4. Team ID 확인
https://developer.apple.com/account → Membership(또는 "Membership details") 페이지에서 10자리 Team ID 확인.

### 5. 환경변수 설정 후 빌드
터미널에서:
```
cd ~/Documents/mypet-desktop

# 먼저 scrollwatch 바이너리가 빌드돼 있는지 확인(없으면):
swiftc -O native/scrollwatch.swift -o native/scrollwatch

# 서명 없이 구조만 먼저 테스트해보고 싶으면:
npm run pack
# -> dist/mac-arm64/MyPet.app 생성됨, 더블클릭해서 평소처럼 되는지 확인

# 실제 서명+공증까지 포함한 배포용 빌드:
export APPLE_ID="본인 Apple ID 이메일"
export APPLE_APP_SPECIFIC_PASSWORD="3번에서 받은 앱 암호"
export APPLE_TEAM_ID="4번에서 확인한 Team ID"
export CSC_NAME="Developer ID Application: 본인이름 (TEAMID)"
npm run dist
```
`npm run dist`는 시간이 꽤 걸려요(특히 공증 - Apple 서버 심사라 몇 분~십몇 분). 다 끝나면 `dist/` 폴더 안에 `MyPet-0.1.0.dmg`, `MyPet-0.1.0-mac.zip` 같은 파일이 생겨요. 이 `.dmg`를 다른 맥에 복사해서 열어보면, 서명/공증이 잘 됐으면 "확인되지 않은 개발자" 경고 없이 바로 열려요(최신 macOS는 "Apple이 악성코드를 검사했습니다" 정도의 안내만 뜸 - 정상).

### 6. 아직 안 되어 있는 것 (제가 못 만든 것)
- **앱 아이콘(.icns)**: 지금 아이콘이 없어서 기본 Electron 아이콘으로 나와요. 손그림 중 하나로 아이콘 만들어드릴 수 있으니 원하시는 그림/스타일 있으면 말씀해주세요.
- **productName/appId 확정**: 지금 "MyPet" / "com.mypetdesktop.app"는 제가 임의로 넣은 값이에요. 실제 팔 때 쓸 이름 정해지면 알려주세요(바꾸기 쉬움).
- **판매 페이지/결제**: 직접 결제로 하신다고 했으니, 웹사이트에 결제(Stripe 등) 붙이고 결제 완료되면 다운로드 링크(또는 이메일로 .dmg 전달)해주는 흐름이 필요해요 - 이건 완전히 별개 작업이라 따로 말씀해주시면 같이 진행해요.
- **자동 업데이트**: 지금은 안 붙어있음. 나중에 기능 업데이트할 때마다 사용자가 새로 다운받아야 함. `electron-updater`로 자동 업데이트 붙이는 것도 나중에 고려할 수 있어요(일단 처음 출시 땐 없어도 됨).
