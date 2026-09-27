import assert from "node:assert/strict";
import test from "node:test";
import { calculateShoppingCoverage } from "../src/domains/shopping.js";

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
