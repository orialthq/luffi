## Research on foreign expert venues, Mar–Sep 2026

I ran over 60 searches: about 45 Hacker News queries (stories and comments), about 17 web searches and 15 arXiv API queries, and fetched about 40 primary pages.

**How to read the tags:**
- **[T]** means the talk summary comes from the transcript-derived graph at github.com/ModernRelay/ai-engineer-graph. I did not watch these talks myself. I did confirm the video titles through YouTube oEmbed.
- **[V]** means the number or claim is self-reported by a vendor or author and has not been independently checked.

### Top 15 insights, ranked by relevance to Luffi

1. **Provenance has to be part of the graph and must survive merges.**
   - Source: Daniel Chalef (Zep), "Citation Needed: Provenance for LLM-Built KGs", AI Engineer World's Fair, posted 2026-07-23, https://youtu.be/H7puB0RwJMM [T].
   - Each fact links back to its verbatim source episode. When two entities merge, both parents keep their source links. A contradiction marks the old edge invalid (with a date) instead of deleting it.
   - A deletion removes a fact only when no surviving source still supports it.
   - A trust tag set at ingestion is inherited by every fact derived from that source.
   - **Luffi:** treat each screenshot as an episode. Tag every edge as either observed or inferred, and let deletions cascade through lineage.

2. **Keep the LLM off the write path, and invalidate rather than delete.**
   - Source: Engram (Liuyin Wang), arXiv 2606.09900, 2026-06-05, code at github.com/ly-wang19/engram.
   - The fast write path appends lossless episodes with no LLM call. A separate asynchronous job builds a bi-temporal KG, and reads can filter by "as of" date.
   - It scored 83.6% on LongMemEval_S versus 73.2% for full context, using about 8x fewer tokens.
   - Related work:
     - EdgeMem (2609.05553) builds memory with no LLM at all.
     - Activity Frames (2608.05784, 2026-08-06) compiles screen activity deterministically, keeps pointers back to the evidence, and produced a day's context 86x smaller in 68 ms.
   - **Luffi:** this is the pattern for "capture to memory in seconds".

3. **A matching name does not mean the same entity.**
   - Paul Iusztin, HN, 2026-05-30, https://news.ycombinator.com/item?id=48337689:
     - He auto-merges at similarity ≥0.95, sends 0.85–0.95 to human review, and creates a new node below that.
     - He starts with a minimal POLE+O ontology (Person / Object / Location / Event / Organization) and extends it only when entities collide.
   - The YantrikDB author's own benchmark (HN 47767119, 2026-04-14):
     - Cosine similarity merged "Alice is CEO" with "Sarah is CTO".
     - Contradiction detection caught 0 of 6 seeded conflicts, because entities were never extracted.
   - Hrishi Olickel, Southbridge, 2026-09-20, https://www.southbridge.ai/blog/jev-entity-resolution [V]:
     - A small model plus escalation to a bigger model stayed within 0.5 points of frontier models at about 99.5% lower cost.
     - Writing concrete evidence rules (for example "same residential street address") took accuracy from 0% to 100% on their test cases.
   - **Luffi:** merge only on a hard key such as a place ID, address or phone number. Otherwise store a "possibly same as" edge and ask the user.

4. **Writing a memory is not the same as committing to a belief.**
   - MemTX (2607.23929, 2026-07-27): writes are staged and validated before they count. Irreversible actions require committed beliefs, and retracting a belief repairs everything derived from it.
   - SafeCommit (2608.04289) makes the same point about acting on uncertain memory.
   - Tomaž Bratanič, Neo4j, 2026-08-10, https://neo4j.com/blog/genai/the-payload-the-semantic-layer-memory-and-the-loop-that-fills-it/:
     - An automatic gate checks each new learning for contradiction with existing ones.
     - A human gate reviews user-scoped learnings before they become durable.
     - Rejected items keep their provenance edges.
   - **Luffi:** model the states explicitly: saved → inferred intent → user-confirmed → done, with evidence required for "done". This directly encodes "a link is not evidence of an action".

5. **Models rarely go back and check provenance on their own.**
   - Source: Nakayashiki, "When Stale Constraints Go Unchecked", arXiv 2608.25553, 2026-08-26.
   - Across 16 models, the agent looked at the provenance path in only about 1 of 5 episodes. After the source was superseded, about 75% of decisions still followed the stale constraint.
   - Spending the verification budget on the critical path recovered 61–74 points.
   - **Luffi:** when a source changes, the system should trigger replanning deterministically, not leave it to the LLM.

6. **Rankings between memory designs flip as history grows.**
   - Source: Quentin Spencer, "Ground Truth First", arXiv 2607.21962, 2026-07-24.
   - A budgeted, curated memory led at 3 weeks, but its recall of evicted content fell from 96% to 72% by 9 weeks. A provenance-typed graph rose to 90% over the same period.
   - Method worth copying: generate the facts first (with validity windows) and render the text afterwards, so the gold answers are correct by construction.

7. **Answer accuracy hides poor retrieval precision.**
   - PrecisionMemBench (arXiv 2605.11325, 2026-05-11) [V: the authors also build Tenure]: baseline precision was ≤0.22.
   - DynamicMem (2606.22877):
     - More than 93% of failures came from what memory retrieved, not from the model's answer.
     - Errors clustered on preferences and on naming the exact referent, which is an entity-resolution problem.
     - No system both kept stable facts and replaced facts that changed.
   - MemAudit (2606.24595): task success saturates even without memory, while recovery of the hidden user state stays around 0.6.

8. **Consumer assistants have converged on the same memory design.**
   - Source: Shlok Khemani, "Lessons from Studying Every Memory System", posted 2026-08-12, https://youtu.be/5ZGyKWjQDr0 [T].
   - The pattern is a running profile synthesized in the background plus on-demand search over raw history. Memory is framed as a compute budget: ChatGPT uses about 4k tokens refreshed every few days, Claude about 1k tokens daily.
   - His other points:
     - Serious teams don't outsource memory.
     - What the system can observe limits memory quality: one profile recorded two mutually exclusive trips because it saw the planning, not the decision.
   - In his ChatGPT memory post (https://www.shloked.com/chatgpt-memory-2026, 2026-06-06), user edits to the memory summary do not persist into the real memory.
   - **Luffi:** "saved" is not "decided". A user's edit must actually write to the graph, and visibly so.

9. **Split memory into a slow engine and a fast engine.**
   - Source: Bruchim & Ast, monday.com, AI Engineer World's Fair, 2026-07-22, https://youtu.be/Btk8wDUVs74 [T].
   - The slow engine mines weeks of activity for persona and routines. The fast engine recomputes live signals. Serving recomputes only a thin slice and checks it against live data.
   - Dual-Layer Agentic Memory (2608.22215) routes each write as skip, new or update through a 1.7B→8B model cascade and pruned 68% of redundant writes.

10. **Close the feedback loop with outcomes, not with rule text.**
    - Sonam Pankaj, "User Signal Dies at the Retrieval Boundary", 2026-06-28, https://youtu.be/Jx4ZFEAq6bY [T][V]: rank memories by similarity × historical usefulness; reported tau-bench went from 66% to 80%.
    - Calx, HN 2026-04-01, https://news.ycombinator.com/item?id=47596925 [V]:
      - The author transferred 237 logged corrections as rules to a new agent, which still made 44 mistakes. 13 of those were in categories the rules explicitly covered.
      - The fix was turning recurring corrections into enforced mechanisms rather than more text.
    - RAID (2606.05023) infers the intent behind one expert edit and propagates it across the knowledge base, with the user controlling execution.
    - **Luffi:** user dismissals and edits should re-weight graph edges. Edits that propagate should be shown as a preview first.

11. **Proactivity is a decision problem, and staying silent is a valid choice.**
    - Proactive Service Agents survey (2609.03727, 2026-09-03):
      - Each step chooses between staying silent, asking, assisting or acting.
      - It defines metrics for triggering, timing, calibration, user burden and policy value.
      - Offline classification accuracy does not predict value in deployment.
    - "Over-Personalization Is a Decision Failure" (2609.34284): make the Apply/Suppress decision explicit instead of leaving it implicit in generation.
    - PM-Bench (2607.12385, code at genglinliu/PMBench): the best agent reached only 65.1 F1 on prospective memory, meaning carrying out an intention when a future cue arrives.

12. **Keep raw captures immutable and let the LLM own only a derived layer.**
    - Iusztin & Bouchard, "Turn 10,994 Notes Into Memory", 2026-06-26, https://youtu.be/ZRM_TfEZcIo [T]: an immutable raw/ folder, an index.yaml, and an LLM-owned wiki/ layer.
    - LangChain "Wiki Memory", Harrison Chase, 2026-06-30, https://www.langchain.com/blog/wiki-memory.
    - Anthropic Managed Agents memory, 2026-04-23, https://claude.com/blog/claude-managed-agents-memory: memories are files, with audit logs of which session wrote each one, plus rollback and redaction.
    - Anthropic "Dreaming", May 2026 (dates conflict between 05-06 and 05-19), https://claude.com/blog/new-in-claude-managed-agents: offline consolidation that can either apply changes automatically or wait for review.

13. **Measure before adding memory machinery.**
    - Towards AI, "Context Engineering in 2026", 2026-08-17, https://youtu.be/WP3hjUXd918 [T]: keeping the full cached history beat 11 compaction presets (about 95% vs 32% recall), and GraphRAG tied hybrid RAG at higher cost.
    - Stefania Druga, Sakana, https://youtu.be/R3-anFK1YM8 [T]: memory added nothing when everything fit in context, and a ranked decisions ledger beat vector RAG.
    - Parth Asawa, UC Berkeley, https://youtu.be/iqloyWCGYQQ [T]: report learning "gain" as stateful minus stateless performance.

14. **Content you ingest can poison memory.**
    - WhisperBench (2607.05189): a single email achieved 87.5% stealth memory injection on OpenClaw.
    - "Memory Provenance Laundering" (2607.29167): consolidation can rewrite external content as if it were the user's own history.
    - **Luffi:** SNS screenshots are third-party content. Keep a source-authority label on them through every consolidation step.

15. **HN practitioners are skeptical, mostly about memory going stale.**
    - "Agent memory as a file format" (Cal Paterson), 2026-08-31, 191 points, https://news.ycombinator.com/item?id=49508317.
    - Recurring themes: stale "heresies" that are hard to find, many users turning memory off, and curation beating semantic search.
    - "Lossless-memory" thread, 2026-09-21: timestamps are needed to rebuild current state from contradicting records, and "memory is really 10 different things".

### Consensus best practices
- Keep an immutable raw layer, and treat everything derived from it as rebuildable. Invalidate facts rather than delete them, and store bi-temporal validity.
- Keep writes fast with no LLM involved. Run extraction, consolidation and "dreaming" asynchronously, with review before apply as an option.
- Keep provenance and trust tags through merges and consolidation, and support deletion by lineage.
- Resolve entities with thresholds, hard keys and a human-review band. Never merge on the name alone.
- Keep memory visible and editable, and make sure user edits actually persist.
- Record outcomes and user feedback as signals, and turn recurring corrections into enforced mechanisms.
- Build memory in-house and treat it as a compute budget.

### Open debates
- Markdown/wiki files versus graphs. Chalef argues files lose provenance under mutation. Iusztin & Bouchard and Paterson argue files are enough at personal scale.
- GraphRAG value: it tied hybrid RAG in the Towards AI measurement, while Neo4j's CrabRAG talk argues graph memory is needed.
- Compacting context versus keeping everything cached.
- Deterministic consolidation (cheap) versus LLM consolidation (better merge decisions).
- Machine-efficient memory (Microsoft's Memora) versus human-legible memory (LangChain Wiki Memory).
- Whether memory helps at all when everything fits in context.

### How experts evaluate memory (what Luffi can adopt)
- **Split the metrics:** bank correctness, retrieval precision and recall (PrecisionMemBench), answer quality, latency and cost. Include belief mutability and a "ghost memory" conflict accuracy (A-TMA with its LTP benchmark, 2607.01935).
- **Measure at several horizons.** Test at weekly, monthly and quarterly checkpoints (Ground Truth First, DynamicMem), and use scripts that generate facts first so gold answers are correct by construction.
- **Audit user-state recovery** from what memory retains (MemAudit), and report gain against a stateless run of the same system (Asawa).
- **Run a restore counterfactual** to separate retrieval misses from information destroyed by eviction (2609.08279).
- **Score proactive suggestions** on trigger precision, timing, calibration, user burden and correct suppression (2609.03727, PersonaMem-v3, ProEvent 2607.17701, VibeLifeBench 2608.10875).
- **Measure risk directly:** stale-fact use, revoked-memory reuse and leakage, with deterministic trace checks and no LLM judge on the pass/fail path (MemRiskBench 2609.14976).
- **General eval practice** from the Braintrust talk (https://youtu.be/nxokqOq1imY [T]) and Hamel Husain's evals FAQ (updated 2026-09-21): pass@k alongside pass^k, clustering production traces to find new failure types, and binary judges validated against human labels.
- **Shared harness:** Agent Memory Leaderboard (agentmemoryleaderboard.ai; cycle 1 results 2026-08-12) fixes the answer model, prompts and top-k so differences reflect the memory system.

### New tools and papers not in your list
- **Frameworks and memory systems:**
  - Memora, Microsoft Research, 2026-06-29, code at github.com/microsoft/Memora.
  - Engram (ly-wang19/engram).
  - PGMem (2608.01708, code available): persona traits linked by provenance edges to the events that support them.
  - ChronoMem (2607.27773): versioned memory with natural-language rollback, built on Google's Agent Development Kit.
  - EvoArena/EvoMem (2606.13681).
  - JAM (2609.34385, code).
  - MemoryData (github.com/OpenDataBox/MemoryData), from "Are We Ready for an Agent-Native Memory System?", which compares 12 systems.
  - YantrikDB, Calx, the Memoryfields spec, and the Neo4j agent-memory .NET library plus GraphAcademy workshop (listed 2026-09-18).
- **Adjacent products and competitors:**
  - Stash: turns Instagram saves into notes an agent can search (HN 2026-08-22, github.com/Parthuss/stash).
  - Outernet: turns TikTok/Instagram saves into plans, maps and nudges; about 18k users, $6.99/month (TechCrunch 2026-08-03).
  - Meta Muse personal agent, launched 2026-09-08, with editable memory and background work.
- **Relevant to images and screenshots:**
  - Camera-roll question answering (2606.05275).
  - MobileMem (2608.13606), LightMem-Ego (2607.11487), Act2Intention (2608.14132).
  - GraphProfiler (2609.12448): a privacy warning that sensitive attributes can be inferred from saved posts.

### Coverage gaps
- **Blogs and newsletters:** no 2026 memory posts from Chip Huyen. LlamaIndex, Simon Willison (only a 2026-03-01 note on Claude memory import) and Hamel Husain had nothing memory-specific.
- **Neo4j:** NODES 2026 is on 2026-11-12, so those talks haven't happened yet. The date on the NODES AI 2026 video page could not be verified.
- **Other posts I did read:**
  - Lilian Weng, "Harness Engineering for Self-Improvement", 2026-07-04: mostly general, with memory-degradation failure modes.
  - Jason Liu's morning-brief vault, 2026-05-18.
  - Eugene Yan, "How to Work and Compound with AI", 2026-05-03.
