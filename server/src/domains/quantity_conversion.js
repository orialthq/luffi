import { fail } from "./schema.js";

const units = { g: ["mass", 1], kg: ["mass", 1000],
  ml: ["volume", 1], l: ["volume", 1000], count: ["count", 1],
  tsp: ["tsp", 1], tbsp: ["tbsp", 1] };

export const QUANTITY_UNITS = Object.freeze(Object.keys(units));

export function roundedQuantity(value) {
  if (!Number.isFinite(value)) fail("calculated quantity exceeds the supported numeric range");
  return Number(value.toPrecision(12));
}

// Conversions are limited to known dimensions. Ingredient density and spoon
// equivalences are never inferred from a recipe or product title.
export function convertQuantity(amount, from, to) {
  if (units[from][0] !== units[to][0]) return null;
  return roundedQuantity(amount * units[from][1] / units[to][1]);
}
