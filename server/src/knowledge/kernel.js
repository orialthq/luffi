import {
  date, definition, fail, fingerprint, json, nowIso, object, sameScope,
  scope, stableJson, string, strings,
} from "./validation.js";

const TABLES = ["entities", "entityMentions", "identityDecisions", "sources", "sourceVersions", "evidence", "assertions"];
const TABLE_BY_KIND = {
  entity: "entities", source: "sources", sourceVersion: "sourceVersions",
  evidence: "evidence", assertion: "assertions",
  entityMention: "entityMentions", identityDecision: "identityDecisions",
};
const ORIGINS = ["source_extracted", "user_reported", "external_observed", "system_inferred"];

/** JSON state is intentionally storage-agnostic. Persist the returned state and
 * its enclosing activity changes in the caller's transaction; these functions
 * perform no IO, and never modify a supplied state. */
export function createKnowledgeState() {
  return {
    schemaVersion: 1, sequence: 0, entities: [], entityMentions: [], identityDecisions: [], sources: [], sourceVersions: [],
    evidence: [], assertions: [], events: [], receipts: [], subscriptions: [],
  };
}

function checkState(state) {
  if (state?.schemaVersion !== 1 || !Number.isSafeInteger(state.sequence) || state.sequence < 0 ||
      [...TABLES, "events", "receipts", "subscriptions"].some((key) => !Array.isArray(state[key]))) {
    fail("INVALID_KNOWLEDGE_STATE", "Unsupported knowledge state");
  }
}

function record(state, table, ownerId, id, { active = true } = {}) {
  string(id, `${table} id`);
  const found = state[table].find((item) => item.ownerId === ownerId && item.id === id);
  if (!found || (active && found.status !== "active")) {
    // Deliberately do not distinguish another owner's record from a missing id.
    fail("KNOWLEDGE_NOT_FOUND", `An accessible active ${table} record is required`);
  }
  return found;
}

function insert(state, table, value) {
  if (state[table].some((item) => item.ownerId === value.ownerId && item.id === value.id)) {
    fail("KNOWLEDGE_ID_EXISTS", `The ${table} id already exists`);
  }
  state[table].push(value);
  return value;
}

function base(payload, ownerId, at) {
  return { id: string(payload.id, "id"), ownerId, status: "active", revision: 1, createdAt: at };
}

function checkRevision(value, expected) {
  if (expected != null && value.revision !== expected) fail("KNOWLEDGE_REVISION_CONFLICT", "Record revision changed");
}

function slot(assertion) {
  return { subjectId: assertion.subjectId, predicate: assertion.predicate, scope: assertion.scope };
}

function change(kind, value) {
  return { kind, id: value.id, revision: value.revision, ...(kind === "assertion" ? { slot: slot(value) } : {}) };
}

function acceptedIdentity(state, ownerId, mentionId) {
  const mention = state.entityMentions.find((item) => item.ownerId === ownerId && item.id === mentionId && item.status === "active");
  if (!mention) return null;
  return state.identityDecisions.find((item) => item.ownerId === ownerId && item.mentionId === mentionId && item.status === "accepted") ?? null;
}

export function resolveEntityMention(state, { ownerId, mentionId }) {
  checkState(state);
  string(ownerId, "ownerId");
  const mention = record(state, "entityMentions", ownerId, mentionId, { active: false });
  const decision = acceptedIdentity(state, ownerId, mentionId);
  return {
    mentionId, status: mention.status === "deleted" ? "deleted" : decision ? "resolved" : "unresolved",
    entityId: decision?.entityId ?? null, decisionId: decision?.id ?? null,
    candidateIds: state.identityDecisions.filter((item) => item.ownerId === ownerId && item.mentionId === mentionId && item.status === "proposed").map((item) => item.id),
    evidenceIds: [...mention.evidenceIds], revision: mention.revision,
  };
}

// The mention is the canonical subject for an extracted assertion when present.
// Its original subjectId remains an audit hint; current entity resolution is a
// projection and never moves or merges the underlying evidence.
function projectedAssertion(state, assertion) {
  if (!assertion.subjectMentionId) return assertion;
  const decision = acceptedIdentity(state, assertion.ownerId, assertion.subjectMentionId);
  return decision ? { ...assertion, subjectId: decision.entityId, identityDecisionId: decision.id } : null;
}

function identityDependents(state, ownerId, mentionIds) {
  return state.assertions.filter((item) => item.ownerId === ownerId && mentionIds.has(item.subjectMentionId));
}

function noteRebinding(changes, assertion, previous, next) {
  assertion.revision += 1;
  if (previous) changes.push(change("assertion", { ...previous, revision: assertion.revision }));
  if (next && (!previous || previous.subjectId !== next.subjectId)) {
    changes.push(change("assertion", { ...next, revision: assertion.revision }));
  }
}

function newAssertion(state, ownerId, raw, { predicates, at }) {
  const subject = record(state, "entities", ownerId, raw.subjectId);
  const subjectMentionId = raw.subjectMentionId == null ? null : string(raw.subjectMentionId, "subjectMentionId");
  let identityDecisionId = null;
  if (subjectMentionId) {
    const decision = acceptedIdentity(state, ownerId, subjectMentionId);
    if (!decision || decision.entityId !== subject.id) fail("INVALID_ASSERTION", "An extracted subject must match an accepted identity decision");
    identityDecisionId = decision.id;
  }
  const predicate = string(raw.predicate, "predicate");
  const def = definition(predicates, predicate);
  if (def.subjectTypes && !def.subjectTypes.includes(subject.type)) {
    fail("PREDICATE_TYPE_MISMATCH", "Subject type is not allowed by the predicate");
  }
  const hasObject = raw.objectEntityId != null;
  const hasValue = raw.typedValue != null;
  if (hasObject === hasValue) fail("INVALID_ASSERTION", "Exactly one objectEntityId or typedValue is required");
  let objectEntityId = null;
  let typedValue = null;
  if (hasObject) {
    const target = record(state, "entities", ownerId, raw.objectEntityId);
    if (def.valueType || (def.objectTypes && !def.objectTypes.includes(target.type))) {
      fail("PREDICATE_TYPE_MISMATCH", "Object type is not allowed by the predicate");
    }
    objectEntityId = target.id;
  } else {
    object(raw.typedValue, "typedValue");
    if (!Object.hasOwn(raw.typedValue, "value")) fail("INVALID_ASSERTION", "typedValue.value is required");
    typedValue = { type: string(raw.typedValue.type, "typedValue.type"), value: json(raw.typedValue.value) };
    if (def.objectTypes || (def.valueType && def.valueType !== typedValue.type) ||
        (def.allowedValues && !def.allowedValues.some((value) => stableJson(value) === stableJson(typedValue.value)))) {
      fail("PREDICATE_TYPE_MISMATCH", "Value is not allowed by the predicate");
    }
    if (typeof predicates?.validate === "function") predicates.validate(typedValue.type, typedValue.value);
  }
  const evidenceIds = strings(raw.evidenceIds, "evidenceIds", { nonempty: true });
  for (const id of evidenceIds) record(state, "evidence", ownerId, id);
  // Each support set is conjunctive. Different sets are independent alternatives.
  // A list of two quotes is not silently assumed to be two independent proofs.
  const supportSets = raw.supportSets ?? [evidenceIds];
  if (!Array.isArray(supportSets) || supportSets.length === 0) fail("INVALID_ASSERTION", "supportSets cannot be empty");
  const sets = supportSets.map((set) => strings(set, "support set", { nonempty: true }));
  if (sets.some((set) => set.some((id) => !evidenceIds.includes(id))) ||
      evidenceIds.some((id) => !sets.some((set) => set.includes(id)))) {
    fail("INVALID_ASSERTION", "supportSets must use exactly the assertion's evidence references");
  }
  const origin = string(raw.origin, "origin");
  if (!ORIGINS.includes(origin)) fail("INVALID_ASSERTION", "Unknown assertion origin");
  const assertedBy = object(raw.assertedBy, "assertedBy");
  if (!["user", "publisher", "external", "system"].includes(assertedBy.type)) fail("INVALID_ASSERTION", "Unknown asserting actor");
  string(assertedBy.id, "assertedBy.id");
  if (assertedBy.type === "user" && assertedBy.id !== ownerId) fail("INVALID_ASSERTION", "A user report must belong to the owner");
  if ((origin === "user_reported" && assertedBy.type !== "user") ||
      (origin === "system_inferred" && assertedBy.type !== "system")) {
    fail("INVALID_ASSERTION", "The assertion origin and asserting actor disagree");
  }
  const observedAt = date(raw.observedAt, "observedAt", { nullable: true });
  const validFrom = date(raw.validFrom, "validFrom", { nullable: true });
  const validTo = date(raw.validTo, "validTo", { nullable: true });
  const refreshDueAt = date(raw.refreshDueAt, "refreshDueAt", { nullable: true });
  if (validFrom && validTo && validFrom >= validTo) fail("INVALID_ASSERTION", "Validity must be a nonempty half-open interval");
  return {
    ...base(raw, ownerId, at), subjectId: subject.id, subjectMentionId, identityDecisionId, predicate,
    objectEntityId, typedValue, scope: scope(raw.scope), origin,
    assertedBy: { type: assertedBy.type, id: assertedBy.id },
    evidenceIds, supportSets: sets, observedAt, validFrom, validTo, refreshDueAt,
    recordedAt: at, supersedesId: null,
    capturedInActivityId: raw.capturedInActivityId == null ? null : string(raw.capturedInActivityId, "capturedInActivityId"),
    createdByRunId: raw.createdByRunId == null ? null : string(raw.createdByRunId, "createdByRunId"),
  };
}

function supported(state, assertion) {
  return assertion.supportSets.some((set) => set.every((id) =>
    state.evidence.some((item) => item.ownerId === assertion.ownerId && item.id === id && item.status === "active")));
}

function redactAssertion(assertion, at) {
  assertion.status = "invalidated";
  assertion.typedValue = null;
  assertion.objectEntityId = null;
  assertion.invalidatedAt = at;
  assertion.revision += 1;
}

function mutate(state, command, { predicates, at }) {
  const { ownerId, type, payload: p } = command;
  const changes = [];
  let result;
  if (type === "entity.create") {
    const value = insert(state, "entities", {
      ...base(p, ownerId, at), type: string(p.type, "entity.type"),
      label: typeof p.label === "string" ? p.label : "",
      externalIds: json(p.externalIds ?? {}),
    });
    changes.push(change("entity", value));
    result = { entityId: value.id };
  } else if (type === "mention.create") {
    const version = record(state, "sourceVersions", ownerId, p.sourceVersionId);
    const evidenceIds = strings(p.evidenceIds, "evidenceIds", { nonempty: true });
    for (const id of evidenceIds) {
      const evidence = record(state, "evidence", ownerId, id);
      if (evidence.sourceVersionId !== version.id) fail("INVALID_EVIDENCE", "A mention must point to evidence in its source version");
    }
    const value = insert(state, "entityMentions", {
      ...base(p, ownerId, at), sourceVersionId: version.id,
      text: string(p.text, "mention.text"), entityType: string(p.entityType, "mention.entityType"), evidenceIds,
    });
    changes.push(change("entityMention", value));
    result = { mentionId: value.id };
  } else if (type === "identity.propose") {
    const mention = record(state, "entityMentions", ownerId, p.mentionId);
    const entity = record(state, "entities", ownerId, p.entityId);
    if (entity.type !== mention.entityType) fail("PREDICATE_TYPE_MISMATCH", "Mention and entity types differ");
    const evidenceIds = strings(p.evidenceIds ?? mention.evidenceIds, "evidenceIds", { nonempty: true });
    for (const id of evidenceIds) record(state, "evidence", ownerId, id);
    const value = insert(state, "identityDecisions", {
      ...base(p, ownerId, at), status: "proposed", mentionId: mention.id, entityId: entity.id,
      evidenceIds, reason: typeof p.reason === "string" ? p.reason : "",
    });
    changes.push(change("identityDecision", value));
    result = { decisionId: value.id };
  } else if (type === "identity.accept" || type === "identity.retract") {
    const decision = record(state, "identityDecisions", ownerId, p.decisionId, { active: false });
    checkRevision(decision, p.expectedRevision);
    const mention = record(state, "entityMentions", ownerId, decision.mentionId);
    const dependents = identityDependents(state, ownerId, new Set([mention.id]));
    const previous = new Map(dependents.map((item) => [item.id, projectedAssertion(state, item)]));
    if (type === "identity.accept") {
      if (decision.status !== "proposed") fail("INVALID_IDENTITY_DECISION", "Only a proposed decision can be accepted");
      record(state, "entities", ownerId, decision.entityId);
      for (const id of decision.evidenceIds) record(state, "evidence", ownerId, id);
      const current = acceptedIdentity(state, ownerId, mention.id);
      if (current && p.replacesDecisionId !== current.id) fail("KNOWLEDGE_REVISION_CONFLICT", "Explicitly identify the identity decision being replaced");
      if (!current && p.replacesDecisionId != null) fail("KNOWLEDGE_REVISION_CONFLICT", "The decision to replace is no longer accepted");
      if (current) {
        current.status = "superseded";
        current.supersededAt = at;
        current.revision += 1;
        changes.push(change("identityDecision", current));
      }
      decision.status = "accepted";
      decision.acceptedAt = at;
    } else {
      if (!["proposed", "accepted"].includes(decision.status)) fail("INVALID_IDENTITY_DECISION", "Only a proposed or accepted decision can be retracted");
      decision.status = "retracted";
      decision.retractedAt = at;
    }
    decision.revision += 1;
    mention.revision += 1;
    changes.push(change("identityDecision", decision), change("entityMention", mention));
    for (const assertion of dependents) noteRebinding(changes, assertion, previous.get(assertion.id), projectedAssertion(state, assertion));
    result = { decisionId: decision.id, mentionId: mention.id, ...resolveEntityMention(state, { ownerId, mentionId: mention.id }) };
  } else if (type === "source.create") {
    const value = insert(state, "sources", {
      ...base(p, ownerId, at), kind: string(p.kind, "source.kind"),
      title: typeof p.title === "string" ? p.title : "",
      provenance: json(p.provenance ?? {}),
    });
    changes.push(change("source", value));
    result = { sourceId: value.id };
  } else if (type === "source.version.add") {
    const source = record(state, "sources", ownerId, p.sourceId);
    checkRevision(source, p.expectedSourceRevision);
    const value = insert(state, "sourceVersions", {
      ...base(p, ownerId, at), sourceId: source.id,
      contentHash: string(p.contentHash, "contentHash"),
      capturedAt: date(p.capturedAt, "capturedAt", { nullable: true }),
      content: json(p.content ?? null), asset: json(p.asset ?? { status: "unavailable" }),
    });
    changes.push(change("sourceVersion", value));
    result = { sourceVersionId: value.id };
  } else if (type === "evidence.add") {
    const version = record(state, "sourceVersions", ownerId, p.sourceVersionId);
    record(state, "sources", ownerId, version.sourceId);
    checkRevision(version, p.expectedSourceVersionRevision);
    const locator = json(object(p.locator, "evidence.locator"));
    if (Object.keys(locator).length === 0) fail("INVALID_EVIDENCE", "An evidence locator is required");
    const value = insert(state, "evidence", {
      ...base(p, ownerId, at), sourceVersionId: version.id,
      locator, quote: typeof p.quote === "string" ? p.quote : "",
      createdByRunId: p.createdByRunId == null ? null : string(p.createdByRunId, "createdByRunId"),
    });
    changes.push(change("evidence", value));
    result = { evidenceId: value.id };
  } else if (type === "assertion.add" || type === "assertion.correct") {
    const raw = type === "assertion.correct" ? object(p.assertion, "assertion") : p;
    const value = newAssertion(state, ownerId, raw, { predicates, at });
    if (type === "assertion.correct") {
      const previous = record(state, "assertions", ownerId, p.assertionId);
      checkRevision(previous, p.expectedRevision);
      const previousSubject = projectedAssertion(state, previous);
      if (!previousSubject || previousSubject.subjectId !== value.subjectId || previous.subjectMentionId !== value.subjectMentionId ||
          previous.predicate !== value.predicate || !sameScope(previous.scope, value.scope)) {
        fail("INVALID_CORRECTION", "A correction must address the same subject, predicate, and scope");
      }
      previous.status = "corrected";
      previous.revision += 1;
      previous.correctedAt = at;
      value.supersedesId = previous.id;
      changes.push(change("assertion", { ...previousSubject, revision: previous.revision }));
    }
    insert(state, "assertions", value);
    changes.push(change("assertion", value));
    result = { assertionId: value.id };
  } else if (type === "assertion.retract") {
    const value = record(state, "assertions", ownerId, p.assertionId);
    const before = projectedAssertion(state, value);
    checkRevision(value, p.expectedRevision);
    value.status = "retracted";
    value.retractedAt = at;
    value.revision += 1;
    changes.push(change("assertion", { ...(before ?? value), revision: value.revision }));
    result = { assertionId: value.id };
  } else if (type === "source.delete") {
    const source = record(state, "sources", ownerId, p.sourceId);
    checkRevision(source, p.expectedRevision);
    Object.assign(source, { status: "deleted", deletedAt: at, title: "", provenance: {}, revision: source.revision + 1 });
    changes.push(change("source", source));
    const versionIds = new Set();
    for (const version of state.sourceVersions.filter((item) => item.ownerId === ownerId && item.sourceId === source.id)) {
      Object.assign(version, { status: "deleted", deletedAt: at, content: null, asset: null, contentHash: null, revision: version.revision + 1 });
      versionIds.add(version.id);
      changes.push(change("sourceVersion", version));
    }
    const evidenceIds = new Set();
    const previousProjections = new Map(state.assertions.filter((item) => item.ownerId === ownerId)
      .map((item) => [item.id, projectedAssertion(state, item)]));
    for (const evidence of state.evidence.filter((item) => item.ownerId === ownerId && versionIds.has(item.sourceVersionId))) {
      Object.assign(evidence, { status: "deleted", deletedAt: at, quote: "", locator: null, revision: evidence.revision + 1 });
      evidenceIds.add(evidence.id);
      changes.push(change("evidence", evidence));
    }
    const deletedMentionIds = new Set();
    for (const mention of state.entityMentions.filter((item) => item.ownerId === ownerId && versionIds.has(item.sourceVersionId))) {
      Object.assign(mention, { status: "deleted", text: "", revision: mention.revision + 1, deletedAt: at });
      deletedMentionIds.add(mention.id);
      changes.push(change("entityMention", mention));
    }
    const changedMentions = new Set(deletedMentionIds);
    for (const decision of state.identityDecisions.filter((item) => item.ownerId === ownerId &&
      (deletedMentionIds.has(item.mentionId) || item.evidenceIds.some((id) => evidenceIds.has(id))))) {
      Object.assign(decision, { status: "invalidated", reason: "", revision: decision.revision + 1, invalidatedAt: at });
      changedMentions.add(decision.mentionId);
      changes.push(change("identityDecision", decision));
    }
    for (const assertion of state.assertions.filter((item) => item.ownerId === ownerId && item.evidenceIds.some((id) => evidenceIds.has(id)))) {
      if (!supported(state, assertion)) redactAssertion(assertion, at);
      else assertion.revision += 1;
      changes.push(change("assertion", { ...(previousProjections.get(assertion.id) ?? assertion), revision: assertion.revision }));
    }
    for (const assertion of identityDependents(state, ownerId, changedMentions)) {
      if (!changes.some((entry) => entry.kind === "assertion" && entry.id === assertion.id)) {
        noteRebinding(changes, assertion, previousProjections.get(assertion.id), projectedAssertion(state, assertion));
      }
    }
    result = {
      sourceId: source.id,
      invalidatedAssertionIds: changes.filter((item) => item.kind === "assertion" &&
        state.assertions.some((assertion) => assertion.ownerId === ownerId && assertion.id === item.id && assertion.status === "invalidated"))
        .map((item) => item.id),
    };
  } else {
    fail("UNKNOWN_KNOWLEDGE_COMMAND", `Unknown knowledge command: ${type}`);
  }
  return { result, changes };
}

export function applyKnowledgeCommand(state, rawCommand, options = {}) {
  checkState(state);
  const command = json(object(rawCommand, "command"));
  string(command.ownerId, "ownerId");
  string(command.commandId, "commandId");
  string(command.type, "type");
  object(command.payload, "payload");
  const payloadHash = fingerprint({ type: command.type, payload: command.payload, expectedSequence: command.expectedSequence ?? null });
  const receipt = state.receipts.find((item) => item.ownerId === command.ownerId && item.commandId === command.commandId);
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) fail("KNOWLEDGE_COMMAND_CONFLICT", "The command id was already used with different content");
    return { state, result: structuredClone(receipt.result), events: [], replayed: true };
  }
  if (command.expectedSequence != null && command.expectedSequence !== state.sequence) {
    fail("KNOWLEDGE_REVISION_CONFLICT", "Knowledge sequence changed");
  }
  const at = nowIso(options.now);
  const next = structuredClone(state);
  const { result, changes } = mutate(next, command, { predicates: options.predicates, at });
  next.sequence += 1;
  const event = {
    id: `knowledge:${next.sequence}`, sequence: next.sequence, ownerId: command.ownerId,
    commandId: command.commandId, type: command.type, occurredAt: at, changes,
  };
  next.events.push(event);
  next.receipts.push({ ownerId: command.ownerId, commandId: command.commandId, payloadHash, result, sequence: next.sequence });
  return { state: next, result: structuredClone(result), events: [structuredClone(event)], replayed: false };
}

/** Returns assertions, not adopted facts. Scope matching is exact; callers must
 * explicitly request another scope instead of silently promoting a local fact. */
export function queryKnowledge(state, query) {
  checkState(state);
  object(query, "query");
  const ownerId = string(query.ownerId, "ownerId");
  if (query.scope) scope(query.scope);
  return structuredClone(state.assertions.filter((item) => item.ownerId === ownerId)
    .map((item) => projectedAssertion(state, item)).filter((item) => item != null &&
    (query.subjectId == null || item.subjectId === query.subjectId) &&
    (query.predicate == null || item.predicate === query.predicate) &&
    (query.objectEntityId == null || item.objectEntityId === query.objectEntityId) &&
    (query.scope == null || sameScope(item.scope, query.scope)) &&
    (query.includeInactive === true || item.status === "active")));
}

function evidenceLive(state, assertion) {
  return supported(state, assertion) && state.entities.some((entity) => entity.ownerId === assertion.ownerId &&
    entity.id === assertion.subjectId && entity.status === "active") &&
    (!assertion.objectEntityId || state.entities.some((entity) => entity.ownerId === assertion.ownerId &&
      entity.id === assertion.objectEntityId && entity.status === "active"));
}

function freshness(assertion, policy, atMs) {
  if (assertion.refreshDueAt && Date.parse(assertion.refreshDueAt) <= atMs) return false;
  if (policy.maxAgeMs != null && (!assertion.observedAt || Date.parse(assertion.observedAt) + policy.maxAgeMs <= atMs)) return false;
  return true;
}

function valueOf(assertion) {
  return assertion.objectEntityId != null ? { objectEntityId: assertion.objectEntityId } : { typedValue: assertion.typedValue };
}

function futureBoundary(assertions, policy, atMs) {
  const times = assertions.flatMap((assertion) => [
    assertion.validFrom, assertion.validTo, assertion.refreshDueAt, assertion.observedAt,
    assertion.observedAt && policy.maxAgeMs != null
      ? new Date(Date.parse(assertion.observedAt) + policy.maxAgeMs).toISOString() : null,
  ]).filter(Boolean).map(Date.parse).filter((time) => time > atMs);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

export function resolveKnowledge(state, query, options = {}) {
  object(query, "query");
  const ownerId = string(query.ownerId, "ownerId");
  const subjectId = string(query.subjectId, "subjectId");
  const predicate = string(query.predicate, "predicate");
  const requestedScope = scope(query.scope);
  const atTime = query.atTime == null ? nowIso(options.now) : date(query.atTime, "atTime");
  const def = definition(options.predicates, predicate);
  const policy = def.resolution;
  const atMs = Date.parse(atTime);
  const all = queryKnowledge(state, { ownerId, subjectId, predicate, scope: requestedScope });
  const applicable = all.filter((assertion) => evidenceLive(state, assertion) &&
    (!assertion.validFrom || Date.parse(assertion.validFrom) <= atMs) &&
    (!assertion.validTo || Date.parse(assertion.validTo) > atMs) &&
    (!assertion.observedAt || Date.parse(assertion.observedAt) <= atMs));
  const stale = applicable.filter((assertion) => !freshness(assertion, policy, atMs));
  let candidates = applicable.filter((assertion) => freshness(assertion, policy, atMs));
  if (policy.originPriority?.length && candidates.length) {
    const rank = (assertion) => {
      const index = policy.originPriority.indexOf(assertion.origin);
      return index < 0 ? policy.originPriority.length : index;
    };
    const best = Math.min(...candidates.map(rank));
    candidates = candidates.filter((assertion) => rank(assertion) === best);
  }
  if (policy.strategy === "latest_observation" && candidates.length) {
    const known = candidates.filter((assertion) => assertion.observedAt);
    const newest = Math.max(...known.map((assertion) => Date.parse(assertion.observedAt)));
    // An undated conflicting report cannot safely be ordered behind a dated one.
    candidates = candidates.filter((assertion) => !assertion.observedAt || Date.parse(assertion.observedAt) === newest);
  }
  const values = [...new Map(candidates.map((assertion) => [stableJson(valueOf(assertion)), valueOf(assertion)])).values()];
  const allUnknown = candidates.length > 0 && candidates.every((assertion) => assertion.typedValue &&
    def.unknownValues?.some((value) => stableJson(value) === stableJson(assertion.typedValue.value)));
  let status = candidates.length ? "resolved" : stale.length ? "stale" : "unknown";
  if (allUnknown) status = "unknown";
  else if (def.cardinality === "single" && values.length > 1) status = "disputed";
  const selected = status === "resolved" ? candidates : [];
  const selectedIds = new Set(selected.map((assertion) => assertion.id));
  return {
    ownerId, subjectId, predicate, scope: requestedScope, atTime, status,
    cardinality: def.cardinality, values: status === "resolved" ? structuredClone(values) : [],
    selectedAssertionIds: [...selectedIds],
    alternativeAssertionIds: applicable.filter((assertion) => !selectedIds.has(assertion.id)).map((assertion) => assertion.id),
    staleAssertionIds: stale.map((assertion) => assertion.id),
    evidenceIds: [...new Set(selected.flatMap((assertion) => assertion.supportSets
      .filter((set) => set.every((id) => state.evidence.some((item) => item.ownerId === ownerId && item.id === id && item.status === "active")))
      .flat()))],
    policyVersion: policy.version, policyFingerprint: fingerprint(def),
    nextReevaluateAt: futureBoundary(all, policy, atMs), knowledgeSequence: state.sequence,
  };
}

function readReferences(state, ownerId, assertions, subjectIds) {
  const found = new Map();
  const add = (kind, id) => {
    const item = state[TABLE_BY_KIND[kind]].find((entry) => entry.ownerId === ownerId && entry.id === id);
    if (item) found.set(`${kind}:${id}`, { kind, id, revision: item.revision });
    return item;
  };
  for (const id of subjectIds) add("entity", id);
  for (const assertion of assertions) {
    add("assertion", assertion.id);
    add("entity", assertion.subjectId);
    if (assertion.objectEntityId) add("entity", assertion.objectEntityId);
    if (assertion.subjectMentionId) {
      const mention = add("entityMention", assertion.subjectMentionId);
      const decision = acceptedIdentity(state, ownerId, assertion.subjectMentionId);
      if (decision) add("identityDecision", decision.id);
      for (const id of [...(mention?.evidenceIds ?? []), ...(decision?.evidenceIds ?? [])]) {
        const evidence = add("evidence", id);
        if (!evidence) continue;
        const version = add("sourceVersion", evidence.sourceVersionId);
        if (version) add("source", version.sourceId);
      }
    }
    for (const id of assertion.evidenceIds) {
      const evidence = add("evidence", id);
      if (!evidence) continue;
      const version = add("sourceVersion", evidence.sourceVersionId);
      if (version) add("source", version.sourceId);
    }
  }
  return [...found.values()];
}

export function buildKnowledgeContext(state, request, options = {}) {
  checkState(state);
  object(request, "context request");
  const ownerId = string(request.ownerId, "ownerId");
  if (!Array.isArray(request.queries)) fail("INVALID_KNOWLEDGE_INPUT", "queries must be an array");
  const atTime = request.atTime == null ? nowIso(options.now) : date(request.atTime, "atTime");
  const queryWatches = request.queries.map((query) => ({
    subjectId: string(query.subjectId, "subjectId"), predicate: string(query.predicate, "predicate"), scope: scope(query.scope),
  }));
  const resolutions = queryWatches.map((query) => resolveKnowledge(state, { ...query, ownerId, atTime }, options));
  const assertions = queryWatches.flatMap((query) => queryKnowledge(state, { ...query, ownerId, includeInactive: true }));
  const future = resolutions.map((item) => item.nextReevaluateAt).filter(Boolean).sort();
  return {
    schemaVersion: 1, ownerId, atTime, knowledgeSequence: state.sequence,
    resolutions, queryWatches, readSet: readReferences(state, ownerId, assertions, queryWatches.map((query) => query.subjectId)),
    policyDependencies: resolutions.map((item) => ({ predicate: item.predicate, fingerprint: item.policyFingerprint })),
    nextReevaluateAt: future[0] ?? null,
  };
}

function matchesWatch(slotValue, watch) {
  return slotValue && (watch.subjectId == null || slotValue.subjectId === watch.subjectId) &&
    (watch.predicate == null || slotValue.predicate === watch.predicate) &&
    (watch.scope == null || sameScope(slotValue.scope, watch.scope));
}

function checkDependencies(readSet, queryWatches) {
  if (!Array.isArray(readSet) || !Array.isArray(queryWatches)) fail("INVALID_KNOWLEDGE_INPUT", "Context dependencies must be arrays");
  for (const ref of readSet) {
    object(ref, "read reference");
    if (!Object.hasOwn(TABLE_BY_KIND, ref.kind) || !Number.isSafeInteger(ref.revision) || ref.revision < 1) {
      fail("INVALID_KNOWLEDGE_INPUT", "Invalid read reference kind or revision");
    }
    string(ref.id, "read reference id");
  }
  for (const watch of queryWatches) {
    object(watch, "query watch");
    if (watch.subjectId != null) string(watch.subjectId, "watch.subjectId");
    if (watch.predicate != null) string(watch.predicate, "watch.predicate");
    if (watch.scope != null) scope(watch.scope);
  }
}

function checkContext(state, context) {
  object(context, "context");
  if (context.schemaVersion !== 1 || !Number.isSafeInteger(context.knowledgeSequence) ||
      context.knowledgeSequence < 0 || context.knowledgeSequence > state.sequence) {
    fail("INVALID_KNOWLEDGE_INPUT", "Invalid context version or sequence");
  }
  string(context.ownerId, "context.ownerId");
  date(context.atTime, "context.atTime");
  date(context.nextReevaluateAt, "context.nextReevaluateAt", { nullable: true });
  checkDependencies(context.readSet, context.queryWatches);
  if (!Array.isArray(context.policyDependencies)) fail("INVALID_KNOWLEDGE_INPUT", "Policy dependencies must be an array");
  for (const dependency of context.policyDependencies) {
    object(dependency, "policy dependency");
    string(dependency.predicate, "policy predicate");
    string(dependency.fingerprint, "policy fingerprint");
  }
}

export function getKnowledgeChanges(state, request) {
  checkState(state);
  object(request, "changes request");
  const ownerId = string(request.ownerId, "ownerId");
  const after = request.afterSequence ?? 0;
  if (!Number.isSafeInteger(after) || after < 0 || after > state.sequence) fail("INVALID_KNOWLEDGE_INPUT", "Invalid sequence watermark");
  const hasFilters = request.queryWatches != null || request.readSet != null;
  const watches = request.queryWatches ?? [];
  const reads = request.readSet ?? [];
  checkDependencies(reads, watches);
  return structuredClone(state.events.filter((event) => event.ownerId === ownerId && event.sequence > after &&
    (!hasFilters || event.changes.some((entry) => watches.some((watch) => matchesWatch(entry.slot, watch)) ||
      reads.some((ref) => ref.kind === entry.kind && ref.id === entry.id)))));
}

/** Also compares predicate definitions when supplied. This is a precondition
 * check for the caller's final write transaction, not a distributed lock. */
export function validateKnowledgeContext(state, context, options = {}) {
  checkState(state);
  checkContext(state, context);
  const ownerId = string(context.ownerId, "ownerId");
  const reasons = [];
  for (const ref of context.readSet) {
    const current = state[TABLE_BY_KIND[ref.kind]]?.find((item) => item.ownerId === ownerId && item.id === ref.id);
    if (!current || current.revision !== ref.revision) reasons.push({ code: "READ_CHANGED", kind: ref.kind, id: ref.id });
  }
  const events = getKnowledgeChanges(state, {
    ownerId, afterSequence: context.knowledgeSequence, queryWatches: context.queryWatches, readSet: context.readSet,
  });
  if (events.length) reasons.push({ code: "QUERY_CHANGED", eventIds: events.map((item) => item.id) });
  const now = nowIso(options.now);
  if (context.nextReevaluateAt && now >= context.nextReevaluateAt) reasons.push({ code: "TIME_BOUNDARY_PASSED", at: context.nextReevaluateAt });
  if (options.predicates) {
    for (const dependency of context.policyDependencies) {
      if (fingerprint(definition(options.predicates, dependency.predicate)) !== dependency.fingerprint) {
        reasons.push({ code: "POLICY_CHANGED", predicate: dependency.predicate });
      }
    }
  }
  return { valid: reasons.length === 0, reasons };
}

/** A context watermark closes the read/register race. The caller must persist
 * this state and enqueue catchUpEvents atomically. Polling events after the
 * returned registeredAtSequence then cannot miss a committed mutation. */
export function registerKnowledgeWatch(state, { ownerId, consumerId, context }) {
  checkState(state);
  checkContext(state, context);
  string(ownerId, "ownerId");
  string(consumerId, "consumerId");
  if (context.ownerId !== ownerId) fail("INVALID_KNOWLEDGE_INPUT", "Watch context owner differs");
  const catchUpEvents = getKnowledgeChanges(state, {
    ownerId, afterSequence: context.knowledgeSequence, queryWatches: context.queryWatches, readSet: context.readSet,
  });
  const next = structuredClone(state);
  next.subscriptions = next.subscriptions.filter((item) => item.ownerId !== ownerId || item.consumerId !== consumerId);
  // Watches retain dependencies, never another copy of resolved personal values.
  const dependencies = json({
    schemaVersion: 1, ownerId, atTime: context.atTime, knowledgeSequence: context.knowledgeSequence,
    readSet: context.readSet, queryWatches: context.queryWatches,
    policyDependencies: context.policyDependencies, nextReevaluateAt: context.nextReevaluateAt,
  });
  next.subscriptions.push({ ownerId, consumerId, context: dependencies, registeredAtSequence: state.sequence });
  return { state: next, catchUpEvents, registeredAtSequence: state.sequence };
}

export function unregisterKnowledgeWatch(state, { ownerId, consumerId }) {
  checkState(state);
  const next = structuredClone(state);
  next.subscriptions = next.subscriptions.filter((item) => item.ownerId !== ownerId || item.consumerId !== consumerId);
  return next;
}

export function getAffectedKnowledgeConsumers(state, { ownerId, afterSequence = 0, atTime }, options = {}) {
  checkState(state);
  string(ownerId, "ownerId");
  const now = atTime == null ? nowIso(options.now) : date(atTime, "atTime");
  return state.subscriptions.filter((item) => item.ownerId === ownerId).flatMap((subscription) => {
    const context = subscription.context;
    const events = getKnowledgeChanges(state, {
      ownerId, afterSequence: Math.max(afterSequence, context.knowledgeSequence), queryWatches: context.queryWatches, readSet: context.readSet,
    });
    const due = context.nextReevaluateAt != null && now >= context.nextReevaluateAt;
    return events.length || due ? [{ consumerId: subscription.consumerId, eventIds: events.map((item) => item.id), timeDue: due }] : [];
  });
}
