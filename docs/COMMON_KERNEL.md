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
| `POST /v1/kernel/ingestion/reviewed-capture/delete` | `importId`로 확인 캡처의 서버 Source와 연결된 시나리오를 원자적으로 삭제하거나 가져오기 전에 삭제 의사를 기록 |
| `POST /v1/kernel/recipe/scenarios` | 사용자가 직접 확인한 레시피로 근거 그래프·Activity·승인 대기 계획을 한 트랜잭션에서 생성 |
| `POST /v1/kernel/dining/scenarios` | 확인해 가져온 식당·카페 캡처, 지역·시각·인원으로 승인 대기 맛집 계획 생성 |
| `POST /v1/kernel/dining/select-place` | 사용자가 후보 지점을 고르고 캡처 Mention의 장소 신원을 연결한 뒤 선택 작업 완료 |
| `POST /v1/kernel/dining/visit-outcome` | 사용자가 방문 여부를 기록. `visited`일 때만 출처가 있는 방문 관계 생성 |
| `POST /v1/kernel/fashion/scenarios` | 확인해 가져온 패션 상품 캡처로 일정별 코디 계획 제안 |
| `POST /v1/kernel/fashion/confirm-outfit` | 사용자가 코디 슬롯·색상·사이즈·소유 상태를 확인하고 출처가 있는 Outfit 구성 |
| `POST /v1/kernel/fashion/wear-outcome` | 사용자가 실제 착용을 보고. `worn`일 때만 착용 관계 생성 |
| `POST /v1/kernel/beauty/scenarios` | 확인한 뷰티 제품 캡처로 일정별 루틴 계획 제안 |
| `POST /v1/kernel/beauty/confirm-routine` | 사용자가 제품 표기·단계명·순서를 확정하고 출처가 있는 루틴 구성 |
| `POST /v1/kernel/beauty/routine-outcome` | 단계별 사용 결과를 직접 보고. `completed`에만 사용 경험 관계 생성 |
| `POST /v1/kernel/travel/scenarios` | 확인한 관광 장소 캡처로 한 지역의 하루 여행 계획 제안 |
| `POST /v1/kernel/travel/confirm-itinerary` | 사용자가 장소·순서·예정 시각을 확정하고 출처 있는 일정 구성 |
| `POST /v1/kernel/travel/stop-outcomes` | 장소별 실제 방문을 직접 보고. `visited`에만 방문 관계 생성 |
| `POST /v1/kernel/life-tip/scenarios` | 확인한 단계형 생활 꿀팁 캡처 하나로 승인 대기 실천 계획 제안 |
| `POST /v1/kernel/life-tip/confirm-actions` | 사용자가 실천할 원본 단계를 고르고 출처 있는 ActionPlan 구성 |
| `POST /v1/kernel/life-tip/outcomes` | 단계별 실제 실행을 직접 보고. `done`에만 실행 관계 생성 |
| `POST /v1/kernel/shopping/scenarios` | 확인한 상품 캡처 1~8개로 비교·선택 계획 제안 |
| `POST /v1/kernel/shopping/confirm-choice` | 상품 하나와 수량을 직접 확정. 캡처 가격은 시점 한정 표시값으로 저장 |
| `POST /v1/kernel/shopping/purchase-outcome` | 실제 구매 여부를 직접 보고. `purchased`에만 실제 지불액과 구매 관계 생성 |
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

캡처를 삭제하면 앱은 로컬 캡처 제거와 서버 삭제 요청을 같은 스냅샷에 기록한다. 삭제 대기함에는 분석 내용 없이 `importId`와 고정된 `commandId`만 남긴다. 앱은 `POST /v1/kernel/ingestion/reviewed-capture/delete`에 `{ "importId": "...", "commandId": "..." }`를 재전송한다. 서버에 이미 가져온 자료가 있으면 Source와 이를 근거로 연결한 레시피·맛집 시나리오를 같은 트랜잭션에서 지운다. 가져오기가 아직 완료되지 않았거나 응답을 잃은 경우에도 `importId`를 삭제 상태로 기록해 늦게 도착한 가져오기 재시도를 거부한다. 서버 삭제 응답을 확인할 때까지 앱의 삭제 대기 항목을 유지한다.

## 첫 레시피 시나리오

Flutter에서 캡처 분석을 명시적으로 확인하면 `/ingestion/reviewed-capture` 요청을 먼저 기기에 저장한 뒤 재전송한다. 서버가 동기화한 자료는 개발용 보드의 **확인한 자료로 레시피 만들기**에서 선택할 수 있다. 캡처의 재료 문자열과 인분을 계산 입력으로 자동 확정하지 않는다. 사용자가 레시피 이름, 기준·목표 인분, 재료별 기준 수량·단위를 직접 입력하고 최종 확인한다. 캡처가 없어도 개발용 **샘플 레시피로 시작**에서 만든 예시 데이터로 같은 경로를 시험할 수 있다. 샘플 요청은 `synthetic: true`를 보내며 서버가 확인 Source의 provenance와 계획 변경안의 run 메타데이터에 이 표식을 남긴다. `synthetic: true`와 `importId`를 함께 보낼 수 없다. 샘플은 실제 캡처나 실제 재고의 증거가 아니다.

`POST /v1/kernel/recipe/scenarios`에는 Bearer 토큰과 다음 형태의 JSON을 보낸다. `commandId`는 재시도 시 그대로 유지하고, `activityId`는 새 활동 ID다. `importId`는 앞서 성공한 확인 캡처를 근거 출처로 연결할 때만 넣는다. 서버는 전달된 `recipe.id`와 `recipe.revision` 대신 활동에 연결된 새 ID와 revision 1을 부여한다.

```json
{
  "commandId": "confirm-tofu-001",
  "activityId": "cook-tofu-001",
  "confirmed": true,
  "importId": "reviewed-capture-import-id",
  "recipe": {
    "title": "두부국",
    "baseServings": 2,
    "ingredients": [
      {
        "id": "tofu-line",
        "ingredientId": "tofu",
        "name": "두부",
        "quantity": { "status": "known", "amount": 300, "unit": "g" },
        "scaling": "linear",
        "optional": false
      }
    ]
  },
  "targetServings": 4,
  "inventory": []
}
```

레시피 재료는 1~25행이고 제목은 최대 200자, 재료명은 최대 100자다. 기준·목표 인분은 각각 1~50의 정수이며, 수량 상태가 `known`인 재료의 기준 수량은 10억 이하여야 한다. `commandId`, `activityId`, `importId`, 재료 행 `id`와 `ingredientId`는 각각 최대 512자다. 이름·수량·단위의 나머지 조건은 등록된 분야 계약으로 검증한다. 이 API는 초기 재고를 모른다고 간주해 비어 있는 `inventory`만 받으며 `collectInventory: false`도 거부한다. 이미 가진 재고를 0으로 추정하지 않는다. 선택 재료는 `includeOptionalIngredientIds`에 재료 **행 ID**를 명시해야 포함된다. `includeCookTask: false`를 보내면 마지막 요리 완료 기록 작업을 생략할 수 있다.

서버는 확인 Source/Version/Evidence를 만들고, `recipe.confirmed_recipe` 값, 레시피에서 재료 항목으로 가는 `recipe.has_requirement`, 항목의 수량·이름인 `recipe.requirement_value`, 항목에서 재료로 가는 `recipe.requires_ingredient`를 근거가 있는 Assertion으로 저장한다. Entity의 이름은 일반 표기이며 사용자가 입력한 제목·재료명·수량은 Source와 근거가 있는 값에 둔다. 계획 Context는 이 값과 관계를 조회·감시한다. 응답의 `proposalId`는 아직 적용되지 않은 계획 변경안이다. `POST /v1/kernel/planning/accept`에 `{ "proposalId": "...", "commandId": "..." }`를 보내 승인해야 작업이 보드에 나타난다.

계획은 `scale_servings → calculate_requirements → cook` 의존성과 별도 `check_inventory → calculate_requirements` 결과 바인딩으로 구성된다. 인분 계산과 부족 수량 계산은 등록된 순수 capability가 실행하고, 재고는 사용자가 `check_inventory` 결과로 관찰한 값만 사용한다. 재고 결과를 고치면 이를 소비한 계산과 후속 작업은 재검토 전까지 진행할 수 없다. 레시피 근거·관계가 바뀌거나 삭제되면 기존 Context의 실행·계획 승인이 막힌다. 확인 Source를 삭제하면 해당 레시피 Activity와 계획·결과·발급 맥락도 같은 트랜잭션에서 지운다. 연결된 가져오기 Source를 삭제하면 그 출처에서 만든 확인 Source에도 삭제가 전파된다. 삭제된 요청 ID는 재전송해 복구하지 않는다.

이 계획 생성기는 **결정적 작업 틀**이며 AI 모델이 작업 순서를 새로 생성하지 않는다. 조리 단계별 안내는 현재 `recipe.recipe`/Task 계약에 없고 `cook`는 사용자가 실제 완료를 기록하는 한 작업이다. 보드의 재고 관찰값은 버전이 있는 TaskResult에 저장하며 지식 그래프의 재고 Assertion이나 공통 ResourceClaim 재고로 자동 승격하지 않고, 실제 소비량으로 차감하지도 않는다. 이 경로와 토큰은 현재 단일 개발 사용자·JSON 저장소용이다.

## 첫 맛집 시나리오

`POST /v1/kernel/dining/scenarios`는 `commandId`, `activityId`, `confirmed: true`, 확인해 가져온 `importIds`(1~20개), `scheduledAt`, `area`, `partySize`(1~20명)를 받는다. 서버는 식당·카페 자료의 관측 상호·지역·주소로 임시 후보를 만들고 승인 대기 계획을 반환한다. 계획 승인 후 `select_place → review_visit_details → record_visit_outcome`을 수행한다. 두 특수 명령은 활동의 현재 revision, 준비된 작업, 후보 ID를 검사하며 같은 명령 ID 재전송에 안전하다. 선택 명령은 캡처 Mention의 IdentityDecision을 연결하고, 방문 결과 명령은 `visited`일 때만 사용자 보고 출처와 `dining.visited` 관계를 저장한다.

Flutter 개발용 보드는 서버에 동기화된 확인 캡처에서 맛집 활동을 만들고 원본·지도 검색을 열 수 있다. 지도 검색은 실장소 확정이 아니며, 방문 전 정보는 현재 `unknown`으로만 기록한다. 제공자 지점 대조·근거 기반 비교·예약 확인·부분 근거 삭제 재계획은 아직 연결되지 않았다. 세부 계약과 검증 이미지는 [첫 맛집 시나리오](DINING_FIRST_SCENARIO.md)를 참조한다.

## 첫 패션 시나리오

`POST /v1/kernel/fashion/scenarios`는 `commandId`, `activityId`, `confirmed: true`, 패션 상품으로 확인해 가져온 `importIds`(1~5개), `occasion`, `scheduledAt`을 받는다. 서버는 캡처의 관측 제목·근거와 미해결 상품 Mention을 후보로 두고, `confirm_outfit → record_wear` 계획을 승인 대기로 만든다. 같은 제목의 다른 캡처를 자동 병합하지 않는다.

사용자는 `confirm-outfit`에서 캡처별 코디 슬롯, 실제 선택한 색상·사이즈, `owned/candidate/unknown`을 직접 보낸다. 확인 Source/Evidence와 상품 IdentityDecision, Product/Variant/Outfit Entity, `fashion.variant_of`·`fashion.variant_options`·`fashion.has_item`·확인된 `fashion.ownership` 관계를 원자적으로 저장한다. `unknown`은 소유 Assertion을 만들지 않는다. `wear-outcome`의 `worn`만 사용자 보고 출처와 `fashion.wore_outfit` 관계를 만든다. 캡처가 삭제되면 현재 개발 저장소는 관련 Activity와 파생 확인·착용 출처를 지우고 명령 재전송을 차단한다. 자세한 예시와 이미지 API 검증은 [첫 패션 시나리오](FASHION_FIRST_SCENARIO.md)를 참조한다.

## 첫 뷰티 시나리오

`POST /v1/kernel/beauty/scenarios`는 `commandId`, `activityId`, `confirmed: true`, 확인해 가져온 뷰티 상품 `importIds`(1~5개), `occasion`, `scheduledAt`을 받는다. 서버는 관측 제목과 근거를 후보로 두고 `confirm_routine → instantiate_routine → record_routine_outcome` 계획을 승인 대기로 만든다. 캡처만으로 소유·피부 적합성·효능이나 단계 순서를 확정하지 않는다.

사용자는 `confirm-routine`의 `selections` 배열 순서로 사용할 캡처, `variantLabel`, `stepTitle`을 직접 확정한다. 확인 결과는 버전 1의 RoutineTemplate이며 `instantiate_routine`은 기존 시스템 capability로 일정 시각의 RoutineOccurrence를 만든다. `routine-outcome`은 모든 단계에 `completed/skipped/unknown`을 명시하며 `completed`에만 사용자 보고 출처와 `beauty.use_experience` 관계를 저장한다. 출처 삭제는 현재 개발 저장소에서 해당 Activity와 파생 루틴·경험을 함께 제거한다. 상세 흐름, 지식 그래프 경계, 이미지 API 검증은 [첫 뷰티 시나리오](BEAUTY_FIRST_SCENARIO.md)에 적었다.

## 첫 여행 시나리오

`POST /v1/kernel/travel/scenarios`는 `commandId`, `activityId`, `confirmed: true`, 확인해 가져온 관광 장소 `importIds`(1~8개), `area`, `startAt`을 받는다. 서버는 캡처의 관측 장소명·지역과 미해결 Mention을 후보로 보존하고 `confirm_itinerary → record_stop_outcomes` 계획을 승인 대기로 만든다. 장소명과 지역 근거가 바뀌면 오래된 계획은 승인할 수 없다.

사용자는 `confirm-itinerary`의 `selections` 배열 순서로 장소와 `plannedAt`을 확정한다. Stop의 순서·예정 시각·장소 연결은 사용자 확인 근거로 저장한다. `stop-outcomes`는 모든 Stop에 `visited/skipped/unknown`을 명시하며, `visited`에만 사용자 보고 출처와 `travel.visit` 관계를 만든다. 화면에서 읽은 지역은 지도 제공자 검증 주소가 아니다. 자세한 범위와 검증 이미지는 [첫 여행 시나리오](TRAVEL_FIRST_SCENARIO.md)를 참조한다.

## 첫 생활 꿀팁 시나리오

`POST /v1/kernel/life-tip/scenarios`는 `commandId`, `activityId`, `confirmed: true`, 확인해 가져온 `importId` 하나를 받는다. 서버는 `unknown` 분석 전체가 아니라 화면 근거가 있는 `생활·팁` 제목과 연속된 단계 fact만 후보로 삼고, `confirm_actions → record_outcomes` 계획을 승인 대기로 만든다. 제목이나 단계 근거가 바뀌면 기존 계획은 승인할 수 없다.

사용자는 `confirm-actions`의 `factIndexes`로 실천할 단계를 원본 순서대로 고른다. 각 Action의 텍스트는 캡처 fact와 사용자 확인 출처에 연결한다. `outcomes`는 모든 Action에 `done/skipped/unknown`을 명시하며, `done`에만 사용자 보고 출처와 `life_tip.execution_for_action` 관계를 만든다. 자세한 범위와 검증 이미지는 [첫 생활 꿀팁 시나리오](LIFE_TIP_FIRST_SCENARIO.md)를 참조한다.

### 첫 쇼핑 시나리오

`POST /v1/kernel/shopping/scenarios`는 `commandId`, `activityId`, `confirmed: true`, 확인해 가져온 `importIds`(1~8개), `purpose`를 받는다. 화면 근거가 있는 상품명과 원화 `가격` fact를 후보로 사용하고 `confirm_choice → record_purchase_outcome` 계획을 승인 대기로 만든다. 사용자는 `confirm-choice`에서 상품 하나와 수량을 확정한다. `purchase-outcome`의 `purchased/not_purchased/unknown`은 별도 사용자 보고이며, `purchased`일 때만 `actualPaidKrw`가 필요하다. 캡처 표시 가격을 결제액으로 추론하지 않는다. 자세한 그래프 경계와 검증 이미지는 [첫 쇼핑 시나리오](SHOPPING_FIRST_SCENARIO.md)를 참조한다.

## 일관성과 현재 경계

개발용 JSON 저장소는 **같은 store 인스턴스** 안에서 읽기와 쓰기를 직렬화한다. 전체 상태를 복제하고 임시 파일 쓰기·파일 동기화·rename·디렉터리 동기화를 거쳐 저장한다. 변경 함수가 실패하면 이전 상태를 유지하고, 손상된 파일을 빈 데이터로 자동 초기화하지 않는다. rename 후 마지막 동기화에서 오류가 나면 파일이 이미 바뀌었을 수 있으므로 재시도에는 같은 명령 ID를 사용한다. 서로 다른 프로세스나 store 인스턴스가 같은 파일을 쓰는 것은 잠그지 못하며 전체 파일 복제·저장이 데이터 양에 비례한다.

PostgreSQL DDL은 런타임 저장소가 아니다. 현재 DB 연결, migration 실행기, JSON→SQL 이전기, SQL 기반 트랜잭션 어댑터가 없고 서버는 JSON 파일을 사용한다. DDL만 실행해도 서버 저장 방식이 바뀌지 않는다. 기존 JSON 상태에 새 필드를 채우는 버전별 자동 업그레이드도 없으며 현재 상태 계약에 맞지 않으면 `KERNEL_SCHEMA_MISMATCH`로 거부한다. 여러 서버 인스턴스, 운영 권한 관리, 원본 자산 업로드, 실제 알림 전달, 외부 예약·구매 실행은 아직 적용되지 않았다.

기존 Flutter 계획함은 로컬 Plan/metadata 기반으로 계속 동작한다. 새 Activity Board와 양방향 동기화하지 않는다. 이전에는 안정적인 기존 Task ID 매핑, 원본 접근 가능 여부, 알림 중복 제거를 먼저 해결해야 하므로 현재 자동 이전을 수행하지 않는다. AI 모델을 호출해 목적에서 PlanDraft를 생성하는 부분도 아직 새 커널에 연결되지 않았다. 현재는 생성된 후보를 안전하게 검증·적용할 수 있는 경로까지 구현했다.

## 검증

`server` 디렉터리에서 `npm test`, 저장소 루트에서 `flutter analyze --fatal-infos`와 `flutter test`를 실행한다. 핵심 회귀는 근거 없는 사실 보존, 충돌/시간/철회, queryWatch에 새 정보 도착, 빈 검색 이후 후보 발견, 최대 2홉과 범위 보존, 인분 변경과 단위 차이, 두 활동의 독립 TaskResult, 오래된 계획 변경안 차단, 자원 초과 배분·시간 중첩·재고 관측 변경, 명령 재전송, 재시작 복구, 사용자 범위 밖의 근거 참조 차단이다. PostgreSQL 실행 검증이나 운영 환경 검증을 대신하는 테스트는 아니다.
