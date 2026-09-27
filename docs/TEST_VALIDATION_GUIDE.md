# 시나리오·이미지 검증 안내

새 팀원이 **무슨 데이터를 넣었고, 무엇이 추출됐으며, 어느 사용자 결정 후 어떤 기록이 생기는지** 확인하기 위한 안내다. 이 문서는 테스트의 실제 주장(assertion)을 요약한다. 시나리오 보드는 `dev`의 공통 커널 검증 경로이며 앱의 기본 캡처·정리 흐름이나 출시 품질을 모두 검증했다는 뜻은 아니다. 각 분야의 상세 계약은 아래에 연결한 시나리오 문서를 참고한다.

## 먼저 알아둘 것

```text
합성 PNG 또는 기존 캡처
  → /v1/analyze: 화면에 보이는 값과 근거 ID 추출
  → 사용자가 원본을 보고 확인: reviewed-capture 가져오기
  → Source / SourceVersion / Evidence / 추출 필드 저장
  → 분야별 시나리오 제안 → 사용자가 계획 승인
  → TaskBoard에서 항목·순서·옵션을 확정
  → 별도 결과 보고가 있을 때만 구매·방문·착용·사용·수행·실천 기록
  → 근거 정정·철회·삭제 시 영향받는 보드와 연결 재검토
```

**이미지에 적힌 내용은 '관찰된 문구'이지 실제 행동의 증거가 아니다.** 예를 들어 운동 화면의 `스쿼트 10회`는 운동 계획 후보이고, 사용자가 수행했다고 보고한 `10회`는 별도 결과다. 식당을 선택해도 방문한 것은 아니며, 상품의 표시 가격은 실제 결제액이 아니다. 계획 제안도 승인 전에는 실행 가능한 보드가 아니다.

테스트에 쓰는 `server/test/fixtures/*.png`는 합성 화면이다. 짝이 되는 `*_live_analysis.json`은 그 PNG를 과거 실제 `/v1/analyze`에 보낸 결과를 보존한 파일이다. **기본 테스트는 이 응답을 재생**하므로 외부 AI 호출 없이 반복 가능하다. 일부 통합 테스트는 PNG 바이트를 로컬 HTTP API로 보내 해시와 요청 경로를 검증하지만, 그 API의 분석 서비스는 저장된 응답을 돌려준다. `test:*image-live`만 현재 실행 중인 개발 서버를 통해 모델을 새로 호출한다. 새 모델 응답은 출력이 달라질 수 있으며, 일반 실행은 저장된 응답 파일을 바꾸지 않는다.

서버에 가져온 테스트 캡처의 `asset.status: unavailable`은 **이미지가 서버에 영구 저장됐다는 뜻이 아니다.** API 전송·분석과 서버 자산 보관은 별개다. 일반 서버 테스트는 브라우저나 실제 휴대폰에서 사용자가 화면을 누르는 전체 과정을 자동화하지 않는다. Flutter 화면·클라이언트 테스트는 별도다. [Android 에뮬레이터 수동 검증](ANDROID_E2E_VALIDATION.md)에서는 갤러리→실제 분석 API→사용자 검토→그래프 동기화→레시피·쇼핑 보드 연결을 확인했다.

## 한 흐름 끝까지: 두부 달걀 볶음과 장보기

이 사례는 [변형 시나리오 테스트](../server/test/scenario_variations.test.js)의 `recipe amount 'as needed'...`와 `image-backed recipe basket...`에서 JSON 파일 저장소와 관계형 저장소 양쪽으로 실행된다.

| 순서 | 들어온 것·사용자 결정 | 확인한 결과 |
| --- | --- | --- |
| 1. 이미지 | [`variation_recipe_tofu_egg_as_needed.png`](../server/test/fixtures/variation_recipe_tofu_egg_as_needed.png)와 [저장된 분석 응답](../server/test/fixtures/variation_recipe_tofu_egg_as_needed_live_analysis.json) | `recipe`, 제목 `두부 달걀 볶음`, 2인분, 두부 `300g`, 달걀 `2개`, 소금 `약간`/단위 없음, 조리 문구 3개. 각 추출 항목은 이미지 근거 ID를 가진다. |
| 2. 확인해 가져오기 | 사용자가 분석을 확인한 `reviewed: true` 캡처 | 원본 시점의 Source·Version·Evidence와 `ingestion.extracted_field`가 생긴다. 이미지의 문자열 `300`이나 `약간`을 계산 가능한 사용자 확정 수량으로 자동 승격하지 않는다. |
| 3. 레시피 확정·승인 | 사용자가 두부 `300g`, 달걀 `2 count`, 소금 `as_needed`, 기준 2인분·목표 4인분을 명시하고 계획 제안을 승인 | 레시피와 재료의 `recipe.has_requirement`·`recipe.requirement_value` 등 근거 관계, `scale_servings`·`check_inventory`·`calculate_requirements` 작업이 생긴다. 소금에 임의 숫자를 붙이지 않는다. |
| 4. 계산 | 인분 환산 작업 실행, 재고 관측은 빈 배열로 보고 | 필요량은 두부 `600g`, 달걀 `4개`, 소금 `필요한 만큼`. 빈 재고 목록은 재고 0이 아니므로 두부·달걀의 부족량은 `unknown`이다. |
| 5. 쇼핑 연결 | 별도 [두부 상품 이미지](../server/test/fixtures/variation_shopping_tofu_ingredient.png)에서 `부침용 두부 300g`, 표시가 `2,400원`을 읽고 상품 선택 보드를 승인·연결 | `recipe_shopping`과 확인된 두 결과의 연결이 생긴다. 레시피 계산이 준비되면 쇼핑 보드에 필요 재료가 **읽기 전용**으로 보인다. 연결·상품 선택만으로 구매나 재고 증가 관계는 생기지 않는다. |
| 6. 근거 변경 | 두부 필요량의 근거 관계를 철회하거나 레시피 캡처를 삭제 | 필요 재료는 `stale`이 되어 과거 수량을 숨긴다. 삭제 시 레시피 보드·연결은 사라지지만 독립 쇼핑 보드는 남는다. |

장보기 묶음 변형에서는 두부·달걀 상품을 각각 고르고 소금은 미선택으로 남긴다. 상품별 `purchased / not_purchased / unknown` 보고를 따로 기록하고, **실제 보유량은 그 뒤 별도 관측**한다. 레시피를 고친 뒤에는 완료된 계산·구매 기록을 덮지 않고 새 레시피 활동에서 재계산해 쇼핑 계획 반영을 검토한다. 관련 테스트는 같은 파일의 `image-backed recipe basket...`, `one inventory observation...`, `a corrected image-backed recipe...`와 [레시피 그래프 정정 테스트](../server/test/recipe_graph_correction.test.js)다.

## 분야별로 무엇을 확인했나

아래 표의 `입력 → 추출`은 저장된 실제 분석 응답의 대표값이다. 각 `[PNG]`는 입력 화면이고 `[응답]`은 그 화면의 모델 출력이다. 오른쪽은 **사용자 확인 후 보드에서 검증한 행동 경계**다. 같은 이름의 캡처라도 자동으로 같은 실물·장소로 합치지 않는다.

| 분야 | 대표 입력 → 추출 | 보드·그래프에서 검증한 것 | 주요 테스트 |
| --- | --- | --- | --- |
| 레시피 | [PNG](../server/test/fixtures/recipe_tomato_egg_generated.png) · [응답](../server/test/fixtures/recipe_tomato_egg_live_analysis.json) → 토마토 달걀 볶음, 달걀 2개·토마토 200g·식용유 1큰술, 순서 3개 | 사용자가 수량·단위를 확정하고 계획을 승인한 뒤 4인분 환산. 재고 미확인을 0으로 바꾸지 않음. 재료·분량·순서를 함께 정정하고 이전 완료 결과를 보존 | [이미지→보드](../server/test/recipe_image_e2e.test.js), [시나리오](../server/test/recipe_scenario_service.test.js), [정정](../server/test/recipe_graph_correction.test.js) |
| 맛집 | [PNG](../server/test/fixtures/dining_a_seongsu.png) · [응답](../server/test/fixtures/dining_a_seongsu_live_analysis.json) 등 4장 → 모퉁이식당 성수점·연남점, 성수국수집 | 같은 상호의 다른 지점을 분리. 사용자가 후보를 골라도 방문은 미기록. `visited` 보고에만 방문 관계. 지점 정정·근거 삭제·재시작 후 현재 근거 확인 | [이미지→지점](../server/test/dining_image_e2e.test.js), [시나리오](../server/test/dining_scenario_service.test.js) |
| 패션 | [PNG](../server/test/fixtures/fashion_a_blazer.png) · [응답](../server/test/fixtures/fashion_a_blazer_live_analysis.json) 및 바지 화면 → 상품 제목·패션 태그·화면의 옵션 문구 | 사용자가 코디 자리·색상·사이즈·소유 상태를 직접 확정. `worn` 보고만 착용 관계. 옵션·자리 정정 뒤 과거 착용 기록 보존 | [시나리오](../server/test/fashion_scenario_service.test.js) |
| 뷰티 | [PNG](../server/test/fixtures/beauty_a_cleanser.png) · [응답](../server/test/fixtures/beauty_a_cleanser_live_analysis.json) 및 보습 크림 화면 → 클렌징 젤 150 mL/세안, 보습 크림 | 제품·단계·순서 확정 → 루틴 회차 생성 → `completed` 단계만 사용 경험. 같은 제품을 서로 다른 단계에 재사용해도 단계별 기록은 분리 | [시나리오](../server/test/beauty_scenario_service.test.js) |
| 여행 | [PNG](../server/test/fixtures/travel_a_viewpoint.png) · [응답](../server/test/fixtures/travel_a_viewpoint_live_analysis.json) 및 해안 산책 화면 → 제주 장소와 위치 근거 | 지역·장소·순서·예정 시각을 사용자 확인. `visited`만 방문 관계. 방문 뒤 일정 정정은 완료 결과를 바꾸지 않고 후속 활동으로 진행 | [시나리오](../server/test/travel_scenario_service.test.js) |
| 생활 꿀팁 | [PNG](../server/test/fixtures/life_tip_receipts.png) · [응답](../server/test/fixtures/life_tip_receipts_live_analysis.json) → 영수증 정리 3단계; 운동 준비 팁은 `facts: []`, `steps: [1,2,3]` | 근거 있는 순서형 `facts`나 `steps`만 후보. 선택한 단계만 계획으로 만들고 `done`만 실행 관계. 문구 철회·정정·삭제 시 오래된 계획 차단 | [시나리오](../server/test/life_tip_scenario_service.test.js), [변형](../server/test/scenario_variations.test.js) |
| 쇼핑 | [PNG](../server/test/fixtures/shopping_a_fabric_box.png) · [응답](../server/test/fixtures/shopping_a_fabric_box_live_analysis.json) → 수납함 표시가 `12,900원`; 두부 상품 → `2,400원` | 보이는 가격·선택 수량·실제 결제액·구매 여부·사후 재고를 분리. 이전/현재 가격이 같이 보이면 사용자 검토가 필요. `purchased`만 구매 관계 | [시나리오](../server/test/shopping_scenario_service.test.js), [가격 검토](../server/test/imported_field_review.test.js), [장보기 변형](../server/test/scenario_variations.test.js) |
| 건강·운동 | [PNG](../server/test/fixtures/health_home_workout.png) · [응답](../server/test/fixtures/health_home_workout_live_analysis.json) → 제자리 걷기 5분, 스쿼트 10회, 어깨 돌리기 10회 | 선택한 운동을 계획에 넣되 수행은 미기록. `done`과 실제 수행량을 보고한 항목에만 운동 회차·수행 관계. `skipped/unknown`은 수행으로 승격하지 않음 | [시나리오](../server/test/health_scenario_service.test.js) |

이미지 추출에는 오독 가능성이 있다. 예를 들어 패션 합성 화면의 `합성 자료`를 `소재: 합성 재료`로 읽은 저장 응답이 있다. 테스트는 이 문구를 옷 소재의 사실로 옮기지 않는지 확인한다. 맛집 이미지의 가격처럼 **근거 ID가 없는 추출 사실**도 원본 응답에는 남을 수 있지만 그래프 사실로 가져오지 않는다. 사용자의 확인은 이 경계를 대체하는 것이 아니라 이후 선택·결정의 별도 근거를 추가한다.

## 공통 구조에서 검증한 것

분야별 결과가 맞더라도 원본·근거·작업의 공통 규칙이 깨지면 다른 분야까지 영향을 받는다. 아래 테스트는 그 경계를 직접 확인한다.

| 공통 부분 | 검증된 규칙 | 찾아볼 테스트 |
| --- | --- | --- |
| 분석·가져오기 | 엄격한 응답 형식, 잘못된 근거 참조 처리, 명시적 사용자 검토, 근거 없는 값의 그래프 제외, 중복 가져오기·삭제 후 재전송 차단 | [분석](../server/test/analysis_service.test.js), [검토한 캡처](../server/test/ingestion_reviewed_capture.test.js) |
| 지식 그래프·검색 | 등록된 관계만 저장, 출처·소유자·활동 범위 분리, 동명이인·동명 상품 자동 병합 방지, 충돌·시간·철회·독립 근거 처리, 실제 근거가 있는 관계만 탐색 | [그래프](../server/test/knowledge_kernel.test.js), [검색](../server/test/retrieval_graph.test.js) |
| 계획·TaskBoard | 작업 의존성·입출력 검사, 계획 승인 전 실행 차단, 보드 revision·명령 재전송, 완료 결과 불변, 소비한 입력 고정, 근거 변경 시 오래된 계획 승인·실행 거부 | [작업 커널](../server/test/activities_kernel.test.js), [통합](../server/test/common_kernel_integration.test.js), [회귀](../server/test/common_kernel_regressions.test.js) |
| 정정·복구 | 원본 분석과 완료 결과는 보존하고 현재 관계를 새 근거로 갱신. 시작 전 계획은 재검토하고 이미 시작한 작업은 무단 재바인딩하지 않음 | [필드 정정](../server/test/imported_field_correction.test.js), [계획 복구](../server/test/imported_field_review.test.js), 분야별 정정 테스트 |
| 저장·원자성 | JSON의 재시작·실패 복구, 관계형 그래프 행·외래키·트랜잭션 롤백, 실제 PostgreSQL의 마이그레이션·동시 쓰기와 레시피↔쇼핑 연결의 재시작·삭제 격리 | [JSON](../server/test/json_state_store.test.js), [관계형](../server/test/postgres_relational_store.test.js), [실제 DB 선택 테스트](../server/test/postgres_real_integration.test.js) |

검토한 캡처의 **삭제**는 일반 정정과 다르다. [레시피 삭제 테스트](../server/test/recipe_scenario_service.test.js)는 작업 결과까지 만든 후 가져오기 ID로 원본을 삭제해 영수증이 `deleted`가 되고 종속 보드·실행 영수증이 제거되며 독립 보드는 남는지 확인한다. [보드 화면 테스트](../test/features/boards/common_boards_screen_test.dart)는 삭제 후 새로고침 시 과거 작업을 숨기고 목록을 다시 읽는지 확인한다. 네트워크 오류만 있을 때에는 과거 보드를 읽기용으로 남기고 쓰기는 막는다.

## 분야를 연결했을 때

연결은 두 보드를 함께 보려는 **사용자 확인 관계**다. 레시피↔쇼핑, 여행↔맛집, 패션↔뷰티, 운동↔생활 꿀팁 등을 연결해도 한쪽의 구매·방문·착용·사용·운동·실천을 추론하지 않는다. [연결 계약](SCENARIO_CONNECTIONS.md)에 관계 종류와 근거 규칙이 있다.

| 통합 테스트 | 실제로 통과시키는 경로 | 연결 후 일부러 **생기지 않아야 하는** 사실 |
| --- | --- | --- |
| [쇼핑·패션·여행·맛집 이미지 API](../server/test/cross_domain_image_pipeline.test.js) | PNG 4장 → 로컬 `/v1/analyze` → 저장 응답 → 가져오기 → 각 보드 승인 → 여행↔맛집 연결 | 선택만으로 구매·착용·방문 없음. `not_purchased`, `not_worn`, `unknown` 보고도 해당 사실을 만들지 않음 |
| [뷰티·운동·꿀팁 이미지 API](../server/test/wellbeing_image_pipeline.test.js) | PNG 3장 → 같은 HTTP 경로 → 가져오기 → 보드 확정 → 운동↔꿀팁 연결 | 루틴·계획·연결과 `unknown` 보고만으로 제품 사용·운동 수행·팁 실행 없음 |
| [시나리오 변형](../server/test/scenario_variations.test.js) | 레시피↔쇼핑, 제주 여행↔식당, 패션↔뷰티, 운동↔준비 팁 등의 값·관계·정정·삭제 | 상대 보드의 결과를 자동 실행으로 취급하지 않음. 팁 캡처를 지워도 별도 운동 기록은 보존 |
| [연결 자체](../server/test/scenario_connections.test.js) | 지원 관계·양쪽 보드 조회·결과 간선·해제·출처 삭제 | 다른 소유자의 보드, 오래된 revision, 중복·허용되지 않은 관계는 거부 |

## 테스트가 검증하는 층과 실행 방법

| 층 | 명령·위치 | 확인하는 것 / 확인하지 않는 것 |
| --- | --- | --- |
| 서버 회귀 | 저장소 루트에서 `npm test --prefix server` | 분석 형식, 가져오기, 근거 그래프, 계획·보드, 분야별 결과·정정·삭제. JSON과 PGlite 기반 관계형 저장소를 포함. 기본 실행은 유료 모델을 호출하지 않음 |
| 이미지 고정 응답 모음 | `cd server && node --test test/image_fixture_corpus.test.js` | 공개 합성 PNG 21장 전체의 해시, 짝 응답, 분류·제목, 근거 ID 참조. 새 모델 호출·실제 이미지 정확도는 확인하지 않음 |
| 특정 흐름 | `cd server && node --test test/scenario_variations.test.js` 또는 해당 표의 테스트 파일 | 변경한 시나리오를 빠르게 재확인. 통합 이미지 HTTP 테스트는 `node --test test/recipe_image_e2e.test.js test/cross_domain_image_pipeline.test.js test/wellbeing_image_pipeline.test.js` |
| 새 모델 응답 | 터미널 1: `cd server && npm run dev`; 터미널 2: `cd server && npm run test:scenario-variations-live` 등 `package.json`의 `test:*image-live` | 합성 PNG를 **현재 모델**에 다시 보내 분류·값·근거를 확인. 출력 변동을 발견하는 회귀 검사이며 기본 테스트의 고정 응답을 자동 갱신하지 않음. `--record`는 새 응답을 사람이 검토한 뒤에만 사용 |
| 실제 PostgreSQL | 테스트 전용 DB의 `LUFFI_TEST_POSTGRES_URL`을 지정하고 `npm run test:postgres-real --prefix server` | 실제 드라이버·마이그레이션·동시 쓰기·FK 실패 롤백·재시작 조회 및 레시피↔쇼핑의 삭제 격리. 환경 변수가 없으면 기본 서버 테스트에서 이 **2개 선택 테스트는 건너뜀**. PGlite 통과와 실제 DB 통과를 혼동하지 말 것 |
| Flutter | 저장소 루트에서 `flutter analyze --fatal-infos`와 `flutter test` | 앱 상태·서버 클라이언트·보드/정정 화면의 별도 테스트. 이 명령만으로 실제 Android 공유 시트, 기기 카메라, 운영 서버와의 전체 경로가 검증되지는 않음 |
| 자동 검사 | [서버 워크플로](../.github/workflows/server.yml)와 [Flutter 워크플로](../.github/workflows/flutter.yml) | `dev`·`main` 푸시와 PR에서 서버 전체 테스트(실제 PostgreSQL 서비스 포함) 및 Flutter 분석·테스트·Android 디버그 빌드를 실행하도록 설정. 로컬 통과와 CI 통과는 각각 확인해야 함 |

마지막 전체 실행 기록(2026-09-27): 서버 **574개 중 572개 통과, 2개 건너뜀**, 그 2개는 테스트 전용 **실제 PostgreSQL에서 따로 2/2 통과**. Flutter 정적 분석 오류 0, Flutter 테스트 **516개 통과**. 실제 PostgreSQL 사례는 각각 마이그레이션·동시 쓰기·롤백·패션 정정과, 이미지 기반 레시피↔쇼핑 연결의 재시작·출처 삭제 격리를 확인한다. 새 이미지 묶음 테스트는 공개 합성 이미지 21장 전부의 고정 응답을 검사한다. 이미지 모델은 이전 검증에서 변형 시나리오 이미지 5장, 뷰티 2장, 건강 1장, 생활 꿀팁 1장, 맛집 4장을 실제 분석 API로 재확인했고, 이번 Android 에뮬레이터에서는 레시피·쇼핑 2장을 새로 분석했다. 이는 합성 이미지의 특정 사례 결과이지 일반 SNS 이미지 전체의 정확도 수치는 아니다.

아직 이 결과만으로 확인했다고 말할 수 없는 범위도 있다. 실제 SNS 캡처 전반의 추출 정확도, **실물 휴대폰과 외부 앱 공유 시트**에서 사용자 조작→서버까지의 전 과정, 운영 DB의 부하·백업 복원·무중단 배포, 실제 구매·예약·방문이나 건강 효과의 외부 검증이다. 새 분야나 현실 데이터를 추가할 때는 이 범위를 별도 검증 계획으로 잡아야 한다.

새 시나리오를 추가할 때는 ① 합성 PNG와 기대 문구, ② 실제 모델 응답의 검토·보존, ③ 화면 근거가 있는 항목만 가져오기, ④ 사용자가 확정해야 할 값, ⑤ 계획 승인과 실제 결과의 분리, ⑥ 정정·삭제·재시도, ⑦ JSON/PGlite 및 필요 시 실제 PostgreSQL, ⑧ 앱 화면·클라이언트 테스트를 각각 확인한다. 공통 커널을 쓰되, `뷰티에서는 같은 제품의 단계별 재사용을 허용`하고 `패션에서는 같은 옵션의 코디 중복을 막는` 것처럼 분야별 의미는 별도로 테스트한다.
