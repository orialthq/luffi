# Luffi iOS 팀원 실행 가이드

저장소: <https://github.com/orialthq/luffi>

Luffi는 Flutter로 화면과 도메인 로직을 공유합니다. iOS에서도 스크린샷을
앱 안에서 가져와 분석·정리까지 확인할 수 있습니다. 다만 iPhone 공유 시트에서
Trun On으로 보내는 경로는 아직 없어서, 앱을 열고 `콘텐츠 추가` 시트의
`스크린샷 가져오기`를 써야 합니다.

## 현재 iOS 지원 범위

| 기능 | iOS 시뮬레이터 | 실제 iPhone | 현재 상태 |
| --- | --- | --- | --- |
| 앱 빌드와 실행 | 가능 | 서명 설정 후 가능 | Flutter UI 실행 가능 |
| 샘플 콘텐츠 탐색 | 가능 | 가능 | 목록·상세·정리함 UI 확인 가능 |
| 텍스트 직접 추가 | 가능 | 가능 | `AppSnapshotFileStore`로 재시작 후에도 보존됨 |
| 정리함·분석 결과 영구 저장 | 가능 | 가능 | `Storage/AppSnapshotFileStore.swift` |
| `.trunon` 팁 파일 수신 | 가능 | 가능 | `Storage/PortableTipInbox.swift` |
| 지도 앱 연동 | 제한적 | 가능 | 네이버·카카오·구글, 미설치 시 웹 폴백 |
| Flutter 테스트 | 가능 | 해당 없음 | Dart·widget 범위이며 iOS 네이티브 연동은 별도 검증 필요 |
| 앱 안에서 스크린샷 가져오기 | 가능 | 가능 | `콘텐츠 추가` 시트의 `스크린샷 가져오기` |
| 스크린샷 Luna 분석 | 서버 필요 | 서버 필요 | 아래 `분석 서버 연결` 참고 |
| 공유 시트에서 Trun On으로 보내기 | 불가 | 불가 | iOS Share Extension 미구현 — App Group에 유료 계정 필요 |

배포 타겟은 iOS 14.0입니다. `PHPickerViewController`가 14.0부터라 13.0에서
올렸습니다. iOS 13을 구동하는 기기는 모두 14 이상으로 올릴 수 있어 실제로
제외되는 기기는 없습니다.

2026년 8월 1일 기준으로 `flutter build ios --simulator --debug
--no-codesign` 빌드와 iPhone 17 Pro 시뮬레이터 실행을 확인했습니다.

## 준비물

- macOS와 Xcode
- Flutter `3.44.8`, Dart `3.12.2` 또는 프로젝트와 호환되는 최신 버전
- Git
- Node.js 20 이상 — 분석 서버를 수정하거나 테스트할 때만 필요

먼저 환경을 확인합니다.

```bash
flutter doctor
xcodebuild -version
```

`flutter doctor`의 Xcode 항목에 문제가 있으면 Xcode를 한 번 실행해 라이선스와
추가 구성 요소 설치를 완료한 뒤 다시 확인하세요.

## 가장 빠른 실행 방법

```bash
git clone https://github.com/orialthq/luffi.git
cd luffi
git checkout main
flutter pub get
flutter analyze --fatal-infos
flutter test
open -a Simulator
flutter devices
flutter run -d "<iPhone 시뮬레이터 ID>"
```

예를 들어 `flutter devices`에 표시된 ID가 `08EACE77-...`라면 마지막 명령은
다음과 같습니다.

```bash
flutter run -d 08EACE77-...
```

시뮬레이터 빌드만 확인하려면 다음 명령을 실행합니다. 시뮬레이터 빌드에는
Apple Developer 서명이 필요하지 않습니다.

```bash
flutter build ios --simulator --debug --no-codesign
```

## 지금 iOS에서 확인할 수 있는 것

- 콘텐츠 목록, 필터, 상세 화면과 정리함 UI
- 샘플 데이터의 뷰티 제품·리뷰·출처 표시
- 긴 원문의 접기·펼치기 동작
- 텍스트 직접 추가 후 분석·확인 흐름
- Dart 도메인 모델, 분석 스키마, 상태 관리와 위젯 테스트
- 서버 코드의 단위 테스트

서버 테스트는 앱 실행과 별개입니다.

```bash
cd server
npm test
```

OpenAI API 키나 로컬 분석 서버는 샘플 UI를 실행하는 데 필요하지 않습니다.
실제 캡처 이미지는 저장소나 공개 Issue에 올리지 마세요.

## 분석 서버 연결

Luna 분석은 Mac에서 도는 중계 서버를 거칩니다. OpenAI 키가 앱에 들어가지
않도록 하기 위해서이고, 그래서 실기기에서 분석을 쓰려면 폰과 Mac이 같은
Wi-Fi에 있어야 합니다.

서버는 모든 인터페이스에 바인딩해야 폰에서 닿습니다.

```bash
cd server
HOST=0.0.0.0 npm run dev
```

앱에는 서버 주소를 빌드 시점에 심습니다. IP 대신 Mac의 `.local` 이름을 쓰면
공유기가 IP를 바꿔도 다시 빌드할 필요가 없습니다.

```bash
flutter run -d "<기기 ID>" \
  --dart-define=ORI_ANALYSIS_BASE_URL=http://$(scutil --get LocalHostName).local:8787
```

`Info.plist`의 `NSAllowsLocalNetworking`이 `.local`과 링크로컬 주소에 한해
평문 HTTP를 허용합니다. 외부 평문 통신은 그대로 차단됩니다. 첫 요청 때
로컬 네트워크 접근 권한을 묻는 팝업이 뜨며, 거부하면 분석만 실패하고 나머지
화면은 정상 동작합니다.

`HOST=0.0.0.0`으로 열면 같은 네트워크의 누구나 이 서버를 호출할 수 있고
서버에는 아직 인증 계층이 없습니다. 신뢰할 수 없는 Wi-Fi에서는 띄우지 마세요.

## 아직 iOS에서 확인할 수 없는 것

공유 시트 경로는 iOS에서 아직 동작하지 않습니다.

```text
스크린샷 촬영
→ 공유 시트에서 Trun On 선택
→ 원본을 앱 내부로 복사
```

Share Extension과 App Group이 없기 때문입니다. 대신 앱을 열고 `콘텐츠 추가`
시트의 `스크린샷 가져오기`로 같은 파이프라인에 넣을 수 있습니다. 수집 이후
경로(검증·복사·분석·복원)는 두 플랫폼이 공유합니다.

App Groups는 무료 Apple ID(Personal Team)에서 지원되지 않으므로, Share
Extension을 붙이려면 유료 Apple Developer Program이 필요합니다.

## 실제 iPhone에서 UI 실행하기

USB 또는 무선으로 iPhone을 Mac에 연결한 뒤 Xcode에서 다음 설정이 필요합니다.

1. `ios/Runner.xcworkspace`를 Xcode로 엽니다.
2. Runner target의 **Signing & Capabilities**에서 팀과 고유 Bundle Identifier를
   설정합니다.
3. iPhone에서 개발자 모드를 켜고 이 Mac을 신뢰합니다.
4. `flutter devices`에서 기기 ID를 확인합니다.
5. `flutter run -d "<iPhone 기기 ID>"`를 실행합니다.

이 단계는 현재 Flutter UI를 실제 기기에서 보는 용도입니다. 스크린샷 공유 입력과
Luna 분석까지 검증하는 절차는 아닙니다.

## iOS 입력 파이프라인을 완성하려면

검증·복사·pending queue·acknowledge·snapshot 저장과 로컬 네트워크 설정은
`ios/Runner/Share/`와 `ios/Runner/Storage/`에 구현돼 있습니다. 남은 것은 공유
시트 진입점뿐입니다.

1. 유료 Apple Developer Program에 가입합니다. App Groups는 개인 팀에서 쓸 수
   없습니다.
2. iOS Share Extension target을 추가합니다.
3. Runner와 Extension이 공유할 App Group 컨테이너를 구성합니다.
4. Extension이 받은 이미지를 App Group 컨테이너에 두고, Runner가 기존
   `IncomingShareIngestor`로 넘기도록 연결합니다.
5. 실제 기기에서 백그라운드·중복 입력·앱 재시작·실패 복구를 검증합니다.

`IncomingShareIngestor`와 `IncomingShareStore`는 `android/.../share/`를 1:1로
옮긴 것입니다. 한쪽 검증 규칙만 바꾸면 같은 캡처가 플랫폼마다 다르게 거부되므로
반드시 양쪽을 함께 수정하고, `RunnerTests`와 `IncomingImageSignatureTest.kt`에
같은 케이스를 추가하세요.

## 브랜치와 PR

```bash
git checkout main
git pull --ff-only
git checkout -b feature/ios-share-extension
```

작업 후 본인 브랜치를 push하고 `main`을 대상으로 Pull Request를 만드세요.
공개 저장소이므로 테스트용 캡처는 식별 정보가 없는 더미 이미지로만 추가합니다.
