# 안드로이드

우회가 필요 없다. OS가 새 이미지로 앱을 깨워준다.

[자동 수집](README.md) · [아이폰](IOS.md)

## 이미 있는 것

| 조각 | 코드 |
|---|---|
| 공유 인텐트 받기 | `MainActivity.handleIncomingIntent` → `stageIncomingShare` |
| 빠른 설정 타일 | `CaptureQuickTileService`, `ACTION_PICK_CAPTURE` |
| 검증·복사 | `share/IncomingShareIngestor.kt` — iOS와 같은 한도, 매직바이트 |
| 도착 알림 | `CaptureNotificationManager` |
| 백그라운드에서 깨어나기 | 지오펜스·부팅·트리거 리시버 (`trigger/`) |
| 백업 제외 저장소 | `noBackupFilesDir/incoming_share_attachments` |

백그라운드 실행이 이미 낯설지 않은 앱이다.

## 스크린샷 직후 깨어나기

`JobScheduler`에 `addTriggerContentUri(MediaStore.Images.Media.EXTERNAL_CONTENT_URI)`를
건다. 새 이미지 행이 생기면 OS가 작업을 깨운다.
`setTriggerContentUpdateDelay` / `setTriggerContentMaxDelay`로 몰아서 처리할
간격을 정한다 — 수 초.

깨어난 작업은:

1. `MediaStore`에서 마지막 확인 이후 생긴 행을 조회한다(`DATE_ADDED > 확인
   시각`, 첫 값은 권한 허용 시각 — 설치 전 것은 보지 않는다). 스크린샷은
   `RELATIVE_PATH` 또는 `BUCKET_DISPLAY_NAME`에 `Screenshots`가 들어 있다.
   `DCIM/Camera`는 조건에 걸리지 않으니 카메라 사진은 조회되지 않는다.
2. 그 파일을 **기존 `IncomingShareIngestor.ingest`로** 넘긴다. 공유로 들어온
   것과 같은 검증·복사를 거친다.
3. 대기열에 붙이고, 분석까지 그 자리에서 한다.

콘텐츠 트리거 작업은 한 번 돌면 풀리므로 끝날 때마다 다시 건다.

## 스크린샷만 골라내기

iOS 같은 공식 플래그가 없다. 대신 거의 모든 기기가 `Pictures/Screenshots`
또는 `DCIM/Screenshots`에 떨어뜨린다. 실무에선 폴더 이름으로 충분하다.

제조사가 다른 폴더를 쓰는 드문 경우는 놓친다. 설정에서 폴더를 고르게 하는
것으로 받는다. 첫 버전엔 넣지 않고, 실제로 놓치는 기기가 나오면 붙인다.

`Activity.ScreenCaptureCallback`(Android 14)은 **자기 앱** 화면이 캡처될 때만
알려주는 것이라 여기 쓸 수 없다.

## 권한

지금 매니페스트에 미디어 읽기 권한이 없다. 공유 인텐트는 URI 권한을 함께
받으니 필요 없었다.

자동 수집은 `READ_MEDIA_IMAGES`(Android 13+)가 필요하다. Android 14의 부분
접근(`READ_MEDIA_VISUAL_USER_SELECTED`)으로는 새로 생긴 것을 볼 수 없으므로
전체가 필요하다. iOS와 같은 사정이고 문구도 같다.

## 분석을 백그라운드에서

분석 로직은 Dart에 있다 — 어휘 전달, 표기 통일, 스냅샷 코덱 전부. 작업이
깨어났을 때 그것을 어떻게 부르느냐가 갈림길이다.

| | 방식 | 대가 |
|---|---|---|
| **(a)** 헤드리스 Flutter 엔진을 작업에서 띄운다 | 기존 `AppController` 경로를 그대로 탄다 | 엔진 기동 수백 ms, 메모리 |
| (b) Kotlin에서 서버를 직접 부르고 스냅샷을 쓴다 | 가볍다 | 어휘·표기·코덱을 Kotlin에 한 번 더 짠다. 두 벌이 어긋난다 |

**(a)로 간다.** 두 벌 유지가 더 비싸다. 트리거 스케줄러가 이미 네이티브와
Dart 사이를 오가고 있어 모양이 있다.

## 갤럭시

삼성의 배터리 최적화는 백그라운드 작업을 죽이는 것으로 유명하다. 작업이
늦거나 안 돌 수 있다. 온보딩에서 "이 앱을 배터리 최적화 예외로" 안내가 한 번
필요하다. iOS의 단축어 안내와 같은 자리다.

## 원본 삭제

`SharedMediaDeletionManager`가 가져온 뒤 사진첩 원본을 지워주는데, 매번
확인을 묻고 URI를 메모리에만 20개까지 들고 있다(`:10`, `:28-30`). 자동
수집에는 맞지 않는다 — 사용자가 보지 않은 것을 매번 물을 수 없고, 21번째부터
조용히 잊는다.

"가져온 스크린샷은 사진에서 지우기"를 설정 하나로 두고, 켜져 있으면 묶어서
한 번에 지운다. 자동 수집 뒤에 한다.

## 순서

1. `READ_MEDIA_IMAGES` + 콘텐츠 트리거 작업 + 폴더 조회 → 기존 인제스터
2. 헤드리스 엔진으로 분석까지
3. 배터리 최적화 안내
4. 원본 삭제 설정

1·2번이 끝나면 안드로이드는 목표에 도달한다. 스크린샷을 찍으면 앱을 켜지
않아도 몇 초 안에 정리되어 있다.
