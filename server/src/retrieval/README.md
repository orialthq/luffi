# Common graph retrieval

`retrieveKnowledge(state, query, { registry, now?, semanticCandidateIds? })`
is synchronous, immutable, and JSON serializable. The registry can be a domain
registry, relation array, Map, or ID-to-definition object.

```js
const result = retrieveKnowledge(knowledge, {
  ownerId,
  text: "두부",
  typeIds: ["recipe.recipe"],
  seedEntityIds: [ingredientId],
  predicates: ["recipe.has_requirement", "recipe.requires_ingredient"],
  scopes: [{ type: "collection", id: collectionId }],
  direction: "incoming",
  maxHops: 2,
  limit: 20,
  atTime: "2026-09-25T09:00:00Z",
}, { registry });
```

## Candidate and proof semantics

- Text (normalized label tokens), exact external IDs, explicit seed IDs, and
  optional semantic IDs find candidate identities. These selectors are a union;
  `typeIds` constrains returned candidates. Explicit seeds can traverse through
  intermediate types. Labels/external IDs never merge two entities.
- Every candidate is re-read from the supplied canonical state for owner and
  active status. Metadata with no applicable live proof remains `unverified`.
  Verification means an accepted identity or an applicable assertion has live
  support. It does **not** turn the label or external ID into a factual assertion.
- Assertion support is computed through the knowledge resolver, preserving
  cardinality, conflict, observation time, validity interval, freshness, and each
  exact scope. Each supporting evidence chain requires an active Evidence,
  SourceVersion, and Source owned by the caller. Independent support sets retain
  their existing conjunction/alternative meanings.
- Traversal uses only registered, resolved object relations; defaults to both
  directions and two hops. Original subject/object orientation remains in each
  edge. Reasons name the actual assertion/evidence IDs for that edge; another
  target's evidence is never borrowed. Cycles cannot increase the hop budget.
- Supply `scope` or `scopes` explicitly to use assertions. Omission uses no
  assertion scope, including scopes named `global`. Multiple scopes are separately
  identified on every proof/edge; the result does not assert that they are
  interchangeable or that their combined path is one fact. Accepted identity
  evidence can verify a candidate without implying any personal observation.
- Only candidates with live support are expanded. Context/planning must select
  and resolve the required fact slots separately; candidate metadata and graph
  proximity are discovery hints, never planning preconditions by themselves.

Results contain `candidates`, traversed `relations`, proof IDs, explicit `reasons`
(no opaque relevance scores), and knowledge dependencies. The candidate budget is
200, result limit at most 100, scopes at most 10, and resolution budget 4,000.
`truncated` reports each budget boundary. This JSON adapter scans the owner's
catalog and assertions; it provides bounded expansion rather than a database
index or a large-dataset performance guarantee. An indexed implementation must
preserve the same canonical validation and dependency contract.

## Semantic adapter

`retrieveKnowledgeWithSemanticAdapter(state, query, { registry, semanticAdapter })`
captures an immutable state snapshot before awaiting
`semanticAdapter.retrieveCandidateIds({ ownerId, text, typeIds, externalIds,
limit, atTime }) -> Promise<string[]>`. The adapter receives no source text and
can return only at most 200 candidate IDs. Foreign, deleted, or unknown IDs are
discarded; index claims, scores, or evidence cannot enter the graph. Provider
authorization, timeout, index revision, and index refresh are adapter concerns.
Index changes alone do not modify canonical knowledge or establish a fact.

## Dependencies and write validation

`validateRetrievalResult(state, result, { registry, now })` checks record reads,
positive/negative assertion queries, temporal boundaries, relation registry
changes, and entity/mention/identity discovery changes. Catalog discovery is
conservatively invalidated by any owner's entity or identity mutation, including
after an empty search. Incoming-edge watches conservatively watch the registered
predicate and scope across subjects because the knowledge kernel watches slots.

Persist server-issued results (or a protected server ID), then call this validator
inside the final write transaction before adopting retrieved candidates into a
context or plan. A caller-supplied result is not an authorization token.
`queryWatches` and `readSet` alone cannot notice a previously absent entity;
consumers must retain `discoveryWatch` and use the retrieval validator. Knowledge
watch subscriptions currently handle assertion/record/time dependencies only;
the integrating service must also check discovery/registry changes before using
a stored retrieval or enqueue catalog review when those events occur.
