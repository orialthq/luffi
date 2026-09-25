# Luffi 공통 커널: `dev` 구현 계약

이 문서는 공통 개발 아키텍처를 현재 코드에 반영한 범위와 사용 계약을 기록한다. 오래된 캡처 분석·계획함을 한 번에 교체하지 않는다. 기존 기능은 동작하고, 새 커널은 개발용 API와 디버그 보드에서 독립적으로 실행한다.

## 코드 경계

| 경계 | 구현 | 상태의 기준 |
| --- | --- | --- |
| 지식 | `server/src/knowledge` | Source/Version/Evidence, Entity/Mention/IdentityDecision, Assertion과 Resolution, readSet/queryWatches |
| 검색 | `server/src/retrieval` | 타입·이름·외부 ID 후보, 범위가 명시된 최대 2홉 관계 탐색, 근거 재검증과 발견 의존성 |
| 활동 | `server/src/activities` | Activity/Task/TaskResult/Artifact, 실행 DAG, PlanRevision/Patch, 반복 회차·리마인더 상태 |
| 자원 배분 | `server/src/composition` | 활동 사이의 Resource/ResourceClaim, 수량·단위·점유 시간·관측 신선도 |
| 분야 | `server/src/domains` | 레시피·맛집·패션·뷰티의 타입/관계/기능/결과물/렌더러 계약과 순수 계산 |
| 가져오기 | `server/src/ingestion` | 사용자가 확인한 기존 분석 결과를 출처가 있는 지식 명령으로 변환 |
| 통합 | `server/src/common/kernel_service.js` | 인증된 소유자, 발급 맥락, 변경안, 영향 알림, 도메인 실행을 하나의 저장 트랜잭션으로 조합 |
| 저장 | `server/src/storage/json_state_store.js` | 개발 환경에서 단일 프로세스 원자적 파일 저장 |
| SQL 초안 | `server/migrations/001_common_kernel.sql` | PostgreSQL 테이블·FK·인덱스 DDL. 현재 런타임 저장 어댑터와 데이터 이전기는 없음 |
| 앱 | `lib/data/common_kernel_client.dart`, `lib/features/boards` | 개발 빌드에서만 새 Activity 보드를 읽고 안정적인 Task ID로 명령 전송 |

지식 그래프는 단순한 `entity → 관계 → entity` 테이블이 아니다. 의미 관계의 기준은 근거와 시간·범위가 있는 Assertion이고, 현재 관계/값은 정책 버전이 있는 Resolution에서 파생한다. SourceVersion→Evidence와 Activity→Task 같은 구조적 연결은 별도 기준 데이터다. 원본의 비슷한 이름은 동일 대상의 후보만 만들며, `mention.create → identity.propose → identity.accept`를 거쳐야 연결된다. 철회 시 언급과 원본 근거가 남아 이전 결정을 되돌릴 수 있다.

TaskBoard는 Activity 읽기 모델이다. 화면 순서가 작업 ID나 실행 순서가 아니다. 작업은 `activityId + taskId`로 식별하고, 선행조건/입출력 바인딩이 실행 DAG를 정의한다. TaskResult는 버전별로 남으며 완료한 작업의 소비 결과를 나중의 새 결과로 몰래 교체하지 않는다. 실행 상태, 진행 가능 여부, 분야 상태, 반복·알림 상태는 서로 다른 값이다.

Flutter 목록은 요약 API를 페이지별로 읽고, 사용자가 활동을 열 때만 전체 보드를 요청한다. 기존 `/boards` 전체 목록은 개발 호환 경로이며 결과 이력까지 모두 실어 보내므로 활동이 늘어날수록 응답이 커진다. 커서 조회는 ID 순서이며 조회 사이 변경에 대한 고정 스냅샷은 제공하지 않는다.

## 개발 서버에서 사용

새 API는 기존 분석 API와 별도로 Bearer 인증을 요구한다. `LUFFI_KERNEL_OWNER_ID`는 현재 **단일 개발 사용자**의 서버 측 소유자이며 요청 본문이 이를 바꿀 수 없다. 길이 32자 이상의 임의 토큰을 서버 환경변수 `LUFFI_KERNEL_TOKEN`으로 제공한다. 토큰이 없으면 새 경로는 503이고 기존 분석 API는 그대로 동작한다. 토큰을 설정했는데 길이가 부족하거나 소유자가 없으면 서버 시작 단계에서 오류가 난다. 상태 파일의 기본 위치는 Git에서 제외된 `server/data/common-kernel.json`이다. `LUFFI_KERNEL_STATE_PATH`로 변경할 수 있다.

Flutter 개발 빌드에도 같은 토큰을 `--dart-define=LUFFI_KERNEL_TOKEN=...`으로 전달하면 Drawer의 **공통 활동 · 개발용** 메뉴가 나타난다. 릴리스/프로필 빌드에서는 메뉴와 API 요청을 모두 막는다. 이 토큰은 개발 편의용 단일 사용자 자격이며 운영 배포 인증 방식으로 사용하지 않는다. 기존 서버 주소는 `ORI_ANALYSIS_BASE_URL` 설정을 재사용한다.

| 경로 | 의미 |
| --- | --- |
| `GET /v1/kernel/contracts` | 커널·팩·capability·renderer 버전 |
| `GET /v1/kernel/boards`, `/boards/{activityId}` | Activity 보드 읽기 모델 |
| `GET /v1/kernel/board-summaries?limit=20&cursor=...` | ID 순서의 가벼운 Activity 요약 목록. 한 페이지 최대 100개, `nextCursor`로 이어 읽기 |
| `POST /v1/kernel/activities/commands` | ID·expectedRevision이 있는 작업·활동 명령 |
| `POST /v1/kernel/activities/run-task` | 순수 시스템 capability의 입력 검사·실행·결과 저장·완료를 한 트랜잭션에서 처리 |
| `POST /v1/kernel/knowledge/commands` | Source/Entity/Evidence/Assertion/Identity 명령 |
| `POST /v1/kernel/knowledge/query`, `/resolve`, `/context`, `/watch` | 근거 조회, 현재 값 해결, 서버 발급 ContextSnapshot, 활동의 변경 구독 |
| `POST /v1/kernel/knowledge/search` | 후보 Entity와 근거·탐색 이유·관계·조회 의존성 반환 |
| `GET /v1/kernel/resources` | 소유자의 자원별 현재 가용량·배분 상태 |
| `POST /v1/kernel/resources/commands` | `resource.create`, `resource.observe`, `claim.acquire`, `claim.release` |
| `POST /v1/kernel/resources/availability` | `{resourceId,timeRange?}`에 대한 가용량·유지 중인 claim 투영 |
| `POST /v1/kernel/planning/proposals`, `/accept` | 사전 컴파일된 계획 변경안의 저장·재검증·적용 |
| `POST /v1/kernel/ingestion/reviewed-capture` | 사용자 확인된 기존 분석의 원자적 가져오기 |
| `POST /v1/kernel/domains/execute` | 부수 효과가 없는 등록된 분야 계산만 실행 |

AI가 만든 PlanDraft/PlanPatch를 적용할 때는 `/knowledge/context`가 돌려준 `contextId`를 사용한다. 서버는 이 ID에 연결된 readSet, 없던 사실을 감시하는 queryWatches, 검색의 발견 의존성, 자원 조건, 정책·시간 조건과 Activity revision을 다시 검사한다. API가 전달한 임의 `context` 객체는 신뢰하지 않는다. 발급 맥락은 서버 상태에 저장되며 사용 기한은 1시간이다. `/planning/proposals`는 실제 상태를 바꾸지 않는 컴파일 검사를 먼저 하고, `/planning/accept`에서 기준 버전과 맥락을 다시 검사한다. 같은 명령 ID·같은 요청은 재전송해도 한 번만 처리하고, 같은 ID에 다른 내용은 충돌이다.

## 검색과 ContextSnapshot

`/knowledge/search`는 `typeIds`, `text`, `externalIds`, `seedEntityIds`, `predicates`, `limit`, `maxHops`, `direction`, `atTime`과 `scope` 또는 `scopes`를 받는다. `externalIds`는 `{제공자:외부ID}` 형태의 문자열 맵이다. 이름은 정규화한 표제어의 일치·포함 조건으로 찾으며 임베딩 검색은 HTTP 경로에 연결되어 있지 않다. 별도 모듈의 semantic adapter는 후보 ID만 공급할 수 있고, 결과의 소유자·활성 상태·근거는 기준 상태에서 다시 검사한다.

타입은 반환 후보를 제한한다. 명시적인 seed는 다른 타입의 중간 대상을 거쳐 탐색할 수 있다. 기본 탐색은 양방향·최대 2홉이며 원래 관계의 subject/object 방향은 결과에 유지한다. 결과 기본 한도는 20개, 최대 100개이고 후보 탐색 예산은 200개다. `truncated`가 결과·후보·탐색·Resolution 예산 초과를 구분한다. JSON 구현은 소유자의 목록을 순회하며 대규모 검색 인덱스가 아니다.

결과의 `reasons`는 이름·외부 ID·seed·관계 중 어떤 이유로 찾았는지 설명한다. `supports`, `evidenceIds`, `relations`는 실제 Assertion 또는 확정된 신원 연결의 근거를 가리킨다. 이름이 같아도 Entity를 합치지 않는다. 근거 없는 Entity 메타데이터는 `verification: "unverified"`로 남고 관계 확장이나 계획의 사실 근거로 승격되지 않는다. `verified`도 메타데이터 전체의 진실성을 뜻하지 않으며, 계획에서 쓸 값은 목적에 맞는 사실 슬롯을 별도로 resolve해야 한다.

관계 탐색은 등록된 관계 중 해당 시점과 **명시한 정확한 범위**에서 해결된 것만 사용한다. 출처·버전·근거의 활성 상태, 독립/결합 근거 집합, 관측 시간, 유효 기간, 신선도와 충돌 정책을 다시 검사한다. scope를 생략하면 개인 관측뿐 아니라 `global`이라는 이름의 범위도 자동 채택하지 않는다. 여러 scope를 지정해도 서로 같은 범위로 합치지 않는다.

`/knowledge/context`의 `queries`는 필수 배열이며 최대 100개다. 직접 사실 조회가 없으면 `[]`를 보낸다. `activityId`, `retrievalQuery`, `resourceIds`는 선택 입력이다. 직접 지식 조회와 검색은 같은 `atTime`을 사용한다. 최상위와 `retrievalQuery.atTime`을 모두 지정하면 같은 시점이어야 하며, 둘 다 생략하면 하나의 현재 시각을 사용한다. 이 시점은 현재 보유한 지식의 유효성을 평가하는 시각이고 과거 전체 저장 상태를 복원하는 기능은 아니다.

```json
{
  "activityId": "dinner-activity",
  "queries": [],
  "retrievalQuery": {
    "text": "두부",
    "typeIds": ["recipe.ingredient"],
    "scope": { "type": "activity", "id": "dinner-activity" },
    "maxHops": 2
  },
  "resourceIds": ["pantry-tofu"]
}
```

Context는 선택 Entity, 직접 조회한 Resolution, Assertion, 최대 500자의 근거 조각, 부족한 사실·충돌·오래된 사실, 활동 목표·제약·작업 상태·버전을 담는다. 검색 결과는 `retrieval`에 별도로 보존한다. `missingFacts/conflicts/staleFacts`는 `queries`로 직접 요청한 Resolution을 분류한 값이다. 검색 결과 전체를 자동으로 해결된 사실 목록에 넣지는 않는다.

`/knowledge/watch`에 `{activityId,contextId}`를 보내거나, `contextId`와 함께 활동 명령을 적용하거나, 계획 변경안을 승인하면 그 맥락을 활동의 구독으로 등록한다. 같은 활동에 새 맥락을 등록하면 이전 구독을 대체한다. 지식 명령과 가져오기 후에는 영향을 받는 활동의 `pendingChanges`를 기록한다. 검색은 기존 Assertion의 변경뿐 아니라 빈 검색 이후 새로운 Entity/신원 연결이 생긴 경우와 관계 registry 변경도 무효화한다. Entity/신원 변경은 현재 소유자 단위로 보수적으로 감시한다. 실행 시에도 저장된 의존성을 다시 확인하며, 별도 주기 작업 없이 시간이 흘렀다는 이유만으로 화면에 변경 알림을 생성하는 것은 아니다.

## ResourceClaim과 활동 연결

ResourceClaim은 저장된 계획 안에서 같은 자원을 중복 배분하지 않게 한다. 모든 claim은 `guarantee: "planning_only"`이며 실제 소유·재고 차감·구매·예약 확정의 증거가 아니다. 자원 ID가 다르면 별개 자원으로 취급하므로 물리적으로 같은 물건을 알아서 합치지 않는다. `resource.observe`의 `observationId`는 관측 참조값이며 현재 지식 커널의 Assertion/Evidence에 대한 FK나 자동 연결은 없다.

| 명령 | 주요 payload | 의미 |
| --- | --- | --- |
| `resource.create` | `resourceId,kind,allocationMode?,unitPolicy?,availability?` | 수량 또는 독점 자원 생성. 관측을 생략하면 unknown |
| `resource.observe` | `resourceId,availability` | 현재 총 가용량 관측 교체. 이미 claim을 뺀 잔량을 입력하지 않음 |
| `claim.acquire` | `claimId,resourceId,activityId,quantity,unit,timeRange?` | 알려져 있고 신선한 가용량 안에서 배분 |
| `claim.release` | `claimId,resourceId,activityId` | 같은 자원·활동의 held claim 해제 |

명령에는 `commandId`를 포함한다. `expectedRevision`을 보내면 관측·획득·해제에서는 **자원 revision**을 검사하고 생성에서는 0을 기대한다. 획득·해제·관측마다 자원 revision이 증가한다. 재전송은 원래 영수증을 반환하므로 현재 상태 표시는 `/resources` 또는 `/resources/availability`로 다시 읽는다. 이미 해제한 claim의 ID를 다른 획득에 재사용할 수 없다.

`activity.create`와 `recurrence.materialize`가 성공하면 같은 저장 트랜잭션에서 자원 커널에 해당 활동을 자동 등록한다. HTTP API는 `activity.register`나 `kernel:` 접두어 명령 ID를 외부에 허용하지 않는다. claim 명령은 실제 Activity의 소유권도 확인하며 종료된 활동의 새 획득은 거부한다. `activity.cancel`과 `activity.complete`는 같은 트랜잭션에서 그 활동의 held claim을 모두 해제하고 자원·검색 구독을 제거한다. 보드 응답은 해제 이력을 포함한 그 활동의 `resourceClaims`를 담는다. 해제는 계획 점유만 돌려주므로 실제 소비 후 재고 변화는 별도 관측으로 갱신해야 한다.

수량 자원은 canonical 단위·소수 정밀도·허용 변환을 명시한다. `consumable`은 시간이 달라도 모든 held claim을 합산한다. `concurrent`는 시간 구간 안에서 동시에 점유한 최대량을 계산한다. `exclusive`는 단위가 `slot`이고 용량이 0 또는 1이다. 시간 구간은 `[start,end)`이며 시간이 없으면 모든 구간과 겹치는 것으로 취급한다. 알려지지 않은 수량과 오래된 관측은 `capacity/remaining: null`이고, 알려진 빈 재고는 0이다. 낮아진 관측 때문에 기존 배분을 감당하지 못하면 claim을 지우지 않고 `overcommitted`로 표시한다.

Context의 명시적 `resourceIds`는 최대 100개다. 해당 Activity가 이미 held한 claim의 자원도 자동 포함한다. 결과에는 `resourceAvailability`와 자원 revision·관측 상태·`freshUntil`을 담은 `resourceReads`가 들어가며, 등록한 맥락은 아직 claim이 없어도 해당 자원의 변경을 감시한다. 관측·획득·해제는 영향을 받는 활성 활동의 `pendingChanges`를 기록한다. 계획 적용과 자동 실행은 자원 revision뿐 아니라 현재 관측 상태도 재검사하므로, 쓰기 없이 `freshUntil`이 지나 known→stale이 된 경우에도 이전 맥락을 거부한다.

자원 가용량은 조회 순간의 관측 신선도와 계획 점유를 투영한다. Context의 지식 `atTime`으로 과거 재고를 복원하지 않으며 Context는 자원별 전체 투영만 받는다. 특정 구간이 필요하면 `/resources/availability`의 `timeRange`를 사용한다. claim은 시간이 지났다는 이유만으로 자동 해제되지 않고, 여러 자원을 한꺼번에 획득하는 HTTP 배치 명령은 없다.

## 기존 캡처 가져오기

기존 캡처 가져오기는 `reviewed: true`가 명시된 경우에만 허용한다. 현재 서버가 원본 이미지를 업로드받아 보관하지 않았으면 `asset.status`를 `device_only` 또는 `unavailable`로 둔다. 캡처 분석에 근거가 있는 필드는 원본 스냅샷 범위의 `ingestion.extracted_field` 주장으로 저장한다. 레시피 인분·실재 재고·식당 예약 확정·제품 소유처럼 기존 분석만으로 확인할 수 없는 값은 만들지 않는다. 업로드되지 않은 원본을 서버에 있는 것처럼 표시하지 않는다.

## 일관성과 현재 경계

개발용 JSON 저장소는 **같은 store 인스턴스** 안에서 읽기와 쓰기를 직렬화한다. 전체 상태를 복제하고 임시 파일 쓰기·파일 동기화·rename·디렉터리 동기화를 거쳐 저장한다. 변경 함수가 실패하면 이전 상태를 유지하고, 손상된 파일을 빈 데이터로 자동 초기화하지 않는다. rename 후 마지막 동기화에서 오류가 나면 파일이 이미 바뀌었을 수 있으므로 재시도에는 같은 명령 ID를 사용한다. 서로 다른 프로세스나 store 인스턴스가 같은 파일을 쓰는 것은 잠그지 못하며 전체 파일 복제·저장이 데이터 양에 비례한다.

PostgreSQL DDL은 런타임 저장소가 아니다. 현재 DB 연결, migration 실행기, JSON→SQL 이전기, SQL 기반 트랜잭션 어댑터가 없고 서버는 JSON 파일을 사용한다. DDL만 실행해도 서버 저장 방식이 바뀌지 않는다. 기존 JSON 상태에 새 필드를 채우는 버전별 자동 업그레이드도 없으며 현재 상태 계약에 맞지 않으면 `KERNEL_SCHEMA_MISMATCH`로 거부한다. 여러 서버 인스턴스, 운영 권한 관리, 원본 자산 업로드, 실제 알림 전달, 외부 예약·구매 실행은 아직 적용되지 않았다.

기존 Flutter 계획함은 로컬 Plan/metadata 기반으로 계속 동작한다. 새 Activity Board와 양방향 동기화하지 않는다. 이전에는 안정적인 기존 Task ID 매핑, 원본 접근 가능 여부, 알림 중복 제거를 먼저 해결해야 하므로 현재 자동 이전을 수행하지 않는다. AI 모델을 호출해 목적에서 PlanDraft를 생성하는 부분도 아직 새 커널에 연결되지 않았다. 현재는 생성된 후보를 안전하게 검증·적용할 수 있는 경로까지 구현했다.

## 검증

`server` 디렉터리에서 `npm test`, 저장소 루트에서 `flutter analyze --fatal-infos`와 `flutter test`를 실행한다. 핵심 회귀는 근거 없는 사실 보존, 충돌/시간/철회, queryWatch에 새 정보 도착, 빈 검색 이후 후보 발견, 최대 2홉과 범위 보존, 인분 변경과 단위 차이, 두 활동의 독립 TaskResult, 오래된 계획 변경안 차단, 자원 초과 배분·시간 중첩·재고 관측 변경, 명령 재전송, 재시작 복구, 사용자 범위 밖의 근거 참조 차단이다. PostgreSQL 실행 검증이나 운영 환경 검증을 대신하는 테스트는 아니다.
