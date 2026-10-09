# 03. Node + Postgres 스택에 맞는 부품

> 조사일: 2026-09-28 · 원문: [`sources/03_node-postgres-stack_2026-09-28.md`](sources/03_node-postgres-stack_2026-09-28.md)
> 성격: 연구 자료 요약입니다. 작업 지시가 아닙니다.

## 먼저 할 일: Node 올리기

Node 20은 **2026-04-30에 지원이 끝났습니다.** 아래 부품은 모두 Node 22 이상과 ESM만 지원합니다.

- pg-boss 12.35 (≥22.12)
- graphile-worker 0.18 (≥22.18)
- ai 7.0 (≥22)
- @mastra/core 1.71 (≥22.13)

서버는 이미 `"type":"module"`이라 **Node 24 LTS로 올리는 비용은 작습니다.**

## 영역별 선택

| 영역 | 추천 | 대안·비고 |
|---|---|---|
| 벡터 검색 | **pgvector** 0.8.6 (사용자 필터 + HNSW) | pgvectorscale·VectorChord는 수백만 규모용이라 불필요. VectorChord는 AGPL/ELv2 |
| 한국어 키워드 검색 | 관리형 DB면 **PGroonga**, 직접 운영이면 **pg_textsearch + textsearch_ko** | pg_textsearch + pgvector + RRF가 한국어에서 Elasticsearch와 비슷(nDCG 0.77 대 0.75, 1.79ms). ParadeDB는 AGPL이라 직접 호스팅 필요 |
| 그래프 탐색 | 재귀 CTE로 1~3단계 충분 | Apache AGE는 PG18 지원이 미완 |
| LLM 호출·에이전트 | **Vercel AI SDK 7** (Apache): 구조화 출력, `embed`, `rerank`, 내구성 있는 워크플로 | Mastra는 대화 스레드 메모리라 커널과 중복. 관찰자·반성자 패턴만 차용 |
| 작업 큐 | **Graphile Worker** (MIT): LISTEN/NOTIFY, cron, 작업 키 중복 제거, SQL 안에서 `add_job()`. 사용자별 큐(`user:<id>`)로 사용자 단위 직렬화 | pg-boss는 스키마가 자주 바뀜 |
| 한국어 임베딩 | **KURE-v1** 또는 **bge-m3** (MIT, 1024차원). HF TEI 사이드카 또는 transformers.js | 한국어에서 OpenAI `text-embedding-3-large`(0.617)보다 우수(KURE 0.695) |
| 리랭커 | bge-reranker-v2-m3, Qwen3-Reranker | 사용자 규모에서는 처음엔 선택 사항 |
| 기기 안 처리 | Apple Foundation Models(한국어 지원, 이미지·OCR 도구), Gemini Nano(ML Kit Prompt API, 한국어 검증) | 기기 커버리지가 부분적이라 **OCR·사전 추출**에만 쓰고 기준은 서버 |

## 걸러낸 것

- **Mem0:** 오픈소스 v3에서 그래프 메모리를 뺐고, 엔티티 연결에 spaCy를 써서 한국어에 약할 가능성이 있습니다. TS pgvector 클라이언트에는 이번 달 크래시 버그가 있습니다. → 8월 조사의 "Mem0 채택" 판단은 철회합니다.
- **Graphiti·Cognee:** Python 전용이라 별도 서비스가 필요합니다.
- **LangGraph.js:** Postgres 저장소에 의미 검색 색인이 없습니다.

## 권장 도입 순서

1. Node 24
2. Graphile Worker + 잠금 구조 교체(사용자 단위 advisory lock, 변경분만 쓰기)
3. pgvector + 한국어 임베딩(큐로 백필)
4. 한국어 키워드 검색 + RRF
5. AI SDK 7 + OpenAI Flex
6. 기기 안 OCR(나중)

**제안 엔진은 기성품이 없습니다.** 주장(assertion) 위의 cron 작업으로 직접 만들어야 합니다.
