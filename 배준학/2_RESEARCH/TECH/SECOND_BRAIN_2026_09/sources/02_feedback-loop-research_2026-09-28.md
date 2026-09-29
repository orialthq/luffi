## Feedback-driven memory and KG research for Luffi (checked 2026-09-28)

**Legend:** ★ is GitHub stars and "push" is the last commit, both read from the GitHub API today. "Self-rep." means only the authors or vendor report the number; nobody else has reproduced it.

### A. Links and structure that change over time
- **A-MEM** (NeurIPS'25). When a note is added, an LLM fetches the top-k similar notes, decides which to link, and rewrites their keywords, tags and context in place. It has no model for conflicts, validity or decay. Code: [agiresearch/A-mem](https://github.com/agiresearch/a-mem), MIT, ★1.2k, push Dec'25. The paper claims about 2x temporal F1 on LoCoMo, and its ablation credits the rewriting step with +5.7 multi-hop F1. Other groups score it more than 25 J-points below Mem0 and report category-label bugs in its evaluation ([src](https://arxiv.org/pdf/2511.18423)). Cost is about 1.2k tokens and 5.4 s per operation on GPT-4o-mini ([paper](https://arxiv.org/html/2502.12110v11)).
- **All-Mem** (Mar'26). A periodic offline LLM "diagnoser" proposes Split, Merge and Update edits to the graph, each with a confidence score. The raw evidence it works from is never changed. Code: [LvCan926/All-Mem](https://github.com/LvCan926/All-Mem), MIT, ★5. Results self-rep. ([arXiv](https://arxiv.org/abs/2603.19595))
- **HippoRAG 2** (ICML'25). It adds triples and synonym edges one passage at a time, then ranks at query time with Personalized PageRank. It never invalidates anything. Code: [OSU-NLP-Group/HippoRAG](https://github.com/osu-nlp-group/hipporag), MIT, ★4k, active. The independent GraphRAG-Bench (ICLR'26) ranks it #1 ([repo](https://github.com/GraphRAG-Bench/GraphRAG-Benchmark)).
- **GraphRAG / LightRAG updates.** GraphRAG still rebuilds its community summaries on update. LightRAG merges new nodes and edges and supports deletion ([src](https://arxiv.org/html/2410.05779v1)). Both merge entities that share a name, which breaks your no-auto-merge rule.

### B. Handling conflicts over time
- **Graphiti / Zep.** Every new batch of input is extracted into entities and edges. An LLM compares new edges with similar existing ones, and a contradicted edge gets `invalid_at`/`expired_at` set instead of being deleted. Every edge points back to the input it came from. Code: [getzep/graphiti](https://github.com/getzep/graphiti), Apache-2.0, ★31k, push yesterday.
  - Claims (self-rep.): DMR 94.8%, LongMemEval +18.5%, 90% lower latency ([paper](https://arxiv.org/abs/2501.13956)). Zep's LoCoMo score has four published values between 58.4 and 84 from its dispute with Mem0 ([summary](https://ai-coding.wiselychen.com/agent-memory-benchmark-rashomon-filesystem/)).
  - Cost: several LLM calls per input, about 50 inputs/min at default settings ([src](https://codex.danielvaughan.com/2026/03/30/graphiti-agent-memory-store/)).
  - **Caveat:** it merges duplicate entities automatically.
- **TEPA** (Aug'26, no code, unverified). Each fact moves through Hypothesis → Active → Revoked. A Beta-Bernoulli support score below 0.3 after 5 observations revokes it into an archive. Updates take under a millisecond. ([arXiv](https://arxiv.org/html/2608.07429v1))
- **Store the evidence first, then derive facts:**
  - **Eywa** ([arXiv](https://arxiv.org/abs/2605.30771)) keeps raw evidence unchanged, attaches a source span to every typed fact, and retrieves without any LLM calls.
  - **SodaMem** records conflicts as SUPERSEDES, CONTRADICTS and UPDATES edges. Code: [SodaMem](https://github.com/SodaMem/SodaMem), Apache-2.0. It reports 92.8% on LongMemEval-S (best of 3 runs) at $0.0016 per question.
  - **Agent Zero Memory** ([arXiv](https://arxiv.org/abs/2608.29606)) answers under a "citation lock", so it may only cite evidence it actually opened. It reports 95.6% on LongMemEval and has no code.
  - All of these numbers are self-rep.

### C. Background consolidation
- **Letta sleep-time ("dreaming").** A background agent rewrites memory after N steps or when the context is compacted. Memory is stored in git, and a second agent can optionally review edits ([docs](https://docs.letta.com/letta-agent/memory)). Code: Apache-2.0, ★25k. The paper claims about 5x less compute at answer time and 2.5x lower cost per query, but only when queries are predictable. It was tested on math tasks, not personal memory ([arXiv](https://arxiv.org/abs/2504.13171)).
- **RecMem** (ACL Findings'26, no code found). It waits to run LLM extraction until similar interactions recur, and claims 87% fewer tokens to build memory ([arXiv](https://arxiv.org/abs/2605.16045)).
- **Mastra Observational Memory.** Two background agents (Observer and Reflector) compress history into a dated observation log. It reports 94.87% on LongMemEval (self-rep.). License is Apache-2.0 apart from the `ee/` directories ([src](https://mastra.ai/research/observational-memory)).
- **MemoryOS** ([BAI-LAB](https://github.com/BAI-LAB/MemoryOS), EMNLP'25). Items move from short- to mid- to long-term memory by a "heat" score based on how often they are used. It claims +49% LoCoMo F1 (self-rep.).
- **MemOS** ([repo](https://github.com/MemTensor/MemOS), ★11.6k). A heavy "memory operating system" layer.

### D. Memory managers trained with reinforcement learning
- **Memory-R1** (ACL'26). It learns ADD, UPDATE, DELETE and NOOP from a reward based on QA correctness, using 152 training QA pairs on 3–14B models. Code: [repo](https://github.com/yansikuan/memory-r1), Apache-2.0, no commits since Sep'25.
- **Mem-α** trains how memory is built with RL, on 30k-token inputs, and generalizes to 400k. Code: [repo](https://github.com/wangyu-ustc/Mem-alpha), no license.
- Neither has been reproduced independently.

### E. Evolving context and user feedback
- **ACE** (ICLR'26). Three roles (Generator → Reflector → Curator) add small itemized "bullets" to a playbook, each with helpful/harmful counters, plus periodic deduplication. Claims: +10.6% on agent tasks and +8.6% on finance, with no independent replication found. Code: [ace-agent/ace](https://github.com/ace-agent/ace), Apache-2.0, ★1.3k.
- **Cognee feedback weights.** User ratings of 1–5 are credited to the nodes and edges that produced the answer, as a smoothed weight (0.5 is neutral) ([docs](https://docs.cognee.ai/examples/feedback-loop-app)). Nothing is deleted. Apache-2.0, ★31k. **Unverified:** in the demo the weights change only the visualization, not retrieval.

### F. Proactive intent inference
- **ProAgentBench** (Feb'26, 500 hours of real 1 Hz screenshots): graph memory adds 11.8% accuracy, but the best model predicts the right moment to help only 64.4% of the time ([arXiv](https://arxiv.org/html/2602.04482v1)).
- **Deciding when to help:** a small temporal-graph model beats an LLM by +16.7 F1 at 11 ms per event and runs on-device ([arXiv](https://arxiv.org/abs/2605.30152)).
- **ATRBench** (EMNLP'26): agents score 62+ points below an oracle at asking now for a preference they will need later ([arXiv](https://arxiv.org/abs/2605.28108)).

### Benchmarks: no trustworthy leader
- **LongMemEval (all self-rep.):** Agent Zero 95.6, OMEGA 95.4, Mastra 94.87, Mem0 93.4–94.4, SodaMem 92.8, Hindsight 91.4.
- **Mem0:** a competing vendor measured 73.8 against a claimed 93.4 ([Maximem](https://www.maximem.ai/blog/state-of-ai-memory-2026-claimed-vs-observed)).
- **MemPalace:** its 100% claim fell apart; the 96.6% it fell back to comes from plain ChromaDB retrieval, not MemPalace's own structure ([issue](https://github.com/MemPalace/mempalace/issues/214)).
- **Letta:** a plain filesystem agent scores 74% on LoCoMo ([blog](https://www.letta.com/blog/benchmarking-ai-agent-memory/)).
- None of these benchmarks tests feedback loops or provenance.
- **Relevant risks:**
  - Self-evolving memory can quietly degrade the agent over time ([Misevolve](https://arxiv.org/abs/2509.26354)).
  - Agents use raw experience reliably but often ignore condensed summaries ([ICML'26](https://arxiv.org/abs/2601.22436)). That argues for keeping raw evidence.

### Recommendation

**Adopt:**
1. **A fact store that keeps evidence first and never overwrites (Graphiti/Eywa/SodaMem pattern).**
   - Captures are stored unchanged, and every fact carries a pointer to its evidence span.
   - A contradiction sets `invalid_at` and adds a SUPERSEDES edge instead of overwriting.
   - Swap Graphiti's automatic entity merge for a `MERGE_CANDIDATE` edge that waits for the user.
2. **A background pass that only proposes.** It runs nightly or when similar captures recur (sleep-time, All-Mem and RecMem style). It emits typed, confidence-scored `suggested_link` edges that cite their evidence. Nothing enters the canonical graph until the user accepts, and batching keeps cost bounded.
3. **Edge weights driven by outcomes (TEPA + Cognee).**
   - Accept, edit, act and dismiss each update a per-edge Beta score.
   - A low score archives the edge; it is not deleted.
   - Only outcomes the user confirms become "done" facts.
4. **An ACE-style playbook per user** for which kinds of suggestions they accept, written as bullets with counters rather than free-form rewrites. Pair it with a cheap on-device model that decides when to suggest.

**Skip or treat as hype:**
- A-MEM-style rewriting of neighbours in place: it changes records silently and its independent numbers are weak.
- RL-trained memory managers: they need a QA reward, include a DELETE operation, and the code is stale. Revisit once you have large outcome logs.
- GraphRAG community summaries: expensive to rebuild and they merge entities by name.
- MemOS as a whole system: too heavy for this.
- Choosing a tool by leaderboard scores.
