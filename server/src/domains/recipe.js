import { array, assertUnique, enumeration, fail, object, ref, text } from "./schema.js";
import { artifact, capability, relation, slot } from "./shared.js";

const ingredient = object({
  id: text, ingredientId: text, name: text, quantity: ref("core.ingredient_quantity"),
  scaling: enumeration("linear", "fixed"), optional: { type: "boolean" },
}, ["id", "ingredientId", "name", "quantity", "scaling"]);

const recipe = object({
  id: text, revision: ref("core.revision"), title: text,
  baseServings: ref("core.positive_number"), ingredients: array(ref("recipe.ingredient_requirement"), 1),
});
const scaled = object({
  recipeId: text, recipeRevision: ref("core.revision"), baseServings: ref("core.positive_number"),
  targetServings: ref("core.positive_number"), ingredients: array(ref("recipe.ingredient_requirement"), 1),
});
const scaleInput = object({ recipe: ref("recipe.recipe"), targetServings: ref("core.positive_number") });
const inventory = object({ ingredientId: text, quantity: ref("core.quantity"), observedAt: ref("core.timestamp") });
const requirement = object({
  ingredientId: text, name: text, requirementIds: array(text, 1),
  requiredQuantity: ref("core.quantity"), availableQuantity: ref("core.quantity"),
  missingQuantity: ref("core.quantity"), status: enumeration("needed", "satisfied", "unknown", "incompatible_unit", "as_needed"),
});

function validateRecipe(input) {
  assertUnique(input.recipe.ingredients, "id", "$.recipe.ingredients");
}

function rounded(value) {
  if (!Number.isFinite(value)) fail("calculated quantity exceeds the supported numeric range");
  return Number(value.toPrecision(12));
}

export function scaleRecipeServings(input) {
  const ratio = input.targetServings / input.recipe.baseServings;
  return {
    recipeId: input.recipe.id, recipeRevision: input.recipe.revision,
    baseServings: input.recipe.baseServings, targetServings: input.targetServings,
    ingredients: input.recipe.ingredients.map((item) => ({
      ...item,
      quantity: item.quantity.status === "known" ? {
        ...item.quantity,
        amount: rounded(item.quantity.amount * (item.scaling === "fixed" ? 1 : ratio)),
      } : { ...item.quantity },
    })),
  };
}

// Only SI conversions with known dimensions. A spoon or an ingredient density
// never silently becomes millilitres or grams.
const units = { g: ["mass", 1], kg: ["mass", 1000], ml: ["volume", 1], l: ["volume", 1000], count: ["count", 1], tsp: ["tsp", 1], tbsp: ["tbsp", 1] };
function convert(amount, from, to) {
  if (units[from][0] !== units[to][0]) return null;
  return rounded(amount * units[from][1] / units[to][1]);
}

export function calculateRecipeRequirements(input) {
  const result = scaleRecipeServings(input);
  const stock = new Map(input.inventory.map((entry) => [entry.ingredientId, entry.quantity]));
  const groups = new Map();
  // Aggregate a repeated ingredient before subtracting stock, or the same
  // observed stock would be spent twice on separate lines of one recipe.
  for (const item of result.ingredients.filter((entry) => !entry.optional || input.includeOptionalIngredientIds?.includes(entry.id))) {
    const group = groups.get(item.ingredientId) ?? { ingredientId: item.ingredientId, name: item.name, requirementIds: [], quantities: [] };
    group.requirementIds.push(item.id);
    group.quantities.push(item.quantity);
    groups.set(item.ingredientId, group);
  }
  const items = [...groups.values()].map(({ quantities, ...group }) => {
    const availableQuantity = stock.get(group.ingredientId) ?? { status: "unknown" };
    let requiredQuantity = { status: "unknown" };
    let missingQuantity = { status: "unknown" };
    let status = "unknown";
    if (quantities.every((q) => q.status === "known")) {
      const unit = quantities[0].unit;
      const amounts = quantities.map((q) => convert(q.amount, q.unit, unit));
      if (amounts.includes(null)) {
        status = "incompatible_unit";
      } else {
        requiredQuantity = { status: "known", amount: rounded(amounts.reduce((a, b) => a + b, 0)), unit };
        if (availableQuantity.status === "known") {
          const available = convert(availableQuantity.amount, availableQuantity.unit, unit);
          if (available === null) status = "incompatible_unit";
          else {
            missingQuantity = { status: "known", amount: rounded(Math.max(0, requiredQuantity.amount - available)), unit };
            status = missingQuantity.amount > 0 ? "needed" : "satisfied";
          }
        }
      }
    } else if (quantities.every((q) => q.status === "as_needed")) {
      requiredQuantity = { status: "as_needed" };
      missingQuantity = { status: "as_needed" };
      status = "as_needed";
    }
    return { ...group, requiredQuantity, availableQuantity: { ...availableQuantity }, missingQuantity, status };
  });
  return { recipeId: result.recipeId, recipeRevision: result.recipeRevision, targetServings: result.targetServings, items };
}

export const recipePack = {
  id: "recipe", version: 1, compatibleKernelVersions: [1],
  entityTypes: ["recipe.recipe", "recipe.ingredient", "recipe.ingredient_requirement", "recipe.inventory_observation"],
  types: [
    { id: "recipe.ingredient", schema: object({ id: text, name: text }) },
    { id: "recipe.ingredient_requirement", schema: ingredient },
    { id: "recipe.recipe", schema: recipe, validate: (value) => assertUnique(value.ingredients, "id", "$.ingredients") },
    { id: "recipe.inventory_observation", schema: inventory },
    { id: "recipe.inventory", schema: array(ref("recipe.inventory_observation")), validate: (value) => assertUnique(value, "ingredientId") },
    { id: "recipe.scale_input", schema: scaleInput },
    { id: "recipe.scaled_recipe", schema: scaled },
    { id: "recipe.requirements_input", schema: object({ ...scaleInput.properties, inventory: ref("recipe.inventory"), includeOptionalIngredientIds: array(text) }, ["recipe", "targetServings", "inventory"]) },
    { id: "recipe.shopping_list", schema: object({ recipeId: text, recipeRevision: ref("core.revision"), targetServings: ref("core.positive_number"), items: array(requirement) }) },
    { id: "recipe.inventory_input", schema: object({ ingredientIds: array(text, 1) }) },
    { id: "recipe.cook_input", schema: object({ recipeId: text, recipeRevision: ref("core.revision"), targetServings: ref("core.positive_number") }) },
    { id: "recipe.cook_result", schema: object({ recipeId: text, completedAt: ref("core.timestamp"), reportedBy: text }) },
  ],
  relations: [
    relation("recipe.has_requirement", ["recipe.recipe"], ["recipe.ingredient_requirement"]),
    relation("recipe.requires_ingredient", ["recipe.ingredient_requirement"], ["recipe.ingredient"], "one"),
    relation("recipe.observes_inventory", ["recipe.inventory_observation"], ["recipe.ingredient"], "one"),
  ],
  slots: [
    slot("recipe.source", "recipe.recipe", "Versioned recipe used as the calculation input"),
    slot("recipe.target_servings", "core.positive_number", "Requested servings; never changes completed cooking history"),
    slot("recipe.inventory", "recipe.inventory", "Explicit stock observations; missing entries remain unknown"),
    slot("recipe.scaled", "recipe.scaled_recipe", "Ingredient amounts for the requested servings"),
    slot("recipe.shopping_list", "recipe.shopping_list", "Additional amounts based on known compatible stock"),
  ],
  capabilities: [
    capability({ id: "recipe.scale_servings", actor: "system", taskKind: "derive", inputType: "recipe.scale_input", outputType: "recipe.scaled_recipe", inputSlots: { recipe: "recipe.source", targetServings: "recipe.target_servings" }, outputSlots: { "$": "recipe.scaled" }, validateInput: validateRecipe, run: scaleRecipeServings }),
    capability({ id: "recipe.calculate_requirements", actor: "system", taskKind: "derive", inputType: "recipe.requirements_input", outputType: "recipe.shopping_list", inputSlots: { recipe: "recipe.source", targetServings: "recipe.target_servings", inventory: "recipe.inventory" }, outputSlots: { "$": "recipe.shopping_list" }, validateInput(input) {
      validateRecipe(input); assertUnique(input.inventory, "ingredientId", "$.inventory");
      const selected = input.includeOptionalIngredientIds ?? [];
      if (new Set(selected).size !== selected.length || selected.some((id) => !input.recipe.ingredients.some((item) => item.id === id && item.optional))) fail("optional selections must uniquely reference optional ingredient requirement IDs", "$.includeOptionalIngredientIds");
    }, run: calculateRecipeRequirements }),
    capability({ id: "recipe.check_inventory", taskKind: "observe", inputType: "recipe.inventory_input", outputType: "recipe.inventory", validateOutput: (output) => assertUnique(output, "ingredientId") }),
    capability({ id: "recipe.cook", inputType: "recipe.cook_input", outputType: "recipe.cook_result", completion: "user_reported_completion_without_implicit_inventory_consumption" }),
  ],
  artifacts: [artifact("recipe.scaled_recipe", "recipe.scaled_recipe", "recipe.ingredients"), artifact("recipe.shopping_list", "recipe.shopping_list", "recipe.shopping_list")],
};
