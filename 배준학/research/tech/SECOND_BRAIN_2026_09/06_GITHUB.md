# 06. GitHub 저장소 조사

> 조사일: 2026-09-29 · 원문: [`sources/06_github_2026-09-29.md`](sources/06_github_2026-09-29.md)
> 방법: `gh api`로 약 45개 검색, 약 110개 저장소의 README·라이선스·릴리스 확인
> 성격: 연구 자료 요약입니다. 작업 지시가 아닙니다. ✅ 허용적 라이선스 · ⚠️ 조건부(카피레프트 등)

## 추천 10선

| # | 저장소 | 라이선스·언어 | 왜 |
|---|---|---|---|
| 1 | **timescale/pg_textsearch** + **bab2min/Kiwi**(WASM) | ✅ C / ✅ | Kiwi로 형태소 분석 → Postgres 안에서 BM25. 빠른 한국어 키워드 검색 |
| 2 | **nlpai-lab/KURE** (v1 + v2) | ✅ | 현재 최고의 한국어 검색 모델. v1 밀집 벡터는 pgvector에, v2 다중 벡터는 재순위에 |
| 3 | **smaramwbc/statewave** (355★) | ✅ Python + TS SDK | Postgres + pgvector, **재현 가능한 출처 영수증**. "출처 엄격 메모리"에 가장 가까움 |
| 4 | **Zleap-AI/SAG** (2.5천★) | ✅ Python | 저장할 때 병합하지 않고 **질문할 때 SQL 조인으로 연결** → 조용한 병합 위험 제거 |
| 5 | **moj-analytical-services/splink** (2.4천★) | ✅ Python | 설명 가능한 매칭 점수, Postgres 백엔드. 경계선은 사용자 검토로 |
| 6 | **fastino-ai/GLiNER2** (+ gliner-onnx.js) | ✅ | CPU 한 번에 개체·관계·분류. LLM 앞 저비용 추출(한국어 품질 미확인) |
| 7 | **earendil-works/absurd** 또는 **dbos-transact-ts** | ✅ | Postgres만으로 내구성·재시도 있는 파이프라인 |
| 8 | **BasedHardware/omi** (1.36만★) | ✅ Flutter + Python | 캡처 → 할 일·기억으로 바꾸는 Flutter 앱. 같은 스택 참고 |
| 9 | **ReflexioAI/reflexio** | ✅ Python | 사용자 수정 → 사용자별 프로필·플레이북. 피드백 루프 참고 |
| 10 | **atomicstrata/atomicmemory** | ✅ TS | TS + Postgres/pgvector, 정정(대체·명확화·삭제·유지) 명시 |

## 카테고리별 추가 발견

- **메모리 엔진**
  - **remnic** (MIT, TS): 정정은 사람 승인, 추가 전용 대체
  - **memoweft** (MIT, TS, 4★): "사용자 말함 / 관측 / 모델 추론 / 충돌"을 다른 기록 유형으로 분리, 확신도는 규칙으로 계산
  - **wend-core** (⚠️ AGPL): 사실마다 출처 행, 에이전트 쓰기는 사람 승인 대기열 → 설계만 참고
  - **bcg** (MIT, TS): 사실별 확신도·유효 기간·근거를 추적하는 "믿음" 그래프
- **검색:** gno (MIT, TS): 점수 추적 + "무엇을 못 찾았는지"까지 담은 증거 묶음
- **엔티티 판정:** sage-wiki (MIT, Go): 병합 제안을 사람이 검토. **성숙한 TS 엔티티 판정 라이브러리는 없음**
- **먼저 제안:** OpenBiliClaw (MIT): SNS에서 관심사 가설을 세우고 **사용자가 확인해야 유지** — Luffi의 의도 추론과 같은 패턴
- **캡처·라이프로그:** memex (⚠️ GPL, Flutter): 조각 → 카드 → PARA 분류 → 타임라인·지도 인사이트. **스크린샷 정리기는 전부 120★ 미만 — 성숙한 오픈소스 없음**
- **한국어:**
  - es-hangul (토스, MIT): 초성·자모 분해
  - gjdong (MIT, TS): 도로명 주소 정규화
  - kovre: 한국어 스크린샷 검색 벤치마크
  - **한국어 GLiNER·엔티티 연결 저장소는 없음**

## 피할 것

- **멈춤:** openrecall(AGPL), reor·kuzu(보관됨), timescale/pgai(5월 보관), A-MEM, Memobase
- **라이선스:**
  - screenpipe (상용 전환)
  - OpenViking (3월부터 AGPL), Honcho, ParadeDB, karakeep (AGPL)
  - VectorChord (AGPL/ELv2)
- **별 부풀림 의심**
  - TencentDB-Agent-Memory: 175일에 2.7만★, 관찰자 91명
  - memanto, okf-agent-memory, deeplethe/utopia
- **보안:** Graphiti Cypher 주입 취약점 (CVE-2026-32247, 3월)
