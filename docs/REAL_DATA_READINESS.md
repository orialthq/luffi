# 실제 데이터 검증 직전의 개발 게이트

이 문서는 **실제 캡처를 수집·분석·적용·평가하기 전**까지 코드로 확인할 수 있는 범위를 정한다. 레시피만의 완료 선언이 아니다. 맛집, 패션, 뷰티, 여행, 생활 꿀팁, 쇼핑, 건강·운동과 분야 간 연결을 같은 출처·작업 커널 위에서 확인하되, 각 분야의 값과 결과 의미는 분야별 테스트가 판단한다.

## 지금 실행할 수 있는 검사

| 검사 | 명령 | 통과가 뜻하는 것 |
| --- | --- | --- |
| 합성 이미지 기록 리포트 | `npm run test:corpus-report --prefix server` | 공개 합성 PNG 21장과 녹화된 분석 응답의 해시·형식·분류·제목·근거 참조를 검사하고 분야별 통과 건수를 JSON으로 출력한다. `mode: recorded_synthetic_regression`은 새 모델 정확도가 아니다. |
| 라벨 입력 이미지 사전 검사 | `npm run check:labeled-inputs --prefix server -- LABELS.json IMAGES_DIR` | 라벨 ID와 같은 이름의 PNG/JPG/JPEG/WebP 파일이 하나씩 있고 실제 바이트의 형식·크기·SHA-256이 라벨과 일치하는지 확인한다. 불일치 이유와 ID만 출력하며 모델 호출·서버 적용은 하지 않는다. |
| 개발·최종 평가 분할 검사 | `npm run check:labeled-splits --prefix server -- DEVELOPMENT_LABELS.json HOLDOUT_LABELS.json` | 두 비공개 라벨 파일 사이에 같은 캡처 ID·원본 출처 그룹·이미지 해시가 없는지 확인한다. 자료 내용은 출력하지 않는다. |
| 서버 전체 회귀 | `npm test --prefix server` | 출처·그래프·계획 승인·분야별 정정과 삭제, 분야 연결의 불변식. 로컬 HTTP 테스트에 포트 사용 권한이 필요하다. 실제 PostgreSQL 선택 테스트는 별도 DB가 없으면 건너뛴다. |
| 앱 전체 회귀 | `flutter analyze --fatal-infos` 및 `flutter test` | 서버의 현재 출처가 삭제되거나 바뀌면 정정 진입을 막고, 열린 정정 화면의 삭제된 필드를 숨기는 동작을 포함한다. |
| 삭제 후 JSON 복구 | `cd server && node --test test/kernel_backup_recovery.test.js` | 삭제 **후** 만든 백업을 빈 저장소에 복원하면 삭제 영수증, 소유자 격리, 독립 자료가 유지되고 같은 가져오기 ID의 재생성이 거부된다. |
| 복원 전 삭제 검사 | `npm run check:kernel-restore --prefix server -- TRUSTED.json CANDIDATE.json` | 최신 신뢰 상태와 후보 백업을 비교해 삭제된 가져오기 영수증의 누락과 삭제된 Source의 재활성화를 거부한다. 두 파일을 모두 읽기만 하며 복원은 수행하지 않는다. |
| 실제 PostgreSQL 격리 테스트 | 테스트 전용 DB의 `LUFFI_TEST_POSTGRES_URL` 지정 후 `npm run test:postgres-real --prefix server` | 마이그레이션·관계형 행·동시 쓰기·롤백·재시작과 분야 연결을 실제 드라이버로 확인한다. `pg_dump`·`pg_restore`가 설치되어 있으면 삭제 전·후 백업의 복원과 삭제 재적용도 실행한다. |

합성 목록은 [`synthetic_corpus.v1.json`](../server/evaluation/synthetic_corpus.v1.json)이 단일 원본이다. 각 항목에 이미지 SHA-256, 짝 응답, 분야, 기대 분류·제목이 고정되어 있다. 검사기가 누락·변경·목록 밖의 이미지나 응답을 실패로 처리한다. 회귀 결과를 이미지 분석의 정밀도, 실제 사용자 만족도, 보드 활용률로 해석하지 않는다. 변형 시나리오의 재료·분량·가격·장소 구별과 결과 분리는 [테스트 안내](TEST_VALIDATION_GUIDE.md)의 개별 통합 테스트에서 검증한다.

필드 단위 라벨 평가기는 [`labeled_analysis.js`](../server/src/evaluation/labeled_analysis.js)에 준비했다. `schemaVersion: 1`, `dataset`, `dataClass`, `entries`를 가진 라벨 목록과, 캡처 ID별 `{ inputSha256, analysis, graph? }` 예측 결과를 받는다. 각 라벨 항목은 `id`, `domain`, `inputSha256`, `expected.fields`를 가진다. 한 필드는 `{ path, value, evidenceRequired }`로 지정하거나, 배열 순서가 변하는 재료·상품 사실은 다음처럼 고유 조건으로 고른다.

```json
{
  "id": "egg-amount",
  "selector": {
    "collection": "/ingredientGroups/*/ingredients/*",
    "where": { "name": "달걀" },
    "path": "/amount"
  },
  "value": "2",
  "evidenceRequired": true
}
```

조건에 맞는 항목이 없거나 둘 이상이면 실패로 기록한다. 그래프 라벨의 `expected.graph`에는 `ownerId`, `distinctMentions`(서로 합치면 안 되는 언급 ID 쌍), `forbiddenAssertions`(사용자 결과 보고 전에는 없어야 할 관계와 활동 범위)를 넣을 수 있다. 잘못된 동일 대상 병합과 방문·구매 등 근거 없는 행동 관계는 필드 오독과 별도 실패로 집계한다. 입력 해시가 다르거나 결과가 빠지면 통과로 세지 않는다. 결과 리포트는 분야별 분모와 실패 위치·이유만 내고 라벨 값이나 분석 본문은 출력하지 않는다. 실제 데이터 평가는 아직 실행하지 않았다.

비공개 평가 항목은 `consentRef`, `sourceGroupId`, `split`(`development` 또는 `holdout`)이 필수다. 같은 게시물·출처의 크롭과 재캡처에는 **같은 `sourceGroupId`**를 적는다. 같은 라벨 파일 안에서 출처 그룹이나 완전히 같은 이미지 바이트의 해시가 두 분할에 걸치면 거부한다. 개발·최종 평가 라벨을 별도 파일로 두는 경우에는 위 `check:labeled-splits`로 두 파일을 함께 확인해야 한다. 합성 라벨에는 분할 필드를 생략할 수 있지만, 하나라도 쓰면 모든 항목에 둘 다 필요하다. 검사는 출처 그룹을 정확히 기입했다는 전제하에서만 크롭·재캡처 누수를 막는다.

비공개 예측 파일은 다음 실행 기록을 포함해야 한다. `serverCommit`은 40자리 Git SHA, `executedAt`은 UTC ISO 시각이다. 값은 실제 분석을 실행한 모델·프롬프트·분석 스키마·커밋으로 기록해야 하며, 도구가 그 진위를 자동으로 보증하지는 않는다.

```json
{
  "schemaVersion": 1,
  "run": {
    "modelId": "model-id",
    "promptVersion": "prompt-1",
    "analysisSchemaVersion": "2.1",
    "serverCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "executedAt": "2026-09-28T00:00:00.000Z"
  },
  "predictions": {
    "capture-a": { "inputSha256": "<64자리 SHA-256>", "analysis": "<분석 객체>" }
  }
}
```

`npm run test:labeled-report --prefix server -- LABELS.json PREDICTIONS.json IMAGES_DIR`는 비공개 평가 시 이미지 원본 검사까지 통과해야 점수를 낸다. 합성 평가만 기존 두 파일 형식으로 실행할 수 있다. 이 명령은 파일을 읽기만 하며 모델 호출이나 서버 적용을 하지 않는다. 실제 자료·라벨 값은 Git과 터미널 출력에 넣지 않는다.

평가에 앞서 위 사전 검사로 **라벨이 가리키는 이미지 원본**을 확인한다. 이미지 파일명은 각 `entry.id`에 확장자(`.png`, `.jpg`, `.jpeg`, `.webp`)를 붙인 형태여야 하며, 같은 ID에 두 확장자가 있으면 실패한다. 링크 파일과 이미지 디렉터리 링크도 거부한다. 출력에는 이미지 내용과 라벨 값을 넣지 않는다. 이 절차는 공개 합성 이미지로 검증했으며, 실제 비공개 이미지를 검사하거나 분석한 결과는 아니다.

## 실제 데이터 단계에 들어가기 전에 결정할 평가 계약

1. **입력과 권한:** 동의를 얻은 평가 자료의 출처, 재사용 범위, 삭제 요청 처리, 이미지·URL·식별자 보존 위치를 정한다. 공개 합성 자료와 실제 자료의 목록·리포트를 분리한다.
2. **라벨:** 이미지마다 분류와 제목만이 아니라 분야별 필수 필드, 화면에서 실제 확인되는 근거 영역, 읽을 수 없는 값, 복수 대상·동명이인·이전 가격 같은 모호성을 사람이 기록한다. 사용자 행동과 화면 문구를 별도 라벨로 둔다.
3. **분할:** 수정에 사용한 개발 세트와 최종 평가 세트를 출처 단위로 분리한다. 같은 게시물의 크롭·재캡처가 서로 다른 세트에 들어가지 않도록 해시와 출처를 확인한다.
4. **점수:** 분야별 분류, 필드 정확성, 근거 연결, 위험한 자동 병합, 근거 없는 행동 추론, 삭제·정정 후 남는 기록을 별도로 집계한다. 실패 사례와 분모를 함께 보고한다. 합성 기록 리포트의 21/21을 이 점수에 합산하지 않는다.
5. **실행:** 모델 버전, 프롬프트·스키마 버전, 서버 커밋, 실행 시각과 입력 해시를 결과에 고정한다. 새 모델 응답은 녹화 응답을 자동 덮어쓰지 않고 검토한다.

이 다섯 항목을 실제 자료에 적용하고 품질 수치를 산출하는 일은 **다음 단계**다. 로컬 비공개 평가 자료의 존재 여부나 결과를 이 공개 합성 목록으로 추정하지 않는다.

## 복구 경계

삭제 전 백업을 복원하면 삭제된 자료가 돌아올 수 있다. [`deletion_ledger.js`](../server/src/storage/deletion_ledger.js)는 JSON·관계형 저장소에서 삭제 트랜잭션을 확정하기 **전**에 가져오기 ID와 Source ID의 해시를 별도 파일에 동기화한다. 파일은 `0600`으로 만들고 연속 기록의 해시 체인을 검증한다. 공통 보드 API를 켜면 `LUFFI_KERNEL_DELETION_LEDGER_PATH`가 필수이며, 서버 상태·DB 백업과 **별도로 보존되는 위치**로 지정해야 한다. 경로를 생략하면 서버는 시작을 거부한다.

삭제 기록이 아직 없는 빈 저장소도 독립 파일을 자동 생성하지 않는다. 서버 시작 전에 다음 중 현재 저장소에 맞는 환경 변수 하나만 설정하고 **신뢰할 수 있는 현재 상태**에서 `npm run bootstrap:deletion-ledger --prefix server -- LEDGER.ndjson`을 한 번 실행한다. 이미 파일이 있으면 덮어쓰지 않는다. 서버를 시작할 때는 같은 파일 경로를 `LUFFI_KERNEL_DELETION_LEDGER_PATH`로 지정한다.

- JSON: `LUFFI_KERNEL_STATE_PATH`
- 관계형 DB: `LUFFI_KERNEL_DATABASE_URL`

`npm run check:deletion-ledger --prefix server -- LEDGER.ndjson`은 같은 저장소 변수와 파일 경로로 삭제 기록의 체인·현재 삭제 영수증·되살아난 출처를 확인한다. `{"status":"safe","ledgerEntries":N}`만 출력하고 자료 내용은 출력하지 않는다. PostgreSQL에서는 저장소의 일반 시작 검사와 마찬가지로 아직 남아 있는 관계형 그래프 이관이 실행될 수 있으므로 DB 읽기 전용 명령은 아니다. 파일이 없어졌거나 현재 삭제 영수증이 유효한 파일의 일부에서 빠져도 서버 시작과 검사 모두 실패한다. 실행 중 파일이 사라져도 다음 삭제가 빈 파일을 다시 만들지 않고 실패한다. 개발 중 만든 상태 파일을 그대로 운영용 신뢰 상태로 간주하지 않는다.

복원된 저장소에 과거 활성 자료가 있으면 서버는 `DELETION_LEDGER_RESTORE_UNSAFE`로 시작을 거부한다. 복원본을 사용자에게 제공하지 않는 격리 상태에서 `npm run reconcile:deletion-ledger --prefix server -- LEDGER.ndjson`으로 재적용 대상을 확인하고, 같은 명령 끝에 `--apply`를 붙여 삭제한 다음 일반 서버를 시작한다. 복구 명령은 원본 이미지나 분석 내용을 출력하지 않는다. 삭제 기록은 트랜잭션보다 먼저 쓰이므로 트랜잭션 자체가 실패한 삭제 의도도 나중에 재적용될 수 있다. 이는 자료를 되살리지 않기 위한 의도적인 경계다.

2026-09-27에는 임시 **실제 PostgreSQL 16**에서 합성 캡처로 `pg_dump`→삭제 전 백업 복원 거부→삭제 재적용→삭제 후 백업 복원을 실행했다. 최신 상태 전체를 잃어도 보호하려면 삭제 기록 파일을 DB 백업과 독립적으로 보존해야 한다. 파일 자체까지 잃었을 때 삭제 이력을 재구성하는 기능은 없다. 실물 Android의 외부 공유 시트, 실제 캡처 정확도와 성능도 아직 검증하지 않았다.
