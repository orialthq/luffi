# 첫 여행 시나리오: 저장한 관광 장소로 하루 일정 만들고 방문 기록하기

## 사용자 목표

> “제주에서 하루 동안 가고 싶은 두 장소를 저장했다. 어느 곳을 먼저 갈지와 방문 예정 시각을 내가 정하고, 여행 뒤 실제로 다녀온 장소만 기록하고 싶다.”

첫 입력은 장소 소개 화면의 캡처다. 분석기는 화면에 보이는 장소명·지역·분류와 근거를 읽는다. 사진이나 소개 문구만으로 정확한 주소, 현재 영업시간, 이동시간, 예약·입장 가능 여부 또는 실제 방문을 알 수 없다. 사용자가 확인해 가져온 캡처는 **장소 후보**이며, 계획과 방문은 별도 출처로 기록한다.

`server/test/fixtures/travel_a_viewpoint.png`와 `travel_b_coastwalk.png`는 가상 장소를 표시한 합성 화면이다. 두 PNG를 실행 중인 `POST /v1/analyze`에 각각 전송했고, `place`·`activity`와 관측된 장소명·`제주` 지역 및 Evidence가 담긴 실제 응답을 같은 이름의 `_live_analysis.json`에 보관했다. 합성 장소를 외부 지도 제공자가 검증한 실제 지점으로 표시하지 않는다.

## 첫 흐름과 보드

1. 사용자가 원본과 분석을 확인해 가져온다. 첫 여행 시나리오는 `contentKind=place`, `category=activity`, 장소명·지역·근거가 있는 캡처만 받는다. 음식점과 숙소는 이 흐름의 후보가 아니다.
2. 같은 지역의 캡처 1~8개와 하루 시작 시각을 고른다. 서버는 장소명과 지역 Assertion을 감시하는 Context를 발급하고 `confirm_itinerary → record_stop_outcomes` 계획 변경안을 만든다. 승인 전에는 작업을 실행할 수 없다.
3. `confirm_itinerary`: 사용자가 캡처 중 실제 일정에 넣을 장소를 골라 **배열 순서대로** 배치하고 각 장소의 시각을 입력한다. 시작 이후 24시간 안에서 시각이 엄격히 증가해야 한다. 사용자 확인 Source/Evidence, 장소 Mention의 IdentityDecision, DayItinerary/Stop/Place Entity와 순서·예정시각 관계를 원자적으로 저장한다. 같은 이름의 다른 캡처를 자동 병합하지 않는다.
4. `record_stop_outcomes`: 모든 Stop에 `visited`, `skipped`, `unknown`을 직접 표시한다. `visited`만 사용자 보고 Source/Evidence와 Visit Entity를 만들어 해당 Stop·Place에 연결한다. 예정 목록, 지도 검색, 원본 열기만으로 방문을 기록하지 않는다.

```text
확인한 관광 장소 캡처 → 승인 대기 계획 → confirm_itinerary → record_stop_outcomes
                            │                 │                       │
                            └ 근거 변경 감시    └ 사용자가 순서·시각 확정  └ 방문한 Stop만 경험
```

## 지식 그래프와 사실 경계

| 대상 | 저장 방식 | 의미 |
| --- | --- | --- |
| 캡처 | Source → SourceVersion → Evidence, `ingestion.extracted_field` | 화면에 보이던 당시 문구. 현재 운영 정보의 보증이 아님 |
| 장소 언급 | 캡처별 `travel.place` Mention → 사용자 확인 IdentityDecision → Place Entity | 동일 이름·지역만으로 서로 다른 캡처를 합치지 않음. 제공자 지점 검증도 아직 없음 |
| 하루 일정 | `travel.day_itinerary` Entity, `travel.area` | 특정 활동에서 사용자가 확정한 지역과 하루 계획 |
| 방문 예정 | `travel.stop` Entity, `travel.has_stop`·`travel.stop_order`·`travel.planned_at`·`travel.stop_at` | 순서와 예정 시각은 명시적 사용자 결정. 이동 가능성·영업 여부를 뜻하지 않음 |
| 실제 방문 | `travel.visit` Entity, `travel.visit_of_stop`·`travel.visit_at_place` | `visited`를 직접 보고한 경우에만 생성. 보고 시각은 실제 도착 시각이 아님 |

명령은 소유자, 현재 보드 revision, 준비된 작업, 후보·Stop ID와 중복, 시각 순서 및 계획 근거를 검사한다. 같은 `commandId` 재전송은 영수증의 결과를 재생한다. 사용자 확인과 방문 결과는 일반 작업 완료 명령으로 우회할 수 없다. 캡처나 파생 사용자 출처를 삭제하면 현재 개발용 저장소는 관련 활동·파생 출처를 함께 제거하고 삭제된 명령의 재전송을 막는다. 독립 근거를 유지하면서 영향받은 Stop만 재검토하는 정책은 후속 범위다.

## 검증과 확장 경계

- 두 합성 PNG를 실제 이미지 분석 API에 전송해 장소명·지역·분류·근거를 확인한다. 저장한 응답과 PNG 해시는 외부 모델 호출 없는 회귀 테스트에서 검증한다.
- 캡처 표시 순서와 사용자가 고른 순서를 일부러 다르게 해, Stop 배열·그래프의 1부터 시작하는 순서가 사용자 선택을 따르는지 검사한다.
- 다른 지역·음식점 캡처, 중복 후보, 하루 범위 밖이나 역순 시각, 누락된 방문 결과, 작업 우회가 거부되는지 검사한다.
- `skipped`/`unknown`에는 Visit 관계가 생기지 않아야 한다. 동일 명령 재전송·디스크 재시작·근거 변경·출처 삭제 후 재전송도 검사한다.

이 첫 흐름은 한 지역의 관광 장소만 다룬다. 앱은 기기 현지 시각으로 하루 계획을 입력하고 UTC로 전송한다. 해외 목적지의 시간대, 날짜를 넘기는 일정, 교통·경로 최적화, 장소 제공자 신원 검증, 실시간 영업·입장 정보, 숙소·항공 예약, 위치 기반 방문 확인은 별도 계약과 검증을 만든 뒤 확장한다.
