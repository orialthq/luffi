import assert from "node:assert/strict";
import test from "node:test";
import { domainRegistry as registry, DomainContractError } from "../src/domains/index.js";

const known = (amount, unit) => ({ status: "known", amount, unit });
const ingredient = (id, ingredientId, amount, unit = "g", extra = {}) => ({ id, ingredientId, name: ingredientId, quantity: known(amount, unit), scaling: "linear", ...extra });
const recipe = (ingredients) => ({ id: "recipe-1", revision: 4, title: "Tofu bowl", baseServings: 2, ingredients });
const inventory = (ingredientId, amount, unit = "g") => ({ ingredientId, quantity: known(amount, unit), observedAt: "2026-09-25T10:00:00+09:00" });
const calculate = (source, stock = [], extra = {}) => registry.execute("recipe.calculate_requirements", { recipe: source, targetServings: 4, inventory: stock, ...extra });
const rejects = (run) => assert.throws(run, (error) => error instanceof DomainContractError && error.code === "INVALID_DOMAIN_VALUE");

test("servings change scales linear ingredients, preserving fixed and unknown quantities", () => {
  const source = recipe([
    ingredient("tofu-line", "tofu", 300),
    ingredient("oil-line", "oil", 10, "ml", { scaling: "fixed" }),
    ingredient("pepper-line", "pepper", 1, "g", { quantity: { status: "as_needed" } }),
    ingredient("sauce-line", "sauce", 1, "g", { quantity: { status: "unknown" } }),
  ]);
  const before = structuredClone(source);
  const output = registry.execute("recipe.scale_servings", { recipe: source, targetServings: 4 });
  assert.equal(output.ingredients[0].quantity.amount, 600);
  assert.equal(output.ingredients[1].quantity.amount, 10);
  assert.deepEqual(output.ingredients[2].quantity, { status: "as_needed" });
  assert.deepEqual(output.ingredients[3].quantity, { status: "unknown" });
  assert.equal(output.recipeRevision, 4);
  assert.deepEqual(source, before);
});

test("after a previous purchase, increased servings yield only the additional shortage", () => {
  const source = recipe([ingredient("tofu-line", "tofu", 300)]);
  const purchased = inventory("tofu", 0.3, "kg");
  const output = calculate(source, [purchased]);
  assert.deepEqual(output.items[0].requiredQuantity, known(600, "g"));
  assert.deepEqual(output.items[0].missingQuantity, known(300, "g"));
  assert.equal(output.items[0].status, "needed");
  assert.deepEqual(purchased.quantity, known(0.3, "kg"));
  assert.equal(registry.validateArtifact("recipe.shopping_list", output), output);
});

test("repeated ingredient lines aggregate before applying inventory once", () => {
  const output = calculate(recipe([ingredient("sauce", "sugar", 100), ingredient("topping", "sugar", 50)]), [inventory("sugar", 100)]);
  assert.equal(output.items.length, 1);
  assert.deepEqual(output.items[0].requirementIds, ["sauce", "topping"]);
  assert.deepEqual(output.items[0].missingQuantity, known(200, "g"));
});

test("missing observations stay unknown; explicit zero stock creates a known shortage", () => {
  const source = recipe([ingredient("line", "tofu", 300)]);
  const missing = calculate(source).items[0];
  assert.equal(missing.status, "unknown");
  assert.deepEqual(missing.missingQuantity, { status: "unknown" });
  const absent = calculate(source, [inventory("tofu", 0)]).items[0];
  assert.equal(absent.status, "needed");
  assert.deepEqual(absent.missingQuantity, known(600, "g"));
});

test("no density or spoon conversion is guessed across incompatible units", () => {
  const output = calculate(recipe([ingredient("line", "oil", 50, "g")]), [inventory("oil", 100, "ml")]);
  assert.equal(output.items[0].status, "incompatible_unit");
  assert.deepEqual(output.items[0].missingQuantity, { status: "unknown" });
  const spoons = calculate(recipe([ingredient("line", "oil", 2, "tsp")]), [inventory("oil", 1, "tbsp")]);
  assert.equal(spoons.items[0].status, "incompatible_unit");
});

test("enough stock never produces a negative purchase amount", () => {
  const output = calculate(recipe([ingredient("line", "tofu", 100)]), [inventory("tofu", 1, "kg")]);
  assert.equal(output.items[0].status, "satisfied");
  assert.deepEqual(output.items[0].missingQuantity, known(0, "g"));
});

test("optional ingredients require explicit selection by requirement ID", () => {
  const source = recipe([ingredient("base", "tofu", 100), ingredient("garnish", "sesame", 10, "g", { optional: true })]);
  assert.equal(calculate(source).items.length, 1);
  assert.equal(calculate(source, [], { includeOptionalIngredientIds: ["garnish"] }).items.length, 2);
  rejects(() => calculate(source, [], { includeOptionalIngredientIds: ["sesame"] }));
  rejects(() => calculate(source, [], { includeOptionalIngredientIds: ["garnish", "garnish"] }));
});

test("ambiguous duplicate observations and ingredient requirement IDs are rejected", () => {
  const source = recipe([ingredient("line", "tofu", 100)]);
  rejects(() => calculate(source, [inventory("tofu", 100), inventory("tofu", 200)]));
  rejects(() => calculate(recipe([ingredient("line", "tofu", 100), ingredient("line", "sugar", 10)])));
  rejects(() => calculate(source, [], { targetServings: 0 }));
});

test("fractional counts remain fractional and calculation overflow is rejected", () => {
  const source = recipe([ingredient("egg-line", "egg", 1, "count")]);
  const output = registry.execute("recipe.scale_servings", { recipe: source, targetServings: 1 });
  assert.deepEqual(output.ingredients[0].quantity, known(0.5, "count"));
  rejects(() => registry.execute("recipe.scale_servings", { recipe: recipe([ingredient("line", "sugar", Number.MAX_VALUE)]), targetServings: 4 }));
});
