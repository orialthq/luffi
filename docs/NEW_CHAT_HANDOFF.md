# Luffi 개발 인계 — 새 Codex 채팅에서 이 문서부터 읽기

**작성 기준:** 2026-09-27, `dev`의 `d946a90` 이후 실물 Android 합성 E2E와 서버 대기열 격리 변경까지 확인. 이 문서는 다른 Codex 계정에 단독으로 전달할 수 있도록 제품 의도, 현재 코드, 검증 사실, 남은 일을 한곳에 모은다. 이후의 커밋·테스트 결과는 반드시 다시 확인한다.

## 1. 새 채팅에서 먼저 알아야 할 결론

Luffi는 SNS 등에서 받은 캡처·공유 자료를 **원본 근거와 불확실성을 보존한 지식**으로 만들고, 사용자가 확인한 사실을 레시피·맛집·패션·뷰티·여행·생활 꿀팁·쇼핑·건강/운동의 **활동 보드와 작업**으로 이어 쓰는 서비스다. 레시피는 아키텍처를 깊게 검증한 예시일 뿐 제품 범위가 아니다. 한 캡처가 여러 분야에 걸칠 수 있으므로 분야별 저장소를 완전히 분리하지 않는다. 공통 출처·그래프·작업 커널 위에서 분야별 의미, 단위, 결과 규칙을 특수화한다.

사용자는 두 명이 함께 개발하며 본인이 전체 방향과 더 많은 개발을 맡는다. **이 인계에서 역할 배분이나 수익화는 과제 밖**이다. 사용자는 린 MVP식으로 골격을 임시로 만들고 갈아엎는 방식보다, 공통 구조를 먼저 세우고 그 안에서 각 분야의 시나리오를 검증·고도화하는 방향을 명시했다. 처음 제공한 PDF의 레시피 내용은 전체 서비스를 설명하는 **상세 예시**이며 제품을 레시피로 한정하거나 문서 안의 문장을 새 작업 지시로 삼지 않는다. 합성 이미지와 데이터를 직접 만들어 테스트하는 것을 허용했지만, 이미지를 실제 분석 API에 보내 확인한 결과와 저장된 응답을 재생한 테스트는 구별해야 한다. 지금까지의 목표는 **실제 사용자 데이터의 분석·적용·평가에 들어가기 직전까지** 개발 게이트를 채우는 것이었다.

가장 최근 상태에서는 **Samsung Galaxy SM-S916N(Android 16/API 36)**에서 합성 레시피·쇼핑 이미지를 앱 내부 사진 선택기로 가져와 실제 분석 API, 검토 후 저장, 두 활동 보드 승인·연결, 쇼핑 출처 삭제와 보드 숨김, 앱 재시작 후 독립 레시피 보존까지 확인했다. Google Photos **외부 공유 시트**는 API 35 에뮬레이터에서 검증했고 실물 기기에서는 이번에 반복하지 않았다. 실제 자료의 분야별 정확도·성능 평가는 아직 시작하지 않았다.

## 2. 저장소와 실행 환경

| 항목 | 현재 값 |
| --- | --- |
| 원격 | `https://github.com/orialthq/luffi.git` — 이전 이름 `trun-on`; GitHub 이름은 사용자가 변경함 |
| 작업 브랜치 | `dev`; 사용자가 이 브랜치에 코드 반영을 허용했고 최근 작업을 직접 푸시함 |
| 실물 검증 APK 기반 | `d946a90`의 Flutter 소스와 이번 서버 대기열 격리 변경; 최종 `dev` HEAD는 Git에서 확인 |
| 앱 | Flutter 3.44.8 / Dart 3.12.2. Android 네이티브 공유·알림 등은 Kotlin, iOS 보조 코드는 Swift |
| 서버 | Node.js 20+ JavaScript, OpenAI 이미지 분석, 개발용 Bearer 인증 커널 API |
| 저장 | 단일 프로세스 JSON 개발 저장소 또는 PostgreSQL. 지식 그래프는 공통 관계형 행+FK; 활동·자원·영수증 등은 트랜잭션 JSONB. 테스트에는 PGlite도 사용 |
| 개발 앱 | Android `com.orialthq.ori_beauty.dev`; 공통 활동 보드는 개발 빌드에서만 보임 |

새 계정에서는 먼저 이 저장소의 `dev`를 체크아웃하고 `git status`, 최신 커밋, 원격을 확인한다. 이 로컬 컴퓨터에만 있던 키체인 항목, 개인 캡처, 비공개 평가 manifest, 서버 상태 파일, 삭제 기록 파일, 이미 빌드된 APK는 **Git으로 전달되지 않는다**. 다른 계정/컴퓨터에서 접근할 수 있다고 가정하지 말 것. OpenAI 키나 개발 토큰을 문서·커밋·로그에 넣지 말 것.

## 3. 사용자 의도가 코드에 반영된 핵심 규칙

1. **입력·분석·확인·활동은 서로 다른 단계다.** 공유 원본을 먼저 보존한다. 분석 결과는 화면에서 관찰한 문구와 근거일 뿐, 사용자가 검토·확인하기 전에는 계획의 확정 사실이 아니다. 확인한 캡처를 서버에 가져와도 보드는 자동 생성되지 않는다.
2. **지식 그래프는 출처와 근거를 중심으로 한다.** `Source → SourceVersion → Evidence`, `EntityMention → IdentityDecision → Entity`, `Assertion → 근거·시간·범위`가 기준이다. 같은 이름의 식당·상품을 자동 병합하지 않는다. 현재 사실은 출처 활성 상태, 근거 집합, 유효 시각, 활동 범위, 충돌/철회 정책을 거쳐 해결한다.
3. **TaskBoard는 Activity의 읽기 모델이다.** 작업 DAG, 안정적인 Task ID, 선행조건과 입출력 바인딩이 실행을 정의한다. 계획 변경안은 사용자가 별도로 승인한다. 완료한 TaskResult와 당시 소비한 입력은 나중의 정정으로 몰래 덮지 않는다. 근거가 바뀌면 미시작 작업은 재검토하고 시작한 작업은 후속 활동으로 잇는다.
4. **관계 연결은 행동의 증거가 아니다.** 레시피↔쇼핑 연결은 구매가 아니고, 여행↔식당 연결은 방문이 아니다. 가격 표시는 실제 지불액이 아니다. 재고 미확인은 0이 아니다. 구매·방문·착용·제품 사용·운동 수행·팁 실행은 해당 분야의 별도 사용자 결과 보고에서만 기록한다.
5. **분야별 특수화를 허용한다.** 공통 커널을 재사용하되 레시피 분량/단위, 쇼핑 포장 수량/결제, 뷰티 단계별 사용, 여행 방문 순서 등은 분야별 계약과 테스트로 다룬다. 한 캡처/출처가 여러 활동과 관계를 가질 수 있다.
6. **삭제와 정정은 다르다.** 일반 정정은 버전 있는 현재 관계를 바꾸고 완료 이력을 보존한다. 개인 자료 삭제는 해당 출처에 의존한 보드·관계·파생 결과를 함께 제거하며, 독립 활동은 남긴다. 늦게 온 가져오기 재시도는 삭제 영수증으로 차단한다.

## 4. 현재 구현의 실제 경계

```text
Android 공유 시트·사진 선택기 / 앱 입력
  → 앱 전용 원본 보존·pending queue·snapshot commit
  → Node /v1/analyze 또는 Batch 분석
  → 엄격한 분석 스키마·근거 ID·누락/충돌 검토
  → 사용자의 ‘정리함에 저장’ 확인
  → 서버 reviewed-capture 가져오기 영수증과 Source/Version/Evidence
  → 분야별 사용자 확인 → 승인 대기 계획 → 별도 승인
  → Activity/Task/TaskResult와 근거 그래프
  → 필요할 때만 분야 간 연결·계획 재검토
  → 정정·철회·삭제 때 영향 재검증
```

- Flutter 진입/상태: `lib/state/app_controller.dart`, `lib/data/incoming_share_service.dart`, `lib/data/reviewed_capture_import_client.dart`, `lib/data/common_kernel_client.dart`, `lib/features/boards/`.
- 서버 진입: `server/src/index.js`, `server/src/http_app.js`, `server/src/analysis_service.js`, `server/src/ingestion/`, `server/src/common/kernel_service.js`.
- 커널: `server/src/knowledge/`, `retrieval/`, `activities/`, `composition/`, `domains/`. 등록된 도메인 팩은 레시피·맛집·패션·뷰티·여행·생활 꿀팁·쇼핑·건강/운동이다.
- 저장/복구: `server/src/storage/json_state_store.js`, `postgres_relational_store.js`, `deletion_ledger.js`, `reconcile_deletions.js`; SQL은 `server/migrations/001_*`~`003_*`.
- 앱의 **기존 로컬 계획함**과 새 서버 Activity Board는 아직 별개이며 양방향 동기화·자동 이전은 없다. 새 보드는 개발용 토큰으로만 보이고 이 토큰은 운영 사용자 인증이 아니다.
- PostgreSQL 그래프는 관계형 행이 기준이다. 단, 그래프 조회는 현재 전체 객체를 조립한다. 대규모 SQL 직접 조회/부분 로딩, 다중 사용자 운영 인증, 원본 이미지의 서버 영구 보관, 실제 알림 전달, 외부 예약·결제 실행은 구현 완료로 간주하지 말 것.

세부 API·불변식은 [공통 커널 계약](COMMON_KERNEL.md), 분야 연결은 [시나리오 연결 계약](SCENARIO_CONNECTIONS.md), 분야별 입력·결과는 `docs/*_FIRST_SCENARIO.md`에 있다. `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`의 일부 문장은 초기 **뷰티 중심 베이스라인의 목표/과거 상태**이므로 현재 다분야 커널의 완료 범위를 판단할 때 코드와 위의 최신 문서를 우선한다.

## 5. 어떤 데이터와 테스트를 실제로 확인했나

공개 **합성 PNG 21장**과 각각 과거 실제 분석 API에서 받은 `*_live_analysis.json`이 `server/test/fixtures/`에 있다. `server/evaluation/synthetic_corpus.v1.json`이 입력 해시, 기대 분야·제목, 응답 파일의 단일 목록이다. 일반 서버 테스트는 저장 응답을 재생하므로 반복 가능하고 유료 모델을 새로 부르지 않는다. 일부 HTTP 통합 테스트는 PNG 바이트를 로컬 API에 보내지만 분석 서비스가 저장 응답을 돌려준다. `npm run test:*image-live`만 현재 모델을 다시 호출한다. **21장 고정 응답 통과는 실제 SNS 캡처 정확도 점수가 아니다.**

대표 검증 경로: 합성 `variation_recipe_tofu_egg_as_needed.png` → 화면 근거를 가진 두부 300g·달걀 2개·소금 약간 추출 → 사용자가 레시피 재료/인분을 따로 확정 → 2→4인분 필요량 계산(두부 600g, 달걀 4개, 소금 숫자 없음) → 재고 미확인은 부족량 미확인 → 두부 상품 캡처의 쇼핑 보드와 연결 → 구매 여부는 여전히 미확정. 레시피 근거를 고치면 오래된 필요량은 `stale`로 숨기고, 출처를 지우면 레시피 보드·연결이 사라져도 독립 쇼핑 보드는 남는다. 분야별 입력·출력·사용자 결정·금지된 추론의 표는 [시나리오·이미지 검증 안내](TEST_VALIDATION_GUIDE.md)에 있다.

| 검증 층 | 마지막으로 확인한 결과 | 한계 |
| --- | --- | --- |
| 서버 전체 | 2026-09-28 로컬 전체 실행 **597개 중 594 통과·3 skipped·0 실패**. skipped는 외부 PostgreSQL 선택 테스트다. 직전 `1aa7b16`의 서버 CI는 실제 PostgreSQL 포함으로 성공했고, 이번 라벨 평가 계약 변경의 CI는 새 커밋에서 다시 확인한다. | 운영 DB 부하·배포·실데이터 정확도 아님 |
| Flutter | `flutter analyze --fatal-infos` 통과, **521개 테스트 통과**. 이후 Flutter 소스 변경 없음 | 테스트는 실물 공유 시트의 자동 증거가 아님 |
| Android | API 35 에뮬레이터에서 Google Photos 외부 공유·서버 중단과 재시도를 확인했다. API 36 실물 기기에서는 앱 사진 선택기→실제 분석→레시피/쇼핑 보드 승인·연결→상품 출처 삭제→열린 보드 숨김→재시작을 확인했다. 디버그 APK 빌드 통과 | 실물 기기의 외부 앱 공유 경로와 실제 사용자 자료 평가는 미실행 |
| 합성 코퍼스 | 21장 원본·저장 응답의 해시와 근거 참조 회귀 | 현재 모델의 새 응답·실제 SNS 자료의 통계 아님 |
| 실제 자료 | 평가기 코드와 계약만 준비 | 비공개 17개 holdout 전체 manifest가 이 작업 환경에 없어 새 수치를 산출하지 않음. 실제 자료 평가 미실행 |

위 서버 수치는 실행 환경과 포함된 선택 테스트에 따라 구분해야 한다. [기존 검증 안내](TEST_VALIDATION_GUIDE.md) 하단의 과거 수치는 최신 결과가 아니다. 원격 CI는 `dev`·PR에서 서버 전체(실제 PostgreSQL 서비스)와 Flutter 분석·테스트·APK 빌드를 실행하도록 구성되어 있다. 마지막으로 확인한 `d946a90`의 서버·Flutter CI는 성공했다. 이후 커밋의 CI 상태는 새 채팅에서 다시 확인한다.

## 6. 최근 추가된 삭제 복구 안전장치

`LUFFI_KERNEL_TOKEN`으로 공통 보드 API를 켜면 `LUFFI_KERNEL_DELETION_LEDGER_PATH`가 **필수**다. `Source`와 가져오기 영수증의 삭제 해시를 DB/JSON 상태보다 먼저 별도 파일에 동기화한다. 기록 파일이 없거나 손상됐거나 현재 삭제 영수증의 일부가 빠지거나, 과거 백업에서 삭제된 자료가 다시 활성화되면 서버 시작을 거부한다. 실행 도중 파일이 사라져도 삭제 명령이 빈 파일을 다시 만들지 않는다. `check:deletion-ledger`는 기록 건수와 `safe` 상태만 출력한다.

새 환경에서는 **신뢰할 수 있는 현재 저장소**와 별도로 보존할 파일 경로를 정하고 한 번만 초기화한다. 파일을 상태/DB 백업과 함께 잃으면 삭제 이력을 재구성할 수 없으므로 같은 백업 묶음에만 보관하지 않는다. 오래된 백업을 복원할 때는 서비스를 공개하지 않은 격리 상태에서 `reconcile:deletion-ledger`를 미리보기→`--apply` 순서로 실행한다. 자세한 명령·오류 해석은 [실제 데이터 직전 게이트](REAL_DATA_READINESS.md#복구-경계)에 있다. **현재 다른 계정의 지속 개발/운영 환경이 지정되지 않아 그 환경의 파일 초기화는 아직 수행하지 않았다.** 임시 격리 상태의 초기화·점검과 실제 PostgreSQL 복원 테스트만 수행했다.

## 7. 새 채팅에서 이어 할 순서

1. **현 상태 확인:** `dev`의 최신 커밋과 CI, 작업 트리 상태를 확인한다. 새 변경이 있으면 이 문서의 숫자보다 현재 코드/테스트를 우선한다. 개인 자료나 키가 있는지 출력하지 않는다.
2. **실물 Android 검증 결과 확인:** [실물 기기 검증 기록](ANDROID_E2E_VALIDATION.md#실물-기기-검증-2026-09-27)에 합성 이미지 앱 내부 사진 선택기→실제 분석→두 보드 승인·연결→쇼핑 캡처 삭제→열린 보드 숨김·독립 보드 보존→앱 재시작까지 기록했다. 다른 기기나 외부 공유 경로를 검증할 때만 같은 절차를 다시 실행한다. 개인 사진을 시험 자료로 쓰지 않는다.
3. **지속 테스트 환경 설정:** 실제 사용할 JSON 상태 또는 PostgreSQL DB가 정해지면 그 상태를 확인하고, 백업과 독립된 삭제 기록 경로를 정해 초기화·점검한다. 현재 토큰은 단일 개발 사용자용이므로 공개 운영 서비스의 인증으로 사용하지 않는다.
4. **사용자가 실제 데이터 단계로 넘어가라고 요청할 때:** 동의·보존·삭제 처리, 비공개 입력/라벨, 출처 단위 개발/최종 평가 분리, 모델·프롬프트·스키마·커밋·입력 해시 고정부터 정한다. 비공개 라벨에는 `consentRef`·`sourceGroupId`·`split`이 필수이고, 동일 출처 그룹/이미지 해시는 개발·최종 평가 양쪽에 들어갈 수 없다. `npm run check:labeled-inputs --prefix server -- LABELS.json IMAGES_DIR`로 라벨 해시와 실제 이미지 바이트를 대조한다. `server/src/evaluation/labeled_analysis.js`는 분야별 필드와 근거, 위험한 Mention 병합, 근거 없는 행동 Assertion을 평가한다. 비공개 점수 명령 `npm run test:labeled-report --prefix server -- LABELS.json PREDICTIONS.json IMAGES_DIR`에는 모델·프롬프트·스키마·커밋·실행 시각 기록과 검증된 이미지가 필요하다. 모델 호출·서버 적용은 하지 않는다. 비공개 17장이나 결과를 임의로 재구성하지 말 것.
5. **실제 오류에 따라 분야별 고도화:** 레시피에서 했듯 맛집의 지점 동일성, 패션 옵션, 뷰티 단계/사용, 여행 일정/방문, 쇼핑 가격/실결제, 운동 계획/수행 등을 따로 측정·수정한다. 공통 커널 하나에 모든 분야 규칙을 우겨 넣지 않는다. 다음 큰 개발 과제(대규모 그래프 부분 조회, 운영 인증, 서버 원본 보관 등)는 실제 평가 결과와 사용자 우선순위를 받은 뒤 선택한다.

실제 사용자 자료 평가가 미실행이라는 경계를 유지하고, 합성 기기 E2E 결과를 정확도 통계로 부르지 말 것. 이 단계까지 사용자는 `dev` 직접 반영을 허용했지만, 다른 계정의 GitHub 접근 권한은 별도 확인이 필요할 수 있다.

## 8. 바로 재현하는 명령

```sh
git clone https://github.com/orialthq/luffi.git
cd luffi
git switch dev
npm ci --prefix server
flutter pub get
npm run test:corpus-report --prefix server
npm test --prefix server
flutter analyze --fatal-infos
flutter test
flutter build apk --debug
```

실제 PostgreSQL 선택 테스트는 **테스트 전용 DB**에서만 `LUFFI_TEST_POSTGRES_URL`을 지정해 `npm run test:postgres-real --prefix server`로 실행한다. 백업·복원 테스트에는 `pg_dump`/`pg_restore` 또는 `LUFFI_TEST_POSTGRES_CONTAINER`로 지정한 임시 컨테이너가 필요하다. 일반 테스트에서 DB가 없으면 그 선택 테스트는 skipped로 표시되므로 개수를 같이 보고한다.

개발 서버에 공통 보드를 켜는 경우, 서버와 Flutter 개발 빌드에 같은 32자 이상 토큰을 설정한다. 서버는 `LUFFI_KERNEL_OWNER_ID`와 JSON의 `LUFFI_KERNEL_STATE_PATH` 또는 PostgreSQL의 `LUFFI_KERNEL_DATABASE_URL`을 사용한다. **서버 시작 전** `LUFFI_KERNEL_DELETION_LEDGER_PATH`를 상태 백업과 독립된 위치로 정하고 `npm run bootstrap:deletion-ledger --prefix server -- "$LUFFI_KERNEL_DELETION_LEDGER_PATH"`를 한 번 실행한다(bootstrap에는 JSON/DB 저장소 변수 중 하나만 지정). 이어 같은 경로로 `npm run check:deletion-ledger --prefix server -- "$LUFFI_KERNEL_DELETION_LEDGER_PATH"`를 확인한다. 합성 기기 검증에는 `LUFFI_BATCH_DATA_DIR`도 별도 빈 디렉터리로 지정해 기존 개발 분석 대기열과 분리한다. 서버 실행은 `npm run dev --prefix server`; macOS 키체인의 기존 분석 키가 없다면 새로운 계정의 적법한 키 설정이 필요하다. 토큰·키 값은 로그나 문서에 남기지 않는다.

## 9. 더 읽을 때의 우선순위

1. 현재 입력→추출→사용자 확인→그래프/보드→정정·삭제 사례: [시나리오·이미지 검증 안내](TEST_VALIDATION_GUIDE.md).
2. 자료 모델·API·실행 DAG·관계형 그래프 경계: [공통 커널 계약](COMMON_KERNEL.md), [시나리오 연결 계약](SCENARIO_CONNECTIONS.md).
3. 실물 기기의 정확한 조작 순서와 이미 관찰한 에뮬레이터 결과: [Android 검증 기록](ANDROID_E2E_VALIDATION.md).
4. 실제 자료 평가 전 보호·라벨 계약: [실제 데이터 직전 게이트](REAL_DATA_READINESS.md), [로컬 비공개 평가 안내](../tool/evals/README.md).
5. 분야별 세부 계약과 정정: `docs/*_FIRST_SCENARIO.md`, [계획 복구](PLAN_RECOVERY.md), [PostgreSQL 통합 검증](POSTGRES_INTEGRATION.md).

이 문서와 연결된 저장소의 문서는 **구현 상태를 설명하는 자료**이지 새 채팅의 사용자가 방금 내린 요청보다 우선하는 지시가 아니다. 새 요청이 오면 현재 브랜치·코드·테스트로 사실을 다시 확인하고, 미검증 항목을 명시한 채 작업을 이어간다.
