import { createHash } from "node:crypto";
import { AppError } from "../errors.js";

export class KnowledgeError extends AppError {
  constructor(code, message) {
    const httpStatus = code === "KNOWLEDGE_NOT_FOUND" ? 404 :
      ["KNOWLEDGE_ID_EXISTS", "KNOWLEDGE_COMMAND_CONFLICT", "KNOWLEDGE_REVISION_CONFLICT"].includes(code) ? 409 :
        code === "INVALID_KNOWLEDGE_STATE" ? 500 :
          ["PREDICATE_TYPE_MISMATCH", "INVALID_ASSERTION", "INVALID_CORRECTION", "INVALID_EVIDENCE"].includes(code) ? 422 : 400;
    super(code, message, { httpStatus });
    this.name = "KnowledgeError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new KnowledgeError(code, message);
}

export function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_KNOWLEDGE_INPUT", `${name} must be an object`);
  }
  return value;
}

export function string(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    fail("INVALID_KNOWLEDGE_INPUT", `${name} must be a nonempty string of at most 512 characters`);
  }
  return value;
}

export function strings(value, name, { nonempty = false } = {}) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) {
    fail("INVALID_KNOWLEDGE_INPUT", `${name} must be an array`);
  }
  return [...new Set(value.map((item) => string(item, name)))];
}

export function scope(value) {
  object(value, "scope");
  return { type: string(value.type, "scope.type"), id: string(value.id, "scope.id") };
}

export function date(value, name, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  // An explicit timezone is required; machine-local parsing must not change a fact.
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    fail("INVALID_KNOWLEDGE_INPUT", `${name} must be an ISO timestamp with timezone`);
  }
  return new Date(value).toISOString();
}

export function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  return date(value instanceof Date ? value.toISOString() : value ?? new Date().toISOString(), "now");
}

export function json(value, name = "value", ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value)) {
    fail("INVALID_KNOWLEDGE_INPUT", `${name} must contain only finite JSON values`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => json(item, name, ancestors));
    object(value, name);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item, name, ancestors)]));
  } finally {
    ancestors.delete(value);
  }
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(value) {
  return createHash("sha256").update(stableJson(json(value))).digest("hex");
}

export function sameScope(a, b) {
  return a?.type === b?.type && a?.id === b?.id;
}

export function definition(predicates, id) {
  const registry = predicates?.predicates ?? predicates;
  const value = typeof registry?.getRelation === "function" ? registry.getRelation(id) : Array.isArray(registry)
    ? registry.find((item) => item.id === id)
    : registry instanceof Map ? registry.get(id) :
      registry && Object.hasOwn(registry, id) ? registry[id] : null;
  if (!value) fail("UNKNOWN_PREDICATE", `Predicate is not registered: ${id}`);
  const result = json(value, "predicate definition");
  if (result.id != null && result.id !== id) fail("INVALID_PREDICATE", "Predicate id does not match its registry key");
  result.id = id;
  result.cardinality ??= "single";
  if (!["single", "many"].includes(result.cardinality)) fail("INVALID_PREDICATE", "Unknown cardinality");
  result.resolution ??= {};
  result.resolution.strategy ??= "consensus";
  result.resolution.version ??= "1";
  if (!["consensus", "latest_observation"].includes(result.resolution.strategy)) {
    fail("INVALID_PREDICATE", "Unknown resolution strategy");
  }
  for (const field of ["subjectTypes", "objectTypes"]) {
    if (result[field] != null) result[field] = strings(result[field], field, { nonempty: true });
  }
  if (result.valueType != null) string(result.valueType, "predicate.valueType");
  if (result.allowedValues != null && !Array.isArray(result.allowedValues)) fail("INVALID_PREDICATE", "allowedValues must be an array");
  if (result.unknownValues != null && !Array.isArray(result.unknownValues)) fail("INVALID_PREDICATE", "unknownValues must be an array");
  if (result.resolution.originPriority != null) {
    result.resolution.originPriority = strings(result.resolution.originPriority, "originPriority");
  }
  if (result.resolution.maxAgeMs != null &&
      (!Number.isSafeInteger(result.resolution.maxAgeMs) || result.resolution.maxAgeMs <= 0)) {
    fail("INVALID_PREDICATE", "maxAgeMs must be a positive integer");
  }
  return result;
}
