# 첫 건강·운동 시나리오: 화면의 운동 항목을 고르고 실제 수행량 기록하기

## 사용자 목표와 입력

> “홈트 3단계 화면을 저장했다. 오늘 할 항목을 고르고, 실제로 한 운동과 수행량을 남기고 싶다.”

첫 입력은 번호가 있는 운동 계획 캡처 하나다. `server/test/fixtures/health_home_workout.png`는 가상의 홈트 화면이며 운동 적합성이나 효과를 검증한 자료가 아니다. PNG를 실제 `POST /v1/analyze`에 전송해 받은 응답을 `_live_analysis.json`에 보관했다. 응답은 `contentKind=unknown`, `건강·운동` field, `운동` kind, 관측 제목과 Evidence가 있는 `1단계`~`3단계` fact를 담는다. 기존 분석 계약에 운동 전용 contentKind가 없으므로 `unknown` 전체를 받지 않고 이 조건에 맞는 `complete` 분석만 후보로 사용한다.

## 작업 보드와 사용자 결정

1. 사용자가 원본과 분석을 확인해 가져오면 `confirm_exercises → record_exercise_outcomes` 계획을 승인 대기로 만든다. 제목과 단계 label/value의 근거를 감시한다. 캡처의 숫자·단위는 문구 그대로 표시하고 실제 수행량으로 해석하지 않는다.
2. `confirm_exercises`에서 원본을 열어 이번에 할 단계 1~8개 중 일부 또는 전부를 고른다. 선택한 순서를 원본 순서로 보존한다. 이 단계에서 운동 수행 사실은 만들어지지 않는다.
3. `record_exercise_outcomes`에서 확정한 모든 항목에 `done`, `skipped`, `unknown`을 직접 표시한다. `done`에는 실제 수행량과 단위(`minutes` 또는 `repetitions`)를 입력한다. `done` 항목이 하나 이상 있을 때만 운동 회차와 항목별 수행 엔터티를 생성한다. 모두 미실시·미확인이면 결과 상태만 보존한다.

## 지식 그래프와 사실 경계

| 대상 | 관계와 출처 | 의미 |
| --- | --- | --- |
| 캡처 | Source → SourceVersion → Evidence → `ingestion.extracted_field` | 화면에 적힌 제목·운동 문구 |
| 운동 언급 | 캡처별 `health.workout` Mention → 사용자 확인 IdentityDecision → Workout Entity | 제목이 같다는 이유로 별도 캡처를 병합하지 않음 |
| 사용자 계획 | `health.workout_plan` → `health.plan_uses_workout`, `health.plan_has_exercise` | 이번 활동에 선택한 항목만 포함 |
| 계획 항목 | `health.planned_exercise` → `health.exercise_order`, `health.exercise_text` | 화면 문구 Evidence와 사용자 확인 Evidence를 연결. 목표 문구이지 성취 수치가 아님 |
| 실제 보고 | `health.workout_session` → `health.session_for_plan`; `health.performance` → `health.performance_in_session`, `health.performance_of_exercise`, `health.actual_amount`, `health.actual_unit` | 사용자가 `done`과 실제 수행량을 보고한 경우에만 생성. 센서 측정이나 의학적 검증이 아님 |

서버는 소유자, 보드 revision, 승인된 단계, 근거와 그래프 관계를 다시 검사한다. 일반 작업 완료 명령으로 운동 수행을 만들 수 없다. 같은 명령 ID를 재전송하면 저장된 결과를 돌려준다. 캡처나 파생 출처를 삭제하면 해당 활동과 관계도 제거한다.

## 검증과 범위

- `cd server && npm run test:health-image-live`로 생성 PNG를 실제 분석 API에 보내 태그·제목·세 단계의 Evidence를 확인한다.
- `npm test`는 PNG 해시와 저장된 실제 분석 응답으로 제안→확정→실제 보고를 재생한다. 화면의 `5분`과 사용자가 보고한 `4분`이 다른 사실로 남는지, 제외·미실시 항목에 수행 관계가 생기지 않는지 확인한다.
- 앱 테스트는 캡처 선택, 원본 열기, 일부 단계 확정, `done`의 수행량 필수 입력, 생성 요청 복구와 HTTP 경로를 확인한다.

이 첫 흐름은 운동 추천, 자세 판정, 증상 평가, 부상 위험 판단, 칼로리·건강 효과 추정, 웨어러블 데이터 수집을 제공하지 않는다. 반복 운동 기록이나 목표 달성 분석은 별도 회차·측정 출처·수정 정책을 설계한 뒤 확장한다.

## 검증 이미지 생성 프롬프트

내장 imagegen 도구로 만든 합성 화면이다. 프롬프트는 다음과 같다.

```text
Use case: ui-mockup. Produce one sharp, readable portrait 9:16 smartphone screenshot fixture of a fictional Korean home workout post, no real person, brand, author, app logo, medical claims, health claims, calories, weight-loss promises, or completion indicators. White or off-white UI with dark Korean typography and simple flat illustrations of a walking figure, a squat pose, and shoulder circles. Exact visible main text, large and legible: title "집에서 하는 3단계 홈트"; category chip "건강·운동"; numbered list "1단계 제자리 걷기 5분", "2단계 스쿼트 10회", "3단계 어깨 돌리기 10회". Keep the three lines cleanly separated and fully visible. Do not add other exercises, numbers, prices, account names, or tiny illegible copy.
```
