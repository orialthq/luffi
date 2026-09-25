# Knowledge kernel

`index.js` exposes pure, synchronous functions over JSON-serializable state. No
function performs network, database, model, or filesystem IO. The caller owns
authentication and must commit returned knowledge state, activity changes, and
outbox work in its transaction. In-memory sequence checks alone are not a
distributed locking mechanism.

## Entry points

- `createKnowledgeState()` creates empty state.
- `applyKnowledgeCommand(state, command, { predicates, now? })` returns
  `{ state, result, events, replayed }`. It never modifies its input; rejected
  commands have no partial effects. The unique command key is owner + command
  ID. Same ID with changed content is a conflict, not another receipt.
- `queryKnowledge(state, { ownerId, subjectId?, predicate?, scope?,
  objectEntityId?, includeInactive? })` returns assertions, not resolved facts.
- `resolveKnowledge(state, { ownerId, subjectId, predicate, scope, atTime? },
  { predicates, now? })` returns adopted values, evidence and alternatives, with
  `resolved`, `unknown`, `disputed`, or `stale` status.
- `resolveEntityMention(state, { ownerId, mentionId })` returns the current
  accepted identity, or unresolved/deleted, without guessing from its name.
- `buildKnowledgeContext(state, { ownerId, queries, atTime? }, options)` returns
  resolutions, read references, query watches, policy fingerprints, a knowledge
  watermark, and the next time boundary.
- `validateKnowledgeContext(state, context, { predicates, now? })` checks read
  revisions, matching events since the snapshot, policy changes, and time.
- `getKnowledgeChanges(state, { ownerId, afterSequence?, readSet?, queryWatches? })`
  returns matching events. Omit both filters to read all events for that owner.
- `registerKnowledgeWatch(state, { ownerId, consumerId, context })` returns the
  updated state, `catchUpEvents`, and `registeredAtSequence`. Commit registration
  and processing of catch-up events atomically to close the read/register race.
- `getAffectedKnowledgeConsumers(state, { ownerId, afterSequence?, atTime? })`
  returns event- or time-invalidated consumers. Rebuild and replace a consumer's
  context after handling it. Time invalidation needs a scheduler or polling;
  this library does not run background timers.
- `unregisterKnowledgeWatch(state, { ownerId, consumerId })` returns new state.

`now` accepts an ISO string, Date, or a function returning one. Timestamps on
stored records require an explicit timezone and are normalized to UTC. Valid
intervals are half-open `[validFrom, validTo)`. `atTime` asks about applicability
at that time using the **currently retained** assertions; it does not provide
a historical "what did the database know then" view. Correction, retraction,
and deletion are respected even for old queries.

Contexts supplied to validation must be the server's actual snapshots. Shape
validation cannot prove that a client has not removed a dependency. An HTTP
boundary must keep contexts server-side and accept a context ID, or verify an
authenticated snapshot. Always pass the current predicates to validation to
detect policy changes. The authenticated owner is supplied by the caller, never
trusted from unverified input. Errors extend the existing `AppError`.

## Commands

Every command is `{ ownerId, commandId, type, payload, expectedSequence? }`.
IDs are required, immutable, and unique within an owner and record kind.

| Type | Payload |
| --- | --- |
| `entity.create` | `id, type, label?, externalIds?` |
| `source.create` | `id, kind, title?, provenance?` |
| `source.version.add` | `id, sourceId, contentHash, capturedAt?, content?, asset?, expectedSourceRevision?` |
| `evidence.add` | `id, sourceVersionId, locator, quote?, createdByRunId?, expectedSourceVersionRevision?` |
| `mention.create` | `id, sourceVersionId, text, entityType, evidenceIds` |
| `identity.propose` | `id, mentionId, entityId, evidenceIds?, reason?` |
| `identity.accept` | `decisionId, expectedRevision?, replacesDecisionId?` |
| `identity.retract` | `decisionId, expectedRevision?` |
| `assertion.add` | assertion fields below |
| `assertion.correct` | `assertionId, expectedRevision?, assertion: { ...newAssertion }` |
| `assertion.retract` | `assertionId, expectedRevision?` |
| `source.delete` | `sourceId, expectedRevision?` |

An assertion requires `id, subjectId, predicate, scope:{type,id}, origin,
assertedBy:{type,id}, evidenceIds`, and exactly one `objectEntityId` or
`typedValue:{type,value}`. Optional fields: `subjectMentionId, supportSets,
observedAt, validFrom, validTo, refreshDueAt, capturedInActivityId, createdByRunId`.
Supported origins are `source_extracted`, `user_reported`, `external_observed`,
`system_inferred`. The asserted actor and extraction run are separate. User
reports must name the owner as the user; inferred records must name a system.

An assertion with `subjectMentionId` uses that mention as its canonical subject.
Its original `subjectId` is retained as an audit hint. Query results project it
onto the **currently accepted** entity; identity retraction removes that
projection without losing the assertion or source. Replacement requires naming
the current decision explicitly, invalidates old and new query slots, and never
merges entity records destructively. Retracting a replacement does not silently
reactivate an earlier decision.

Evidence IDs alone default to one conjunctive support set. Use
`supportSets: [["quote-a", "quote-b"], ["independent-quote"]]` only when the
last quote independently supports the whole assertion. Deleting a source
redacts its content, locator and quotes, invalidates affected identity decisions,
and redacts unsupported assertion values. An independently supported assertion
may survive with its remaining live evidence. Watches retain dependency IDs,
not copies of personal fact values; command receipts and events omit payloads.
Other layers' caches, assets and run logs must implement the same deletion event.

## Predicate registry

`predicates` may be an array of specs, an object keyed by ID, a Map, or the domain
registry exposing `getRelation(id)`. When available, `registry.validate(typeId,
value)` also checks typed values. Each spec supports:

```js
{
  id: "inventory.availability",
  subjectTypes: ["ingredient"],
  valueType: "availability", // or objectTypes: ["product"]
  cardinality: "single", // or many
  allowedValues: ["present", "absent", "unknown"],
  unknownValues: ["unknown"],
  resolution: {
    strategy: "latest_observation", // or consensus
    version: "1",
    maxAgeMs: 3600000,
    originPriority: ["user_reported", "external_observed"]
  }
}
```

Origin priority is opt-in and predicate-specific. Consensus keeps conflicting
values disputed. Latest-observation compares observation time, never ingestion
time; an undated conflicting assertion stays ambiguous. Stale assertions do not
silently become current. Scopes match exactly; the caller must explicitly ask
for another scope. Entity type registration and truth/authenticity of quoted
evidence remain the ingestion/domain adapter's responsibility.

The state implementation uses arrays and retained change events for deterministic
development use and portable persistence. It is not a SQL repository, an indexed
graph engine, or a bounded event-retention system. A production adapter needs
transactional indexes plus a watermark/retention contract that never trims
events still needed by active snapshots and consumers.
