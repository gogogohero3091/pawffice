// scrollwatch.swift
//
// 전역 마우스 휠(스크롤) 이벤트를 macOS 자체 API(NSEvent 전역 모니터링)로 감지해서,
// 스크롤될 때마다 표준출력(stdout)에 한 줄("scroll")씩 찍는 아주 작은 헬퍼 프로그램이에요.
//
// 왜 필요한가: 이 앱은 uiohook-napi라는 범용 크로스플랫폼 라이브러리로 전역 키보드/휠을
// 감지하는데, 이 Mac 환경에서는 키보드(keydown)는 정상 동작하지만 휠(wheel) 이벤트만 전혀
// 잡히지 않는 문제가 있었어요(권한도 다 켜져 있고 라이브러리도 최신인데 안 됨 - 라이브러리의
// macOS 쪽 버그로 보여요). NSEvent.addGlobalMonitorForEvents는 macOS가 직접 제공하는,
// 더 안정적인 전역 이벤트 감지 방법이에요.
//
// 빌드 방법(터미널에서 한 번만):
//   cd ~/Documents/mypet-desktop
//   swiftc -O native/scrollwatch.swift -o native/scrollwatch
//
// main.js가 이 컴파일된 바이너리(native/scrollwatch)를 자식 프로세스로 실행해서 stdout을
// 한 줄씩 읽어요. 첫 실행 시 macOS가 "손쉬운 사용(접근성)" 권한을 물어볼 수 있어요 -
// 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 허용해주셔야 동작해요(이미 이
// 앱/Electron에 권한을 줬더라도, 이 헬퍼는 별도의 실행파일이라 따로 권한이 필요할 수 있어요).

import Cocoa

let app = NSApplication.shared
// 독(Dock)이나 Cmd+Tab에 안 뜨게 - 화면에 아무것도 안 그리는 순수 백그라운드 감지 프로그램이라서.
app.setActivationPolicy(.prohibited)

_ = NSEvent.addGlobalMonitorForEvents(matching: .scrollWheel) { _ in
    print("scroll")
    fflush(stdout)
}

app.run()
