import { array, assertUnique, enumeration, object, ref, text } from "./schema.js";
import { artifact, capability, relation, slot, valueRelation } from "./shared.js";

const outfitItem = object({ slot: text, variantId: text,
  ownership: enumeration("owned", "candidate", "unknown"),
  importId: text, color: text, size: text }, ["slot", "variantId", "ownership"]);
const outfit = object({ id: text, occasion: text, items: array(ref("fashion.outfit_item"), 1) });

export const fashionPack = {
  id: "fashion", version: 2, compatibleKernelVersions: [1],
  entityTypes: ["core.product", "core.product_variant", "core.owned_item", "fashion.outfit", "fashion.wear_experience"],
  types: [
    { id: "fashion.outfit_item", schema: outfitItem },
    { id: "fashion.outfit", schema: outfit, validate: (value) => assertUnique(value.items, "slot", "$.items") },
    { id: "fashion.ownership", schema: enumeration("owned", "candidate", "unknown") },
    { id: "fashion.variant_options", schema: object({ color: text, size: text }) },
    { id: "fashion.variant_selection_input", schema: object({ productId: text, variantIds: array(text, 1), occasion: text }) },
    { id: "fashion.variant_selection", schema: object({ productId: text, variantId: text, ownership: ref("fashion.ownership"), reportedBy: text }) },
    { id: "fashion.wear_input", schema: object({ outfitId: text }) },
    { id: "fashion.wear_experience", schema: object({ id: text, outfitId: text, wornAt: ref("core.timestamp"), reportedBy: text, note: text }, ["id", "outfitId", "wornAt", "reportedBy"]) },
    { id: "fashion.capture_candidate", schema: object({ importId: text, name: text,
      mentionId: text, evidenceIds: ref("core.evidence_ids") }) },
    { id: "fashion.confirm_input", schema: object({ occasion: text,
      candidates: array(ref("fashion.capture_candidate"), 1) }) },
    { id: "fashion.confirm_result", schema: object({ outfitId: text,
      outfit: ref("fashion.outfit"), confirmedAt: ref("core.timestamp") }) },
    { id: "fashion.wear_outcome", schema: object({ outfitId: text,
      status: enumeration("worn", "not_worn", "unknown"), reportedAt: ref("core.timestamp") }) },
  ],
  relations: [
    relation("fashion.variant_of", ["core.product_variant"], ["core.product"], "one"),
    valueRelation("fashion.variant_options", ["core.product_variant"], "fashion.variant_options", "explicit_user_confirmation"),
    relation("fashion.has_item", ["fashion.outfit"], ["core.product_variant", "core.owned_item"]),
    relation("fashion.wore_outfit", ["fashion.wear_experience"], ["fashion.outfit"], "one"),
    { ...valueRelation("fashion.ownership", ["core.product_variant"], "fashion.ownership", "explicit_user_observation"), allowedValues: ["owned", "candidate", "unknown"], unknownValues: ["unknown"] },
  ],
  slots: [
    slot("fashion.occasion", "core.text", "Activity-scoped outfit purpose, not a permanent preference"),
    slot("fashion.variant", "core.product_variant", "Exact size and colour variant"),
    slot("fashion.outfit", "fashion.outfit", "Composition preserving owned versus candidate items"),
  ],
  capabilities: [
    capability({ id: "fashion.select_variant", taskKind: "decision", inputType: "fashion.variant_selection_input", outputType: "fashion.variant_selection" }),
    capability({ id: "fashion.compose_outfit", actor: "system", taskKind: "derive", inputType: "fashion.outfit", outputType: "fashion.outfit", inputSlots: { occasion: "fashion.occasion" }, outputSlots: { "$": "fashion.outfit" }, validateInput(input) { assertUnique(input.items, "slot", "$.items"); }, validateOutput(output) { assertUnique(output.items, "slot", "$.items"); }, run: (input) => input }),
    capability({ id: "fashion.record_wear", taskKind: "observe", inputType: "fashion.wear_input", outputType: "fashion.wear_experience" }),
    capability({ id: "fashion.confirm_outfit", taskKind: "decision", inputType: "fashion.confirm_input",
      outputType: "fashion.confirm_result" }),
    capability({ id: "fashion.record_wear_outcome", taskKind: "observe", inputType: "fashion.wear_input",
      outputType: "fashion.wear_outcome" }),
  ],
  artifacts: [artifact("fashion.outfit", "fashion.outfit", "fashion.outfit")],
};
