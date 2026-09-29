# 모바일 AI Second Brain 경쟁 서비스 분석과 ① 문제정의 초안

기준일: 2026년 9월 15일 · 대상: Sorti, Mem, Fabric의 iPhone·Android 앱과 연결된 AI 기능

## 1. 핵심 판단

**가장 설득력 있는 문제정의는 “AI가 능동적으로 일하기 시작했지만, 그 AI가 일할 수 있도록 자료·맥락·진행 상태를 관리하는 부담은 여전히 사용자에게 남는다”이다.**

세 서비스를 ‘저장·검색만 하는 도구’로 묶으면 현재 제품과 맞지 않는다. Sorti는 상품 비교와 가격 알림, Mem은 할 일·프로젝트 자동 발견과 후속 관리, Fabric은 연결된 자료와 작업을 활용하는 에이전트를 제공한다. 비판은 이러한 자동화가 생활 속 활동의 어느 구간까지 이어지고, 어디서 사용자가 다시 개입해야 하는지를 구체적으로 드러내야 한다. [1. Mem iOS](https://apps.apple.com/us/app/mem-your-personal-ai-agent/id1578757028) · [6. Mem Agent](https://get.mem.ai/product/agent) · [13. Sorti Android](https://play.google.com/store/apps/details?hl=en&id=com.linoybargal.Sorti) · [20. Fabric Android](https://play.google.com/store/apps/details?hl=en&id=so.fabric.mobile)

서비스별로 공격할 지점은 다르다.

| 서비스 | 문제정의의 중심 | 사용자가 계속 맡는 일 | 판단의 성격 |
| --- | --- | --- | --- |
| Sorti | 저장물을 다시 보여주는 것만으로 여러 선택과 준비가 필요한 활동이 완성되지는 않는다. | 후보를 실제 일정·예산·준비 순서에 맞게 엮기 | 공식 활용 흐름에서 도출한 해석 |
| Mem | 능동적 후속 관리도 AI에 들어온 기록과 연결 범위에 의존한다. | 연결되지 않은 선택·변경·완료 사실을 전달하고 외부 도구에 반영하기 | 공식 가이드의 명시적 절차에 근거 |
| Fabric | 강력한 작업 공간을 개인에게 맞는 자동화로 구성하는 책임이 남는다. | 작업 정의, 자료 연결, 실행 주기·접근 범위 설정, 결과에 따른 지시 수정 | 공식 설정·사용 가이드에 근거 |

이 차이는 ‘진짜·가짜 에이전트’라는 이분법보다 구체적이다. **에이전트가 수행하는 작업량과, 사용자가 에이전트를 운영하기 위해 들이는 수고를 함께 봐야 한다.** 자동화 기능이 늘었다는 사실만으로 전체 활동의 수고가 줄었다고 결론낼 수는 없다. 반대로 수고가 남는다는 사실만으로 경쟁 제품이 효과가 없다고 단정할 수도 없다.

본 분석은 최신 스토어 설명·버전 기록, 공식 모바일 가이드, 공개 앱 화면, 공개 리뷰에 근거한다. 실기기 설치·로그인 후 수행 시간을 재거나 기능을 재현한 시험은 포함하지 않는다. 따라서 응답 정확도, 탭 수, 동기화 지연, 실제 완료율은 측정 결과로 제시하지 않는다. 공개 설명에 없는 기능은 ‘미확인’으로 다루며, 서비스 전체의 미지원으로 바꾸어 쓰지 않는다.

## 2. 모바일 버전을 기준으로 바로잡아야 할 사실

| 항목 | Sorti | Mem | Fabric |
| --- | --- | --- | --- |
| 공식 iPhone 앱 | 있음. 확인한 미국 등록 페이지는 1.1.36 | 있음. 확인한 미국 등록 페이지는 2.6.33 | 있음. 0.8.13, 9월 3일 업데이트 |
| 공식 Android 앱 | 있음. Google Play 갱신일 9월 8일 | 공식 다운로드 페이지에서 Android 네이티브 앱을 확인하지 못함. 메시지 채널 이용과 네이티브 앱 설치는 구분해야 함 | 있음. Google Play 갱신일 8월 27일 |
| 중요한 최근 변화 | 분류 수정 학습, 상품 비교, 재발견·Progress 기능을 릴리스 노트에 명시 | 7월 Mem Agent 전환, 8월 26일 iOS Tasks·Projects 추가 | 3월 9일 iOS Tasks 추가, 9월 손글씨 스캐너 업데이트 |
| iOS 최소 버전 | iOS 15.0 | iOS 18.0 | iOS 15.6 |
| 스토어상 UI 언어 | 영어·히브리어 | 영어 | 영어 |

출처: 각 앱의 스토어 및 Mem 공식 다운로드 페이지. 날짜는 2026년이며, 스토어의 상대 날짜를 임의로 정확한 출시일로 환산하지 않았다. UI 언어 표시는 한국어 콘텐츠 이해 성능을 뜻하지 않는다. [1. Mem iOS](https://apps.apple.com/us/app/mem-your-personal-ai-agent/id1578757028) · [2. Mem 지원 플랫폼](https://get.mem.ai/download) · [12. Sorti iOS](https://apps.apple.com/us/app/sorti-save-organize-it-all/id6478935311) · [13. Sorti Android](https://play.google.com/store/apps/details?hl=en&id=com.linoybargal.Sorti) · [19. Fabric iOS](https://apps.apple.com/us/app/fabric-your-second-brain/id6449003046) · [20. Fabric Android](https://play.google.com/store/apps/details?hl=en&id=so.fabric.mobile)

특히 Mem을 예전 Mem Chat 기준으로 설명하면 중요한 경쟁 기능을 놓친다. 현재 iOS 앱에는 Tasks·Projects가 출시되어 있으므로 ‘대화만 있고 할 일을 볼 수 없다’는 서술은 폐기해야 한다. Fabric도 ‘참고 자료와 할 일을 연결하지 못한다’고 할 수 없다. 전용 Tasks와 자료 연결이 공식 기능이다. [1. Mem iOS](https://apps.apple.com/us/app/mem-your-personal-ai-agent/id1578757028) · [23. Fabric Tasks 가이드](https://fabric.so/guide/features/tasks)

비용 구조도 다르다. Sorti는 전체 기능을 무료로 안내한다. Fabric의 캡처 연결은 Pro에 속하며, 현재 개인 요금표의 Pro는 연간 $216 결제 시 월 환산 $18로 표시된다. 월 단위 결제 가격과 혼동해서는 안 된다. Mem의 추적·연결 한도는 아래에서 따로 다룬다. 가격은 성능 차이의 증거가 아니라 필요한 사용 범위를 확보하는 조건이다. [14. Sorti 기능](https://letitsorti.com/features) · [21. Fabric iOS 캡처 연결](https://fabric.so/marketplace/connections/ios-screenshots/EPILUm2R) · [30. Fabric 요금제](https://fabric.so/pricing-and-plans-for-individuals)

## 3. Mem: 능동적이지만, 그 능동성이 관찰 가능한 기록의 범위에 묶인다

### Intent Inference 범위 재검토

**공개 근거로 가장 명확하게 설명할 수 있는 범위는 ‘기록 기반 할 일 추론과 후속 관리’다. 이를 ‘여러 생활 캡처에서 아직 표현되지 않은 활동 의도를 자율적으로 발견한다’까지 확대해서는 안 된다.**

| 구분 | 확인한 근거 | 판단할 수 있는 범위 |
| --- | --- | --- |
| 입력한 이미지·PDF 내용 이해 | 이미지 이해 사용 가이드 | 업로드된 자료를 읽고 검색하는 기능을 안내한다. 사진첩 자동 관찰이나 캡처 묶음에서의 자발적 목표 발견을 증명하지 않는다. |
| 메모에서 할 일·프로젝트 자동 추출 | iOS 출시 기록, 창업자 설명, 실제 사용자의 추출 결과에 대한 후기 | 단순 체크박스 수집을 넘어 메모를 해석해 작업으로 관리하는 기능은 출시·사용 근거가 있다. |
| 그룹화·우선순위·작업 상태 관리 | 창업자가 별도 작업 데이터로 해석·관리하는 방식을 설명 | 제공사의 작동 방식 설명이다. 임의의 자료에서 정확히 수행하는 수준은 독립적으로 측정되지 않았다. |
| 상황에 맞춘 후속 알림 | 공식 홈페이지의 입력→출력 예시 | 이미 노트에 적힌 작업을 다시 제시하고 행동 시점을 권하는 사례다. 새로운 활동 의도 발견의 시연으로 사용할 수 없다. |
| 여행·식단·구매 지원 | 공식 활용 가이드와 공유 루틴 안내 | 목표·조건을 알려주거나 루틴을 설정하는 활용법을 설명한다. 모든 생활 상황을 자동으로 파악한다는 실기 검증 자료가 아니다. |
| 약한 관심 신호만 있는 여러 캡처에서 활동 후보 발견 | 해당 과업의 재현 가능한 시연·시험 결과 미확인 | 지원 여부와 성능을 확정할 수 없다. ‘이미지 이해 + 할 일 추출’이 각각 있다는 이유로 이 결합 흐름도 된다고 단정할 수 없다. |

출처: 이미지 이해 [4. Mem 이미지 이해](https://help.mem.ai/features/pdf-and-image-understanding), 출시 [1. Mem iOS](https://apps.apple.com/us/app/mem-your-personal-ai-agent/id1578757028), 작업 관리 [32. 창업자의 작업 추론 설명](https://www.reddit.com/r/MemIt/comments/1vl2thj/love_meeting_notes_hate_that_task_management_is/), 시연 예시 [31. Mem 홈페이지](https://get.mem.ai/), 사용자 경험 [34. Mem Agent 사용 후기와 답변](https://www.reddit.com/r/MemIt/comments/1ve6kit/constructive_feedback_on_mem_agent/), 루틴 [33. Skills·Routines 출시 안내](https://www.reddit.com/r/MemIt/comments/1vkzzc9/mem_agent_now_supports_skills_and_you_can_share/).

홈페이지의 Dana 사례를 구체적으로 보면, 원본 회의 노트에 이미 ‘목요일 투자자 보고 전에 Dana의 최종 수치를 받기’라는 후속 작업이 적혀 있다. Agent의 출력은 그 작업을 오늘 처리하라고 제안한다. 이 사례에서 새롭게 더한 것은 대응 시점과 메시지 초안 제안이며, 자료 요청이라는 행동 자체를 무관한 기록에서 처음 발견한 것이 아니다. 이 예시만으로 일반적인 다중 맥락 추론의 정확도나 자발적 목표 발견을 입증할 수 없다. [31. Mem 홈페이지의 원본 노트와 Agent 응답](https://get.mem.ai/)

그렇다고 Mem을 단순 리마인더로 축소해서도 안 된다. 창업자는 노트의 체크박스를 모으는 방식이 아니라, 내용을 해석해 별도의 작업 데이터로 관리하고 그룹화·중복 제거·우선순위를 다루는 방식이라고 설명한다. 사용자가 모든 작업을 정형화해서 직접 등록해야만 하는 제품으로 규정할 근거는 없다. [32. 창업자의 작업 추론 설명](https://www.reddit.com/r/MemIt/comments/1vl2thj/love_meeting_notes_hate_that_task_management_is/)

Skills는 사용자가 ‘특정 상황이면 이렇게 처리해 달라’는 반복 규칙을 알려주고, 이후 관련 대화나 새로 생성·수정한 노트에 적용하는 기능으로 안내된다. 기본 작업 추적과 사용자 지정 루틴을 구분해야 한다. 모든 능동적 동작에 사전 규칙이 필요한 것도 아니고, 사용자 지정 루틴의 존재가 모든 생활 의도의 자동 발견을 뜻하는 것도 아니다. 공개된 식사 추천 루틴의 상세 화면은 로그인 뒤에 있어 조건과 결과를 직접 확인하지 못했다. [33. Skills·Routines 출시 안내](https://www.reddit.com/r/MemIt/comments/1vkzzc9/mem_agent_now_supports_skills_and_you_can_share/)

더 직접적인 문제는 추론의 유무보다 **추출된 행동이 정말 사용자의 의도인지 구분하는 정확도**다. 한 사용자는 회의록에서 다른 사람의 할 일이 자신의 작업으로 추출되어 수정해야 했다고 보고했다. 다른 사용자는 참고 자료와 이메일을 실행할 의도가 없는데도 작업·프로젝트로 해석한 경험을 보고했다. 이는 개별 사용 경험으로, 전체 오류율이나 최신 모든 계정의 동작을 대표하지 않는다. 다만 ‘참고 정보·막연한 관심·남의 업무·나의 실행 의지’를 구분하는 것이 실질적인 검증 과제임을 보여준다. [34. Mem Agent 사용 후기와 답변](https://www.reddit.com/r/MemIt/comments/1ve6kit/constructive_feedback_on_mem_agent/) · [35. 가격 개편 공지의 사용자 경험](https://www.reddit.com/r/MemIt/comments/1w5h2jy/community_update_on_pricing/)

따라서 비교 문구는 ‘Mem에도 우리와 동일한 Intent Inference가 구현되어 있다’가 아니라, **‘Mem은 노트에서 작업을 추론해 관리한다. 목표가 명시되지 않은 여러 생활 캡처에서 활동 후보를 발견하는 범위는 공개 근거만으로 확인되지 않았다’**가 정확하다. 미확인을 미지원으로 바꾸어 경쟁 우위를 주장하는 것 역시 피해야 한다.

### 공식적으로 안내하는 입력·기억 기능

Mem Agent는 입력된 메모와 메시지에서 할 일·프로젝트·목표를 파악하고, 진행 중인 일을 기억하며 다음 대응 시점을 조정한다고 소개한다. 이는 제공사가 설명하는 범위이며, 모든 유형의 목표·자료에서 동일하게 작동한다는 성능 검증 결과는 아니다. [6. Mem Agent](https://get.mem.ai/product/agent)

모바일 입력도 텍스트에 한정되지 않는다. Share to Mem은 다른 앱의 공유 메뉴에서 Mem을 선택하고 저장하는 흐름을 제공한다. 안내된 절차에는 노트 초안 확인·수정, 필요시 컬렉션 선택, 완료가 포함된다. 다만 이 입력 경로가 있다는 사실과 휴대폰의 모든 캡처가 별도 동작 없이 유입된다는 것은 다르다. 사진첩 자동 수집은 이번에 확인한 Mem 공식 모바일 안내에서 확인되지 않았다. [3. Mem 공유 저장](https://help.mem.ai/features/share-to-mem)

이미지·PDF가 Mem에 업로드되면 내용 이해와 검색 색인화가 자동으로 진행된다. ‘캡처를 읽지 못한다’는 비판도 맞지 않는다. 반면 외부 URL로 연결한 이미지는 표시할 수 있어도 색인화되지 않으며, 이해 대상으로 삼으려면 다시 업로드해야 한다는 제한이 있다. [4. Mem 이미지 이해](https://help.mem.ai/features/pdf-and-image-understanding)

Heads Up은 현재 노트와 관련된 사람·주제·프로젝트의 자료를 자동으로 제시한다. iOS에서도 관련 노트를 열 수 있다. 따라서 매번 모든 관련 자료를 사용자가 찾아 붙여야 한다고 주장할 근거도 없다. [5. Mem Heads Up](https://help.mem.ai/features/heads-up)

### 한계 A — 일을 처리한 뒤, AI에게도 처리됐다고 알려줘야 하는 구간

가장 강한 근거는 공식 활용 가이드다. 여행 가이드는 조건이 달라지면 여행 노트를 고치고, 확정 정보와 변경 사항을 저장하도록 한다. 선택 결과를 알려준 뒤 계획이 갱신되는 흐름을 설명한다. **여행을 진행하는 일과, AI가 이해하는 여행 상태를 최신으로 만드는 일이 함께 남아 있는 셈이다.** [7. Mem 여행 가이드](https://get.mem.ai/agent-use-cases/travel-planning)

구매 결정 가이드도 선택한 결과와 이유를 저장하고, 나중에 실제 만족 여부를 기록하도록 안내한다. 이를 다음 비교의 맥락으로 활용한다고 설명한다. 여기서 확인되는 것은 결과를 저장해 이후 응답에 참고하는 활용법이며, 독립적인 선호 학습 알고리즘이나 그 정확도가 검증됐다는 의미는 아니다. [8. Mem 구매 결정 가이드](https://get.mem.ai/agent-use-cases/product-comparison-decisions)

식료품 가이드는 구매하거나 소진한 사실을 Agent에게 알려주도록 한다. 영수증은 구매 사실의 증거일 뿐 현재 남아 있는 양을 보장하지 않는다고 설명한다. 이 한계를 ‘AI가 냉장고를 못 본다’고 조롱해서는 안 된다. 비판할 부분은 일상에서 생기는 변화 중 어떤 것이 자연스럽게 입력되고, 어떤 것은 별도 보고가 필요한지다. [10. Mem 식료품 가이드](https://get.mem.ai/agent-use-cases/grocery-list-food-inventory)

이 지점의 적절한 비판 문장은 다음과 같다.

> Mem은 기록된 일을 능동적으로 챙기지만, 연결되지 않은 생활의 변화를 기록으로 만드는 일까지 없애지는 못한다. 사용자는 자신의 일을 진행하면서 AI가 이해하는 진행 상태도 함께 관리해야 한다.

이 문장은 모든 완료 사실을 매번 수동 입력해야 한다는 뜻이 아니다. 연결된 서비스에서 완료 상태를 파악하는 기능이 있으므로, 범위를 반드시 ‘연결되지 않았거나 아직 기록되지 않은 변화’로 한정해야 한다. [11. Mem 요금제](https://get.mem.ai/pricing)

### 한계 B — AI의 판단과 실제 업무 도구의 상태 사이에 전달 작업이 남는다

프로젝트 가이드의 입력에는 회의 메모, 결정 기록, 사용자가 저장한 외부 작업 보드의 업데이트 등이 포함된다. Agent는 근거를 묶어 상태와 위험을 설명하고 변경안을 만들지만, 해당 가이드는 외부 도구에 적용하는 일을 사용자에게 남긴다. [9. Mem 프로젝트 가이드](https://get.mem.ai/agent-use-cases/project-tracking)

여기서 문제는 최종 승인을 사람이 한다는 점이 아니다. **승인해야 할 결정을 검토하는 수고와, 같은 상태를 서로 다른 시스템에 다시 전달하는 수고는 다르다.** 전자는 사용자의 통제권이며, 후자는 줄일 수 있는 조율 비용이다.

공식 가이드가 설명한 외부 도구 운영 흐름에 대해서는 ‘상태를 읽고 판단하는 자동화와, 실제 상태를 반영하는 과정 사이에 수동 전달 단계가 남는다’고 비판할 수 있다. 다만 이를 Mem 내부 Tasks의 존재까지 부정하거나 모든 커넥터가 쓰기 작업을 못 한다는 주장으로 확대해서는 안 된다.

### 한계 C — 저장된 기억 전체와 능동적으로 추적하는 범위는 같지 않다

현재 요금표는 신규 노트, 자동 검토 대상 노트, 열린 작업·프로젝트, 연결 개수를 각각 제한한다. 자동 추적 대상은 해당 월에 생성·수정한 노트라고 설명한다. [11. Mem 요금제](https://get.mem.ai/pricing)

| 월간 요금표 항목 | Free | Plus | Pro |
| --- | ---: | ---: | ---: |
| 표시 가격 | 무료 | 월 $9 | 월 $29 |
| 자동 추적을 위해 검토하는 노트 | 25 | 50 | 100 |
| 동시에 열린 작업·프로젝트 | 15 | 25 | 50 |
| 연결된 외부 서비스 | 없음 | 없음 | 1 |
| 사용자 지정 루틴 | 없음 | 없음 | 1 |

출처: 공식 웹 요금표. 신규 노트·메시지 등의 별도 한도도 있으며, 한국 앱 내 결제 가격과 동일하다는 의미는 아니다. [11. Mem 요금제](https://get.mem.ai/pricing)

창업자의 추가 공지에 따르면 2026년 8월 20일 이전 가입자의 기존 요금제는 당장 이 표로 전환되지 않는다. 현재 웹 요금표를 모든 기존 계정에 동일하게 적용해서는 안 된다. [35. 가격 개편 공지](https://www.reddit.com/r/MemIt/comments/1w5h2jy/community_update_on_pricing/)

Gmail·Slack·Todoist 연결은 맥락을 공급하고 완료 여부를 이해하는 데 사용된다. 따라서 유료 연결이 수동 보고를 일부 줄인다는 점을 인정해야 한다. 동시에 캡처와 생활 정보가 여러 경로에서 쌓이는 사용자는 자신의 활동이 추적 범위에 충분히 들어오는지 확인해야 한다. ‘기억해 둔 자료’와 ‘계속 챙겨 주는 일’의 범위를 동일하게 받아들이게 해서는 안 된다. [11. Mem 요금제](https://get.mem.ai/pricing)

### Mem에 대한 최종 평가

Mem은 ‘능동적 개인 에이전트’를 직접적으로 비교해야 할 상대다. 비판의 초점은 **실행 의지와 참고 정보의 구분, 입력 범위, 상태 갱신의 수고, 외부 도구와의 연결 범위**에 두어야 한다. 제품을 ‘명시된 체크박스만 처리하는 도구’로 축소해서도, 제공사의 활용 예시를 검증된 생활 자동화로 확대해서도 안 된다. [32. 창업자의 작업 추론 설명](https://www.reddit.com/r/MemIt/comments/1vl2thj/love_meeting_notes_hate_that_task_management_is/) · [35. 사용자 경험](https://www.reddit.com/r/MemIt/comments/1w5h2jy/community_update_on_pricing/)

## 4. Sorti: 다시 찾을 수 있는 저장물이 곧 실행 계획은 아니다

### 모바일에서의 실제 제품 방향

Sorti는 휴대폰에서 발견한 상품·레시피·장소를 다시 활용하도록 만드는 서비스다. 공유 메뉴로 콘텐츠를 보내거나, iPhone에서 최근 캡처를 가져오는 동작을 지원한다. 공개 iPhone 이미지에는 장소 지도, 다른 앱에서의 공유, 레시피 재료, Progress 배지가 등장한다. [12. Sorti iOS](https://apps.apple.com/us/app/sorti-save-organize-it-all/id6478935311)

Android 설명에도 상품 식별, 유사 상품 탐색, 동일 상품의 판매처별 가격 비교, 가격 하락 추적, 공유 폴더, 오래된 저장물 재발견이 명시된다. 따라서 ‘정리만 하고 실행은 전혀 돕지 않는다’는 평가는 맞지 않는다. [13. Sorti Android](https://play.google.com/store/apps/details?hl=en&id=com.linoybargal.Sorti)

공식 기능 페이지는 저장을 의도로 취급해 가격 하락·재입고·장소 접근 시 다시 제시한다고 설명한다. 개별 항목에 음성 메모도 붙일 수 있다. 다만 이 모든 기능의 정확도와 지역별 적용 범위가 독립적으로 검증되었다는 뜻은 아니다. [14. Sorti 기능](https://letitsorti.com/features)

### 한계 A — 저장물의 분류와 활동의 구성 사이에 남는 간격

공식 여행 사례의 중심은 추천 장소를 도시·종류별로 정리하고, 지도와 공유 폴더에서 다시 찾는 것이다. 여러 추천을 한 여행 자료함으로 모으는 자동화는 확인된다. [15. Sorti 여행 가이드](https://letitsorti.com/use-cases/travel)

그러나 같은 여행지의 음식점 여섯 곳과 숙소 세 곳이 모였다고 해서, 숙소 선택에 따라 달라지는 식사 동선이나 예약 우선순위까지 결정된 것은 아니다. **‘함께 볼 자료’가 정리된 상태와 ‘어떤 순서로 무엇을 할지’가 정해진 상태 사이에 사용자의 판단·구성 작업이 남는다.** 이는 공개된 활용 흐름에 대한 해석이며, 모든 형태의 일정 제안을 기술적으로 못 한다는 판정은 아니다.

레시피도 재료·조리 시간·분량 추출과 검색은 확인된다. 이 정보가 바로 ‘이번 주 내 일정과 실제 재고에 맞는 식사 계획’을 의미하지는 않는다. 항목을 이해하는 자동화가 개인의 여러 조건을 종합한 활동 계획으로 어느 정도 확장되는지가 비교할 지점이다. [16. Sorti 레시피 가이드](https://letitsorti.com/use-cases/recipes)

### 한계 B — 가격이 내려간 순간과 내가 지금 살 이유는 다를 수 있다

Sorti는 가격 추적과 목표 가격 알림, 가격 이력·쿠폰을 제공한다고 설명한다. 이는 구매를 돕는 실제 기능이다. [17. Sorti 가격 추적](https://letitsorti.com/use-cases/shopping)

그럼에도 할인·재입고는 상품 측 조건이다. 저장 당시의 관심이 지금도 유효한지, 다른 후보를 이미 구매했는지, 선물하려던 일정이 지났는지에 따라 같은 알림의 유용성은 달라진다. **알림을 발생시킬 조건을 아는 것과, 지금 그 행동이 필요한 이유를 아는 것은 구분해서 평가해야 한다.** 공개 자료만으로 이러한 개인 상태를 자동 반영하는 범위까지 확정하기는 어렵다.

### 한계 C — 찾은 링크가 원래 저장한 대상인지 확인하는 부담

Sorti는 캡처에서 원본 링크를 복원하려고 시도하지만, 정확한 원본을 찾지 못하면 가까운 결과나 유사 상품을 제시한다고 설명한다. 따라서 ‘원본 링크 복원’과 ‘비슷한 대안 제시’를 동일한 성공으로 볼 수 없다. 구매·방문·예약 전에 대상이 실제로 일치하는지 확인하는 일이 남을 수 있다. [14. Sorti 기능](https://letitsorti.com/features)

### 학습과 리뷰를 어떻게 해석해야 하는가

최근 릴리스 노트는 사용자가 분류를 옮기고 이름을 고친 행동에서 학습한다고 명시한다. 분류 피드백이 없다는 비판은 쓸 수 없다. 8월 공개 리뷰에는 세부 주제의 오분류를 다시 정리해야 한다는 경험과 일괄 이동 요청이 있었지만, 이후 업데이트가 있으므로 현재 오류율을 증명하지 않는다. 수정 부담을 실기기에서 살펴볼 이유로만 사용해야 한다. [12. Sorti iOS](https://apps.apple.com/us/app/sorti-save-organize-it-all/id6478935311)

Sorti의 창업자 글도 저장과 행동의 간격을 문제로 삼는다. 따라서 ‘우리는 저장 후 행동이라는 문제를 처음 발견했다’는 접근은 설득력이 없다. 차이를 논하려면 행동까지 이어지는 구체적 절차를 비교해야 한다. 해당 글의 재방문·예약 관련 비율은 원 연구를 확인하지 못했으므로 시장 통계로 인용하지 않는다. [18. Sorti 창업자 글](https://letitsorti.com/journal/why-saved-recipes-and-places-rarely-turn-into-real-plans)

### Sorti에 대한 최종 평가

비판의 중심은 **‘저장물을 다시 활용하기 쉽게 만드는 데 비해, 여러 자료를 하나의 실제 활동으로 조율하는 책임은 얼마나 줄였는가’**다. 가격 알림·지도·공유 목록·분류 학습의 존재를 인정하면서도, 활동의 목표·선택·진행을 유지하는 문제를 별도로 제기할 수 있다.

## 5. Fabric: 도구는 연결되지만, 자동화를 구성하는 책임은 남는다

### 모바일에서도 제공하는 범위

Fabric은 파일·노트·링크·음성 기록을 담는 작업 공간이며, 모바일에서도 검색·AI 대화·자료 공유·작업 관리를 제공한다. Android 앱 설명은 연결된 앱에서 이메일을 보내거나 작업을 만드는 능력까지 설명한다. ‘자료 보관함에 AI 검색만 붙인 제품’이라고 평가해서는 안 된다. [19. Fabric iOS](https://apps.apple.com/us/app/fabric-your-second-brain/id6449003046) · [20. Fabric Android](https://play.google.com/store/apps/details?hl=en&id=so.fabric.mobile)

특히 캡처 수집은 강한 경쟁 기능이다. iOS와 Android 캡처 연결은 전체 자동 동기화 또는 선택 수집을 지원하며, 캡처를 읽고 검색하고 다른 자료와 연결한다고 설명한다. 이는 Pro 연결 기능이다. [21. Fabric iOS 캡처 연결](https://fabric.so/marketplace/connections/ios-screenshots/EPILUm2R) · [22. Fabric Android 캡처 연결](https://fabric.so/marketplace/connections/android-screenshots/imC1iw4E)

다만 캡처 연결 문서는 동기화된 캡처를 읽기 전용으로 설명하고, 프로젝트에 넣거나 내용을 편집하며 활용하려면 라이브러리에 복사하는 경로를 안내한다. AI가 동기화된 캡처를 검색·참조하지 못한다는 뜻은 아니다. **수집되어 찾아볼 수 있는 자료와, 작업에 사용하는 자료 사이의 전환 절차**로 보아야 한다. [21. Fabric iOS 캡처 연결](https://fabric.so/marketplace/connections/ios-screenshots/EPILUm2R) · [22. Fabric Android 캡처 연결](https://fabric.so/marketplace/connections/android-screenshots/imC1iw4E)

### 한계 A — 자료와 할 일을 연결하는 기능이 있어도, 연결 작업은 남는다

Tasks 가이드는 전용 화면에서 작업을 생성하고 제목을 입력한 뒤, 관련 항목 추가 메뉴로 파일·폴더·공간을 선택하는 흐름을 설명한다. 마감·알림·우선순위도 설정한다. 자료와 작업의 연결은 이미 있지만, 안내된 기본 사용 흐름은 사용자가 연결을 구성하는 방식이다. [23. Fabric Tasks 가이드](https://fabric.so/guide/features/tasks)

이 차이가 중요하다. ‘자료와 할 일이 따로 있다’는 비판은 틀리지만, **‘무엇을 할 일로 만들고 어떤 자료를 붙일지는 사용자가 여전히 구성해야 하는 경로가 있다’**는 비판은 근거가 있다. 이 절차가 모든 AI 경로에서 필수라고 확대하지는 않는다.

### 한계 B — 자동화의 출발점이 사용자가 설계한 작업이다

Background Agents는 작업 내용, 실행 일정, 접근할 자료 범위와 권한을 정하도록 안내한다. 결과가 기대와 다르면 지시문과 범위를 수정한다. 반복 업무에는 유용하지만, 자동화할 일을 명확히 정의하지 않은 개인에게는 그 정의 자체가 선행 과제로 남는다. [24. Fabric Agents](https://fabric.so/features/agents)

이를 다음과 같이 비판할 수 있다.

> Fabric은 자동화를 수행할 능력을 제공하지만, 무엇을 자동화할지 정하고 자료와 규칙을 맞추는 일까지 모두 대신하지는 않는다. 사용자는 일을 맡기는 사람이면서 자신에게 맞는 자동화의 설계자이기도 하다.

권한 확인 자체는 결함이 아니다. 비교할 것은 안전한 통제를 유지하면서도 작업 구성·자료 연결·반복 수정의 수고를 얼마나 줄이는가다.

### 한계 C — 모바일의 통합 경험은 기능 목록만으로 판단할 수 없다

Fabric의 모바일 공식 가이드와 마케팅 페이지 사이에는 차이가 있다. 모바일 가이드는 Kanban·List view가 없다고 쓰지만, Kanban 소개는 휴대폰에서 보드를 볼 수 있으며 데스크톱·태블릿에 더 적합하다고 설명한다. **현재 문서만으로 네이티브 모바일 Kanban의 정확한 제공 범위를 확정할 수 없다.** [26. Fabric 모바일 가이드](https://fabric.so/guide/apps-and-extensions/mobile) · [27. Fabric Kanban](https://fabric.so/features/kanban)

Tasks 소개 페이지에는 AI를 통한 작업 조회·수정이 ‘Coming soon’으로 남아 있다. 반면 앱 설명은 외부 앱에서 작업을 만드는 기능을 설명한다. 내장 Tasks와 외부 작업 도구의 차이인지, 문서 갱신 시점 차이인지는 확인되지 않았다. ‘AI와 Tasks가 전혀 연결되지 않는다’는 단정은 보류해야 한다. [20. Fabric Android](https://play.google.com/store/apps/details?hl=en&id=so.fabric.mobile) · [25. Fabric Tasks 소개](https://fabric.so/features/tasks-and-reminders)

맥락 설정 가이드는 현재 파일·폴더를 자동으로 대화 맥락에 포함하는 기능도 설명한다. 사용자가 매번 파일을 전부 수동 첨부해야 한다는 주장은 맞지 않는다. [28. Fabric 맥락 설정](https://fabric.so/guide/AI-and-assistant/setting-context)

8월 iPhone 리뷰에는 기능이 풍부한 반면 노트 생성과 탐색이 복잡하다는 경험이 있다. 그러나 한 사람의 경험을 전체 사용성으로 일반화할 수 없고, 9월 업데이트에는 PDF·Canvas 성능 개선도 기록돼 있다. 모바일의 전환 부담을 시험할 근거로 삼되 ‘느리다’, ‘사용성이 나쁘다’를 확정 사실로 쓰지 않는다. [19. Fabric iOS](https://apps.apple.com/us/app/fabric-your-second-brain/id6449003046) · [29. Fabric 변경 이력](https://fabric.so/info/changelog)

### Fabric에 대한 최종 평가

Fabric의 약점을 ‘연결되지 않은 도구’로 설명하면 사실과 다르다. 더 적절한 문제는 **‘연결 가능한 기능이 풍부해도, 휴대폰에서 하나의 개인 활동을 진행하는 흐름을 구성하는 책임은 남는다’**다. 범용 작업 공간을 잘 운영하는 사용자와, 저장만 해 두고 다시 활용하지 못하는 사용자의 필요가 동일하지 않다는 점을 짚어야 한다.

## 6. 같은 생활 장면에서 비교할 때 드러나는 문제

다음은 실제 시험 결과가 아닌 비교 시나리오다. 다낭 숙소 세 곳·음식점 여섯 곳·항공편 두 개를 저장하고, 이후 숙소를 선택하고 예약을 변경하는 상황을 가정한다.

| 전환 구간 | 공시로 확인된 지원 | 남는 문제 또는 확인할 쟁점 |
| --- | --- | --- |
| 캡처를 찾을 수 있는 자료로 만들기 | Sorti의 분류·원본 탐색, Mem의 업로드 이미지 이해, Fabric의 캡처 동기화 | 어떤 자료는 직접 공유해야 하는지, 대상 식별이 맞는지, 수집 후 작업에 쓰기 위한 전환이 있는지 |
| 여러 자료를 실제 여행 계획으로 만들기 | Sorti의 도시별 목록·지도, Mem의 조건 기반 여행 계획, Fabric의 자료 연결 작업 | 내 조건이 어디서 들어오는지, 목표를 정하고 자료를 묶는 데 얼마나 개입하는지 |
| 숙소를 선택한 뒤 남은 계획 바꾸기 | Mem은 선택을 알려주면 계획을 갱신하는 흐름을 명시 | 한 번의 선택이 어떤 상태에 반영되는지, 별도 설명·수정이 필요한지 |
| 외부 앱에서 예약을 변경한 뒤 상태 맞추기 | Mem의 연결 서비스 맥락 활용, Fabric의 외부 앱 작업 기능 | 해당 예약 서비스가 연결되는지, 확인 자료가 유입되는지, 변경·취소가 기존 계획에 반영되는지 |

근거: 입력 방식은 [3. Mem 공유 저장](https://help.mem.ai/features/share-to-mem) · [4. Mem 이미지 이해](https://help.mem.ai/features/pdf-and-image-understanding) · [14. Sorti 기능](https://letitsorti.com/features) · [21. Fabric iOS 캡처 연결](https://fabric.so/marketplace/connections/ios-screenshots/EPILUm2R) · [22. Fabric Android 캡처 연결](https://fabric.so/marketplace/connections/android-screenshots/imC1iw4E), 여행 계획은 [7. Mem 여행 가이드](https://get.mem.ai/agent-use-cases/travel-planning) · [15. Sorti 여행 가이드](https://letitsorti.com/use-cases/travel) · [23. Fabric Tasks 가이드](https://fabric.so/guide/features/tasks), 연결 서비스는 [11. Mem 요금제](https://get.mem.ai/pricing) · [20. Fabric Android](https://play.google.com/store/apps/details?hl=en&id=so.fabric.mobile). 표의 미확인 쟁점은 기능 부재를 뜻하지 않는다.

비교의 단위는 ‘검색 버튼이 있는가’ 또는 ‘보드가 있는가’보다 **상태가 바뀌는 순간**이어야 한다. 가령 이미 선택한 숙소를 다시 비교 대상으로 제시하지 않는지, 취소된 예약을 여전히 확정으로 취급하지 않는지, 바뀐 장소가 남은 일정과 할 일에 어떤 영향을 주는지다. 이 기준이면 기능의 수가 아니라 활동을 계속 진행하는 데 필요한 수고를 평가할 수 있다.

## 7. 사용할 비판과 버릴 비판

| 서술 | 판정 | 이유 또는 고쳐 쓸 방향 |
| --- | --- | --- |
| 세 서비스는 가짜 AI 에이전트다. | 사용하지 않음 | 실제 추적·계획·실행 기능이 있다. 판별 기준도 불명확하다. |
| Mem은 사용자가 질문해야만 움직인다. | 사용하지 않음 | 현재 Agent의 자동 추적·후속 관리와 충돌한다. |
| Mem에는 Tasks·Projects가 없다. | 사용하지 않음 | 8월 26일 iOS 출시 기록이 있다. |
| Mem은 피드백을 기억하지 못한다. | 사용하지 않음 | 구매 결과·선호·이전 결정의 활용을 명시한다. |
| Mem은 연결되지 않은 변화의 기록을 사용자에게 요구한다. | 사용 가능 | 여행·구매·식료품 가이드로 뒷받침된다. 연결 기능의 예외를 함께 설명한다. |
| Sorti는 정리·저장만 한다. | 사용하지 않음 | 가격 비교·알림·원본 탐색·지도 등을 제공한다. |
| Sorti에는 행동 기반 학습이 없다. | 사용하지 않음 | 분류 수정 학습이 릴리스 노트에 명시된다. |
| Sorti의 공개 여행 흐름은 자료 정리에 비해 활동 간 조율을 덜 구체적으로 다룬다. | 해석으로 사용 | 미확인 자동화 기능을 ‘없음’으로 단정하지 않는다. |
| Fabric은 캡처를 자동 수집하지 못한다. | 사용하지 않음 | iOS·Android 캡처 동기화가 있다. |
| Fabric은 자료와 할 일을 연결하지 못한다. | 사용하지 않음 | 관련 항목 연결 기능이 있다. |
| Fabric의 자동화 설정에는 작업·자료·주기 구성의 수고가 남는다. | 사용 가능 | 공식 Agents 설정 절차로 뒷받침된다. |
| Fabric 모바일에는 Kanban이 없다. | 확정 보류 | 공식 문서끼리 충돌한다. 실기기 확인이 필요하다. |
| 최종 구매를 사용자에게 맡기므로 에이전트가 아니다. | 사용하지 않음 | 승인과 결제 통제는 기능의 결함을 뜻하지 않는다. |

근거는 각 서비스 분석의 해당 출처를 따른다. 표는 새로운 기능 검증 결과가 아니라 앞선 사실과 해석의 사용 범위를 정리한 것이다.

## 8. ①을 쓰는 논리 순서

**첫 문장:** 경쟁 서비스도 능동적 활용을 지향하고 있다는 변화만 짧게 인정한다. 기능 자랑을 길게 나열하지 않는다.

**Sorti:** 잘 정리된 저장물과 실제 활동 사이에 남는 구성 부담을 제기한다. 독자가 문제를 가장 쉽게 이해하는 출발점이다.

**Mem:** 이 문제를 풀기 위해 능동적 Agent로 진화했지만, 연결되지 않은 실제 변화는 여전히 기록·보고해야 한다는 더 깊은 한계로 넘어간다. 가장 직접적인 경쟁자이므로 이 부분에 가장 많은 분량을 배정한다.

**Fabric:** 자료와 작업을 한 공간에 연결하고 자동화까지 제공해도, 사용자가 그 흐름을 설계·설정하는 부담이 남는다는 다른 해법의 한계를 보여준다.

**마지막 문장:** 세 제품의 공통 미해결 과제를 사용자 수고로 묶는다. 이 문단에서 특정 신제품의 기능이나 우월성을 소개하지 않는다.

추천 제목은 **“능동적 AI로 진화했지만, 여전히 사용자가 관리해야 하는 실행 과정”**이다. 더 날카로운 내부 논의용 표현은 **“일을 챙겨주는 AI를 쓰기 위해, 사용자가 AI도 챙겨야 한다”**이다. 후자는 제품 전체에 대한 판정 대신 남은 부담을 설명하는 문장으로 사용한다.

### ① 본문 초안

> **① 능동적 AI로 진화했지만, 여전히 사용자가 관리해야 하는 실행 과정**
>
> 기존 정보 관리 서비스는 저장과 검색을 넘어, 저장한 정보를 실제 행동으로 연결하는 방향으로 발전하고 있다. 그러나 기능이 능동적으로 동작하는 것과 사용자의 활동이 적은 수고로 진행되는 것은 별개의 문제다. 자료를 행동으로 엮고, 바뀐 상황을 전달하며, 자동화의 흐름을 구성하는 부담은 여전히 남아 있다.
>
> Sorti는 저장한 상품과 장소를 정리하고 가격 비교·알림 등을 제공하지만, 공식 여행 활용 흐름의 중심은 장소를 분류하고 다시 찾는 데 있다. 같은 여행지의 숙소와 음식점이 한곳에 모여 있어도, 어떤 숙소를 선택하고 그 선택에 맞춰 식사·이동·예약 순서를 어떻게 조정할지는 별도의 구성 작업이다. 저장물의 접근성을 높이는 것만으로 여러 자료를 하나의 실제 활동으로 조율하는 문제가 해결되지는 않는다. [15. Sorti 여행 가이드](https://letitsorti.com/use-cases/travel) · [17. Sorti 가격 추적](https://letitsorti.com/use-cases/shopping)
>
> Mem은 할 일과 프로젝트를 발견하고 후속 행동을 챙기는 Agent로 발전했지만, 그 판단은 입력된 기록과 연결된 서비스의 범위에 의존한다. 공식 가이드는 여행 조건의 변경, 구매 결정의 결과, 연결되지 않은 진행 상황을 기록하도록 안내한다. 외부 작업 도구를 사용하는 흐름에서도 Agent가 만든 변경안을 사용자가 반영하는 단계가 남는다. 사용자는 자신의 일을 처리하는 동시에 AI가 이해하는 진행 상태도 최신으로 유지해야 한다. [7. Mem 여행 가이드](https://get.mem.ai/agent-use-cases/travel-planning) · [8. Mem 구매 결정 가이드](https://get.mem.ai/agent-use-cases/product-comparison-decisions) · [9. Mem 프로젝트 가이드](https://get.mem.ai/agent-use-cases/project-tracking)
>
> Fabric은 자료와 할 일을 연결하는 작업 공간과 백그라운드 에이전트를 제공하지만, 공개된 설정 흐름에서는 사용자가 작업을 정의하고 자료 범위·실행 주기를 구성하며 결과에 맞춰 지시를 수정한다. 자동화할 수 있는 기능이 많아져도, 자신에게 필요한 자동화가 무엇인지 정하고 이를 운영하는 부담까지 사라지는 것은 아니다. [23. Fabric Tasks 가이드](https://fabric.so/guide/features/tasks) · [24. Fabric Agents](https://fabric.so/features/agents)
>
> 결국 남은 문제는 저장 정보의 양이나 AI 기능의 수가 아니다. 저장한 자료가 지금의 목표와 실제 진행 상태에 맞춰 다음 행동으로 이어지도록, 사용자가 계속 구성하고 전달하고 갱신해야 한다는 점이다. 개인 AI 서비스의 과제는 정보 처리의 자동화를 넘어 이러한 조율 부담을 줄이는 데 있다.

위 초안의 Mem 비판은 연결되지 않은 정보와 가이드에 명시된 외부 도구 운영 흐름에 적용된다. 연결된 서비스에서 완료 여부를 이해하는 기능까지 부정하는 문장으로 줄여서는 안 된다. [11. Mem 요금제](https://get.mem.ai/pricing)

## 9. 문제정의의 설득력을 높일 검증 기준

공개 자료는 남아 있는 절차를 보여준다. 다만 그 절차가 얼마나 번거롭고, 어떤 서비스가 전체 수고를 더 줄이는지는 별도 검증이 필요하다. 다음 기준으로 같은 모바일 과업을 비교하면 ‘능동적’, ‘유기적’, ‘인터랙티브’라는 표현을 관찰 가능한 차이로 바꿀 수 있다.

| 확인할 차이 | 관찰할 장면 | 기록할 값 |
| --- | --- | --- |
| 시작하는 수고 | 여러 캡처에서 실행할 활동을 정하는 과정 | 목표·맥락을 직접 설명한 횟수, 최초 활용까지 걸린 시간 |
| 자료를 연결하는 수고 | 숙소 비교 또는 식사 계획에 관련 자료를 모으는 과정 | 직접 검색·선택·첨부·이동한 횟수 |
| 상태를 알려주는 수고 | 후보 선택, 예약 완료·변경, 일정 취소 이후 | 같은 사실의 반복 입력 횟수, 추가 설명 필요 여부 |
| 계획의 일관성 | 하나의 선택이 관련 할 일에 영향을 주는 순간 | 갱신된 항목, 누락·충돌, 잘못 유지된 상태 |
| 알림의 유용성 | 완료·보류·관심 변화 이후 | 이미 끝난 일의 재알림, 원치 않는 제안, 유용한 후속 제안 |
| 모바일 사용의 연속성 | 이동 중 한 손으로 자료와 다음 행동을 오가는 과정 | 화면·앱 전환, 중단 후 재개 시간, 포기한 구간 |

승인·선택처럼 사용자의 의사가 필요한 동작은 별도로 기록한다. 이런 동작까지 모두 없애는 것을 목표로 삼으면 통제권을 줄인 제품이 유리한 잘못된 비교가 된다. 줄여야 할 것은 같은 맥락을 반복해서 설명하거나, 이미 발생한 결과를 여러 곳에 다시 입력하는 수고다.

피드백도 구분해야 한다. 분류 수정을 학습하는 것, 대화에서 알려준 취향을 기억하는 것, 실제 선택·완료·변경을 관련 계획에 반영하는 것은 서로 다른 범위다. 앞의 두 가지는 경쟁 서비스에도 있으므로, 마지막 범위가 어떤 입력과 상호작용에서 얼마나 일관되게 작동하는지를 확인해야 한다.

## 10. 출처

아래는 본문에서 사용한 출처다. 기능 설명은 제공사의 공시이며 독립적인 성능 인증이 아니다. 가격은 확인 시점의 웹 표시 기준이고, 스토어·국가·청구 방식에 따라 달라질 수 있다.

### Mem

1. [Mem — 미국 App Store: 최신 앱 설명·버전 기록](https://apps.apple.com/us/app/mem-your-personal-ai-agent/id1578757028)
2. [Mem — 공식 다운로드 지원 플랫폼](https://get.mem.ai/download)
3. [Mem Help — Share to Mem](https://help.mem.ai/features/share-to-mem)
4. [Mem Help — PDF and Image Understanding](https://help.mem.ai/features/pdf-and-image-understanding)
5. [Mem Help — Heads Up](https://help.mem.ai/features/heads-up)
6. [Mem Agent — 제품 설명](https://get.mem.ai/product/agent)
7. [Mem Agent — Travel Planning Assistant](https://get.mem.ai/agent-use-cases/travel-planning)
8. [Mem Agent — Product Comparisons and Decisions](https://get.mem.ai/agent-use-cases/product-comparison-decisions)
9. [Mem Agent — Project Tracking Across Notes and Decisions](https://get.mem.ai/agent-use-cases/project-tracking)
10. [Mem Agent — Grocery Lists and Food Inventory Notes](https://get.mem.ai/agent-use-cases/grocery-list-food-inventory)
11. [Mem — 현재 요금제·추적 범위·연결 한도](https://get.mem.ai/pricing)

### Sorti

12. [Sorti — 미국 App Store: 앱 설명·변경 이력·공개 리뷰](https://apps.apple.com/us/app/sorti-save-organize-it-all/id6478935311)
13. [Sorti — Google Play](https://play.google.com/store/apps/details?hl=en&id=com.linoybargal.Sorti)
14. [Sorti — 기능 설명](https://letitsorti.com/features)
15. [Sorti — 여행 활용 흐름](https://letitsorti.com/use-cases/travel)
16. [Sorti — 레시피 활용 흐름](https://letitsorti.com/use-cases/recipes)
17. [Sorti — 상품 저장·가격 추적](https://letitsorti.com/use-cases/shopping)
18. [Sorti — 저장한 레시피와 장소가 계획으로 이어지지 않는 문제에 관한 창업자 글](https://letitsorti.com/journal/why-saved-recipes-and-places-rarely-turn-into-real-plans)

### Fabric

19. [Fabric — 미국 App Store: 앱 설명·버전 기록·공개 리뷰](https://apps.apple.com/us/app/fabric-your-second-brain/id6449003046)
20. [Fabric — Google Play](https://play.google.com/store/apps/details?hl=en&id=so.fabric.mobile)
21. [Fabric Marketplace — iOS Screenshots](https://fabric.so/marketplace/connections/ios-screenshots/EPILUm2R)
22. [Fabric Marketplace — Android Screenshots](https://fabric.so/marketplace/connections/android-screenshots/imC1iw4E)
23. [Fabric User Guide — Tasks](https://fabric.so/guide/features/tasks)
24. [Fabric — Background Agents](https://fabric.so/features/agents)
25. [Fabric — Tasks and Reminders](https://fabric.so/features/tasks-and-reminders)
26. [Fabric User Guide — Mobile](https://fabric.so/guide/apps-and-extensions/mobile)
27. [Fabric — Kanban](https://fabric.so/features/kanban)
28. [Fabric User Guide — Setting Context](https://fabric.so/guide/AI-and-assistant/setting-context)
29. [Fabric — Changelog](https://fabric.so/info/changelog)
30. [Fabric — 개인 요금제](https://fabric.so/pricing-and-plans-for-individuals)

### Mem의 추론 범위 추가 확인

31. [Mem — 홈페이지의 원본 회의 노트와 Agent 응답 예시](https://get.mem.ai/)
32. [Mem 창업자 Kevin — 작업 추론·별도 데이터 관리에 관한 답변](https://www.reddit.com/r/MemIt/comments/1vl2thj/love_meeting_notes_hate_that_task_management_is/)
33. [Mem 창업자 Kevin — Skills·Routines 출시 안내](https://www.reddit.com/r/MemIt/comments/1vkzzc9/mem_agent_now_supports_skills_and_you_can_share/)
34. [r/MemIt — Constructive Feedback on Mem Agent, 사용자 경험과 창업자 답변](https://www.reddit.com/r/MemIt/comments/1ve6kit/constructive_feedback_on_mem_agent/)
35. [Mem 창업자 Kevin — Community Update on Pricing, 기존 계정 적용 범위와 사용자 경험](https://www.reddit.com/r/MemIt/comments/1w5h2jy/community_update_on_pricing/)
