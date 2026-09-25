import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors.js";
import { applyKnowledgeCommand, createKnowledgeState } from "../src/knowledge/index.js";
import { retrieveKnowledge, retrieveKnowledgeWithSemanticAdapter, validateRetrievalResult } from "../src/retrieval/index.js";

const NOW = "2026-09-25T09:00:00.000Z";
const LATER = "2026-09-26T09:00:00.000Z";
const SCOPE = { type: "activity", id: "dinner" };
const OTHER_SCOPE = { type: "activity", id: "tomorrow" };
const REGISTRY = [
  { id: "recipe.requires", subjectTypes: ["recipe"], objectTypes: ["requirement"], cardinality: "many", resolution: { strategy: "consensus", version: "1" } },
  { id: "requirement.ingredient", subjectTypes: ["requirement"], objectTypes: ["ingredient"], cardinality: "single", resolution: { strategy: "consensus", version: "1" } },
  { id: "ingredient.substitute", subjectTypes: ["ingredient"], objectTypes: ["ingredient"], cardinality: "single", resolution: { strategy: "consensus", version: "1" } },
  { id: "ingredient.availability", subjectTypes: ["ingredient"], valueType: "availability", allowedValues: ["present", "absent", "unknown"], unknownValues: ["unknown"], cardinality: "single", resolution: { strategy: "latest_observation", version: "1" } },
];

function fixture() {
  let state = createKnowledgeState();
  let index = 0;
  const apply = (type, payload, ownerId = "alice") => {
    const output = applyKnowledgeCommand(state, { ownerId, commandId: `cmd-${++index}`, type, payload }, { predicates: REGISTRY, now: NOW });
    state = output.state;
    return output;
  };
  const entity = (id, type = "ingredient", label = id, extra = {}, ownerId = "alice") => apply("entity.create", { id, type, label, ...extra }, ownerId);
  const source = (id = "1", ownerId = "alice") => {
    apply("source.create", { id: `s${id}`, kind: "user_note" }, ownerId);
    apply("source.version.add", { id: `v${id}`, sourceId: `s${id}`, contentHash: `hash-${id}`, capturedAt: NOW }, ownerId);
    apply("evidence.add", { id: `e${id}`, sourceVersionId: `v${id}`, locator: { field: "note" }, quote: "evidence" }, ownerId);
  };
  const assertion = (id, subjectId, predicate, value, extra = {}) => apply("assertion.add", {
    id, subjectId, predicate, ...(typeof value === "string" ? { objectEntityId: value } : { typedValue: value }),
    scope: SCOPE, origin: "user_reported", assertedBy: { type: "user", id: "alice" }, evidenceIds: ["e1"], observedAt: NOW, ...extra,
  });
  const retrieve = (query = {}, options = {}) => retrieveKnowledge(state, { ownerId: "alice", atTime: NOW, scope: SCOPE, ...query }, { registry: REGISTRY, ...options });
  const validate = (result, options = {}) => validateRetrievalResult(state, result, { registry: REGISTRY, now: NOW, ...options });
  source();
  return { get state() { return state; }, set state(value) { state = value; }, apply, entity, source, assertion, retrieve, validate };
}

const ids = (result) => result.candidates.map((candidate) => candidate.entityId);
function recipeGraph(f) {
  f.entity("recipe", "recipe", "두부 요리"); f.entity("req", "requirement", "두부 1모");
  f.entity("tofu", "ingredient", "두부"); f.entity("beans", "ingredient", "콩");
  f.assertion("r1", "recipe", "recipe.requires", "req");
  f.assertion("r2", "req", "requirement.ingredient", "tofu");
  f.assertion("r3", "tofu", "ingredient.substitute", "beans");
}

test("candidate lookup preserves duplicate identities, owner isolation, and honest unverified metadata", () => {
  const f = fixture();
  f.entity("tofu-1", "ingredient", "두부", { externalIds: { catalog: "x1" } });
  f.entity("tofu-2", "ingredient", "두부", { externalIds: { catalog: "x1" } });
  f.entity("tofu-3", "ingredient", "두부", {}, "bob");
  const before = structuredClone(f.state);
  const result = f.retrieve({ text: "두부", maxHops: 0 });
  assert.deepEqual(ids(result), ["tofu-1", "tofu-2"]);
  assert.ok(result.candidates.every((candidate) => candidate.verification === "unverified" && candidate.evidenceIds.length === 0));
  assert.deepEqual(result.candidates[0].reasons, [{ kind: "text", match: "exact" }]);
  assert.equal(JSON.stringify(result).includes('"score"'), false);
  assert.deepEqual(f.retrieve({ externalIds: { catalog: "x1" }, maxHops: 0 }).candidates.map((candidate) => candidate.entityId), ["tofu-1", "tofu-2"]);
  assert.deepEqual(f.state, before);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("two-hop traversal is bounded, preserves assertion directions, and can cross intermediate types", () => {
  const f = fixture(); recipeGraph(f);
  const outgoing = f.retrieve({ seedEntityIds: ["recipe"], direction: "outgoing" });
  assert.deepEqual(ids(outgoing), ["recipe", "req", "tofu"]);
  assert.equal(outgoing.relations.length, 2);
  assert.deepEqual(outgoing.candidates.find((item) => item.entityId === "tofu").reasons[0], {
    kind: "relation", fromEntityId: "req", predicate: "requirement.ingredient", direction: "outgoing", hop: 2,
    scope: SCOPE, assertionIds: ["r2"], evidenceIds: ["e1"],
  });
  const reverse = f.retrieve({ seedEntityIds: ["tofu"], typeIds: ["recipe"], direction: "incoming" });
  assert.deepEqual(ids(reverse), ["recipe"]);
  assert.equal(reverse.candidates[0].hop, 2);
  assert.deepEqual(reverse.relations.map((edge) => [edge.subjectId, edge.objectEntityId]), [["req", "tofu"], ["recipe", "req"]]);
  assert.deepEqual(ids(f.retrieve({ seedEntityIds: ["recipe"], maxHops: 1, direction: "outgoing" })), ["recipe", "req"]);
  assert.deepEqual(ids(f.retrieve({ seedEntityIds: ["recipe"], predicates: ["recipe.requires"] })), ["recipe", "req"]);
});

test("scopes are exact, omitted scopes never promote personal observations, and no union scope is invented", () => {
  const f = fixture(); recipeGraph(f);
  const omitted = retrieveKnowledge(f.state, { ownerId: "alice", seedEntityIds: ["recipe"], atTime: NOW }, { registry: REGISTRY });
  assert.deepEqual(ids(omitted), ["recipe"]);
  assert.equal(omitted.candidates[0].verification, "unverified");
  assert.deepEqual(omitted.relations, []);
  assert.deepEqual(ids(f.retrieve({ seedEntityIds: ["recipe"], scope: OTHER_SCOPE })), ["recipe"]);
  f.assertion("other", "tofu", "ingredient.availability", { type: "availability", value: "absent" }, { scope: OTHER_SCOPE });
  const result = f.retrieve({ seedEntityIds: ["tofu"], scope: undefined, scopes: [SCOPE, OTHER_SCOPE], maxHops: 0 });
  assert.ok(result.candidates[0].supports.some((support) => support.predicate === "ingredient.availability" && support.scope.id === "tomorrow"));
  assert.ok(result.candidates[0].supports.every((support) => ["dinner", "tomorrow"].includes(support.scope.id)));
});

test("expired, future, stale, and disputed relationships are not traversed", () => {
  for (const extra of [ { validTo: NOW }, { validFrom: LATER, observedAt: LATER }, { refreshDueAt: NOW } ]) {
    const f = fixture(); f.entity("tofu"); f.entity("beans");
    f.assertion("a", "tofu", "ingredient.substitute", "beans", extra);
    const result = f.retrieve({ seedEntityIds: ["tofu"] });
    assert.deepEqual(ids(result), ["tofu"]);
    assert.equal(result.candidates[0].verification, "unverified");
    assert.deepEqual(result.relations, []);
  }
  const f = fixture(); f.entity("tofu"); f.entity("beans"); f.entity("lentils");
  f.assertion("a", "tofu", "ingredient.substitute", "beans");
  f.assertion("b", "tofu", "ingredient.substitute", "lentils");
  assert.deepEqual(ids(f.retrieve({ seedEntityIds: ["tofu"] })), ["tofu"]);
  f.apply("assertion.retract", { assertionId: "b" });
  assert.deepEqual(ids(f.retrieve({ seedEntityIds: ["tofu"], direction: "outgoing" })), ["tofu", "beans"]);
});

test("unknown observations provide no planning proof, and current observation time wins over import time", () => {
  const f = fixture(); f.entity("tofu");
  f.assertion("unknown", "tofu", "ingredient.availability", { type: "availability", value: "unknown" });
  assert.equal(f.retrieve().candidates[0].verification, "unverified");
  f.apply("assertion.retract", { assertionId: "unknown" });
  f.assertion("present", "tofu", "ingredient.availability", { type: "availability", value: "present" });
  f.assertion("old", "tofu", "ingredient.availability", { type: "availability", value: "absent" }, { observedAt: "2026-09-20T09:00:00Z" });
  assert.deepEqual(f.retrieve().candidates[0].supports[0].assertionIds, ["present"]);
});

test("each traversed edge cites its own supporting assertions rather than sibling edge evidence", () => {
  const f = fixture(); f.source("2"); f.entity("recipe", "recipe"); f.entity("a", "requirement"); f.entity("b", "requirement");
  f.assertion("a1", "recipe", "recipe.requires", "a");
  f.assertion("a2", "recipe", "recipe.requires", "b", { evidenceIds: ["e2"] });
  const result = f.retrieve({ seedEntityIds: ["recipe"], direction: "outgoing" });
  assert.deepEqual(result.relations.map((edge) => [edge.objectEntityId, edge.assertionIds, edge.evidenceIds]), [["a", ["a1"], ["e1"]], ["b", ["a2"], ["e2"]]]);
});

test("canonical source chains, entity status, and full support sets are revalidated", () => {
  const f = fixture(); recipeGraph(f);
  const initial = f.retrieve({ seedEntityIds: ["recipe"] });
  f.apply("source.delete", { sourceId: "s1" });
  assert.equal(f.validate(initial).valid, false);
  assert.deepEqual(ids(f.retrieve({ seedEntityIds: ["recipe"] })), ["recipe"]);
  assert.equal(f.retrieve({ seedEntityIds: ["recipe"] }).candidates[0].verification, "unverified");

  for (const table of ["sources", "sourceVersions", "evidence"]) {
    const g = fixture(); recipeGraph(g);
    // A stale imported projection must not bypass canonical parent-source status.
    g.state[table][0].status = "deleted";
    assert.deepEqual(ids(g.retrieve({ seedEntityIds: ["recipe"] })), ["recipe"]);
  }
  const g = fixture(); recipeGraph(g); g.state.entities.find((entity) => entity.id === "req").status = "deleted";
  assert.deepEqual(ids(g.retrieve({ seedEntityIds: ["recipe"] })), ["recipe"]);

  const h = fixture(); h.source("2"); h.entity("tofu"); h.entity("beans");
  h.assertion("independent", "tofu", "ingredient.substitute", "beans", { evidenceIds: ["e1", "e2"], supportSets: [["e1"], ["e2"]] });
  h.apply("source.delete", { sourceId: "s1" });
  assert.deepEqual(h.retrieve({ seedEntityIds: ["tofu"], direction: "outgoing" }).relations[0].evidenceIds, ["e2"]);
});

test("semantic adapters supply IDs only and cannot smuggle foreign, deleted, or invented entities or proof", async () => {
  const f = fixture(); f.entity("tofu"); f.entity("foreign", "ingredient", "private", {}, "bob"); f.entity("deleted");
  f.state.entities.find((entity) => entity.id === "deleted").status = "deleted";
  let received;
  const result = await retrieveKnowledgeWithSemanticAdapter(f.state, { ownerId: "alice", text: "protein", atTime: NOW }, {
    registry: REGISTRY, semanticAdapter: { retrieveCandidateIds: async (request) => { received = request; return ["tofu", "foreign", "deleted", "invented", "tofu"]; } },
  });
  assert.deepEqual(ids(result), ["tofu"]);
  assert.deepEqual(result.candidates[0].reasons, [{ kind: "semantic_candidate" }]);
  assert.equal(result.candidates[0].verification, "unverified");
  assert.deepEqual(Object.keys(received).sort(), ["atTime", "externalIds", "limit", "ownerId", "text", "typeIds"]);
  await assert.rejects(retrieveKnowledgeWithSemanticAdapter(f.state, { ownerId: "alice", atTime: NOW }, {
    registry: REGISTRY, semanticAdapter: { retrieveCandidateIds: async () => [{ entityId: "tofu", score: 1, evidenceIds: ["fake"] }] },
  }), { code: "INVALID_RETRIEVAL_QUERY" });
});

test("async semantic retrieval keeps a snapshot watermark and detects later canonical deletion", async () => {
  const f = fixture(); recipeGraph(f);
  const before = f.state;
  const result = await retrieveKnowledgeWithSemanticAdapter(before, { ownerId: "alice", text: "unmatched", atTime: NOW, scope: SCOPE }, {
    registry: REGISTRY, semanticAdapter: { retrieveCandidateIds: async () => { f.apply("source.delete", { sourceId: "s1" }); return ["recipe"]; } },
  });
  assert.equal(result.knowledgeSequence, before.sequence);
  assert.equal(f.validate(result).valid, false);
});

test("dependencies cover empty discoveries, missing outgoing and incoming edges, time, and policy changes", () => {
  const f = fixture();
  const empty = f.retrieve({ text: "두부" });
  assert.deepEqual(ids(empty), []);
  f.entity("tofu", "ingredient", "두부");
  assert.ok(f.validate(empty).reasons.some((reason) => reason.code === "DISCOVERY_CHANGED"));
  f.entity("req", "requirement"); f.entity("beans");
  const noEdges = f.retrieve({ seedEntityIds: ["tofu"] });
  assert.ok(noEdges.queryWatches.some((watch) => watch.predicate === "requirement.ingredient" && watch.subjectId == null));
  f.assertion("incoming", "req", "requirement.ingredient", "tofu");
  assert.ok(f.validate(noEdges).reasons.some((reason) => reason.code === "QUERY_CHANGED"));
  const beforeOutgoing = f.retrieve({ seedEntityIds: ["tofu"] });
  f.assertion("outgoing", "tofu", "ingredient.substitute", "beans", { refreshDueAt: LATER });
  assert.equal(f.validate(beforeOutgoing).valid, false);
  const current = f.retrieve({ seedEntityIds: ["tofu"] });
  assert.equal(current.nextReevaluateAt, LATER);
  assert.ok(f.validate(current, { now: LATER }).reasons.some((reason) => reason.code === "TIME_BOUNDARY_PASSED"));
  const changedRegistry = structuredClone(REGISTRY); changedRegistry[2].resolution.version = "2";
  assert.ok(f.validate(current, { registry: changedRegistry }).reasons.some((reason) => reason.code === "POLICY_CHANGED"));
  assert.equal(f.validate(current).valid, true);
});

test("accepted mention identity proves identity only and retraction restores an unverified candidate", () => {
  const f = fixture(); f.entity("tofu-a", "ingredient", "두부"); f.entity("tofu-b", "ingredient", "두부");
  f.apply("mention.create", { id: "mention", sourceVersionId: "v1", text: "두부", entityType: "ingredient", evidenceIds: ["e1"] });
  f.apply("identity.propose", { id: "identity", mentionId: "mention", entityId: "tofu-a" });
  assert.ok(f.retrieve({ text: "두부" }).candidates.every((candidate) => candidate.verification === "unverified"));
  f.apply("identity.accept", { decisionId: "identity" });
  const accepted = f.retrieve({ text: "두부", scope: undefined });
  assert.equal(accepted.candidates.find((candidate) => candidate.entityId === "tofu-a").verification, "verified");
  assert.equal(accepted.candidates.find((candidate) => candidate.entityId === "tofu-b").verification, "unverified");
  assert.deepEqual(accepted.relations, []);
  assert.ok(accepted.readSet.some((ref) => ref.kind === "identityDecision" && ref.id === "identity"));
  f.apply("identity.retract", { decisionId: "identity" });
  assert.equal(f.validate(accepted).valid, false);
  assert.ok(f.retrieve({ text: "두부" }).candidates.every((candidate) => candidate.verification === "unverified"));
});

test("a stale identity projection cannot reuse assertions after its identity evidence source is gone", () => {
  const f = fixture(); f.source("2"); f.entity("tofu"); f.entity("beans");
  f.apply("mention.create", { id: "mention", sourceVersionId: "v1", text: "두부", entityType: "ingredient", evidenceIds: ["e1"] });
  f.apply("identity.propose", { id: "identity", mentionId: "mention", entityId: "tofu" });
  f.apply("identity.accept", { decisionId: "identity" });
  f.assertion("derived", "tofu", "ingredient.substitute", "beans", { subjectMentionId: "mention", evidenceIds: ["e2"] });
  f.state.sources.find((source) => source.id === "s1").status = "deleted";
  const result = f.retrieve({ seedEntityIds: ["tofu"] });
  assert.deepEqual(ids(result), ["tofu"]);
  assert.equal(result.candidates[0].verification, "unverified");
});

test("added and removed registry relations invalidate discovery even when the previous query had no facts", () => {
  const f = fixture(); f.entity("tofu");
  const result = f.retrieve({ seedEntityIds: ["tofu"] });
  const added = [...REGISTRY, { id: "ingredient.related", subjectTypes: ["ingredient"], objectTypes: ["ingredient"], cardinality: "many" }];
  assert.ok(f.validate(result, { registry: added }).reasons.some((reason) => reason.code === "RETRIEVAL_REGISTRY_CHANGED"));
  assert.ok(f.validate(result, { registry: [] }).reasons.some((reason) => reason.code === "RETRIEVAL_REGISTRY_CHANGED"));
});

test("traversal rejects invented predicates and unsafe bounds with typed application errors", () => {
  const f = fixture();
  for (const query of [ { maxHops: 3 }, { maxHops: -1 }, { limit: 101 }, { limit: 0 }, { predicates: ["invented"] }, { atTime: "2026-09-25" }, { scopes: [SCOPE] }, { externalIds: { provider: { opaque: 1 } } } ]) {
    assert.throws(() => f.retrieve(query), (error) => error instanceof AppError && error.httpStatus === 400);
  }
});
