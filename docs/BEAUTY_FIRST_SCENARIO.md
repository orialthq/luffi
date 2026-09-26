# 첫 뷰티 시나리오: 저장한 제품으로 루틴을 확정하고 사용 기록하기

## 사용자 목표

> “토요일 저녁 세안과 보습 루틴을 만들고 싶다. 저장한 클렌징 젤과 크림을 순서대로 넣되, 어떤 제품을 쓸지 내가 확인하고 실제 사용한 단계만 기록한다.”

첫 입력은 제품 화면 캡처다. 분석기는 화면에 보이는 상품명과 문구를 읽을 수 있지만, 사용자의 소유 여부, 피부에 맞는지, 효능, 사용한 날짜나 제품 선택은 알지 못한다. 캡처는 **제품 후보와 출처**다. 루틴의 제품·단계 순서와 선택한 제품 표기는 사용자가 확정한다. `사용 완료`도 사용자의 명시적 보고가 있을 때만 기록한다.

검증 이미지는 `server/test/fixtures/beauty_a_cleanser.png`와 `beauty_b_moisturizer.png`다. 두 장은 합성 제품 화면이며 각각 실행 중인 `POST /v1/analyze`에 전송했다. 원본 응답은 같은 이름의 `_live_analysis.json`에 보관한다. 화면의 `사용 단계` 같은 문구는 관측 텍스트일 뿐, 의료적 적합성이나 루틴 순서의 증거로 쓰지 않는다.

## 사용자 흐름과 보드

1. 캡처를 분석하고 원본과 추출 내용을 사용자가 확인한 뒤 가져온다. `beauty_product`이며 관측 제목·근거가 있는 자료만 루틴 후보가 된다.
2. 사용자는 일정 이름, 시각, 사용할 캡처를 고른다. 서버는 캡처별 SourceVersion/Evidence와 미해결 상품 Mention을 연결하고 계획 변경안을 만든다. 계획을 승인해야 보드의 작업이 열린다.
3. `confirm_routine`: 사용자는 캡처별 선택한 제품 표기와 단계명을 입력하고 **배열 순서대로** 루틴 순서를 확정한다. 일부 후보만 고를 수 있다. 같은 상품명이라도 다른 캡처를 자동으로 동일 제품으로 병합하지 않는다. Product, Variant, RoutineTemplate, RoutineStep을 만들고 출처·사용자 확인 관계를 저장한다.
4. `instantiate_routine`: 시스템의 순수 파생 작업이 확정된 템플릿을 지정 시각의 RoutineOccurrence로 만든다. 원본 템플릿의 단계 참조는 유지하되 사용 상태는 `pending`으로 시작한다.
5. `record_routine_outcome`: 사용자는 **모든 단계**에 `completed`, `skipped`, `unknown` 중 하나를 직접 표시한다. `completed`만 사용자 보고 Source/Evidence와 UseExperience 관계를 만든다. `skipped`와 `unknown`은 사용 경험을 만들지 않는다.

```text
확인한 제품 캡처 → 승인 대기 계획 → confirm_routine → instantiate_routine → record_routine_outcome
                         │                   │                                       │
                         └ 근거 변경 감시      └ 단계 순서·제품 사용자 확인             └ 완료한 단계만 사용 경험
```

## 지식 그래프의 의미

| 대상 | 저장 방식 | 의미 |
| --- | --- | --- |
| 캡처 | Source → SourceVersion → Evidence와 추출 필드 Assertion | 캡처에 보였던 문구. 소유·효능·적합성의 증거가 아님 |
| 상품 | 캡처별 `core.product` Mention과 사용자 확인 IdentityDecision | 같은 이름의 캡처를 자동 병합하지 않음 |
| 선택 제품 | `core.product_variant` Entity와 `beauty.variant_of`, 사용자가 입력한 `beauty.variant_label` | 그 루틴에서 쓰겠다고 고른 제품 표기. 재고나 구매 확정이 아님 |
| 루틴 | `beauty.routine_template`/`beauty.routine_step`, `beauty.has_step`·`beauty.step_order`·`beauty.uses_variant` | 단계의 1부터 시작하는 순서와 제품 참조. 완료 여부는 여기에 쓰지 않음 |
| 실행 회차 | `beauty.routine_occurrence`, `beauty.occurrence_of` | 일정 시각에 만들었던 루틴 한 회차. 각 단계는 미완료로 시작 |
| 사용 | `beauty.use_experience`, `beauty.experience_in`·`beauty.experience_for_step`·`beauty.experience_uses_variant` | 사용자가 `completed`라고 보고한 정확한 회차·단계·제품만 경험으로 기록 |

명령은 활동 소유자, 보드 revision, 후보 ID, 중복 단계 ID, 상태 값과 작업 준비 여부를 확인하고 원자적으로 기록한다. 같은 `commandId`를 다시 보내도 결과만 재생한다. 근거 캡처를 삭제하면 현재 개발 저장소는 관련 활동과 파생 루틴·사용 기록을 함께 제거하고 기존 명령의 재전송을 차단한다. 독립 근거를 유지하면서 영향받은 단계만 재검토하는 방식은 후속 범위다.

## 검증 기준과 확장 경계

- 두 합성 PNG를 실제 이미지 분석 API에 보내 `beauty_product`, 관측 제목, 근거가 나오는지 확인한다. 저장 응답은 외부 모델 호출 없이 테스트에서 재생한다.
- 사용자가 고른 순서가 템플릿과 실행 회차에 유지되는지, 일부 후보 선택이 되는지, 다른 활동의 후보나 중복 후보·단계가 거부되는지 검사한다.
- `completed`에만 사용 경험 관계가 생기고, `skipped`/`unknown`은 생기지 않아야 한다. 명령 재전송, 서버 재시작, 근거 삭제 후 재전송도 검사한다.
- 성분 추출·상호작용 판단, 피부 타입별 권고, 사용 빈도 추천, 사진을 통한 피부 상태 진단, 효능 판정, 반복 일정 자동 생성은 별도의 출처와 검증 계약이 필요하다. 이 첫 흐름은 제품 화면으로 그런 판단을 하지 않는다.
