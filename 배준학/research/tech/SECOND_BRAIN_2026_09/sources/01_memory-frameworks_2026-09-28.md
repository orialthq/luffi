## LLM memory / evolving knowledge-graph frameworks, as of 2026-09-28

I pulled star counts and dates from the GitHub API today and checked the READMEs, docs and code linked below.

**Bottom line:** none of these meets our kernel's rules out of the box. Each one automatically merges entities in some way, and none has our Mention → IdentityDecision separation. Adopt one as a separate, derived layer next to our kernel, or borrow its patterns. Don't let it be the system of record.

### Ranked for Luffi (Node 20 + Postgres, strict provenance, no auto-merge, feedback loop)

| # | Project | Does the graph evolve? | License | Server / Node SDK | Storage | Stars / latest release | Provenance | Auto-merges entities? | Ingest cost | Korean |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [Hindsight](https://github.com/vectorize-io/hindsight) (new; repo created Oct 2025) | Yes. Background LLM merges facts into "observations" that get strengthened, weakened or extended, with a proof count. Contradictions are reconciled, not overwritten. | MIT ✅ | Python server; official Node client | **Postgres 15+ with pgvector only**, graph via recursive CTEs ([storage](https://hindsight.vectorize.io/developer/storage)) | 38.1k / v0.10.1, Sep 21 | Yes: each observation cites its source memories with exact quotes | Yes: fuzzy name match plus co-occurrence. Can be made stricter; labelled entities match exactly only. No full off switch found. | 1 extraction pass per retain, plus background merging (call count not published) | Multilingual; Sept 2026 fixes keep facts in their original script |
| 2 | [Graphiti](https://github.com/getzep/graphiti) (Zep) | Yes. Facts carry two time axes and are automatically invalidated when contradicted; entity summaries update. No decay, no feedback. | Apache ✅ | Python only; REST server and MCP. Zep's TS SDK is for the cloud product only. | Neo4j, FalkorDB or Neptune. Kuzu is deprecated. **No Postgres.** | 31.2k / v0.30.2, Sep 8 | Strong: every fact edge lists its source episodes | Yes: similarity match, then LLM. Only bypass is `add_triplet` with known entity IDs ([#1193](https://github.com/getzep/graphiti/issues/1193)). | 4+ LLM stages per episode, some run once per node or edge. The request for ingest without LLM ([#1299](https://github.com/getzep/graphiti/issues/1299)) is still open. | Unverified |
| 3 | [Cognee](https://github.com/topoteretes/cognee) | Partly. [`improve`](https://docs.cognee.ai/core-concepts/main-operations/improve) raises or lowers `feedback_weight` on the nodes and edges used in an answer. Contradiction tagging is opt-in. No decay. | Apache ✅ for the core. ⚠️ Running the graph on Postgres is only a demo; the production version is a paid product. | Python; [`@cognee/cognee-ts`](https://docs.cognee.ai/typescript/getting-started) is Rust bindings at v0.2 (early) | Ladybug/Kuzu, Neo4j, FalkorDB, Neptune; Postgres + pgvector for metadata and vectors | 31.1k / v1.6.1, Sep 24 | Chunk → entity links | Yes, without an LLM: an entity's ID is a hash of its lowercased name, so same-named entities merge across documents | About 1 combined extract-and-summarise call per chunk | Unverified |
| 4 | [MemOS 2.0](https://github.com/MemTensor/MemOS) | Yes. Natural-language feedback and correction API, background scheduler, archived versions of memories, and an LLM "reorganizer" that can be switched off. | Apache ✅ | Python, REST. Its npm packages are agent plugins, not an SDK. | Neo4j + Qdrant by default; also a [Postgres + pgvector graph backend](https://github.com/MemTensor/MemOS/blob/main/src/memos/graph_dbs/postgres.py) on plain tables, no Apache AGE | 11.6k / v2.0.34, Sep 23 | Each memory keeps its `sources` plus archived versions | Yes, via the reorganizer (can be turned off) | Unverified | Unverified |
| 5 | [LightRAG](https://github.com/HKUDS/LightRAG) | Weak. Documents can be added or deleted incrementally; no time validity, no feedback. | MIT ✅ | Python, REST only | **Postgres for everything (pgvector + Apache AGE)**, or Neo4j, Mongo, OpenSearch | 39.9k / v1.5.7, Sep 2 | Chunk IDs, file paths, citations | Yes: the entity's name is its key | 1+ extraction call per chunk, plus merge-summary calls | Output language set by `SUMMARY_LANGUAGE` |

**Lower tier (checked):**
- **Mem0:** 66.1k stars, last release Sep 25. Graph memory was **removed from the open-source version** (now paid platform only). The new algorithm only adds memories, with no update or delete, so it doesn't evolve ([migration guide](https://docs.mem0.ai/migration/oss-v2-to-v3)). Still a solid TS vector memory with pgvector support, at 1 LLM call per add.
- **Letta:** the V1 server is [retired to an `archive` branch](https://github.com/letta-ai/letta). Work moved to `letta-code`, an agent harness whose memory blocks are stored in git. Sleep-time agents are now called "dreaming". It is not a knowledge graph.
- **Microsoft GraphRAG:** 36.1k stars, v3.2.0. The [README says maintenance mode](https://github.com/microsoft/graphrag), with no new features, and warns that indexing is expensive.
- **HippoRAG 2:** research code. Last PyPI release is 2.0.0a4 from June 2025.
- **A-MEM:** research code. The LLM rewrites neighbouring notes, but facts don't trace to sources. Last commit March 2026.
- **MIRIX:** runs on Postgres but is organised as memory types, not a graph. Last release v0.1.6, Dec 2025.
- **Memobase:** user profile plus an event timeline. No commits since Jan 2026.

### Verdicts on the top 5

1. **Hindsight:** the only strong candidate that runs on our existing Postgres (any managed Postgres with pgvector) and has a Node client. Its evolution matches our loop well: observations with evidence, a proof count, and contradictions kept as history. Background merging can be disabled. Risks: fuzzy entity resolution will merge two different "스타벅스" branches unless we pass exact labels. It is pre-1.0, owns its own schema, and is driven by one vendor. Its observations must count as derived data, never as evidence.
2. **Graphiti:** the best model of facts changing over time, and the closest to our Assertion-with-time design. The cost is Neo4j or FalkorDB, a Python sidecar, heavy LLM use per capture, and LLM-based entity merging we can only avoid by calling `add_triplet` with our own IDs. Best used as a design reference, not a dependency.
3. **Cognee:** the most direct feedback mechanism (weights nudged up or down by user feedback), which fits "user acts or corrects". But merging entities by name hash breaks our no-auto-merge rule, and running it on Postgres needs the paid product. Revisit when the TS/Rust SDK matures.
4. **MemOS:** has a real feedback and correction API and a plain-Postgres graph option. The "memory operating system" abstraction is heavy and the docs lean toward Chinese. Worth a short test, not a bet.
5. **LightRAG:** very active and runs on Postgres with AGE, but it is document retrieval, not user memory: no time handling, no feedback, and it merges by name. At most useful for reference content like recipes or travel guides.

### Hype / avoid

- **[OpenViking](https://github.com/volcengine/OpenViking)** (38.8k stars): AGPL ⚠️, and it's a filesystem-style context store, not a knowledge graph.
- **[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)** (27.4k stars): a shared memory proxy for coding agents. Wrong domain.
- **[Supermemory](https://github.com/supermemoryai/supermemory)** (31k stars, MIT repo): the memory engine's source is not in the repo I checked; self-hosting runs one binary on one machine.
- **Mem0 "graph memory":** gone from the open-source version.
- **Letta as a knowledge graph:** it never was one, and it has now pivoted to an agent harness.
- **GraphRAG, HippoRAG, A-MEM:** maintenance mode or research code.
- **Honcho:** AGPL ⚠️.
- **Worth reading, not adopting:** **[LongMemory](https://github.com/CaviraOSS/LongMemory)** (formerly OpenMemory; 4.5k stars, Apache, TypeScript). It is philosophically closest to our kernel: immutable memories, provenance, separate "recorded" and "valid" times, cautious create-or-merge entity decisions, and decay and reinforcement. But it only stores to SQLite, v1.0 is a from-scratch rewrite released Aug 31, 2026, and it is mostly one maintainer.

### Could not verify

- Korean handling for Graphiti, Cognee and MemOS.
- Exact LLM call counts for Hindsight's background merging and for MemOS.
- The license of Supermemory's self-hosted engine binary.
- Whether Hindsight's entity merging can be turned off completely; the docs only mention a stricter setting.
- Hindsight's star count (38k for a repo about 11 months old) comes straight from the API; I didn't audit it.
