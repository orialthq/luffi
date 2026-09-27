import { array, enumeration, fail, integer, object, ref, text } from "./schema.js";
import { artifact, capability, relation, valueRelation } from "./shared.js";
import { convertQuantity, QUANTITY_UNITS, roundedQuantity } from "./quantity_conversion.js";

const singleChoice = object({ id: text, productId: text, offerId: text,
  importId: text, title: text, quantity: ref("shopping.quantity_count"),
  displayedPriceText: text, ingredientMatch: ref("shopping.ingredient_match_result"),
  packageQuantity: ref("shopping.package_quantity"),
  packageEvidenceIds: ref("core.evidence_ids"),
  recipeCoverage: ref("shopping.recipe_coverage") },
  ["id", "productId", "offerId", "importId", "title", "quantity", "displayedPriceText"]);

const basketLine = object({ ingredientId: text, name: text,
  requiredQuantity: ref("core.quantity"),
  availableQuantity: ref("core.quantity"),
  missingQuantity: ref("core.quantity"),
  choices: array(ref("shopping.single_choice")),
  coverage: ref("shopping.recipe_coverage") },
  ["ingredientId", "name", "missingQuantity", "choices", "coverage"]);
const basketChoice = object({ id: text, kind: enumeration("basket"),
  sourceResultId: text, lines: array(ref("shopping.basket_line"), 1) });

export function calculateShoppingCoverage(missingQuantity, packageQuantity, count) {
  if (packageQuantity.status === "unknown") return { status: "unknown_package" };
  if (missingQuantity.status !== "known") return { status: "unknown_need" };
  const selectedAmount = convertQuantity(packageQuantity.amount * count,
    packageQuantity.unit, missingQuantity.unit);
  if (selectedAmount === null) return { status: "incompatible_unit" };
  const selectedQuantity = { status: "known", amount: selectedAmount,
    unit: missingQuantity.unit };
  const shortfall = { status: "known",
    amount: roundedQuantity(Math.max(0, missingQuantity.amount - selectedAmount)),
    unit: missingQuantity.unit };
  return { status: shortfall.amount === 0 ? "sufficient" : "insufficient",
    neededQuantity: missingQuantity, selectedQuantity, shortfall };
}

export function calculateBasketCoverage(missingQuantity, choices) {
  if (choices.length === 0) return { status: "unselected" };
  if (choices.some((choice) => choice.packageQuantity.status === "unknown")) {
    return { status: "unknown_package" };
  }
  if (missingQuantity.status !== "known") return { status: "unknown_need" };
  const amounts = choices.map((choice) => convertQuantity(
    choice.packageQuantity.amount * choice.quantity,
    choice.packageQuantity.unit, missingQuantity.unit));
  if (amounts.includes(null)) return { status: "incompatible_unit" };
  const amount = roundedQuantity(amounts.reduce((sum, value) => sum + value, 0));
  const shortfall = roundedQuantity(Math.max(0, missingQuantity.amount - amount));
  return { status: shortfall === 0 ? "sufficient" : "insufficient",
    neededQuantity: missingQuantity,
    selectedQuantity: { status: "known", amount, unit: missingQuantity.unit },
    shortfall: { status: "known", amount: shortfall, unit: missingQuantity.unit } };
}

export function compareBasketWithRecipeNeeds(basket, needs) {
  const previous = new Map(basket.lines.map((line) => [line.ingredientId, line]));
  const current = new Map(needs.items.map((item) => [item.ingredientId, item]));
  return [...new Set([...previous.keys(), ...current.keys()])].map((ingredientId) => {
    const before = previous.get(ingredientId);
    const after = current.get(ingredientId);
    const change = !before ? "added" : !after ? "removed" :
      before.name !== after.name ||
        JSON.stringify(before.requiredQuantity) !== JSON.stringify(after.requiredQuantity) ||
        JSON.stringify(before.availableQuantity) !== JSON.stringify(after.availableQuantity) ||
        JSON.stringify(before.missingQuantity) !== JSON.stringify(after.missingQuantity)
        ? "changed" : "unchanged";
    return { ingredientId, change,
      ...(before ? { previous: { name: before.name,
        ...(before.requiredQuantity ? { requiredQuantity: before.requiredQuantity } : {}),
        ...(before.availableQuantity ? { availableQuantity: before.availableQuantity } : {}),
        missingQuantity: before.missingQuantity,
        coverage: before.coverage, choiceCount: before.choices.length } } : {}),
      ...(after ? { current: { name: after.name,
        requiredQuantity: after.requiredQuantity,
        availableQuantity: after.availableQuantity,
        missingQuantity: after.missingQuantity,
        coverage: calculateBasketCoverage(after.missingQuantity,
          before?.choices ?? []) } } : {}) };
  });
}

export const shoppingPack = {
  id: "shopping", version: 2, compatibleKernelVersions: [1],
  entityTypes: ["core.product", "shopping.offer_snapshot", "shopping.purchase_choice",
    "shopping.purchase_report"],
  types: [
    { id: "shopping.quantity_count", schema: integer,
      validate: (value) => { if (value > 20) fail("quantity exceeds 20"); } },
    { id: "shopping.krw_amount", schema: integer,
      validate: (value) => { if (value > 1_000_000_000) fail("amount exceeds limit"); } },
    { id: "shopping.offer_snapshot", schema: object({ id: text,
      title: text, displayedPriceText: text }) },
    { id: "shopping.single_choice", schema: singleChoice },
    { id: "shopping.basket_line", schema: basketLine },
    { id: "shopping.purchase_choice", schema: { oneOf: [singleChoice, basketChoice] } },
    { id: "shopping.package_quantity", schema: { oneOf: [
      object({ status: enumeration("unknown") }),
      object({ status: enumeration("known"), amount: { type: "number",
        exclusiveMinimum: 0 }, unit: enumeration(...QUANTITY_UNITS) }),
    ] }, validate: (value) => {
      if (value.status === "known" && value.amount > 1_000_000_000) {
        fail("package amount exceeds limit");
      }
    } },
    { id: "shopping.recipe_coverage", schema: { oneOf: [
      object({ status: enumeration("unknown_package") }),
      object({ status: enumeration("unknown_need") }),
      object({ status: enumeration("incompatible_unit") }),
      object({ status: enumeration("unselected") }),
      object({ status: enumeration("sufficient", "insufficient"),
        neededQuantity: ref("core.quantity"), selectedQuantity: ref("core.quantity"),
        shortfall: ref("core.quantity") }),
    ] } },
    { id: "shopping.ingredient_match_result", schema: { oneOf: [
      object({ status: enumeration("unverified") }),
      object({ status: enumeration("matched"), ingredientId: text,
        sourceResultId: text }),
    ] } },
    { id: "shopping.purchase_report", schema: object({ id: text,
      choiceId: text, actualPaidKrw: ref("shopping.krw_amount"),
      reportedAt: ref("core.timestamp") }) },
    { id: "shopping.capture_detail", schema: object({ label: text,
      value: text, evidenceIds: ref("core.evidence_ids") }) },
    { id: "shopping.capture_candidate", schema: object({ importId: text,
      title: text, displayedPriceText: text, mentionId: text,
      titleEvidenceIds: ref("core.evidence_ids"),
      priceEvidenceIds: ref("core.evidence_ids"),
      details: array(ref("shopping.capture_detail")) }) },
    { id: "shopping.linked_recipe_needs", schema: object({
      connectionId: text, sourceActivityId: text, sourceResultId: text,
      recipeId: text, recipeRevision: ref("core.revision"),
    }) },
    { id: "shopping.confirm_input", schema: object({ purpose: text,
      candidates: array(ref("shopping.capture_candidate"), 1),
      linkedRecipe: ref("shopping.linked_recipe_needs") },
    ["purpose", "candidates"]) },
    { id: "shopping.confirm_result", schema: object({ choice: ref("shopping.purchase_choice"),
      confirmedAt: ref("core.timestamp") }) },
    { id: "shopping.outcome_input", schema: object({
      choice: ref("shopping.purchase_choice") }) },
    { id: "shopping.purchase_outcome", schema: object({ choiceId: text,
      status: enumeration("purchased", "not_purchased", "unknown"),
      actualPaidKrw: ref("shopping.krw_amount"),
      reportedAt: ref("core.timestamp") },
      ["choiceId", "status", "reportedAt"]),
      validate: (value) => {
        if ((value.status === "purchased") !==
            Object.hasOwn(value, "actualPaidKrw")) {
          fail("actual paid amount is required only for a reported purchase");
        }
      } },
    { id: "shopping.basket_outcome", schema: object({ basketId: text,
      outcomes: array(ref("shopping.purchase_outcome"), 1),
      reportedAt: ref("core.timestamp") }) },
    { id: "shopping.outcome_result", schema: { oneOf: [
      ref("shopping.purchase_outcome"), ref("shopping.basket_outcome"),
    ] } },
  ],
  relations: [
    relation("shopping.offer_of_product", ["shopping.offer_snapshot"],
      ["core.product"], "one"),
    { ...valueRelation("shopping.displayed_price", ["shopping.offer_snapshot"],
      "core.text"), temporalSemantics: "source_snapshot_only" },
    relation("shopping.choice_product", ["shopping.purchase_choice"],
      ["core.product"], "one"),
    relation("shopping.choice_offer", ["shopping.purchase_choice"],
      ["shopping.offer_snapshot"], "one"),
    relation("shopping.choice_supersedes_choice", ["shopping.purchase_choice"],
      ["shopping.purchase_choice"], "one"),
    relation("shopping.basket_contains_choice", ["shopping.purchase_choice"],
      ["shopping.purchase_choice"]),
    relation("shopping.choice_matches_ingredient", ["shopping.purchase_choice"],
      ["recipe.ingredient"], "one"),
    valueRelation("shopping.quantity", ["shopping.purchase_choice"],
      "shopping.quantity_count", "explicit_user_confirmation"),
    valueRelation("shopping.package_quantity", ["shopping.purchase_choice"],
      "shopping.package_quantity", "explicit_user_confirmation"),
    relation("shopping.purchase_for_choice", ["shopping.purchase_report"],
      ["shopping.purchase_choice"], "one"),
    relation("shopping.inventory_after_choice", ["recipe.inventory_observation"],
      ["shopping.purchase_choice"]),
    valueRelation("shopping.actual_paid_krw", ["shopping.purchase_report"],
      "shopping.krw_amount", "explicit_user_observation"),
  ],
  capabilities: [
    capability({ id: "shopping.confirm_choice", taskKind: "decision",
      inputType: "shopping.confirm_input", outputType: "shopping.confirm_result" }),
    capability({ id: "shopping.record_purchase_outcome", taskKind: "observe",
      inputType: "shopping.outcome_input", outputType: "shopping.outcome_result" }),
  ],
  slots: [],
  artifacts: [artifact("shopping.purchase_choice", "shopping.purchase_choice",
    "shopping.choice")],
};
