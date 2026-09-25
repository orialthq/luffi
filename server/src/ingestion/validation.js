import { AppError } from "../errors.js";
import { domainRegistry } from "../domains/index.js";

export class IngestionError extends AppError {
  constructor(code, message) {
    super(code, message, { httpStatus: code === "INGESTION_IMPORT_CONFLICT" ? 409 : 400 });
    this.name = "IngestionError";
  }
}
export const fail = (message, code = "INVALID_CAPTURE_IMPORT") => { throw new IngestionError(code, message); };
export function string(value, name, { nullable = false, empty = false, max = 20000 } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max) fail(`${name} must be a bounded string`);
  return value;
}
export function record(value, name, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name} must be a plain object`);
  const keys = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !keys.has(key))) fail(`${name} has missing or unsupported fields`);
  return value;
}
export function list(value, name, check, max = 1000) {
  if (!Array.isArray(value) || value.length > max) fail(`${name} must be a bounded array`);
  value.forEach((entry, index) => check(entry, `${name}[${index}]`));
  return value;
}
export const strings = (value, name) => list(value, name, (entry, path) => string(entry, path));
export function confidence(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail(`${name} must be between zero and one`);
}
export function timestamp(value, name, nullable = false) {
  if (nullable && value == null) return null;
  try { domainRegistry.validate("core.timestamp", value); } catch { fail(`${name} must be a valid date-time with timezone`); }
  return new Date(value).toISOString();
}
export function oneOf(value, values, name) {
  if (!values.includes(value)) fail(`${name} has an unsupported value`);
}

// Only textual analysis belongs in this adapter. Binary image upload is a
// separate authenticated path and device filesystem locations never migrate.
export function assertSafeJson(value, path = "$", ancestors = new Set(), depth = 0) {
  if (depth > 24) fail(`${path} exceeds the supported nesting depth`);
  if (typeof value === "string") {
    const text = value.trim();
    if (/data:image\//i.test(text) || /(?:\/9j\/|iVBORw0KGgo|R0lGOD|UklGR)[A-Za-z0-9+/=]+/.test(text)) fail(`${path} contains inline image data`);
    if (/(?:^|[\s"'=])(?:file:\/\/|content:\/\/|[A-Za-z]:[\\/]|~\/|\.{1,2}\/)/i.test(text) || /^\//.test(text) || /(?:^|[\s"'=])\/(?:[^/\s]+\/)+[^/\s]+/.test(text)) fail(`${path} contains a device file path`);
    return;
  }
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (typeof value !== "object" || ancestors.has(value)) fail(`${path} must contain finite JSON values`);
  ancestors.add(value);
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${path} must be a plain JSON object`);
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key) || /base64|imageData|filePath|localPath|imagePath|localUri/i.test(key)) fail(`${path}.${key} is not allowed in an analysis import`);
    assertSafeJson(child, `${path}.${key}`, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

export function validateLegacyAnalysis(analysis) {
  assertSafeJson(analysis);
  if (Buffer.byteLength(JSON.stringify(analysis)) > 1024 * 1024) fail("analysis exceeds one MiB");
  const required = ["schemaVersion", "model", "domain", "contentKind", "completeness", "title", "place", "summary", "evidence", "ingredientGroups", "steps", "facts", "conflicts", "warnings"];
  record(analysis, "analysis", required, ["filing", "tags"]);
  if (Object.hasOwn(analysis, "filing") === Object.hasOwn(analysis, "tags")) fail("analysis requires exactly one of filing or tags");
  oneOf(analysis.schemaVersion, ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "2.0", "2.1"], "analysis.schemaVersion");
  // Stored-data compatibility is deliberately independent of the current model.
  string(analysis.model, "analysis.model", { max: 512 });
  oneOf(analysis.domain, ["beauty", "food", "unknown"], "analysis.domain");
  oneOf(analysis.contentKind, ["beauty_product", "recipe", "sauce_recipe", "commerce_product", "product_review", "menu_comparison", "place", "unknown"], "analysis.contentKind");
  oneOf(analysis.completeness, ["complete", "partial", "conflicted", "needs_review", "unsupported"], "analysis.completeness");
  string(analysis.summary, "analysis.summary", { empty: true });
  strings(analysis.warnings, "analysis.warnings");
  const references = [];
  const cited = (entry, path, { hasConfidence = true } = {}) => {
    strings(entry.evidenceIds, `${path}.evidenceIds`);
    references.push(...entry.evidenceIds);
    if (hasConfidence) confidence(entry.confidence, `${path}.confidence`);
  };
  record(analysis.title, "title", ["value", "status", "confidence", "evidenceIds"]);
  string(analysis.title.value, "title.value", { nullable: true });
  oneOf(analysis.title.status, ["observed", "inferred", "missing"], "title.status");
  if ((analysis.title.status === "missing") !== (analysis.title.value === null)) fail("title value and status disagree");
  cited(analysis.title, "title");
  if (analysis.place !== null) {
    record(analysis.place, "place", ["name", "address", "category", "confidence", "evidenceIds"], ["searchArea"]);
    for (const key of ["name", "address"]) string(analysis.place[key], `place.${key}`, { nullable: true });
    if (Object.hasOwn(analysis.place, "searchArea")) string(analysis.place.searchArea, "place.searchArea", { nullable: true });
    oneOf(analysis.place.category, [null, "restaurant", "cafe", "beauty", "shopping", "lodging", "activity", "other"], "place.category");
    cited(analysis.place, "place");
  }
  const evidenceIds = new Set();
  list(analysis.evidence, "evidence", (entry, path) => {
    record(entry, path, ["id", "text", "region", "confidence"]);
    string(entry.id, `${path}.id`, { max: 512 }); string(entry.text, `${path}.text`);
    oneOf(entry.region, ["image_text", "caption", "overlay", "product_panel", "menu", "unknown"], `${path}.region`);
    confidence(entry.confidence, `${path}.confidence`);
    if (evidenceIds.has(entry.id)) fail("duplicate legacy evidence ID");
    evidenceIds.add(entry.id);
  });
  list(analysis.ingredientGroups, "ingredientGroups", (group, path) => {
    record(group, path, ["name", "ingredients"]); string(group.name, `${path}.name`);
    list(group.ingredients, `${path}.ingredients`, (entry, entryPath) => {
      record(entry, entryPath, ["name", "amount", "unit", "preparation", "optional", "originalText", "confidence", "evidenceIds"]);
      for (const key of ["name", "originalText"]) string(entry[key], `${entryPath}.${key}`);
      for (const key of ["amount", "unit", "preparation"]) string(entry[key], `${entryPath}.${key}`, { nullable: true });
      if (typeof entry.optional !== "boolean") fail(`${entryPath}.optional must be boolean`);
      cited(entry, entryPath);
    });
  });
  list(analysis.steps, "steps", (entry, path) => {
    record(entry, path, ["order", "instruction", "durationSeconds", "temperature", "evidenceIds"]);
    if (!Number.isSafeInteger(entry.order) || entry.order < 1 || (entry.durationSeconds !== null && (!Number.isSafeInteger(entry.durationSeconds) || entry.durationSeconds < 0))) fail(`${path} has invalid step numbers`);
    string(entry.instruction, `${path}.instruction`); string(entry.temperature, `${path}.temperature`, { nullable: true });
    cited(entry, path, { hasConfidence: false });
  });
  list(analysis.facts, "facts", (entry, path) => {
    record(entry, path, ["label", "value", "confidence", "evidenceIds"]);
    string(entry.label, `${path}.label`); string(entry.value, `${path}.value`); cited(entry, path);
  });
  list(analysis.conflicts, "conflicts", (entry, path) => {
    record(entry, path, ["field", "details", "evidenceIds"]);
    string(entry.field, `${path}.field`); string(entry.details, `${path}.details`); cited(entry, path, { hasConfidence: false });
  });
  if (analysis.filing) {
    record(analysis.filing, "filing", ["fields", "areas", "kinds", "traits"]);
    for (const [key, entries] of Object.entries(analysis.filing)) list(entries, `filing.${key}`, (entry, path) => {
      record(entry, path, ["observations", "value", "confidence", "evidenceIds"]);
      string(entry.value, `${path}.value`); strings(entry.observations, `${path}.observations`); cited(entry, path);
    });
  } else {
    list(analysis.tags, "tags", (entry, path) => {
      record(entry, path, ["value"], ["source", "confidence", "evidenceIds", "quotes", "citations", "facet"]);
      string(entry.value, `${path}.value`);
      if (entry.confidence != null) confidence(entry.confidence, `${path}.confidence`);
      for (const key of ["evidenceIds", "quotes", "citations"]) if (entry[key] !== undefined) strings(entry[key], `${path}.${key}`);
      if (entry.evidenceIds) references.push(...entry.evidenceIds);
      if (entry.source !== undefined) oneOf(entry.source, ["ai", "user", "web"], `${path}.source`);
      if (entry.facet != null) oneOf(entry.facet, ["field", "area", "kind", "trait"], `${path}.facet`);
    });
  }
  if (references.some((id) => !evidenceIds.has(id))) fail("analysis references missing evidence; reviewed imports are never silently repaired");
  return structuredClone(analysis);
}
