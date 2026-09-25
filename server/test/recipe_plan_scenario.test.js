import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validatePlanDraft } from "../src/activities/index.js";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { domainRegistry } from "../src/domains/index.js";
import { buildRecipePlanDraft } from "../src/scenarios/recipe_plan.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

const observedAt = "2026-09-25T09:00:00+09:00";
const source = {
  id: "tofu-soup", revision: 2, title: "두부국", baseServings: 2,
  ingredients: [
    { id: "tofu-line", ingredientId: "tofu", name: "두부",
      quantity: { status: "known", amount: 300, unit: "g" }, scaling: "linear" },
    { id: "salt-line", ingredientId: "salt", name: "소금",
      quantity: { status: "as_needed" }, scaling: "fixed" },
    { id: "garnish-line", ingredientId: "onion", name: "파",
      quantity: { status: "known", amount: 1, unit: "count" }, scaling: "linear", optional: true },
  ],
};
const inventory = [{ ingredientId: "tofu", quantity: { status: "known", amount: 0.3, unit: "kg" }, observedAt }];
const confirmed = (overrides = {}) => ({ confirmed: true, recipe: source, targetServings: 4, ...overrides });

async function serviceFixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), "luffi-recipe-plan-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return createCommonKernelService({
    ownerId: "recipe-owner",
    store: createJsonStateStore({ filePath: join(directory, "state.json"), initialState: createCommonKernelState }),
  });
}

async function createBoard(service, draft, id) {
  await service.activityCommand({ commandId: `create-${id}`, type: "activity.create",
    activityId: id, expectedRevision: 0,
    payload: { title: "두부국 준비", goal: { text: "두부국 4인분 만들기" }, planDraft: draft } });
  return service.getBoard(id);
}

test("a confirmed recipe produces a deterministic valid plan without inventing stock", () => {
  const input = confirmed();
  const before = structuredClone(input);
  const draft = buildRecipePlanDraft(input);
  assert.deepEqual(buildRecipePlanDraft(input), draft);
  assert.deepEqual(input, before);
  assert.deepEqual(draft.tasks.map((item) => item.capabilityId), [
    "recipe.scale_servings", "recipe.calculate_requirements", "recipe.cook",
  ]);
  assert.deepEqual(draft.tasks[1].inputBindings.inventory, []);
  assert.equal(draft.tasks[1].inputBindings.targetServings, 4);
  assert.equal(draft.tasks[0].inputBindings.recipe.ingredients[0].quantity.amount, 300);
  const capabilities = Object.fromEntries(domainRegistry.listCapabilities().map((spec) => [spec.id, spec]));
  assert.equal(validatePlanDraft(draft, { capabilities }).valid, true);
});

test("known inventory, selected optional ingredients and evidence are passed through exactly", () => {
  const draft = buildRecipePlanDraft(confirmed({ inventory, includeOptionalIngredientIds: ["garnish-line"], evidenceIds: ["recipe-proof"] }));
  assert.deepEqual(draft.tasks[1].inputBindings.inventory, inventory);
  assert.deepEqual(draft.tasks[1].inputBindings.includeOptionalIngredientIds, ["garnish-line"]);
  assert.deepEqual(draft.tasks.map((item) => item.evidenceBindings), [
    ["recipe-proof"], ["recipe-proof"], ["recipe-proof"],
  ]);
  assert.deepEqual(buildRecipePlanDraft(confirmed({ includeCookTask: false })).tasks.map((item) => item.id),
    ["scale_servings", "calculate_requirements"]);
});

test("unconfirmed, malformed and ambiguous inputs are rejected before a plan exists", () => {
  const bad = [
    confirmed({ confirmed: false }),
    confirmed({ confirmed: "true" }),
    confirmed({ targetServings: 0 }),
    confirmed({ inventory: null }),
    confirmed({ inventory: [inventory[0], inventory[0]] }),
    confirmed({ includeOptionalIngredientIds: ["unknown-line"] }),
    confirmed({ collectInventory: true, inventory }),
    confirmed({ evidenceIds: ["same", "same"] }),
    confirmed({ collectInventory: "yes" }),
    confirmed({ unexpectedField: 1 }),
  ];
  for (const value of bad) assert.throws(() => buildRecipePlanDraft(value),
    (error) => error?.httpStatus === 400);
});

test("service can run the plan; absent inventory remains unknown, never zero", async (t) => {
  const service = await serviceFixture(t);
  await createBoard(service, buildRecipePlanDraft(confirmed()), "unknown-stock");
  let board = await service.getBoard("unknown-stock");
  assert.equal(board.tasks.find((item) => item.id === "scale_servings").readiness.status, "ready");
  assert.equal(board.tasks.find((item) => item.id === "calculate_requirements").readiness.status, "blocked");
  const scaled = await service.runTask({ activityId: "unknown-stock", taskId: "scale_servings",
    commandId: "scale-unknown", expectedRevision: board.revision });
  assert.equal(scaled.output.ingredients[0].quantity.amount, 600);
  board = await service.getBoard("unknown-stock");
  const required = await service.runTask({ activityId: "unknown-stock", taskId: "calculate_requirements",
    commandId: "requirements-unknown", expectedRevision: board.revision });
  assert.deepEqual(required.output.items.find((item) => item.ingredientId === "tofu").missingQuantity,
    { status: "unknown" });
  board = await service.getBoard("unknown-stock");
  assert.equal(board.tasks.find((item) => item.id === "cook").readiness.status, "ready");
  await assert.rejects(service.runTask({ activityId: "unknown-stock", taskId: "cook",
    commandId: "auto-cook", expectedRevision: board.revision }),
  (error) => error.code === "DOMAIN_EXECUTION_UNAVAILABLE");
});

test("inventory observation is a user task whose exact result feeds requirements", async (t) => {
  const service = await serviceFixture(t);
  const draft = buildRecipePlanDraft(confirmed({ collectInventory: true, includeOptionalIngredientIds: ["garnish-line"] }));
  assert.deepEqual(draft.tasks.find((item) => item.id === "check_inventory").inputBindings.ingredientIds,
    ["tofu", "salt", "onion"]);
  assert.deepEqual(draft.dataBindings, [{ id: "observed_inventory", sourceTaskId: "check_inventory",
    targetTaskId: "calculate_requirements", inputKey: "inventory" }]);
  await createBoard(service, draft, "checked-stock");
  let board = await service.getBoard("checked-stock");
  await service.runTask({ activityId: "checked-stock", taskId: "scale_servings",
    commandId: "scale-checked", expectedRevision: board.revision });
  board = await service.getBoard("checked-stock");
  assert.equal(board.tasks.find((item) => item.id === "calculate_requirements").readiness.status, "blocked");
  await service.activityCommand({ commandId: "inventory-result", type: "task.recordResult",
    activityId: "checked-stock", expectedRevision: board.revision,
    payload: { taskId: "check_inventory", value: inventory } });
  board = await service.getBoard("checked-stock");
  await service.activityCommand({ commandId: "inventory-done", type: "task.transition",
    activityId: "checked-stock", expectedRevision: board.revision,
    payload: { taskId: "check_inventory", to: "completed" } });
  board = await service.getBoard("checked-stock");
  assert.equal(board.tasks.find((item) => item.id === "calculate_requirements").readiness.status, "ready");
  const result = await service.runTask({ activityId: "checked-stock", taskId: "calculate_requirements",
    commandId: "requirements-checked", expectedRevision: board.revision });
  assert.deepEqual(result.output.items.find((item) => item.ingredientId === "tofu").missingQuantity,
    { status: "known", amount: 300, unit: "g" });
  assert.equal(result.output.items.find((item) => item.ingredientId === "onion").status, "unknown");
});
