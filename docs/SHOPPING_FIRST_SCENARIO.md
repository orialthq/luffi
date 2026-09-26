# 첫 쇼핑 시나리오: 상품 화면을 비교하고 실제 구매를 기록하기

## 목표와 입력

> “수납함 상품 화면 두 개를 저장했다. 보이는 가격과 옵션을 비교해 하나를 고르고, 구매했다면 실제 지불액을 남기고 싶다.”

첫 입력은 사용자가 분석을 확인해 가져온 상품 화면 1~8개다. `server/test/fixtures/shopping_a_fabric_box.png`와 `shopping_b_clear_box.png`는 가상 상품 화면이다. 실제 쇼핑몰, 판매자, 재고, 결제 정보가 아니다. 두 PNG를 실행 중인 `POST /v1/analyze`에 전송해 얻은 응답을 각각 `_live_analysis.json`에 보관했다. 둘 다 `commerce_product`, `complete`, 관측 제목, Evidence가 있는 `가격`·`색상`·`크기` fact를 반환했다. 앱과 서버는 상품명과 `가격` 하나가 있는 캡처만 후보로 받는다. 화면에 적힌 가격은 현재 판매 가격이 아니라 캡처 당시 표시 텍스트다.

## 사용자 흐름과 작업 보드

1. 확인해 가져온 상품 화면에서 목적과 후보를 고르면 `confirm_choice → record_purchase_outcome` 제안을 만든다. 승인 전에는 작업이 실행되지 않는다. 서버는 후보의 제목과 fact label/value 근거를 감시한다.
2. `confirm_choice`에서 후보의 표시 가격과 옵션을 비교하고 원본 캡처를 열 수 있다. 사용자가 상품 하나와 수량 1~20개를 확정한다. 이 단계는 구매가 아니다.
3. `record_purchase_outcome`에서 `purchased`, `not_purchased`, `unknown` 중 하나를 직접 보고한다. `purchased`에만 실제 지불액(원)을 입력한다. 실제 지불액은 화면 가격과 달라도 그대로 보존된다.

## 지식 그래프

| 대상 | 관계 및 출처 | 의미 |
| --- | --- | --- |
| 상품 화면 | Source → SourceVersion → Evidence → `ingestion.extracted_field` | 제목·가격·옵션을 화면에서 읽은 결과 |
| 상품 정체성 | 캡처별 `core.product` Mention → 사용자 선택 IdentityDecision → Product Entity | 같은 제목의 다른 화면을 자동 병합하지 않음 |
| 표시 제안 | `shopping.offer_snapshot` → `shopping.offer_of_product`, `shopping.displayed_price` | 선택한 캡처의 시점 한정 표시 가격. 현재 가격, 최저가, 결제액이 아님 |
| 사용자 선택 | `shopping.purchase_choice` → `shopping.choice_product`, `shopping.choice_offer`, `shopping.quantity` | 사용자 확인 Source/Evidence로 뒷받침하는 상품·수량 선택 |
| 구매 보고 | `shopping.purchase_report` → `shopping.purchase_for_choice`, `shopping.actual_paid_krw` | `purchased` 보고 때만 생성. 영수증이나 결제 사업자 확인은 아님 |

모든 관계는 활동 범위, 출처, 시점을 보존한다. 표시 가격은 캡처 시점의 근거이고, 실제 지불액은 별도 사용자 보고 근거다. 일반 작업 완료 명령으로 선택·구매 기록을 만들 수 없다. 서버는 소유자, revision, 승인된 후보, 준비 상태, 원본 근거, 그래프의 선택 관계를 검사한다. 동일한 명령 ID는 재전송해도 결과를 재생한다. 캡처나 파생 출처를 삭제하면 해당 활동과 파생 관계도 제거한다.

## 검증과 다음 확장 경계

- 실제 API 분석은 `cd server && npm run test:shopping-image-live`로 두 PNG를 재전송해 상품명·가격·색상·크기 Evidence를 검사한다.
- `npm test`는 저장된 실제 API 응답과 PNG 해시로 제안→확정→구매 보고를 재생한다. 캡처 가격 `12,900원`과 실제 지불액 `13,500원`이 별도 관계인지, 미구매 보고에서 구매 관계가 생기지 않는지 확인한다.
- 앱 테스트는 후보 선택, 수량, 원본 열기, 실제 지불액 필수 조건, HTTP 경로와 생성 요청 복구를 확인한다.
- 가격 근거가 취소되면 승인 대기 계획을 막는다. 다른 후보 선택, 수량 범위 이탈, 구매액 누락, 작업 완료 우회, 출처 삭제와 재전송도 거부한다.

이 흐름에는 실시간 가격 조회, 판매처 링크 검증, 장바구니·결제 연동, 배송·반품, 영수증 자동 인식, 상품 동일성 자동 병합을 넣지 않았다. 향후 이를 추가하더라도 `offer_snapshot`과 사용자 구매 보고를 덮어쓰지 않고 새로운 출처·관계로 연결해야 한다.

## 검증 이미지 제작 정보

두 PNG는 내장 imagegen으로 제작한 합성 이미지다. 아래는 같은 조건을 재현하기 위한 프롬프트다. 가상 상품명과 표시값을 고정해 OCR·근거 추출을 검사한다.

```text
Use case: ui-mockup. Create a crisp portrait Korean mobile shopping product listing screenshot for a fictional, unbranded home-storage item. A realistic product photo appears below a clear product title. Exact visible text: "생활용품", "접이식 패브릭 수납함", "가격 12,900원", "색상 베이지", "크기 38 × 28 × 24 cm". Use clean white shopping-app UI, large legible Korean typography, and no real seller, logo, address, discount, payment confirmation, or extra prices.
```

```text
Use case: ui-mockup. Create a crisp portrait Korean mobile shopping product listing screenshot for a fictional, unbranded home-storage item. A realistic photo of a transparent stackable box appears below a clear product title. Exact visible text: "생활용품", "투명 적층 수납함", "가격 15,900원", "색상 투명", "크기 35 × 25 × 20 cm". Use clean white shopping-app UI, large legible Korean typography, and no real seller, logo, address, discount, payment confirmation, or extra prices.
```
