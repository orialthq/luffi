import { validateLegacyAnalysis } from "../ingestion/index.js";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const domainSet = new Set(["recipe", "dining", "fashion", "beauty", "travel",
  "life_tip", "shopping", "health"]);

function fail() { throw new Error("INVALID_EVALUATION_LABELS"); }

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
    const paths = new Set();
    for (const field of entry.expected.fields) {
      const parts = typeof field?.path === "string" ? field.path.split("/").slice(1) : [];
      if (!field?.path?.startsWith("/") || parts.length === 0 ||
          parts.some((part) => !part || ["__proto__", "constructor", "prototype"].includes(part)) ||
          paths.has(field.path) || typeof field.evidenceRequired !== "boolean" ||
          !Object.hasOwn(field, "value") ||
          (field.value !== null && !["string", "number", "boolean"].includes(typeof field.value)) ||
          (typeof field.value === "number" && !Number.isFinite(field.value))) fail();
      paths.add(field.path);
    }
  }
  return manifest;
}

function atPointer(value, pointer) {
  const parts = pointer.split("/").slice(1).map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let parent;
  for (const part of parts) {
    parent = value;
    value = value?.[part];
  }
  return { value, parent };
}

export function evaluateLabeledAnalysis(entry, analysis) {
  try {
    validateLegacyAnalysis(analysis);
  } catch {
    return { valid: false, fields: entry.expected.fields.map((field) => ({
      path: field.path, matched: false, reason: "invalid_analysis_schema",
    })) };
  }
  const evidence = new Set(analysis.evidence.map((item) => item.id));
  return { valid: true, fields: entry.expected.fields.map((field) => {
    const observed = atPointer(analysis, field.path);
    let reason = null;
    if (observed.value === undefined) reason = "missing_field";
    else if (observed.value !== field.value) reason = "value_mismatch";
    else if (field.evidenceRequired && (!Array.isArray(observed.parent?.evidenceIds) ||
        observed.parent.evidenceIds.length === 0 ||
        observed.parent.evidenceIds.some((id) => !evidence.has(id)))) reason = "missing_evidence";
    return { path: field.path, matched: reason === null, reason };
  }) };
}

export function evaluateLabeledBatch(manifest, predictions) {
  validateLabelManifest(manifest);
  if (!predictions || typeof predictions !== "object" || Array.isArray(predictions)) fail();
  const cases = manifest.entries.map((entry) => {
    const prediction = predictions[entry.id];
    const evaluation = prediction?.inputSha256 !== entry.inputSha256
      ? { valid: false, fields: entry.expected.fields.map((field) => ({ path: field.path,
        matched: false, reason: prediction ? "input_hash_mismatch" : "missing_prediction" })) }
      : evaluateLabeledAnalysis(entry, prediction.analysis);
    return { id: entry.id, domain: entry.domain, ...evaluation };
  });
  const domains = Object.fromEntries([...domainSet].filter((domain) =>
    cases.some((item) => item.domain === domain)).map((domain) => {
    const records = cases.filter((item) => item.domain === domain);
    const fields = records.flatMap((item) => item.fields);
    return [domain, { cases: records.length, validResponses: records.filter((item) => item.valid).length,
      labeledFields: fields.length, matchedFields: fields.filter((item) => item.matched).length }];
  }));
  const expectedIds = new Set(manifest.entries.map((entry) => entry.id));
  const unexpectedPredictions = Object.keys(predictions).filter((id) => !expectedIds.has(id)).sort();
  return { dataset: manifest.dataset, dataClass: manifest.dataClass,
    cases: cases.length, validResponses: cases.filter((item) => item.valid).length,
    labeledFields: cases.reduce((sum, item) => sum + item.fields.length, 0),
    matchedFields: cases.reduce((sum, item) => sum + item.fields.filter((field) => field.matched).length, 0),
    unexpectedPredictions,
    domains,
    failures: cases.flatMap((item) => item.fields.filter((field) => !field.matched).map((field) => ({
      id: item.id, domain: item.domain, path: field.path, reason: field.reason,
    }))) };
}
