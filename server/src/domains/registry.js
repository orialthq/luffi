import { isDeepStrictEqual } from "node:util";
import { DomainContractError, fail, validateSchema } from "./schema.js";
import { CORE_TYPES } from "./shared.js";

function frozenCopy(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenCopy(item)])));
}

function invalid(message) {
  throw new DomainContractError("INVALID_DOMAIN_PACK", message);
}

function index(entries, kind) {
  const result = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(entry.id)) invalid(`${kind} needs a namespaced id`);
    if (result.has(entry.id)) invalid(`duplicate ${kind}: ${entry.id}`);
    result.set(entry.id, entry);
  }
  return result;
}

function lookup(map, id, kind) {
  const value = map.get(id);
  if (!value) throw new DomainContractError("UNKNOWN_DOMAIN_CONTRACT", `unknown ${kind}: ${id}`);
  return value;
}

/** No domain-specific branches live here. Packs provide contracts and pure rules. */
export function createDomainRegistry(packs) {
  if (!Array.isArray(packs)) invalid("packs must be an array");
  const owned = frozenCopy(packs);
  const packIndex = index(owned, "pack");
  for (const pack of owned) {
    if (!Number.isInteger(pack.version) || pack.version < 1 || !pack.compatibleKernelVersions?.includes(1)) invalid(`incompatible pack: ${pack.id}`);
    for (const key of ["types", "entityTypes", "relations", "capabilities", "slots", "artifacts"]) if (!Array.isArray(pack[key])) invalid(`${pack.id}.${key} must be an array`);
  }
  const flatten = (key) => owned.flatMap((pack) => pack[key]);
  const types = index([...frozenCopy(CORE_TYPES), ...flatten("types")], "type");
  const relations = index(flatten("relations"), "relation");
  const capabilities = index(flatten("capabilities"), "capability");
  const slots = index(flatten("slots"), "slot");
  const artifacts = index(flatten("artifacts"), "artifact");
  const getType = (id) => lookup(types, id, "type");
  const getCapability = (id) => lookup(capabilities, id, "capability");
  const requireType = (id) => { if (!types.has(id)) invalid(`unknown type reference: ${id}`); };

  function checkSchema(schema, references = new Set()) {
    if (!schema || typeof schema !== "object") invalid("schema must be an object");
    if (schema.$ref) {
      requireType(schema.$ref);
      if (references.has(schema.$ref)) invalid(`recursive type reference: ${schema.$ref}`);
      checkSchema(getType(schema.$ref).schema, new Set([...references, schema.$ref]));
    } else if (schema.oneOf) {
      if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2) invalid("oneOf requires at least two schemas");
      schema.oneOf.forEach((item) => checkSchema(item, references));
    } else if (schema.enum) {
      if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.some((item) => typeof item !== "string")) invalid("enum must contain strings");
    } else if (schema.type === "object") {
      if (!schema.properties || schema.additionalProperties !== false) invalid("object schemas must reject unknown properties");
      if (!Array.isArray(schema.required) || schema.required.some((key) => !Object.hasOwn(schema.properties, key))) invalid("required fields must exist in properties");
      Object.values(schema.properties).forEach((item) => checkSchema(item, references));
    } else if (schema.type === "array") checkSchema(schema.items, references);
    else if (!["string", "number", "integer", "boolean"].includes(schema.type)) invalid(`unsupported schema type: ${schema.type}`);
  }
  for (const type of types.values()) {
    checkSchema(type.schema, new Set([type.id]));
    if (type.validate !== undefined && typeof type.validate !== "function") invalid(`invalid type validator: ${type.id}`);
  }
  for (const pack of owned) pack.entityTypes.forEach(requireType);
  for (const item of slots.values()) requireType(item.type);
  for (const item of relations.values()) {
    if (!Array.isArray(item.subjectTypes) || item.subjectTypes.length === 0) invalid(`relation ${item.id} needs subject types`);
    item.subjectTypes.forEach(requireType);
    if (Boolean(item.objectTypes) === Boolean(item.valueType)) invalid(`relation ${item.id} needs objectTypes or valueType, exclusively`);
    if (item.objectTypes) {
      if (!Array.isArray(item.objectTypes) || !item.objectTypes.length) invalid(`relation ${item.id} needs object types`);
      item.objectTypes.forEach(requireType);
    } else requireType(item.valueType);
    if (!["single", "many"].includes(item.cardinality) || !["consensus", "latest_observation"].includes(item.resolution?.strategy) || typeof item.resolution.version !== "string") invalid(`invalid relation policy: ${item.id}`);
  }
  for (const item of capabilities.values()) {
    requireType(item.inputType); requireType(item.outputType);
    if (item.version !== 1 || !["user", "system"].includes(item.actor) || !["observation", "decision", "action", "wait", "milestone"].includes(item.taskKind) || !["none", "external_read", "external_write"].includes(item.effect)) invalid(`invalid capability: ${item.id}`);
    if (!Array.isArray(item.preconditions) || typeof item.completion !== "string" || !item.completion || !["none", "safe_to_retry", "reconcile_before_retry"].includes(item.retryPolicy)) invalid(`incomplete task contract: ${item.id}`);
    for (const key of ["validateInput", "validateOutput"]) if (item[key] !== undefined && typeof item[key] !== "function") invalid(`invalid capability validator: ${item.id}.${key}`);
    if (item.run && (typeof item.run !== "function" || item.actor !== "system" || item.effect !== "none")) invalid(`only pure system capabilities can register a run function: ${item.id}`);
    for (const [direction, typeId] of [["inputSlots", item.inputType], ["outputSlots", item.outputType]]) {
      for (const [field, slotId] of Object.entries(item[direction] ?? {})) {
        const spec = slots.get(slotId);
        if (!spec) invalid(`unknown slot: ${slotId}`);
        const fieldType = field === "$" ? typeId : getType(typeId).schema.properties?.[field]?.$ref;
        if (field !== "$" && !getType(typeId).schema.properties?.[field]) invalid(`unknown slot field: ${item.id}.${field}`);
        if (fieldType && fieldType !== spec.type) invalid(`slot type mismatch: ${item.id}.${field}`);
        if (!fieldType && !isDeepStrictEqual(getType(typeId).schema.properties[field], getType(spec.type).schema)) invalid(`inline slot type mismatch: ${item.id}.${field}`);
      }
    }
  }
  const renderers = new Map();
  for (const item of artifacts.values()) {
    requireType(item.payloadType);
    if (item.version !== 1 || item.rendererVersion !== 1 || typeof item.rendererKey !== "string" || !item.rendererKey) invalid(`invalid artifact: ${item.id}`);
    const renderer = renderers.get(item.rendererKey);
    if (renderer && renderer.payloadType !== item.payloadType) invalid(`renderer has incompatible payload types: ${item.rendererKey}`);
    renderers.set(item.rendererKey, frozenCopy({ id: item.rendererKey, key: item.rendererKey, version: item.rendererVersion, payloadType: item.payloadType }));
  }

  const validate = (typeId, value) => {
    const type = getType(typeId);
    validateSchema(type.schema, value, getType); type.validate?.(value);
    return value;
  };
  const validateCapabilityInput = (id, input) => {
    const spec = getCapability(id);
    validate(spec.inputType, input); spec.validateInput?.(input);
    return input;
  };
  const validateCapabilityOutput = (id, output) => {
    const spec = getCapability(id);
    validate(spec.outputType, output); spec.validateOutput?.(output);
    return output;
  };
  return Object.freeze({
    listPacks: () => [...packIndex.values()], getPack: (id) => lookup(packIndex, id, "pack"),
    listTypes: () => [...types.values()], getType,
    listRelations: () => [...relations.values()], getRelation: (id) => lookup(relations, id, "relation"),
    listCapabilities: () => [...capabilities.values()], getCapability,
    listSlots: () => [...slots.values()], getSlot: (id) => lookup(slots, id, "slot"),
    listArtifacts: () => [...artifacts.values()], getArtifact: (id) => lookup(artifacts, id, "artifact"),
    listRenderers: () => [...renderers.values()], getRenderer: (id) => lookup(renderers, id, "renderer"),
    validate, validateCapabilityInput, validateCapabilityOutput,
    validateSlot(id, value) { return validate(lookup(slots, id, "slot").type, value); },
    validateArtifact(id, value) { return validate(lookup(artifacts, id, "artifact").payloadType, value); },
    validateRelation(assertion) {
      const spec = lookup(relations, assertion.predicate, "relation");
      if (!spec.subjectTypes.includes(assertion.subjectType)) fail("subject type is not allowed", "$.subjectType");
      if (spec.objectTypes) {
        if (Object.hasOwn(assertion, "value") || !spec.objectTypes.includes(assertion.objectType)) fail("requires an allowed object type, not a scalar value", "$.objectType");
      } else {
        if (Object.hasOwn(assertion, "objectType")) fail("requires a scalar value, not an object type", "$.value");
        validate(spec.valueType, assertion.value);
      }
      return assertion;
    },
    execute(id, input) {
      const spec = getCapability(id);
      validateCapabilityInput(id, input);
      if (!spec.run) throw new DomainContractError("DOMAIN_EXECUTION_UNAVAILABLE", `capability requires its declared actor or an external adapter: ${id}`);
      const output = spec.run(structuredClone(input));
      validateCapabilityOutput(id, output);
      return structuredClone(output);
    },
  });
}
