import { AppError } from "../errors.js";
import { domainRegistry } from "../domains/index.js";

function invalid(message) {
  throw new AppError("INVALID_RECIPE_PLAN", message, { httpStatus: 400 });
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/**
 * Builds a reviewable plan from a recipe the user has explicitly confirmed.
 * The plan only contains inputs; the registered capabilities perform every
 * calculation when their tasks run. No stock or purchase is inferred here.
 */
export function buildRecipePlanDraft(input, { registry = domainRegistry } = {}) {
  if (!plainObject(input)) invalid("확인한 레시피와 목표 인분을 입력해 주세요.");
  const allowed = new Set([
    "confirmed", "recipe", "targetServings", "inventory",
    "includeOptionalIngredientIds", "collectInventory", "includeCookTask",
    "evidenceIds",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) invalid("지원하지 않는 레시피 계획 입력이 있어요.");
  if (input.confirmed !== true) invalid("사용자가 확인한 레시피만 계획에 사용할 수 있어요.");
  if (input.collectInventory !== undefined && typeof input.collectInventory !== "boolean") invalid("재고 확인 설정이 올바르지 않아요.");
  if (input.includeCookTask !== undefined && typeof input.includeCookTask !== "boolean") invalid("조리 작업 설정이 올바르지 않아요.");

  const inventory = Object.hasOwn(input, "inventory") ? input.inventory : [];
  const selected = Object.hasOwn(input, "includeOptionalIngredientIds")
    ? input.includeOptionalIngredientIds : [];
  const evidenceIds = Object.hasOwn(input, "evidenceIds") ? input.evidenceIds : [];
  if (!Array.isArray(evidenceIds) || evidenceIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(evidenceIds).size !== evidenceIds.length) invalid("레시피 근거 ID가 올바르지 않아요.");
  if (input.collectInventory === true && Array.isArray(inventory) && inventory.length > 0) {
    invalid("기존 재고 관찰값과 새 재고 확인 작업을 동시에 지정할 수 없어요.");
  }

  const scaleInput = { recipe: input.recipe, targetServings: input.targetServings };
  const requirementsInput = { ...scaleInput, inventory, includeOptionalIngredientIds: selected };
  registry.validateCapabilityInput("recipe.scale_servings", scaleInput);
  registry.validateCapabilityInput("recipe.calculate_requirements", requirementsInput);
  registry.validateCapabilityInput("recipe.cook", {
    recipeId: input.recipe.id, recipeRevision: input.recipe.revision,
    targetServings: input.targetServings,
  });

  const chosen = new Set(selected);
  const ingredientIds = [...new Set(input.recipe.ingredients
    .filter((item) => !item.optional || chosen.has(item.id))
    .map((item) => item.ingredientId))];
  if (input.collectInventory === true && ingredientIds.length === 0) {
    invalid("선택한 재료가 없어 확인할 재고가 없어요.");
  }

  const task = (id, title, capabilityId, inputBindings) => ({
    id, title, kind: registry.getCapability(capabilityId).taskKind,
    capabilityId, inputBindings,
    ...(evidenceIds.length ? { evidenceBindings: [...evidenceIds] } : {}),
  });
  const tasks = [task("scale_servings", "인분에 맞게 재료량 계산", "recipe.scale_servings",
    structuredClone(scaleInput))];
  const dataBindings = [];
  const dependencyLinks = [{ id: "scale_before_requirements", fromTaskId: "scale_servings", toTaskId: "calculate_requirements" }];

  if (input.collectInventory === true) {
    const checkInput = { ingredientIds };
    registry.validateCapabilityInput("recipe.check_inventory", checkInput);
    tasks.push(task("check_inventory", "현재 재고 확인", "recipe.check_inventory", checkInput));
    dataBindings.push({ id: "observed_inventory", sourceTaskId: "check_inventory",
      targetTaskId: "calculate_requirements", inputKey: "inventory" });
  }
  const calculationInput = structuredClone(requirementsInput);
  if (input.collectInventory === true) delete calculationInput.inventory;
  tasks.push(task("calculate_requirements", "필요한 재료 확인", "recipe.calculate_requirements", calculationInput));

  if (input.includeCookTask !== false) {
    tasks.push(task("cook", "요리 완료 기록", "recipe.cook", {
      recipeId: input.recipe.id, recipeRevision: input.recipe.revision,
      targetServings: input.targetServings,
    }));
    dependencyLinks.push({ id: "requirements_before_cook",
      fromTaskId: "calculate_requirements", toTaskId: "cook" });
  }
  return { tasks, dependencyLinks, dataBindings, artifacts: [] };
}
