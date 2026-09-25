import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors.js";
import {
  applyKnowledgeCommand, buildKnowledgeContext, createKnowledgeState,
  getAffectedKnowledgeConsumers, getKnowledgeChanges, queryKnowledge,
  registerKnowledgeWatch, resolveEntityMention, resolveKnowledge, unregisterKnowledgeWatch, validateKnowledgeContext,
} from "../src/knowledge/index.js";

const NOW = "2026-09-25T09:00:00Z";
const EARLIER = "2026-09-24T09:00:00Z";
const scope = { type: "inventory", id: "pantry" };
const predicates = [{
  id: "inventory.availability", subjectTypes: ["ingredient"], valueType: "availability",
  allowedValues: ["present", "absent", "unknown"], unknownValues: ["unknown"],
  cardinality: "single", resolution: { strategy: "consensus", version: "1" },
}, {
  id: "product.price", subjectTypes: ["product"], valueType: "money",
  cardinality: "single", resolution: { strategy: "latest_observation", version: "1" },
}, {
  id: "outfit.has_item", subjectTypes: ["outfit"], objectTypes: ["product"],
  cardinality: "many", resolution: { strategy: "consensus", version: "1" },
}];

function fixture() {
  let state = createKnowledgeState();
  let commandIndex = 0;
  const apply = (type, payload, overrides = {}, options = {}) => {
    const command = { ownerId: "alice", commandId: `cmd-${++commandIndex}`, type, payload, ...overrides };
    const output = applyKnowledgeCommand(state, command, { predicates, now: NOW, ...options });
    state = output.state;
    return output;
  };
  const source = (suffix = "1", ownerId = "alice") => {
    apply("source.create", { id: `s${suffix}`, kind: "user_note", title: "source" }, { ownerId });
    apply("source.version.add", { id: `v${suffix}`, sourceId: `s${suffix}`, contentHash: `hash${suffix}`, content: "original", capturedAt: NOW }, { ownerId });
    apply("evidence.add", { id: `e${suffix}`, sourceVersionId: `v${suffix}`, locator: { field: "answer" }, quote: "observed answer" }, { ownerId });
  };
  const assertion = (id, value, extra = {}) => ({
    id, subjectId: "tofu", predicate: "inventory.availability",
    typedValue: { type: "availability", value }, scope,
    origin: "user_reported", assertedBy: { type: "user", id: "alice" }, evidenceIds: ["e1"],
    observedAt: NOW, ...extra,
  });
  const resolve = (query = {}, options = {}) => resolveKnowledge(state, {
    ownerId: "alice", subjectId: "tofu", predicate: "inventory.availability", scope, atTime: NOW, ...query,
  }, { predicates, ...options });
  const context = (request = {}, options = {}) => buildKnowledgeContext(state, {
    ownerId: "alice", queries: [{ subjectId: "tofu", predicate: "inventory.availability", scope }], atTime: NOW, ...request,
  }, { predicates, ...options });
  apply("entity.create", { id: "tofu", type: "ingredient", label: "두부" });
  source();
  return { get state() { return state; }, set state(value) { state = value; }, apply, source, assertion, resolve, context };
}

test("knowledge commands are immutable, serializable, idempotent, and fail atomically", () => {
  const f = fixture();
  const before = structuredClone(f.state);
  const command = { ownerId: "alice", commandId: "one", type: "assertion.add", payload: f.assertion("a1", "absent"), expectedSequence: f.state.sequence };
  const output = applyKnowledgeCommand(f.state, command, { predicates, now: NOW });
  assert.deepEqual(f.state, before);
  assert.equal(output.result.assertionId, "a1");
  const restored = JSON.parse(JSON.stringify(output.state));
  const replay = applyKnowledgeCommand(restored, command, { predicates, now: EARLIER });
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.sequence, output.state.sequence);
  assert.deepEqual(replay.events, []);
  assert.throws(() => applyKnowledgeCommand(restored, { ...command, payload: f.assertion("a1", "present") }, { predicates }), { code: "KNOWLEDGE_COMMAND_CONFLICT", httpStatus: 409 });
  assert.throws(() => f.apply("assertion.add", f.assertion("bad", "present", { evidenceIds: ["missing"] })), { code: "KNOWLEDGE_NOT_FOUND" });
  assert.deepEqual(f.state, before);
});

test("knowledge timestamps reject impossible dates without changing the state", () => {
  const f = fixture();
  const before = structuredClone(f.state);
  for (const observedAt of ["2026-02-30T12:00:00Z", "2026-02-29T12:00:00Z", "2026-09-25T12:00:00+15:00", "2026-09-25T12:00:00.1234Z"]) {
    assert.throws(() => f.apply("assertion.add", f.assertion("invalid", "present", { observedAt })), { code: "INVALID_KNOWLEDGE_INPUT" });
    assert.deepEqual(f.state, before);
  }
  assert.throws(() => f.context({ atTime: "2026-02-30T12:00:00Z" }), { code: "INVALID_KNOWLEDGE_INPUT" });
  f.apply("assertion.add", f.assertion("leap", "present", { observedAt: "2024-02-29T12:00:00Z" }));
  assert.equal(queryKnowledge(f.state, { ownerId: "alice", subjectId: "tofu" })[0].observedAt, "2024-02-29T12:00:00.000Z");
});

test("only registered and typed predicates with real evidence can be written", () => {
  const f = fixture();
  for (const replacement of [
    { predicate: "model.invented" }, { typedValue: { type: "quantity", value: 2 } },
    { typedValue: { type: "availability", value: "maybe" } }, { evidenceIds: [] },
    { objectEntityId: "tofu" }, { assertedBy: { type: "publisher", id: "seller" } },
  ]) assert.throws(() => f.apply("assertion.add", f.assertion("a", "absent", replacement)), AppError);
  assert.equal(f.state.assertions.length, 0);
});

test("same names do not merge entities and record ids are isolated by owner", () => {
  const f = fixture();
  f.apply("entity.create", { id: "tofu-other", type: "ingredient", label: "두부" });
  f.apply("entity.create", { id: "tofu", type: "ingredient", label: "두부" }, { ownerId: "bob" });
  f.source("bob", "bob");
  assert.throws(() => f.apply("assertion.add", f.assertion("a", "absent", { evidenceIds: ["ebob"] })), { code: "KNOWLEDGE_NOT_FOUND" });
  f.apply("assertion.add", f.assertion("a", "absent"));
  assert.deepEqual(queryKnowledge(f.state, { ownerId: "bob" }), []);
  assert.deepEqual(getKnowledgeChanges(f.state, { ownerId: "mallory" }), []);
  assert.equal(f.state.entities.length, 3);
});

test("a scoped observation is not promoted into another activity or global memory", () => {
  const f = fixture();
  const activityScope = { type: "activity", id: "dinner" };
  f.apply("assertion.add", f.assertion("a", "absent", { scope: activityScope }));
  assert.equal(f.resolve().status, "unknown");
  assert.equal(f.resolve({ scope: activityScope }).status, "resolved");
  assert.equal(f.resolve({ scope: { type: "activity", id: "tomorrow" } }).status, "unknown");
});

test("consensus preserves conflicts and correction retracts exactly the same fact slot", () => {
  const f = fixture();
  f.apply("assertion.add", f.assertion("a1", "absent"));
  f.apply("assertion.add", f.assertion("a2", "present"));
  assert.equal(f.resolve().status, "disputed");
  assert.deepEqual(f.resolve().selectedAssertionIds, []);
  const before = structuredClone(f.state);
  assert.throws(() => f.apply("assertion.correct", { assertionId: "a1", expectedRevision: 1, assertion: f.assertion("a3", "present", { scope: { type: "activity", id: "other" } }) }), { code: "INVALID_CORRECTION" });
  assert.deepEqual(f.state, before);
  f.apply("assertion.correct", { assertionId: "a1", expectedRevision: 1, assertion: f.assertion("a3", "present") });
  assert.equal(f.resolve().status, "resolved");
  assert.deepEqual(f.resolve().selectedAssertionIds, ["a2", "a3"]);
  assert.equal(f.state.assertions.find((item) => item.id === "a1").status, "corrected");
  assert.equal(f.state.assertions.find((item) => item.id === "a3").supersedesId, "a1");
});

test("old captures imported today do not override a newer observation", () => {
  const f = fixture();
  f.apply("entity.create", { id: "product", type: "product", label: "shirt" });
  const price = (id, amount, observedAt) => f.assertion(id, "ignored", {
    subjectId: "product", predicate: "product.price", typedValue: { type: "money", value: { amount, currency: "KRW" } }, observedAt,
  });
  f.apply("assertion.add", price("new", 12000, NOW));
  f.apply("assertion.add", price("old", 9000, EARLIER));
  const result = f.resolve({ subjectId: "product", predicate: "product.price" });
  assert.deepEqual(result.selectedAssertionIds, ["new"]);
  assert.equal(result.values[0].typedValue.value.amount, 12000);
  f.apply("assertion.add", price("undated", 10000, null));
  assert.equal(f.resolve({ subjectId: "product", predicate: "product.price" }).status, "disputed");
});

test("future facts and expired intervals are excluded, and unknown is not absent", () => {
  const f = fixture();
  f.apply("assertion.add", f.assertion("old", "present", { observedAt: EARLIER, validTo: NOW }));
  f.apply("assertion.add", f.assertion("future", "absent", { observedAt: "2026-09-26T09:00:00Z", validFrom: "2026-09-26T09:00:00Z" }));
  assert.equal(f.resolve().status, "unknown");
  assert.equal(f.resolve().nextReevaluateAt, "2026-09-26T09:00:00.000Z");
  f.apply("assertion.add", f.assertion("uncertain", "unknown"));
  assert.equal(f.resolve().status, "unknown");
  f.apply("assertion.correct", { assertionId: "uncertain", assertion: f.assertion("checked", "absent") });
  assert.equal(f.resolve().values[0].typedValue.value, "absent");
});

test("predicate-specific freshness and authority have no global user-first assumption", () => {
  const f = fixture();
  f.apply("assertion.add", f.assertion("old", "absent", { observedAt: EARLIER }));
  const freshPolicies = structuredClone(predicates);
  freshPolicies[0].resolution.maxAgeMs = 3600000;
  assert.equal(f.resolve({}, { predicates: freshPolicies }).status, "stale");
  f.apply("assertion.add", f.assertion("official", "present", { origin: "external_observed", assertedBy: { type: "external", id: "sensor" } }));
  assert.equal(f.resolve().status, "disputed");
  const authorityPolicies = structuredClone(predicates);
  authorityPolicies[0].resolution.originPriority = ["external_observed", "user_reported"];
  assert.deepEqual(f.resolve({}, { predicates: authorityPolicies }).selectedAssertionIds, ["official"]);
});

test("many-valued object relations retain independent typed entity references", () => {
  const f = fixture();
  f.apply("entity.create", { id: "outfit", type: "outfit" });
  for (const id of ["shirt-s", "shirt-m"]) {
    f.apply("entity.create", { id, type: "product", label: "shirt" });
    f.apply("assertion.add", f.assertion(`rel-${id}`, "unused", {
      subjectId: "outfit", predicate: "outfit.has_item", typedValue: null, objectEntityId: id,
    }));
  }
  const resolved = f.resolve({ subjectId: "outfit", predicate: "outfit.has_item" });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.values.length, 2);
});

test("source deletion removes unsupported values, preserves independent support, and blocks late analysis", () => {
  const f = fixture();
  f.source("2");
  f.apply("assertion.add", f.assertion("dependent", "absent", { evidenceIds: ["e1", "e2"] }));
  f.apply("assertion.add", f.assertion("independent", "present", { evidenceIds: ["e1", "e2"], supportSets: [["e1"], ["e2"]] }));
  const result = f.apply("source.delete", { sourceId: "s1" });
  assert.deepEqual(result.result.invalidatedAssertionIds, ["dependent"]);
  assert.equal(f.resolve().status, "resolved");
  assert.deepEqual(f.resolve().evidenceIds, ["e2"]);
  assert.equal(f.state.assertions.find((item) => item.id === "dependent").typedValue, null);
  assert.equal(f.state.sourceVersions.find((item) => item.id === "v1").content, null);
  assert.equal(f.state.evidence.find((item) => item.id === "e1").quote, "");
  assert.throws(() => f.apply("evidence.add", { id: "late", sourceVersionId: "v1", locator: { field: "x" }, quote: "old data" }), { code: "KNOWLEDGE_NOT_FOUND" });
  assert.throws(() => f.apply("assertion.add", f.assertion("late", "present")), { code: "KNOWLEDGE_NOT_FOUND" });
});

test("source deletion invalidates old contexts and retraction recalculates instead of caching a winner", () => {
  const f = fixture();
  f.apply("assertion.add", f.assertion("a", "absent"));
  const context = f.context();
  f.apply("assertion.retract", { assertionId: "a", expectedRevision: 1 });
  assert.equal(f.resolve().status, "unknown");
  assert.equal(validateKnowledgeContext(f.state, context, { now: NOW, predicates }).valid, false);
  assert.throws(() => f.apply("assertion.retract", { assertionId: "a", expectedRevision: 1 }), { code: "KNOWLEDGE_NOT_FOUND" });
});

test("query watches cover missing facts and close the snapshot/register race", () => {
  const f = fixture();
  const context = f.context();
  assert.equal(context.resolutions[0].status, "unknown");
  f.apply("assertion.add", f.assertion("new", "present"));
  const registration = registerKnowledgeWatch(f.state, { ownerId: "alice", consumerId: "board-shopping", context });
  assert.equal(registration.catchUpEvents.length, 1);
  f.state = registration.state;
  assert.deepEqual(getAffectedKnowledgeConsumers(f.state, { ownerId: "alice", afterSequence: context.knowledgeSequence, atTime: NOW }).map((item) => item.consumerId), ["board-shopping"]);
  assert.equal(validateKnowledgeContext(f.state, context, { now: NOW, predicates }).valid, false);
  f.state = unregisterKnowledgeWatch(f.state, { ownerId: "alice", consumerId: "board-shopping" });
  assert.deepEqual(getAffectedKnowledgeConsumers(f.state, { ownerId: "alice", atTime: NOW }), []);
});

test("unrelated scopes do not invalidate contexts or subscriptions", () => {
  const f = fixture();
  const context = f.context();
  f.state = registerKnowledgeWatch(f.state, { ownerId: "alice", consumerId: "consumer", context }).state;
  f.apply("assertion.add", f.assertion("other", "present", { scope: { type: "activity", id: "picnic" } }));
  assert.equal(validateKnowledgeContext(f.state, context, { now: NOW, predicates }).valid, true);
  assert.deepEqual(getAffectedKnowledgeConsumers(f.state, { ownerId: "alice", atTime: NOW }), []);
});

test("time alone invalidates memory and consumers without requiring a new write", () => {
  const f = fixture();
  const expires = "2026-09-25T10:00:00Z";
  f.apply("assertion.add", f.assertion("a", "absent", { refreshDueAt: expires }));
  const context = f.context();
  f.state = registerKnowledgeWatch(f.state, { ownerId: "alice", consumerId: "consumer", context }).state;
  assert.equal(validateKnowledgeContext(f.state, context, { now: NOW, predicates }).valid, true);
  assert.equal(validateKnowledgeContext(f.state, context, { now: expires, predicates }).valid, false);
  assert.equal(f.resolve({ atTime: expires }).status, "stale");
  assert.deepEqual(getAffectedKnowledgeConsumers(f.state, { ownerId: "alice", afterSequence: f.state.sequence, atTime: expires }), [{ consumerId: "consumer", eventIds: [], timeDue: true }]);
});

test("predicate policy changes invalidate a snapshot even without a knowledge write", () => {
  const f = fixture();
  const context = f.context();
  const revised = structuredClone(predicates);
  revised[0].resolution.strategy = "latest_observation";
  assert.deepEqual(validateKnowledgeContext(f.state, context, { predicates: revised, now: NOW }).reasons.map((item) => item.code), ["POLICY_CHANGED"]);
});

test("a registry's relation and value validator are usable without serializing registry functions", () => {
  const f = fixture();
  const calls = [];
  const registry = {
    getRelation: (id) => predicates.find((item) => item.id === id),
    validate: (type, value) => { calls.push([type, value]); },
  };
  f.apply("assertion.add", f.assertion("a", "absent"), {}, { predicates: registry });
  assert.deepEqual(calls, [["availability", "absent"]]);
  assert.equal(f.resolve({}, { predicates: registry }).status, "resolved");
});

test("watch registrations keep dependency references rather than deleted value copies", () => {
  const f = fixture();
  f.apply("entity.create", { id: "product", type: "product" });
  f.apply("assertion.add", f.assertion("a", "unused", { subjectId: "product", predicate: "product.price", typedValue: { type: "money", value: "private-price" } }));
  const context = f.context({ queries: [{ subjectId: "product", predicate: "product.price", scope }] });
  f.state = registerKnowledgeWatch(f.state, { ownerId: "alice", consumerId: "consumer", context }).state;
  f.apply("source.delete", { sourceId: "s1" });
  assert.equal(JSON.stringify(f.state).includes("private-price"), false);
});

test("failed corrections and stale optimistic writes do not modify the supplied state", () => {
  const f = fixture();
  f.apply("assertion.add", f.assertion("a", "absent"));
  const before = structuredClone(f.state);
  assert.throws(() => f.apply("assertion.correct", { assertionId: "a", expectedRevision: 99, assertion: f.assertion("new", "present") }), { code: "KNOWLEDGE_REVISION_CONFLICT" });
  assert.throws(() => f.apply("assertion.correct", { assertionId: "a", assertion: f.assertion("a", "present") }), { code: "KNOWLEDGE_ID_EXISTS" });
  assert.throws(() => f.apply("assertion.add", f.assertion("b", "present"), { expectedSequence: 0 }), { code: "KNOWLEDGE_REVISION_CONFLICT" });
  assert.deepEqual(f.state, before);
});

test("identity candidates never merge names and acceptance/retraction preserves the original mention", () => {
  const f = fixture();
  f.apply("entity.create", { id: "other-tofu", type: "ingredient", label: "두부" });
  f.apply("mention.create", { id: "mention", sourceVersionId: "v1", text: "두부", entityType: "ingredient", evidenceIds: ["e1"] });
  f.apply("identity.propose", { id: "candidate-1", mentionId: "mention", entityId: "tofu" });
  f.apply("identity.propose", { id: "candidate-2", mentionId: "mention", entityId: "other-tofu" });
  assert.equal(resolveEntityMention(f.state, { ownerId: "alice", mentionId: "mention" }).status, "unresolved");
  assert.throws(() => f.apply("assertion.add", f.assertion("premature", "absent", { subjectMentionId: "mention" })), { code: "INVALID_ASSERTION" });
  f.apply("identity.accept", { decisionId: "candidate-1" });
  assert.equal(resolveEntityMention(f.state, { ownerId: "alice", mentionId: "mention" }).entityId, "tofu");
  f.apply("identity.retract", { decisionId: "candidate-1", expectedRevision: 2 });
  assert.equal(resolveEntityMention(f.state, { ownerId: "alice", mentionId: "mention" }).status, "unresolved");
  assert.equal(f.state.entityMentions[0].text, "두부");
  assert.equal(f.state.entityMentions[0].sourceVersionId, "v1");
  assert.equal(f.state.entities.length, 2);
});

test("relinking a mention recomputes its assertions and invalidates both old and previously empty new slots", () => {
  const f = fixture();
  f.apply("entity.create", { id: "other-tofu", type: "ingredient", label: "두부" });
  f.apply("mention.create", { id: "mention", sourceVersionId: "v1", text: "두부", entityType: "ingredient", evidenceIds: ["e1"] });
  f.apply("identity.propose", { id: "candidate-1", mentionId: "mention", entityId: "tofu" });
  f.apply("identity.accept", { decisionId: "candidate-1" });
  f.apply("assertion.add", f.assertion("a", "absent", { subjectMentionId: "mention" }));
  const oldContext = f.context();
  const newContext = f.context({ queries: [{ subjectId: "other-tofu", predicate: "inventory.availability", scope }] });
  f.apply("identity.propose", { id: "candidate-2", mentionId: "mention", entityId: "other-tofu" });
  assert.throws(() => f.apply("identity.accept", { decisionId: "candidate-2" }), { code: "KNOWLEDGE_REVISION_CONFLICT" });
  f.apply("identity.accept", { decisionId: "candidate-2", replacesDecisionId: "candidate-1" });
  assert.equal(f.resolve().status, "unknown");
  assert.equal(f.resolve({ subjectId: "other-tofu" }).status, "resolved");
  assert.equal(f.state.assertions[0].subjectId, "tofu", "original interpretation remains inspectable");
  assert.equal(queryKnowledge(f.state, { ownerId: "alice", subjectId: "other-tofu" })[0].identityDecisionId, "candidate-2");
  assert.equal(validateKnowledgeContext(f.state, oldContext, { now: NOW, predicates }).valid, false);
  assert.equal(validateKnowledgeContext(f.state, newContext, { now: NOW, predicates }).valid, false);
  f.apply("identity.retract", { decisionId: "candidate-2" });
  assert.equal(f.resolve({ subjectId: "other-tofu" }).status, "unknown");
  assert.equal(f.resolve().status, "unknown", "retraction does not silently revive the superseded decision");
});

test("an identity decision cannot borrow another owner's evidence or cross entity types", () => {
  const f = fixture();
  f.apply("mention.create", { id: "mention", sourceVersionId: "v1", text: "두부", entityType: "ingredient", evidenceIds: ["e1"] });
  f.source("bob", "bob");
  f.apply("entity.create", { id: "shirt", type: "product" });
  assert.throws(() => f.apply("identity.propose", { id: "bad", mentionId: "mention", entityId: "tofu", evidenceIds: ["ebob"] }), { code: "KNOWLEDGE_NOT_FOUND" });
  assert.throws(() => f.apply("identity.propose", { id: "bad", mentionId: "mention", entityId: "shirt" }), { code: "PREDICATE_TYPE_MISMATCH" });
  assert.throws(() => resolveEntityMention(f.state, { ownerId: "bob", mentionId: "mention" }), { code: "KNOWLEDGE_NOT_FOUND" });
});

test("deleting identity evidence removes projected facts even when their own evidence survives", () => {
  const f = fixture();
  f.source("2");
  f.apply("mention.create", { id: "mention", sourceVersionId: "v1", text: "private-mention", entityType: "ingredient", evidenceIds: ["e1"] });
  f.apply("identity.propose", { id: "candidate", mentionId: "mention", entityId: "tofu", reason: "private-identity-reason" });
  f.apply("identity.accept", { decisionId: "candidate" });
  f.apply("assertion.add", f.assertion("a", "absent", { subjectMentionId: "mention", evidenceIds: ["e2"] }));
  const context = f.context();
  f.apply("source.delete", { sourceId: "s1" });
  assert.equal(f.resolve().status, "unknown");
  assert.equal(resolveEntityMention(f.state, { ownerId: "alice", mentionId: "mention" }).status, "deleted");
  assert.equal(validateKnowledgeContext(f.state, context, { predicates, now: NOW }).valid, false);
  assert.equal(JSON.stringify(f.state).includes("private-mention"), false);
  assert.equal(JSON.stringify(f.state).includes("private-identity-reason"), false);
  assert.throws(() => f.apply("identity.accept", { decisionId: "candidate" }), AppError);
});
