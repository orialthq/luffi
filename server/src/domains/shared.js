import { array, enumeration, integer, nonnegative, object, positive, ref, text } from "./schema.js";

const unit = enumeration("g", "kg", "ml", "l", "count", "tsp", "tbsp");
const quantity = (amount) => ({ oneOf: [
  object({ status: enumeration("known"), amount, unit }),
  object({ status: enumeration("unknown") }),
  object({ status: enumeration("as_needed") }),
] });

export const CORE_TYPES = [
  { id: "core.id", schema: text },
  { id: "core.text", schema: text },
  { id: "core.positive_number", schema: positive },
  { id: "core.revision", schema: integer },
  { id: "core.timestamp", schema: { ...text, format: "date-time" } },
  { id: "core.quantity", schema: quantity(nonnegative) },
  { id: "core.ingredient_quantity", schema: quantity(positive) },
  { id: "core.entity_ref", schema: object({ id: text, type: text }) },
  { id: "core.evidence_ids", schema: array(text, 1) },
  { id: "core.product", schema: object({ id: text, name: text, brand: text }, ["id", "name"]) },
  { id: "core.product_variant", schema: object({
    id: text, productId: text, label: text,
    size: text, color: text, volume: ref("core.quantity"),
  }, ["id", "productId", "label"]) },
  { id: "core.owned_item", schema: object({ id: text, variantId: text, observedAt: ref("core.timestamp") }) },
];

export function capability({ id, inputType, outputType, actor = "user", taskKind = "action", effect = "none", inputSlots = {}, outputSlots = {}, completion, run, validateInput, validateOutput }) {
  return {
    id, version: 1, inputType, outputType, actor,
    taskKind: ({ derive: "action", observe: "observation" })[taskKind] ?? taskKind, effect,
    inputSlots, outputSlots, preconditions: ["validated_inputs"],
    completion: completion ?? (actor === "user" ? "user_reported_result" : "validated_output"),
    retryPolicy: effect === "external_write" ? "reconcile_before_retry" : (actor === "user" ? "none" : "safe_to_retry"),
    ...(run ? { run } : {}), ...(validateInput ? { validateInput } : {}), ...(validateOutput ? { validateOutput } : {}),
  };
}

export const relation = (id, subjectTypes, objectTypes, cardinality = "many") => ({
  id, subjectTypes, objectTypes, cardinality: cardinality === "one" ? "single" : cardinality,
  temporalSemantics: "valid_interval", resolution: { strategy: "consensus", version: "1" },
});
export const valueRelation = (id, subjectTypes, valueType, resolutionPolicy = "evidence_required") => ({
  id, subjectTypes, valueType, cardinality: "single", temporalSemantics: "valid_interval",
  resolution: { strategy: resolutionPolicy === "explicit_user_observation" ? "latest_observation" : "consensus", version: "1" },
});
export const artifact = (id, payloadType, rendererKey) => ({ id, version: 1, payloadType, rendererKey, rendererVersion: 1 });
export const slot = (id, type, description) => ({ id, type, description });
