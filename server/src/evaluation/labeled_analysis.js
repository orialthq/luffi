import { validateLegacyAnalysis } from "../ingestion/index.js";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const domainSet = new Set(["recipe", "dining", "fashion", "beauty", "travel",
  "life_tip", "shopping", "health"]);

function fail() { throw new Error("INVALID_EVALUATION_LABELS"); }

function pointerParts(pointer, wildcard = false) {
  if (typeof pointer !== "string" || !pointer.startsWith("/") || pointer.length < 2) fail();
  const parts = pointer.slice(1).split("/").map((part) => {
    if (!part || /~(?![01])/.test(part)) fail();
    const decoded = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (["__proto__", "constructor", "prototype"].includes(decoded) ||
        (decoded === "*" && !wildcard)) fail();
    return decoded;
  });
  return parts;
}

function validateGraphLabels(graph) {
  if (graph === undefined) return;
  if (!graph || typeof graph !== "object" || Array.isArray(graph) ||
      Object.keys(graph).some((key) => !["ownerId", "distinctMentions", "forbiddenAssertions"].includes(key)) ||
      typeof graph.ownerId !== "string" || !idPattern.test(graph.ownerId)) fail();
  if ((graph.distinctMentions !== undefined && !Array.isArray(graph.distinctMentions)) ||
      (graph.forbiddenAssertions !== undefined && !Array.isArray(graph.forbiddenAssertions))) fail();
  for (const pair of graph.distinctMentions ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1] ||
        pair.some((id) => typeof id !== "string" || !idPattern.test(id))) fail();
  }
  for (const assertion of graph.forbiddenAssertions ?? []) {
    if (!assertion || typeof assertion !== "object" ||
        Object.keys(assertion).some((key) => !["predicate", "subjectId", "scope"].includes(key)) ||
        typeof assertion.predicate !== "string" || !/^[a-z][a-z0-9_.]*$/.test(assertion.predicate) ||
        (assertion.subjectId === undefined && assertion.scope === undefined) ||
        (assertion.subjectId !== undefined &&
          (typeof assertion.subjectId !== "string" || !idPattern.test(assertion.subjectId))) ||
        (assertion.scope !== undefined &&
          (!assertion.scope || typeof assertion.scope !== "object" ||
            Object.keys(assertion.scope).some((key) => !["type", "id"].includes(key)) ||
            typeof assertion.scope?.type !== "string" || !idPattern.test(assertion.scope.type) ||
            typeof assertion.scope?.id !== "string" || !idPattern.test(assertion.scope.id)))) fail();
  }
}

export function validateLabelManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !["synthetic", "consented_private"].includes(manifest.dataClass) ||
      typeof manifest.dataset !== "string" || !idPattern.test(manifest.dataset) || !Array.isArray(manifest.entries) ||
      manifest.entries.length === 0) fail();
  const ids = new Set();
  for (const entry of manifest.entries) {
    if (typeof entry?.id !== "string" || !idPattern.test(entry.id) ||
        !domainSet.has(entry?.domain) || ids.has(entry.id) ||
        !/^[a-f0-9]{64}$/.test(entry.inputSha256) ||
        (manifest.dataClass === "consented_private" &&
          (typeof entry.consentRef !== "string" || !idPattern.test(entry.consentRef))) ||
        !entry.expected || !Array.isArray(entry.expected.fields) ||
        entry.expected.fields.length === 0) fail();
    ids.add(entry.id);
    validateGraphLabels(entry.expected.graph);
    const paths = new Set();
    for (const field of entry.expected.fields) {
      const selector = field?.selector;
      if ((field?.path === undefined) === (selector === undefined) ||
          typeof field.evidenceRequired !== "boolean" ||
          !Object.hasOwn(field, "value") ||
          (field.value !== null && !["string", "number", "boolean"].includes(typeof field.value)) ||
          (typeof field.value === "number" && !Number.isFinite(field.value))) fail();
      if (selector !== undefined) {
        if (typeof field.id !== "string" || !idPattern.test(field.id) ||
            !selector || typeof selector !== "object" || Array.isArray(selector) ||
            Object.keys(selector).some((key) => !["collection", "where", "path"].includes(key)) ||
            !selector.where || typeof selector.where !== "object" || Array.isArray(selector.where) ||
            Object.keys(selector.where).length === 0 ||
            Object.entries(selector.where).some(([key, value]) =>
              !idPattern.test(key) || !["string", "number", "boolean"].includes(typeof value) ||
              (typeof value === "number" && !Number.isFinite(value)))) fail();
        pointerParts(selector.collection, true);
        pointerParts(selector.path);
      } else pointerParts(field.path);
      const key = selector ? field.id : field.path;
      if (paths.has(key)) fail();
      paths.add(key);
    }
  }
  return manifest;
}

function atPointer(value, pointer) {
  const parts = pointerParts(pointer);
  let parent;
  for (const part of parts) {
    parent = value;
    value = value?.[part];
  }
  return { value, parent };
}

function selectField(analysis, field) {
  if (!field.selector) return atPointer(analysis, field.path);
  let candidates = [analysis];
  for (const part of pointerParts(field.selector.collection, true)) {
    candidates = candidates.flatMap((candidate) => part === "*"
      ? Array.isArray(candidate) ? candidate : []
      : candidate?.[part] === undefined ? [] : [candidate[part]]);
  }
  const matches = candidates.filter((candidate) => candidate && typeof candidate === "object" &&
    Object.entries(field.selector.where).every(([key, value]) => candidate[key] === value));
  if (matches.length !== 1) return { reason: matches.length ? "ambiguous_match" : "missing_match" };
  return atPointer(matches[0], field.selector.path);
}

function evaluateGraph(graphLabels, graph) {
  if (!graphLabels) return [];
  const labels = [
    ...(graphLabels.distinctMentions ?? []).map((pair, index) => ({ kind: "distinct_mentions", index, pair })),
    ...(graphLabels.forbiddenAssertions ?? []).map((assertion, index) =>
      ({ kind: "forbidden_assertion", index, assertion })),
  ];
  if (!graph || !Array.isArray(graph.identityDecisions) || !Array.isArray(graph.assertions)) {
    return labels.map(({ kind, index }) => ({ kind, index, matched: false, reason: "missing_graph" }));
  }
  return labels.map(({ kind, index, pair, assertion }) => {
    let violation;
    if (kind === "distinct_mentions") {
      const identities = pair.map((mentionId) => new Set(graph.identityDecisions
        .filter((decision) => decision.ownerId === graphLabels.ownerId &&
          decision.mentionId === mentionId && decision.status === "accepted")
        .map((decision) => decision.entityId)));
      violation = [...identities[0]].some((id) => identities[1].has(id));
    } else {
      violation = graph.assertions.some((item) => item.status === "active" &&
        item.ownerId === graphLabels.ownerId &&
        item.predicate === assertion.predicate &&
        (assertion.subjectId === undefined || item.subjectId === assertion.subjectId) &&
        (assertion.scope === undefined ||
          (item.scope?.type === assertion.scope.type && item.scope.id === assertion.scope.id)));
    }
    return { kind, index, matched: !violation, reason: violation ?
      kind === "distinct_mentions" ? "unsafe_identity_merge" : "forbidden_action_assertion" : null };
  });
}

export function evaluateLabeledAnalysis(entry, analysis) {
  try {
    validateLegacyAnalysis(analysis);
  } catch {
    return { valid: false, fields: entry.expected.fields.map((field) => ({
      path: field.id ?? field.path, matched: false, reason: "invalid_analysis_schema",
    })) };
  }
  const evidence = new Set(analysis.evidence.map((item) => item.id));
  return { valid: true, fields: entry.expected.fields.map((field) => {
    const observed = selectField(analysis, field);
    let reason = observed.reason ?? null;
    if (!reason && observed.value === undefined) reason = "missing_field";
    else if (!reason && observed.value !== field.value) reason = "value_mismatch";
    else if (!reason && field.evidenceRequired && (!Array.isArray(observed.parent?.evidenceIds) ||
        observed.parent.evidenceIds.length === 0 ||
        observed.parent.evidenceIds.some((id) => !evidence.has(id)))) reason = "missing_evidence";
    return { path: field.id ?? field.path, matched: reason === null, reason };
  }) };
}

export function evaluateLabeledBatch(manifest, predictions) {
  validateLabelManifest(manifest);
  if (!predictions || typeof predictions !== "object" || Array.isArray(predictions)) fail();
  const cases = manifest.entries.map((entry) => {
    const prediction = predictions[entry.id];
    const evaluation = prediction?.inputSha256 !== entry.inputSha256
      ? { valid: false, fields: entry.expected.fields.map((field) => ({ path: field.id ?? field.path,
        matched: false, reason: prediction ? "input_hash_mismatch" : "missing_prediction" })) }
      : evaluateLabeledAnalysis(entry, prediction.analysis);
    const graph = prediction?.inputSha256 !== entry.inputSha256
      ? evaluateGraph(entry.expected.graph, null)
      : evaluateGraph(entry.expected.graph, prediction.graph);
    return { id: entry.id, domain: entry.domain, ...evaluation, graph };
  });
  const domains = Object.fromEntries([...domainSet].filter((domain) =>
    cases.some((item) => item.domain === domain)).map((domain) => {
    const records = cases.filter((item) => item.domain === domain);
    const fields = records.flatMap((item) => item.fields);
    const graph = records.flatMap((item) => item.graph);
    return [domain, { cases: records.length, validResponses: records.filter((item) => item.valid).length,
      labeledFields: fields.length, matchedFields: fields.filter((item) => item.matched).length,
      graphChecks: graph.length, passedGraphChecks: graph.filter((item) => item.matched).length }];
  }));
  const expectedIds = new Set(manifest.entries.map((entry) => entry.id));
  const unexpectedPredictions = Object.keys(predictions).filter((id) => !expectedIds.has(id)).sort();
  return { dataset: manifest.dataset, dataClass: manifest.dataClass,
    cases: cases.length, validResponses: cases.filter((item) => item.valid).length,
    labeledFields: cases.reduce((sum, item) => sum + item.fields.length, 0),
    matchedFields: cases.reduce((sum, item) => sum + item.fields.filter((field) => field.matched).length, 0),
    graphChecks: cases.reduce((sum, item) => sum + item.graph.length, 0),
    passedGraphChecks: cases.reduce((sum, item) => sum + item.graph.filter((check) => check.matched).length, 0),
    unexpectedPredictions,
    domains,
    failures: cases.flatMap((item) => [
      ...item.fields.filter((field) => !field.matched).map((field) => ({
        id: item.id, domain: item.domain, path: field.path, reason: field.reason })),
      ...item.graph.filter((check) => !check.matched).map((check) => ({
        id: item.id, domain: item.domain, check: check.kind, index: check.index, reason: check.reason })),
    ]) };
}
