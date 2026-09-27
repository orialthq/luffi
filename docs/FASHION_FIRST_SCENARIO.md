# 첫 패션 시나리오: 저장한 옷으로 외출 코디를 확정하고 착용 기록하기

## 사용자 목표

> “토요일 모임에 입을 옷을 정하고 싶다. 저장한 차콜 재킷과 베이지 슬랙스를 코디에 넣되, 실제로 가진 옷인지와 선택할 색상·사이즈를 내가 확인하고, 나중에 입었는지 기록한다.”

첫 입력은 상품 캡처다. 앱의 기존 분석은 `commerce_product`와 상품 제목·보이는 문구·근거를 읽지만 패션 전용 색상/사이즈 구조, 재고, 소유, 착용 경험은 알지 못한다. 따라서 캡처를 **상품 후보**로만 사용한다. AI가 본 `M, L`은 옵션 목록이지 사용자가 고른 사이즈가 아니며, 사진에 보인 옷은 사용자가 소유한 옷이 아니다.

검증 이미지는 `server/test/fixtures/fashion_a_blazer.png`와 `fashion_b_trousers.png`다. 각각 실제 `/v1/analyze`에 전송한 응답을 `_live_analysis.json`으로 보관한다. 재킷 이미지의 `합성 자료`를 분석기가 `합성 재료`로 오독해 `소재` 사실을 만들었다. 이 사실은 코디의 소재나 품질 주장으로 승격하지 않는다. 제목과 각 문구도 원본을 보며 사용자 확인을 거친다.

## 흐름과 보드

1. 캡처를 분석하고 사용자가 원본 옆에서 확인한 뒤 커널로 가져온다. `commerce_product`이고 `패션` kind가 있는 자료만 첫 시나리오 후보로 제공한다.
2. 사용자는 일정명·시각과 사용할 캡처를 고른다. 서버는 캡처별 SourceVersion, 제목 Evidence, 미해결 `core.product` Mention을 보존하고 고정된 계획 변경안을 만든다. 사용자가 승인해야 보드 작업이 열린다.
3. `confirm_outfit`: 사용자는 각 캡처에 코디 슬롯(`outerwear/top/bottom/shoes/accessory`), **선택한** 색상·사이즈, `owned/candidate/unknown`을 입력한다. 같은 슬롯에는 한 항목만 둔다. 확인하지 않은 옵션이나 소유를 이미지에서 추정하지 않는다. 선택한 상품 Mention만 사용자 확인을 근거로 Product Entity에 연결하고, 선택 옵션을 Variant Entity로 만든다. Outfit Entity의 `fashion.has_item` 관계는 이 Variant에 연결한다.
4. `record_wear`: 사용자는 `worn/not_worn/unknown`을 직접 고른다. `worn`일 때만 사용자 보고 출처와 `fashion.wore_outfit` 관계를 만든다. 코디를 만들거나 쇼핑 링크를 열었다는 이유로 착용 기록을 만들지 않는다.

```text
확인한 상품 캡처 → 승인 대기 계획 → confirm_outfit → record_wear
                         │                 │
                         └ 근거 변경 감시   └ 실제 착용은 사용자만 확인
```

## 지식 그래프와 경계

| 대상 | 저장 방식 | 의미 |
| --- | --- | --- |
| 캡처 | Source → SourceVersion → Evidence, 추출 필드 Assertion | 화면에서 읽은 과거 문구. 소재·옵션·소유의 검증이 아님 |
| 상품 | 캡처별 `core.product` Mention, 사용자 확인 IdentityDecision | 같은 상호·제목이라는 이유로 자동 병합하지 않음 |
| 선택 옵션 | `core.product_variant` Entity, `fashion.variant_of`와 `fashion.variant_options` | 사용자가 명시한 색상·사이즈. 온라인 재고나 구매 상태가 아님 |
| 소유 | Variant의 `fashion.ownership` 값 관계 | 사용자 보고 `owned/candidate`; `unknown`은 소유 주장으로 저장하지 않음 |
| 코디 | `fashion.outfit` Entity, 항목별 `fashion.has_line` → `fashion.outfit_line` → `fashion.line_variant`, 현재 `fashion.has_item`, 버전 있는 TaskResult | 항목 신원을 유지하면서 현재 Variant 연결을 바꿀 수 있음. 착용 완료를 뜻하지 않음 |
| 코디 자리 | Variant의 활동 범위 `fashion.item_slot` 값 관계 | 겉옷·상의·하의 등 사용자가 확인한 배치. 같은 활동에서 중복 자리는 허용하지 않음 |
| 착용 | `fashion.wear_experience` Entity와 `fashion.wore_outfit` | `worn`을 직접 보고한 경우에만 생성 |

시나리오 명령은 owner, ID, 현재 보드 revision, 입력 후보, 고유 슬롯을 검증하고 원자적·재전송 안전 영수증을 남긴다. 출처를 삭제하면 아직 부분 철회·재계획이 완성되지 않은 개발 저장소에서는 관련 활동을 함께 제거하고 재전송을 차단한다. 이후에는 독립 출처를 유지하고 영향받은 작업만 재검토하게 확장한다.

확정 후에는 현재 그래프의 색상·사이즈·코디 자리·소유 상태를 함께 정정할 수 있다. 화면은 현재 그래프 지문과 항목을 받아 중복 자리와 옵션을 검토한 뒤 한 명령으로 제출한다. 자리·소유만 바꾸면 현재 Variant 관계를 정정한다. 색상·사이즈가 바뀌면 기존 Variant를 고치지 않고 새 `core.product_variant`를 만들어 같은 상품에 연결하고, 항목의 `fashion.line_variant`와 코디의 `fashion.has_item`을 새 Variant로 교체한다. 이전 Variant를 참조하는 다른 활동은 그대로 유지한다. 새 Variant의 옵션·소유·자리 관계와 출처·근거는 한 트랜잭션에서 기록한다. 처음 확정한 TaskResult와 착용 기록은 바꾸지 않으며, 기존 보드의 `record_wear`는 재검토 대상으로 막고 새 활동에서 코디를 다시 확인한다. 같은 상품 옵션을 서로 다른 활동에서 다시 확인하더라도 자동으로 신원을 병합하지 않는다.

새 관계 도입 전 확정한 코디에는 `fashion.item_slot`이나 안정적인 항목 연결이 없을 수 있다. 이 경우 현재 화면은 처음 확정한 슬롯과 Variant를 읽어 보여주고, 첫 정정에서 모든 항목의 관계를 함께 만든다. 일부 관계만 남은 불완전한 그래프는 충돌로 거부한다.

## 검증 사례

- 합성 재킷·슬랙스 PNG 각각을 실제 이미지 API에 전송하고 `commerce_product`, 제목, `패션` 태그와 근거를 확인한다. 오독된 소재 사실은 패션 KG에 복사하지 않는다.
- 두 캡처를 서로 다른 슬롯에 넣으면 두 상품/Variant를 구분한 Outfit이 된다. 같은 슬롯 중복, 다른 활동의 후보, 확인하지 않은 소유 상태는 거부한다.
- `candidate`는 구매·소유를 의미하지 않고, `not_worn`/`unknown`은 착용 관계를 만들지 않는다. 같은 명령의 재전송과 서버 재시작에도 중복 기록이 생기지 않는다.
- 기존 캡처의 출처 삭제와 근거 변경 시 오래된 계획 승인을 막는다.
- 착용 결과 직전에 Outfit의 상품 Variant·색상·사이즈·소유 상태 관계를 다시 확인한다. `fashion.has_item`이 철회된 코디는 착용으로 기록하지 않는다. JSON 파일과 관계형 PostgreSQL 저장소에서 같은 검증을 실행한다.
- 색상·사이즈·슬롯·소유 상태 정정은 JSON 및 관계형 저장소에서 완료 결과 불변, 다른 활동의 Variant 격리, 여러 번 정정한 뒤 현재 항목 복원, 오래된 지문 거부, 명령 재전송, 삭제 후 재전송 차단을 검사한다.

## 이후 확장

같은 실상품을 다룬 여러 캡처의 명시적 신원 병합, 체형·날씨·드레스코드 적합성 추천, 후보 간 AI 비교, 옷장 재고·세탁 상태, 가격/재고/구매 확정, 착용 사진 비교는 별도의 출처·검증 계약을 만든 뒤 추가한다. 지금의 모델이 이미지 하나만으로 적합성이나 소유를 확정해서는 안 된다.
