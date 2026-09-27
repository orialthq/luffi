import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { validateAnalyzeRequest } from "../src/request_validation.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";
import { createRelationalTestPool } from "./relational_fixture.js";

async function fixture(t, backend = "json") {
  let store;
  if (backend === "postgres") {
    const { pool } = await createRelationalTestPool(t);
    store = createPostgresRelationalStore({ pool,
      initialState: createCommonKernelState });
    await store.ready();
  } else {
    const folder = await fs.mkdtemp(join(tmpdir(), "luffi-recipe-correction-"));
    t.after(() => fs.rm(folder, { recursive: true, force: true }));
    store = createJsonStateStore({ filePath: join(folder, "state.json"),
      initialState: createCommonKernelState });
  }
  const service = createCommonKernelService({ ownerId: "cook", store });
  const image = await fs.readFile(new URL("./fixtures/recipe_tomato_egg_generated.png", import.meta.url));
  assert.equal(createHash("sha256").update(image).digest("hex"),
    "4344034d26aeab2e3d42316b08d0f24fa3894e5a61f7536b0dedb3cf33d65106");
  validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: "recipe", sourceApp: "synthetic.recipe" } });
  const analysis = JSON.parse(await fs.readFile(new URL(
    "./fixtures/recipe_tomato_egg_live_analysis.json", import.meta.url), "utf8"));
  validateLegacyAnalysis(analysis);
  const imported = await service.importReviewedCapture({ importId: "recipe-image",
    reviewed: true, reviewedAt: "2026-09-25T12:00:00Z",
    capture: { id: "recipe", asset: { status: "unavailable" } }, analysis });
  const original = { title: "토마토 달걀 볶음", baseServings: 2,
    ingredients: [
      { id: "egg-line", ingredientId: "egg", name: "달걀",
        quantity: { status: "known", amount: 2, unit: "count" }, scaling: "linear" },
      { id: "tomato-line", ingredientId: "tomato", name: "토마토",
        quantity: { status: "known", amount: 200, unit: "g" }, scaling: "linear" },
      { id: "oil-line", ingredientId: "oil", name: "식용유",
        quantity: { status: "known", amount: 1, unit: "tbsp" }, scaling: "linear" },
    ],
    steps: analysis.steps.map((step, index) => ({ id: `step-${index+1}`,
      order: index + 1, instruction: step.instruction })) };
  const created = await service.createRecipeScenario({ commandId: "create-recipe",
    activityId: "cook-recipe", confirmed: true, importId: "recipe-image",
    recipe: { id: "client-recipe", revision: 1, ...original },
    targetServings: 4, inventory: [] });
  return { service, store, imported, created, original };
}

for (const backend of ["json", "postgres"]) {
test(`deleting a recipe correction removes its superseded confirmation activity (${backend})`, async (t) => {
  const { service, store, created } = await fixture(t, backend);
  const editable = await service.getEditableRecipe("cook-recipe");
  const request = { commandId: "correct-before-direct-delete", activityId: "cook-recipe",
    expectedAssertionId: editable.assertionId, confirmed: true,
    recipe: { title: "새 토마토 달걀 볶음", baseServings: editable.recipe.baseServings,
      ingredients: editable.recipe.ingredients, steps: editable.recipe.steps } };
  const correction = await service.correctRecipe(request);
  await service.knowledgeCommand({ commandId: "delete-recipe-correction",
    type: "source.delete", payload: { sourceId: correction.sourceId } });
  await assert.rejects(service.getBoard("cook-recipe"),
    (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.correctRecipe(request),
    (error) => error.code === "CORRECTION_DELETED");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.find((item) =>
    item.id === created.confirmationSourceId).status, "deleted");
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate?.startsWith("recipe.") &&
    item.scope?.id === "cook-recipe").length, 0);
});

test(`one correction atomically replaces ingredients, quantities and ordered step relations (${backend})`, async (t) => {
  const { service, store, created, original } = await fixture(t, backend);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "accept-original" });
  const before = await service.getBoard("cook-recipe");
  const editable = await service.getEditableRecipe("cook-recipe");
  assert.equal(editable.originalRecipe.steps.length, 3);
  assert.equal(editable.importId, "recipe-image");
  const updated = { title: original.title, baseServings: 2,
    ingredients: [
      { ...original.ingredients[1], quantity: { status: "known", amount: 250, unit: "g" } },
      { ...original.ingredients[0], quantity: { status: "known", amount: 3, unit: "count" } },
      { id: "salt-line", ingredientId: "salt", name: "소금",
        quantity: { status: "as_needed" }, scaling: "fixed" },
    ],
    steps: [
      { id: "step-2", instruction: "달걀을 먼저 볶는다." },
      { id: "step-1", instruction: "토마토를 썬다." },
      { id: "step-4", instruction: "소금을 넣고 마무리한다." },
    ] };
  const request = { commandId: "fix-recipe", activityId: "cook-recipe",
    expectedAssertionId: editable.assertionId, recipe: updated, confirmed: true };
  const corrected = await service.correctRecipe(request);
  assert.equal(corrected.revision, 2);
  assert.equal((await service.correctRecipe(request)).replayed, true);
  const graph = await service.getEditableRecipe("cook-recipe");
  assert.deepEqual(graph.recipe.ingredients.map((item) => [item.id, item.order,
    item.quantity.status === "known" ? item.quantity.amount : null]), [
    ["tomato-line", 1, 250], ["egg-line", 2, 3], ["salt-line", 3, null],
  ]);
  assert.deepEqual(graph.recipe.steps.map((item) => [item.id, item.order]),
    [["step-2", 1], ["step-1", 2], ["step-4", 3]]);
  const state = await store.snapshot();
  const active = (predicate) => state.knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === predicate);
  assert.equal(active("recipe.requirement_value").length, 3);
  assert.equal(active("recipe.has_requirement").length, 3);
  assert.equal(active("recipe.requires_ingredient").length, 3);
  assert.equal(active("recipe.step_value").length, 3);
  assert.equal(active("recipe.has_step").length, 3);
  assert.ok(!active("recipe.requirement_value").some((item) => item.typedValue.value.id === "oil-line"));
  assert.ok(!active("recipe.step_value").some((item) => item.typedValue.value.id === "step-3"));
  assert.equal((await service.getBoardReview("cook-recipe")).status, "ready");
  const proposal = await service.proposeBoardReview({ commandId: "propose-fix",
    activityId: "cook-recipe", expectedRevision: before.revision, confirmed: true });
  await service.acceptProposal({ proposalId: proposal.proposalId, commandId: "accept-fix" });
  const after = await service.getBoard("cook-recipe");
  assert.equal(after.tasks.find((item) => item.id === "scale_servings")
    .inputBindings.recipe.ingredients[0].quantity.amount, 250);
  assert.deepEqual(after.tasks.find((item) => item.id === "cook")
    .inputBindings.steps.map((item) => item.id), ["step-2", "step-1", "step-4"]);
  await assert.rejects(service.correctRecipe({ ...request, commandId: "stale" }),
    (error) => error.code === "RECIPE_REVISION_CONFLICT");
  await assert.rejects(service.correctRecipe({ ...request, recipe: original }),
    (error) => error.code === "COMMAND_CONFLICT");
});

test(`invalid replacements leave the complete graph unchanged and source deletion redacts edits (${backend})`, async (t) => {
  const { service, store, imported, created } = await fixture(t, backend);
  const editable = await service.getEditableRecipe("cook-recipe");
  const before = await store.snapshot();
  await assert.rejects(service.correctRecipe({ commandId: "same-recipe",
    activityId: "cook-recipe", expectedAssertionId: editable.assertionId, confirmed: true,
    recipe: { title: editable.recipe.title, baseServings: editable.recipe.baseServings,
      ingredients: editable.recipe.ingredients, steps: editable.recipe.steps } }),
  (error) => error.code === "UNCHANGED_RECIPE");
  await assert.rejects(service.correctRecipe({ commandId: "duplicate-step",
    activityId: "cook-recipe", expectedAssertionId: editable.assertionId, confirmed: true,
    recipe: { ...editable.recipe, steps: [
      { id: "same", instruction: "하나" }, { id: "same", instruction: "둘" }],
      ingredients: editable.recipe.ingredients } }),
  (error) => error.code === "INVALID_DOMAIN_VALUE" || error.code === "INVALID_REQUEST");
  assert.deepEqual(await store.snapshot(), before);
  const changed = { title: "바꾼 레시피", baseServings: 2,
    ingredients: editable.recipe.ingredients, steps: editable.recipe.steps };
  const correction = await service.correctRecipe({ commandId: "rename-recipe",
    activityId: "cook-recipe", expectedAssertionId: editable.assertionId,
    confirmed: true, recipe: changed });
  await service.deleteReviewedCapture({ importId: "recipe-image", commandId: "delete-image" });
  const deleted = await store.snapshot();
  assert.equal(deleted.knowledge.sources.find((item) => item.id === correction.sourceId).status,
    "deleted");
  assert.equal(deleted.knowledge.sourceVersions.find((item) =>
    item.sourceId === correction.sourceId).content, null);
  await assert.rejects(service.getEditableRecipe(created.activityId),
    (error) => error.code === "NOT_FOUND");
  assert.equal(deleted.importReceipts[imported.importId].deleted, true);
});

test(`a started recipe keeps completed quantities while corrected steps continue in a new activity (${backend})`, async (t) => {
  const { service, created } = await fixture(t, backend);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "accept-started" });
  let board = await service.getBoard("cook-recipe");
  await service.runTask({ commandId: "scale-started", activityId: "cook-recipe",
    taskId: "scale_servings", expectedRevision: board.revision });
  board = await service.getBoard("cook-recipe");
  const oldResults = structuredClone(board.results);
  const editable = await service.getEditableRecipe("cook-recipe");
  await service.correctRecipe({ commandId: "change-started-steps",
    activityId: "cook-recipe", expectedAssertionId: editable.assertionId,
    confirmed: true, recipe: { title: editable.recipe.title,
      baseServings: editable.recipe.baseServings,
      ingredients: editable.recipe.ingredients,
      steps: [...editable.recipe.steps].reverse().map((item) => ({
        id: item.id, instruction: item.instruction })) } });
  const review = await service.getBoardReview("cook-recipe");
  assert.equal(review.reasonCode, "STARTED_TASK_PROTECTED");
  assert.deepEqual((await service.getBoard("cook-recipe")).results, oldResults);
  const next = await service.createReviewSuccessor({ commandId: "continue-recipe",
    activityId: "cook-recipe", expectedRevision: board.revision, confirmed: true });
  await service.acceptProposal({ proposalId: next.proposalId, commandId: "accept-next" });
  const successor = await service.getBoard(next.activityId);
  assert.deepEqual(successor.tasks.find((item) => item.id === "cook")
    .inputBindings.steps.map((item) => item.id), ["step-3", "step-2", "step-1"]);
  assert.deepEqual((await service.getBoard("cook-recipe")).results, oldResults);
});

test(`deleting the original confirmation also deletes the edited recipe copy (${backend})`, async (t) => {
  const { service, store, created } = await fixture(t, backend);
  const editable = await service.getEditableRecipe("cook-recipe");
  const request = { commandId: "rename-before-delete", activityId: "cook-recipe",
    expectedAssertionId: editable.assertionId, confirmed: true,
    recipe: { title: "수정한 토마토 달걀 볶음", baseServings: 2,
      ingredients: editable.recipe.ingredients, steps: editable.recipe.steps } };
  const changed = await service.correctRecipe(request);
  await service.knowledgeCommand({ commandId: "erase-confirmation", type: "source.delete",
    payload: { sourceId: created.confirmationSourceId } });
  const state = await store.snapshot();
  assert.equal(state.knowledge.sources.find((item) => item.id === changed.sourceId).status,
    "deleted");
  assert.equal(state.knowledge.sourceVersions.find((item) =>
    item.sourceId === changed.sourceId).content, null);
  await assert.rejects(service.correctRecipe(request),
    (error) => error.code === "CORRECTION_DELETED");
});
}
