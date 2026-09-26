# 첫 생활 꿀팁 시나리오: 화면에서 읽은 단계를 고르고 실행 기록하기

## 사용자 목표와 입력

> “영수증 정리 3단계를 캡처해 두었다. 이번에 실천할 단계를 골라 계획으로 만들고, 실제로 한 단계만 기록하고 싶다.”

첫 입력은 단계가 번호와 함께 보이는 캡처다. `server/test/fixtures/life_tip_receipts.png`는 imagegen으로 만든 가상 게시물 화면이며, 실제 작성자나 검증된 생활 정보가 아니다. PNG를 실행 중인 `POST /v1/analyze`에 전송한 HTTP 200 응답을 `_live_analysis.json`에 보관했다. 응답은 `contentKind=unknown`, `생활·팁` field 태그, 관측 제목, 근거가 있는 `1단계`~`3단계` fact를 담았다. 현재 분석 계약은 생활 팁만의 contentKind나 실행 검증을 제공하지 않으므로 `unknown`은 허용하되, 아무 `unknown` 캡처나 실천 계획으로 승격하지 않는다.

## 보드와 사용자 결정

1. 사용자가 원본과 분석을 확인해 가져온다. 첫 흐름은 `complete` 분석, `생활·팁` field, 화면에 보이는 제목과 1부터 연속되는 단계 fact 1~8개, 각 항목의 Evidence가 있어야 시작한다. 이 조건이 없는 조언·상품 리뷰·다른 분야의 `unknown`은 후보가 아니다.
2. 하나의 캡처를 골라 `confirm_actions → record_outcomes` 계획 제안을 만든다. 서버는 제목과 각 단계의 추출 Assertion을 감시한다. 사용자가 계획을 승인하기 전에는 작업을 실행하지 않는다.
3. `confirm_actions`에서 사용자가 원본을 다시 보고 이번에 실천할 단계만 고른다. 원본의 단계 순서는 유지한다. 사용자 확인 Source/Evidence, 캡처별 Tip Mention의 IdentityDecision, ActionPlan/Action Entity와 텍스트·순서 관계를 한 트랜잭션에서 기록한다.
4. `record_outcomes`에서 확정한 모든 단계에 `done`, `skipped`, `unknown`을 표시한다. `done`에만 별도 사용자 보고 Source/Evidence와 Execution Entity를 만들어 해당 Action에 연결한다. 계획 확정이나 보드 작업 시작만으로 실행 사실을 만들지 않는다.

## 지식 그래프와 사실 경계

| 대상 | 저장 방식 | 의미 |
| --- | --- | --- |
| 캡처 | Source → SourceVersion → Evidence, `ingestion.extracted_field` | 화면에 보이던 제목과 단계 문구. 조언의 효과·정확성 검증은 아님 |
| 팁 언급 | 캡처별 `life_tip.tip` Mention → 사용자 확인 IdentityDecision → Tip Entity | 제목이 같은 다른 캡처를 자동으로 합치지 않음 |
| 실천 계획 | `life_tip.action_plan` Entity, `life_tip.plan_uses_tip` | 사용자가 이 팁으로 활동을 시작함 |
| 선택한 단계 | `life_tip.action` Entity, `life_tip.plan_has_action`, `life_tip.action_order`, `life_tip.action_text` | 원본 fact Evidence와 사용자 확인 Evidence가 함께 붙은 이번 계획의 항목 |
| 실제 실행 | `life_tip.execution` Entity, `life_tip.execution_for_action` | 사용자가 `done`을 보고한 항목. 효과나 습관 형성을 증명하지 않음 |

단계 ID는 이 계획에 귀속된다. 원본 팁의 문구와 선택한 단계, 실행 보고는 각각 다른 출처다. 같은 제목만으로 별도 캡처의 Identity를 병합하지 않는다. 서버는 소유자, revision, 준비된 작업, 후보·단계 ID, 중복 및 현재 근거를 확인한다. 전용 명령 외 일반 작업 완료로 결과를 우회할 수 없고, 명령 재전송은 저장된 영수증을 재생한다. 캡처나 파생 출처를 삭제하면 현재 개발 저장소는 관련 활동과 파생 출처를 함께 제거하고 명령 재전송을 막는다.

## 검증과 확장 경계

- 합성 PNG의 SHA-256과 실제 API 응답을 회귀 테스트에서 확인한다. 외부 모델을 다시 호출하지 않고 보드·그래프를 재생한다.
- 일부 단계만 선택했을 때 제외한 fact가 계획의 Action이 되지 않는지, `skipped/unknown`에 실행 관계가 생기지 않는지 검사한다.
- 다른 태그의 캡처, 잘못된 단계 순서·중복, 누락된 결과, 일반 작업 명령 우회, 근거 변경, 출처 삭제·재전송을 검사한다.

이 첫 흐름은 한 캡처의 명시적인 번호 단계만 다룬다. 이미지의 조언을 제품 구매, 안전성·효능 주장, 자동 실행, 반복 습관, 알림, 결과 측정으로 확장하지 않는다. 제목·단계가 비정형인 생활 팁과 여러 캡처를 결합한 루틴은 별도 추출·검증 계약이 필요하다. 앱의 기존 `.trunon` 팁 공유 형식은 이 보드의 실행 기록과 다른 데이터 계약이다.

## 검증 이미지 생성 프롬프트

기본 내장 imagegen 도구를 사용했다. 저장 경로는 `server/test/fixtures/life_tip_receipts.png`다.

```text
Use case: ui-mockup
Asset type: synthetic mobile screenshot fixture for an app's Korean daily life tip image-analysis test
Primary request: Create a sharp, readable portrait smartphone screenshot of a Korean social post about organizing paper receipts at home. This is a fictional post, no real brand or author. Exact visible Korean text in the main content card:
"영수증 정리 3단계"
"1. 주머니와 가방의 영수증을 한곳에 모아요"
"2. 필요한 영수증과 버릴 영수증을 나눠요"
"3. 필요한 영수증은 날짜별 봉투에 넣어요"
A small visible category chip: "생활·팁". Add a simple illustration of paper receipts and two unbranded envelopes below the text. Clean off-white background, dark charcoal typography, generous spacing, crisp flat UI. No additional tips, claims, names, addresses, usernames, watermarks, or small illegible text. Exact text should be clearly legible. Do not imply any step has been performed.
```
