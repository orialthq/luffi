import assert from "node:assert/strict";
import test from "node:test";
import { calculateBasketCoverage, calculateShoppingCoverage,
  compareBasketWithRecipeNeeds } from "../src/domains/shopping.js";

test("confirmed package count covers only the known missing amount", () => {
  const missing = { status: "known", amount: 500, unit: "g" };
  assert.deepEqual(calculateShoppingCoverage(missing,
    { status: "known", amount: 0.3, unit: "kg" }, 1), {
    status: "insufficient", neededQuantity: missing,
    selectedQuantity: { status: "known", amount: 300, unit: "g" },
    shortfall: { status: "known", amount: 200, unit: "g" },
  });
  assert.deepEqual(calculateShoppingCoverage(missing,
    { status: "known", amount: 0.3, unit: "kg" }, 2), {
    status: "sufficient", neededQuantity: missing,
    selectedQuantity: { status: "known", amount: 600, unit: "g" },
    shortfall: { status: "known", amount: 0, unit: "g" },
  });
});

test("coverage preserves unknown needs and incompatible units", () => {
  const packageQuantity = { status: "known", amount: 300, unit: "g" };
  assert.deepEqual(calculateShoppingCoverage({ status: "unknown" },
    packageQuantity, 2), { status: "unknown_need" });
  assert.deepEqual(calculateShoppingCoverage({ status: "as_needed" },
    packageQuantity, 2), { status: "unknown_need" });
  assert.deepEqual(calculateShoppingCoverage({ status: "known", amount: 300,
    unit: "ml" }, packageQuantity, 2), { status: "incompatible_unit" });
  assert.deepEqual(calculateShoppingCoverage({ status: "known", amount: 1,
    unit: "tbsp" }, { status: "known", amount: 3, unit: "tsp" }, 1),
  { status: "incompatible_unit" });
  assert.deepEqual(calculateShoppingCoverage({ status: "known", amount: 300,
    unit: "g" }, { status: "unknown" }, 2), { status: "unknown_package" });
});

test("two different products can jointly cover one ingredient", () => {
  const missing = { status: "known", amount: 500, unit: "g" };
  const choices = [
    { quantity: 1, packageQuantity: { status: "known", amount: 250, unit: "g" } },
    { quantity: 1, packageQuantity: { status: "known", amount: 0.3, unit: "kg" } },
  ];
  assert.deepEqual(calculateBasketCoverage(missing, choices), {
    status: "sufficient", neededQuantity: missing,
    selectedQuantity: { status: "known", amount: 550, unit: "g" },
    shortfall: { status: "known", amount: 0, unit: "g" },
  });
  assert.deepEqual(calculateBasketCoverage(missing, []), { status: "unselected" });
});

test("basket review recomputes changed lines without rewriting historical choices", () => {
  const old = { status: "known", amount: 500, unit: "g" };
  const basket = { lines: [{ ingredientId: "tofu", name: "두부",
    missingQuantity: old, coverage: { status: "insufficient" },
    choices: [{ quantity: 1, packageQuantity: { status: "known",
      amount: 300, unit: "g" } }] },
  { ingredientId: "egg", name: "달걀", missingQuantity: { status: "unknown" },
    coverage: { status: "unselected" }, choices: [] }] };
  const review = compareBasketWithRecipeNeeds(basket, { items: [
    { ingredientId: "tofu", name: "두부",
      missingQuantity: { status: "known", amount: 200, unit: "g" } },
    { ingredientId: "salt", name: "소금", missingQuantity: { status: "as_needed" } },
  ] });
  assert.deepEqual(review.map((item) => [item.ingredientId, item.change]), [
    ["tofu", "changed"], ["egg", "removed"], ["salt", "added"],
  ]);
  assert.equal(review[0].current.coverage.status, "sufficient");
  assert.deepEqual(basket.lines[0].missingQuantity, old);
});
