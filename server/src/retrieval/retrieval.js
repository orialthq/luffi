import { createHash } from "node:crypto";
import { AppError } from "../errors.js";
import { normalizeIsoTimestamp } from "../common/iso_time.js";
import { buildKnowledgeContext, queryKnowledge, validateKnowledgeContext } from "../knowledge/index.js";

const CANDIDATE_BUDGET = 200;
const SLOT_BUDGET = 4000;
const TABLES = {
  entity: "entities", entityMention: "entityMentions", identityDecision: "identityDecisions",
  evidence: "evidence", sourceVersion: "sourceVersions", source: "sources", assertion: "assertions",
};

export class RetrievalError extends AppError {
  constructor(code, message, httpStatus = 400) {
    super(code, message, { httpStatus });
    this.name = "RetrievalError";
  }
}

const fail = (message) => { throw new RetrievalError("INVALID_RETRIEVAL_QUERY", message); };
const key = (value) => JSON.stringify(value);
const scopeKey = (value) => key([value.type, value.id]);
const slotKey = (value) => key([value.subjectId, value.predicate, scopeKey(value.scope)]);
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, stable(value[name])])) : value;
const registryFingerprint = (relations) => createHash("sha256").update(key(stable([...relations.values()]))).digest("hex");
const normalizeText = (value) => value.normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/gu, " ").trim();
function text(value, name, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${name} must be a nonempty string of at most ${max} characters`);
  return value;
}
function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name} must be an object`);
  return value;
}
function strings(value, name, limit = 100) {
  if (!Array.isArray(value) || value.length > limit) fail(`${name} must be an array with at most ${limit} entries`);
  return [...new Set(value.map((item) => text(item, name)))];
}
function timestamp(value, name) {
  const normalized = normalizeIsoTimestamp(value);
  if (!normalized) fail(`${name} must be a real ISO timestamp with timezone and millisecond or coarser precision`);
  return normalized;
}
function normalizeQuery(query, now) {
  object(query, "query");
  const ownerId = text(query.ownerId, "ownerId");
  const limit = query.limit ?? 20;
  const maxHops = query.maxHops ?? 2;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("limit must be between 1 and 100");
  if (!Number.isInteger(maxHops) || maxHops < 0 || maxHops > 2) fail("maxHops must be 0, 1, or 2");
  const direction = query.direction ?? "both";
  if (!["outgoing", "incoming", "both"].includes(direction)) fail("Unknown traversal direction");
  if (query.scope != null && query.scopes != null) fail("Use scope or scopes, not both");
  const rawScopes = query.scopes ?? (query.scope == null ? [] : [query.scope]);
  if (!Array.isArray(rawScopes) || rawScopes.length > 10) fail("scopes must have at most 10 entries");
  const scopes = [...new Map(rawScopes.map((item) => {
    object(item, "scope");
    const value = { type: text(item.type, "scope.type"), id: text(item.id, "scope.id") };
    return [scopeKey(value), value];
  })).values()];
  const externalIds = Object.fromEntries(Object.entries(object(query.externalIds ?? {}, "externalIds"))
    .map(([namespace, value]) => [text(namespace, "external ID namespace"), text(value, "external ID value")]));
  if (Object.keys(externalIds).length > 20) fail("At most 20 external IDs are supported");
  const clockValue = typeof now === "function" ? now() : now;
  return {
    ownerId, limit, maxHops, direction, scopes, externalIds,
    text: query.text == null ? null : normalizeText(text(query.text, "text", 2048)),
    typeIds: query.typeIds == null ? [] : strings(query.typeIds, "typeIds"),
    seedEntityIds: query.seedEntityIds == null ? [] : strings(query.seedEntityIds, "seedEntityIds"),
    predicates: query.predicates == null ? null : strings(query.predicates, "predicates", 100),
    atTime: timestamp(query.atTime ?? (clockValue instanceof Date ? clockValue.toISOString() : clockValue) ?? new Date().toISOString(), "atTime"),
  };
}

function relationDefinitions(registry, requested) {
  let definitions;
  if (typeof registry?.listRelations === "function") definitions = registry.listRelations();
  else if (Array.isArray(registry)) definitions = registry;
  else if (registry instanceof Map) definitions = [...registry.values()];
  else if (registry && typeof registry === "object" && typeof registry.getRelation !== "function") definitions = Object.values(registry);
  else if (requested && typeof registry?.getRelation === "function") definitions = requested.map((id) => registry.getRelation(id));
  else fail("A relation registry with listRelations or an explicit predicate list is required");
  if (!Array.isArray(definitions) || definitions.some((item) => !item || typeof item.id !== "string")) fail("Invalid relation registry");
  const registered = new Map(definitions.map((item) => [item.id, item]));
  if (requested?.some((id) => !registered.has(id))) fail("A requested predicate is not registered");
  return new Map([...registered].filter(([id]) => requested == null || requested.includes(id)).sort(([a], [b]) => a.localeCompare(b)));
}

/** Candidate indexes are hints only. Rebuild proof availability from the supplied
 * canonical snapshot, including the source/version chain, before resolving facts. */
function prepare(state, query, registry) {
  const assertions = queryKnowledge(state, { ownerId: query.ownerId, includeInactive: true });
  const relations = relationDefinitions(registry, query.predicates);
  const records = Object.fromEntries(Object.entries(TABLES).map(([kind, table]) => [kind,
    new Map(state[table].filter((item) => item.ownerId === query.ownerId).map((item) => [item.id, item])),
  ]));
  const active = (kind, id) => records[kind].get(id)?.status === "active";
  const liveEvidence = (id) => {
    const evidence = records.evidence.get(id);
    const version = evidence && records.sourceVersion.get(evidence.sourceVersionId);
    return evidence?.status === "active" && version?.status === "active" && active("source", version.sourceId);
  };
  const validAssertion = (assertion) => {
    const definition = relations.get(assertion.predicate);
    const subject = records.entity.get(assertion.subjectId);
    if (!definition || subject?.status !== "active" || (definition.subjectTypes && !definition.subjectTypes.includes(subject.type))) return false;
    if (assertion.subjectMentionId) {
      const mention = records.entityMention.get(assertion.subjectMentionId);
      const decision = records.identityDecision.get(assertion.identityDecisionId);
      if (mention?.status !== "active" || decision?.status !== "accepted" || decision.entityId !== subject.id ||
          ![...mention.evidenceIds, ...decision.evidenceIds].every(liveEvidence)) return false;
    }
    if (assertion.objectEntityId != null) {
      const target = records.entity.get(assertion.objectEntityId);
      return !definition.valueType && target?.status === "active" && (!definition.objectTypes || definition.objectTypes.includes(target.type));
    }
    if (!assertion.typedValue || definition.objectTypes || (definition.valueType && definition.valueType !== assertion.typedValue.type)) return false;
    try { registry?.validate?.(assertion.typedValue.type, assertion.typedValue.value); } catch { return false; }
    return !definition.allowedValues || definition.allowedValues.some((value) => key(value) === key(assertion.typedValue.value));
  };
  const invalidIds = new Set(assertions.filter((assertion) => !validAssertion(assertion)).map((assertion) => assertion.id));
  const effectiveState = {
    ...state,
    evidence: state.evidence.map((item) => item.ownerId === query.ownerId && !liveEvidence(item.id) ? { ...item, status: "unavailable" } : item),
    assertions: state.assertions.map((item) => item.ownerId === query.ownerId && invalidIds.has(item.id) ? { ...item, status: "unavailable" } : item),
  };
  return { assertions, relations, records, active, liveEvidence, effectiveState };
}

function directReasons(entity, query, semanticIds) {
  const reasons = [];
  if (query.seedEntityIds.includes(entity.id)) reasons.push({ kind: "seed" });
  for (const [namespace, value] of Object.entries(query.externalIds)) {
    if (entity.externalIds?.[namespace] === value) reasons.push({ kind: "external_id", namespace, value });
  }
  if (query.text) {
    const label = normalizeText(entity.label ?? "");
    if (label === query.text) reasons.push({ kind: "text", match: "exact" });
    else if (query.text.split(" ").every((term) => label.includes(term))) reasons.push({ kind: "text", match: "all_terms" });
  }
  if (semanticIds.has(entity.id)) reasons.push({ kind: "semantic_candidate" });
  const hasSelector = query.text || query.seedEntityIds.length || Object.keys(query.externalIds).length || semanticIds.size;
  if (!hasSelector) reasons.push({ kind: query.typeIds.length ? "type" : "catalog" });
  return reasons;
}
function priority(reasons) {
  return Math.min(...reasons.map((reason) => ({ external_id: 0, seed: 1, text: reason.match === "exact" ? 2 : 3, semantic_candidate: 4, type: 5, catalog: 6, relation: 7 })[reason.kind]));
}

/** No mutation, embeddings, network IO, or entity merging. Every returned proof
 * is current only at atTime and in its explicit scope. Entity metadata itself
 * never becomes a planning fact, even when the candidate has verified support. */
export function retrieveKnowledge(state, request, options = {}) {
  const query = normalizeQuery(request, options.now);
  const semanticIds = new Set(strings(options.semanticCandidateIds ?? [], "semanticCandidateIds", CANDIDATE_BUDGET));
  const { assertions, relations, records, active, liveEvidence, effectiveState } = prepare(state, query, options.registry);
  const scopeKeys = new Set(query.scopes.map(scopeKey));
  const reads = new Map();
  const watches = new Map();
  const policies = new Map();
  const slots = new Map();
  const inspected = new Map();
  const edges = new Map();
  const candidates = new Map();
  const truncated = { initialCandidates: false, expansion: false, resolutions: false, results: false };
  let nextReevaluateAt = null;
  const addRead = (kind, id) => {
    const item = records[kind].get(id);
    if (item) reads.set(key([kind, id]), { kind, id, revision: item.revision });
    return item;
  };
  const readEvidence = (id) => {
    const evidence = addRead("evidence", id);
    const version = evidence && addRead("sourceVersion", evidence.sourceVersionId);
    if (version) addRead("source", version.sourceId);
  };
  const addWatch = (watch) => watches.set(key(watch), watch);
  const resolve = (subjectId, predicate, scope) => {
    const slot = { subjectId, predicate, scope };
    const id = slotKey(slot);
    addWatch(slot);
    if (slots.has(id)) return slots.get(id);
    if (slots.size >= SLOT_BUDGET) { truncated.resolutions = true; return null; }
    const context = buildKnowledgeContext(effectiveState, { ownerId: query.ownerId, queries: [slot], atTime: query.atTime }, { predicates: options.registry });
    for (const ref of context.readSet) reads.set(key([ref.kind, ref.id]), ref);
    for (const policy of context.policyDependencies) policies.set(policy.predicate, policy);
    if (context.nextReevaluateAt && (!nextReevaluateAt || context.nextReevaluateAt < nextReevaluateAt)) nextReevaluateAt = context.nextReevaluateAt;
    const resolution = context.resolutions[0];
    slots.set(id, resolution);
    return resolution;
  };
  const proof = (resolution, selectedIds = resolution?.selectedAssertionIds) => {
    if (resolution?.status !== "resolved" || !selectedIds?.length) return null;
    const selected = assertions.filter((item) => selectedIds.includes(item.id));
    const evidenceIds = [...new Set(selected.flatMap((item) => item.supportSets.filter((set) => set.every(liveEvidence)).flat()))].sort();
    return evidenceIds.length ? { kind: "assertion", subjectId: resolution.subjectId, predicate: resolution.predicate, scope: resolution.scope, assertionIds: [...selectedIds].sort(), evidenceIds } : null;
  };
  const inspect = (entityId) => {
    if (inspected.has(entityId)) return inspected.get(entityId);
    const entity = addRead("entity", entityId);
    const supports = [];
    const adjacent = new Map();
    const addRelations = (resolution) => {
      if (resolution?.status !== "resolved") return;
      for (const value of resolution.values) {
        if (!value.objectEntityId || !active("entity", value.objectEntityId)) continue;
        const assertionIds = resolution.selectedAssertionIds.filter((id) => assertions.some((item) => item.id === id && item.objectEntityId === value.objectEntityId));
        const support = proof(resolution, assertionIds);
        if (!support) continue;
        const edge = { subjectId: resolution.subjectId, predicate: resolution.predicate, objectEntityId: value.objectEntityId, scope: resolution.scope, assertionIds: support.assertionIds, evidenceIds: support.evidenceIds };
        adjacent.set(key([edge.subjectId, edge.predicate, edge.objectEntityId, scopeKey(edge.scope)]), edge);
      }
    };
    // Accepted identity is evidence for the identity only; proposed decisions do
    // not merge matching names or attach their source text to another entity.
    for (const decision of records.identityDecision.values()) {
      if (decision.entityId !== entityId || decision.status !== "accepted") continue;
      const mention = records.entityMention.get(decision.mentionId);
      if (mention?.status !== "active") continue;
      addRead("identityDecision", decision.id); addRead("entityMention", mention.id);
      const evidenceIds = [...new Set([...mention.evidenceIds, ...decision.evidenceIds])];
      evidenceIds.forEach(readEvidence);
      if (evidenceIds.length && evidenceIds.every(liveEvidence)) supports.push({ kind: "identity", mentionId: mention.id, decisionId: decision.id, evidenceIds });
    }
    for (const definition of relations.values()) {
      for (const scope of query.scopes) {
        if (!definition.subjectTypes || definition.subjectTypes.includes(entity.type)) {
          const resolution = resolve(entityId, definition.id, scope);
          const support = proof(resolution);
          if (support) supports.push(support);
          addRelations(resolution);
        }
        if (definition.objectTypes?.includes(entity.type)) {
          // Current kernel watches match subject/predicate/scope slots. A broad
          // predicate watch intentionally catches a previously absent incoming edge.
          addWatch({ predicate: definition.id, scope });
        }
      }
    }
    for (const assertion of assertions) {
      if (assertion.objectEntityId !== entityId || !relations.has(assertion.predicate) || !scopeKeys.has(scopeKey(assertion.scope)) || !active("entity", assertion.subjectId)) continue;
      const resolution = resolve(assertion.subjectId, assertion.predicate, assertion.scope);
      if (resolution?.status !== "resolved") continue;
      const selectedIds = resolution.selectedAssertionIds.filter((id) => assertions.some((item) => item.id === id && item.objectEntityId === entityId));
      const support = proof(resolution, selectedIds);
      if (support) supports.push(support);
      addRelations(resolution);
    }
    const uniqueSupports = [...new Map(supports.map((item) => [key(item), item])).values()];
    const result = { supports: uniqueSupports, adjacent: [...adjacent.values()] };
    inspected.set(entityId, result);
    return result;
  };

  const initial = [...records.entity.values()].filter((entity) => entity.status === "active").map((entity) => ({
    entity, reasons: directReasons(entity, query, semanticIds),
  })).filter(({ entity, reasons }) => reasons.length &&
    (!query.typeIds.length || query.typeIds.includes(entity.type) || query.seedEntityIds.includes(entity.id)))
    .sort((a, b) => priority(a.reasons) - priority(b.reasons) || a.entity.id.localeCompare(b.entity.id));
  truncated.initialCandidates = initial.length > CANDIDATE_BUDGET;
  for (const { entity, reasons } of initial.slice(0, CANDIDATE_BUDGET)) candidates.set(entity.id, { entity, reasons, hop: 0 });
  let frontier = [...candidates.keys()];
  for (let hop = 0; hop <= query.maxHops && frontier.length; hop += 1) {
    const next = [];
    for (const entityId of frontier) {
      const { supports, adjacent } = inspect(entityId);
      if (!supports.length || hop === query.maxHops) continue;
      for (const edge of adjacent) {
        const outgoing = edge.subjectId === entityId;
        const incoming = edge.objectEntityId === entityId;
        if ((!outgoing && !incoming) || (outgoing && query.direction === "incoming") || (!outgoing && query.direction === "outgoing")) continue;
        const targetId = outgoing ? edge.objectEntityId : edge.subjectId;
        const target = records.entity.get(targetId);
        if (target?.status !== "active") continue;
        if (!candidates.has(targetId)) {
          if (candidates.size >= CANDIDATE_BUDGET) { truncated.expansion = true; continue; }
          candidates.set(targetId, { entity: target, reasons: [], hop: hop + 1 });
          next.push(targetId);
        }
        const candidate = candidates.get(targetId);
        const reason = { kind: "relation", fromEntityId: entityId, predicate: edge.predicate, direction: outgoing ? "outgoing" : "incoming", hop: hop + 1, scope: edge.scope, assertionIds: edge.assertionIds, evidenceIds: edge.evidenceIds };
        if (!candidate.reasons.some((item) => key(item) === key(reason))) candidate.reasons.push(reason);
        edges.set(key([edge.subjectId, edge.predicate, edge.objectEntityId, scopeKey(edge.scope)]), edge);
      }
    }
    frontier = next;
  }
  const eligible = [...candidates.values()].filter(({ entity }) => !query.typeIds.length || query.typeIds.includes(entity.type))
    .sort((a, b) => a.hop - b.hop || priority(a.reasons) - priority(b.reasons) || a.entity.id.localeCompare(b.entity.id));
  truncated.results = eligible.length > query.limit;
  const resultCandidates = eligible.slice(0, query.limit).map(({ entity, reasons, hop }) => {
    const { supports } = inspect(entity.id);
    return {
      entityId: entity.id, type: entity.type, label: entity.label, externalIds: structuredClone(entity.externalIds),
      verification: supports.length ? "verified" : "unverified", hop, reasons,
      evidenceIds: [...new Set(supports.flatMap((item) => item.evidenceIds))].sort(), supports,
    };
  });
  return structuredClone({
    schemaVersion: 1, ownerId: query.ownerId, atTime: query.atTime, knowledgeSequence: state.sequence,
    candidates: resultCandidates, relations: [...edges.values()],
    readSet: [...reads.values()], queryWatches: [...watches.values()], policyDependencies: [...policies.values()], nextReevaluateAt,
    discoveryWatch: { kind: "entity_catalog", query, semanticCandidateIds: [...semanticIds], registryFingerprint: registryFingerprint(relations) },
    limits: { maxHops: query.maxHops, candidateBudget: CANDIDATE_BUDGET, resolutionBudget: SLOT_BUDGET }, truncated,
  });
}

/** Adapter contract: retrieveCandidateIds(request) -> Promise<string[]>.
 * It receives no canonical source text and can provide no facts, entity labels,
 * scores, or assertions. Its IDs always pass the same owner/state/proof checks. */
export async function retrieveKnowledgeWithSemanticAdapter(state, request, options = {}) {
  if (typeof options.semanticAdapter?.retrieveCandidateIds !== "function") fail("semanticAdapter.retrieveCandidateIds is required");
  const snapshot = structuredClone(state);
  const query = normalizeQuery(request, options.now);
  const ids = await options.semanticAdapter.retrieveCandidateIds(structuredClone({
    ownerId: query.ownerId, text: query.text, typeIds: query.typeIds, externalIds: query.externalIds,
    limit: CANDIDATE_BUDGET, atTime: query.atTime,
  }));
  return retrieveKnowledge(snapshot, { ...query, predicates: query.predicates ?? undefined }, { ...options, semanticCandidateIds: ids });
}

/** For server-issued, persisted results. A client-supplied dependency list is
 * not an authorization token. Catalog changes are conservatively invalidating:
 * even an empty search must notice a new entity or a newly accepted identity. */
export function validateRetrievalResult(state, result, options = {}) {
  object(result?.discoveryWatch, "discoveryWatch");
  if (result.discoveryWatch.kind !== "entity_catalog") fail("Unsupported discovery watch");
  const currentRelations = options.registry ? relationDefinitions(options.registry, null) : null;
  const selectedRelations = currentRelations && new Map([...currentRelations].filter(([id]) =>
    result.discoveryWatch.query.predicates == null || result.discoveryWatch.query.predicates.includes(id)));
  const registryChanged = selectedRelations && registryFingerprint(selectedRelations) !== result.discoveryWatch.registryFingerprint;
  const allDependenciesRegistered = currentRelations && result.policyDependencies.every((item) => currentRelations.has(item.predicate));
  const checked = validateKnowledgeContext(state, result, { predicates: allDependenciesRegistered ? options.registry : undefined, now: options.now });
  const discoveryEvents = state.events.filter((event) => event.ownerId === result.ownerId && event.sequence > result.knowledgeSequence &&
    event.changes.some((change) => ["entity", "entityMention", "identityDecision"].includes(change.kind)));
  const reasons = [...checked.reasons];
  if (registryChanged) reasons.push({ code: "RETRIEVAL_REGISTRY_CHANGED" });
  if (discoveryEvents.length) reasons.push({ code: "DISCOVERY_CHANGED", eventIds: discoveryEvents.map((event) => event.id) });
  return { valid: reasons.length === 0, reasons };
}
