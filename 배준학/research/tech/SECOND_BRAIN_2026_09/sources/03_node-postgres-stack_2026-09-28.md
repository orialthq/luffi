## Luffi: open-source building blocks for a Node + Postgres stack (checked 2026-09-28)

**Do this first: upgrade Node.** Node 20 reached end of life on 2026-04-30 ([eolradar](https://eolradar.com/node-js-20-end-of-life-2026/)). I checked the npm registry today, and every candidate below now requires Node 22 or later and ships as ESM only:
- pg-boss 12.35.0 requires ≥22.12
- graphile-worker 0.18.0 requires ≥22.18
- ai 7.0.118 requires ≥22
- @mastra/core 1.71.0 requires ≥22.13

The server's `package.json` (`server/package.json` on `dev`) is already `"type":"module"` with no npm dependencies, but its `engines` field says `>=20`. Moving to Node 24 LTS should be cheap.

### 1. Graph and vector search inside Postgres
- **pgvector** ✅ 23k★, 0.8.6 released 2026-07-29 ([changelog](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md)). HNSW indexes with iterative scans handle queries filtered by user. This is the base layer and replaces the current full-scan name matching; queries should take milliseconds.
- **pgvectorscale** ✅ 3.1k★ and **VectorChord** ⚠️ (AGPLv3 or ELv2, 1.8k★, v1.1.1) are built for millions to billions of vectors. Each user's graph is small, so skip both.
- **Korean keyword search.** Stock Postgres full-text search has no Korean parser. Four options:
  - **PGroonga** ✅ (PostgreSQL licence, recalled rather than confirmed): 4.0.9 released 2026-09-23 and very active ([releases](https://github.com/pgroonga/pgroonga/releases)). Supabase offers it. Easiest Korean route that works on a managed host.
  - **textsearch_ko + pg_textsearch**: textsearch_ko (MeCab, BSD) is a stale 77★ repo; [pg_textsearch](https://github.com/timescale/pg_textsearch) is ✅ PostgreSQL licence, 4k★, v1.4.0, BM25 ranking, PG 17/18, accepts any text-search configuration.
    - A May 2026 benchmark put this pair with pgvector and in-database rank fusion (RRF). It matched Elasticsearch on Korean (MIRACL nDCG 0.77 vs 0.75) at 1.79 ms p50 ([jaesolshin](https://jaesolshin.com/posts/postgresql-replaces-elasticsearch/)). That was a single node, and the ~200 ms embedding step was excluded.
    - Best quality if you host Postgres yourself.
  - **ParadeDB pg_search** ⚠️ AGPL-3.0, 9.3k★, v0.25.10 released 2026-09-23. Real BM25 plus a Korean morphological tokenizer (`pdb.lindera(korean)`, KoDic dictionary). Neon removed it on 2026-09-21 ([Neon](https://neon.com/docs/extensions/migrate-pg-search-to-lakebase-text)), so in practice you would host it yourself.
  - **pg_bigm** ✅ v1.2: bigram index, fine as a fallback for two-character Korean terms.
- **Apache AGE** ✅: 1.6.0 released 2026-01-21. PG18 support is still "being finalized" by a small volunteer team ([roadmap](https://github.com/apache/age/discussions/2305)). Recursive CTEs over your assertion tables cover 1–3 hop queries, so skip it.

### 2. TypeScript agent and memory frameworks
- **Vercel AI SDK 7** ✅ Apache-2.0, released 2026-06-25 ([blog](https://vercel.com/blog/ai-sdk-7)). Runs in plain Node and provides structured output, `embed`/`embedMany`, [`rerank`](https://ai-sdk.dev/docs/ai-sdk-core/reranking), and durable `WorkflowAgent` runs. **Adopt it** as a thin wrapper over OpenAI.
- **Mastra** ✅ Apache-2.0 core (its `ee/` directory is source-available), 28k★, 1.71.0. Its [memory](https://mastra.ai/docs/memory/overview) is chat-thread memory: history, working memory, pgvector semantic recall, and observational memory. It has no knowledge graph and would duplicate your kernel. Skip the framework, but borrow observational memory's background observer/reflector pattern for consolidation passes.
- **Mem0** ✅ 66k★, npm mem0ai 3.3.1. Open-source v3 **removed graph memory**, and its entity linking uses spaCy ([migration guide](https://docs.mem0.ai/migration/oss-v2-to-v3)). That spaCy setup is probably weak for Korean (unverified). The TypeScript pgvector client has a crash bug filed this month ([#7294](https://github.com/mem0ai/mem0/issues/7294)). It would also keep memories in a separate store outside your provenance tables. **This undercuts the earlier "adopt Mem0" memory note.**
- **Graphiti** ✅ 31k★: Python only, runs on Neo4j, FalkorDB or Neptune. Skip, but copy its edge-invalidation design.
- **Cognee** ✅ v1.6.1 released 2026-09-24: Python core, so it would mean a separate Python service. Skip.
- **LangGraph.js**: its Postgres store shows no semantic index in the JS docs. Skip.
- **New projects worth reading, not adopting:**
  - [TypeGraph](https://github.com/nicia-ai/typegraph) (MIT, 80★): TypeScript on Postgres + pgvector, bitemporal, hybrid search. Too young.
  - [post-graph-rag](https://arxiv.org/abs/2608.24921): a Postgres-only bitemporal graph design that supports your architecture. Its claimed 94% on LongMemEval is unverified.

### 3. Background jobs on Postgres
- **Graphile Worker** ✅ MIT, 0.18.0 released 2026-09-08.
  - Low latency through LISTEN/NOTIFY, built-in cron, deduplication by job key, and `add_job()` can be called from SQL inside the same transaction.
  - Jobs sharing a named queue run one at a time, so a queue per user (`user:<id>`) serializes each user's writes while different users run in parallel.
- **pg-boss** ✅ MIT, 12.35.0 released 2026-09-26: cron, dead-letter queues, a dashboard, and group concurrency. It changes schema often and has [documented footguns](https://agledger.ai/blog/pg-boss-production-lessons/).
- **Pick:** Graphile Worker.
- **Effect on speed:**
  - Throughput multiplies by the number of workers, but each capture still takes ~20 s.
  - For backfills, OpenAI's [Flex tier](https://developers.openai.com/api/docs/guides/flex-processing) charges Batch prices on normal synchronous calls without the 24 h window. It is in beta with limited models.
- **The global lock needs a code change, not a library:** write changed rows incrementally and take a per-user `pg_advisory_xact_lock`.

### 4. Korean embeddings and rerankers
- **Benchmarks.** On the [KURE-v1 model card](https://huggingface.co/nlpai-lab/KURE-v1) (8 Korean retrieval sets), nDCG@10 is:

| Model | nDCG@10 |
|---|---|
| KURE-v1 | 0.695 |
| bge-m3 | 0.687 |
| multilingual-e5-large | 0.664 |
| OpenAI text-embedding-3-large | 0.617 |

- The [Korean leaderboard](https://github.com/OnAnd0n/ko-embedding-leaderboard) ranks Qwen3-Embedding-4B at 81.4, KURE-v1 80.8, bge-m3 79.3, embeddinggemma-300m 78.2 and Qwen3-Embedding-0.6B 75.9. It does not include OpenAI.
- OpenAI appears to have released no new embedding model in 2026 (unverified).
- **Pick:** KURE-v1 or bge-m3 (both MIT, 1024 dimensions). Serve it through [Hugging Face TEI](https://github.com/huggingface/text-embeddings-inference) (✅ Apache-2.0, a Rust Docker sidecar that runs on CPU) or in-process with @huggingface/transformers 4.3.0 (an ONNX build of bge-m3 exists).
  - Expected effect: roughly +8 nDCG points over what you have now and almost no embedding cost.
- **Rerankers:** bge-reranker-v2-m3 and Qwen3-Reranker (both ✅ Apache-2.0). There is also a Korean fine-tune, [dragonkue/bge-reranker-v2-m3-ko](https://huggingface.co/dragonkue/bge-reranker-v2-m3-ko), licence unverified. I found no Korean reranker benchmark. At per-user scale a reranker is optional at first.

### 5. On-device (Flutter)
- **Apple Foundation Models** ([WWDC26](https://developer.apple.com/videos/play/wwdc2026/241/)):
  - Image input, an OCR tool and the Korean locale are all supported.
  - Context is 8,192 tokens per Apple; another report says 4K (unverified).
  - Apple's server model is free only for developers under 2M downloads.
- **Gemini Nano** through the ML Kit Prompt API is validated for English and Korean ([docs](https://developers.google.com/ml-kit/genai/prompt/android)).
- **Flutter bridges:**
  - [flutter_local_ai](https://pub.dev/packages/flutter_local_ai) (MIT) covers both platforms.
  - [flutter_gemma](https://pub.dev/packages/flutter_gemma) runs EmbeddingGemma with a local vector store under the Gemma terms ⚠️.
- Device coverage is partial, so use on-device work for OCR and pre-extraction that shrinks the server prompt, and keep the server as the source of truth. On-device embeddings only help if the server uses the same model.

### Recommended minimal stack and order of adoption
1. **Node 24 LTS** — unblocks everything else.
2. **Graphile Worker plus the lock rewrite** — per-user queues, incremental writes and advisory locks; parallel capture analysis; nightly consolidation and suggestion cron jobs.
3. **pgvector with KURE-v1 or bge-m3 on TEI** — backfill embeddings through the queue.
4. **Korean keyword search, fused with vectors by RRF in one SQL query** — PGroonga if you're on a managed host, or pg_textsearch + textsearch_ko if you host Postgres yourself.
5. **Vercel AI SDK 7 plus OpenAI Flex** — can go in alongside step 2.
6. **On-device OCR and pre-extraction** — later.

There is no ready-made library for the suggestion engine. Build it in-house as a cron job over assertions, borrowing Mastra's observer/reflector pattern.

**Open question:** which host runs your Postgres decides which of these extensions you can actually install.
