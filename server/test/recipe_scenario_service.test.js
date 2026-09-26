import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { makeValidAnalysis } from "./fixtures.js";

const sampleRecipe = () => ({ id: "sample-tofu-soup", revision: 1, title: "두부국",
  baseServings: 2, ingredients: [
    { id: "tofu-line", ingredientId: "tofu", name: "두부",
      quantity: { status: "known", amount: 300, unit: "g" }, scaling: "linear", optional: false },
    { id: "salt-line", ingredientId: "salt", name: "소금",
      quantity: { status: "as_needed" }, scaling: "fixed", optional: false },
  ] });
const scenario = (overrides = {}) => ({ commandId: "recipe-one", activityId: "cook-one",
  confirmed: true, recipe: sampleRecipe(), targetServings: 4, inventory: [], ...overrides });

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-recipe-scenario-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const store = createJsonStateStore({ filePath: join(folder, "state.json"), initialState: createCommonKernelState });
  return { store, service: createCommonKernelService({ ownerId: "person-1", store }) };
}

test("confirmed recipe creates evidence-backed graph and an approval-gated plan", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createRecipeScenario(scenario());
  assert.equal(created.replayed, false);
  const board = await service.getBoard("cook-one");
  assert.equal(board.tasks.length, 0);
  assert.equal(board.pendingProposals.length, 1);
  assert.equal(board.pendingProposals[0].id, created.proposalId);
  const resolved = await service.resolveKnowledge({ subjectId: created.recipeEntityId,
    predicate: "recipe.confirmed_recipe", scope: { type: "activity", id: "cook-one" } });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.values[0].typedValue.value.title, "두부국");
  assert.equal(resolved.values[0].typedValue.value.id, created.recipeEntityId);
  const snapshot = await store.snapshot();
  assert.ok(snapshot.knowledge.assertions.some((item) => item.predicate === "recipe.has_requirement"));
  assert.ok(snapshot.knowledge.assertions.some((item) => item.predicate === "recipe.requires_ingredient"));
  const requirementAssertion = snapshot.knowledge.assertions.find((item) =>
    item.predicate === "recipe.requirement_value" && item.typedValue?.value.id === "tofu-line");
  assert.deepEqual(requirementAssertion.typedValue.value.quantity,
    { status: "known", amount: 300, unit: "g" });
  assert.ok(snapshot.knowledge.entities.filter((item) => item.id.startsWith("recipe:")).every((item) =>
    !["두부국", "두부", "소금"].includes(item.label)));
  assert.equal((await service.createRecipeScenario(scenario())).replayed, true);
  assert.equal((await service.getBoard("cook-one")).pendingProposals.length, 1);
  await assert.rejects(service.createRecipeScenario(scenario({ targetServings: 3 })),
    (error) => error.code === "COMMAND_CONFLICT");

  await service.acceptProposal({ proposalId: created.proposalId, commandId: "accept-recipe" });
  let current = await service.getBoard("cook-one");
  assert.deepEqual(current.tasks.map((task) => task.id),
    ["scale_servings", "check_inventory", "calculate_requirements", "cook"]);
  const scaled = await service.runTask({ activityId: "cook-one", taskId: "scale_servings",
    expectedRevision: current.revision, commandId: "scale-recipe" });
  assert.equal(scaled.output.ingredients[0].quantity.amount, 600);
  current = await service.getBoard("cook-one");
  assert.equal(current.tasks.find((task) => task.id === "calculate_requirements").readiness.status, "blocked");
  await service.activityCommand({ commandId: "inventory-result", type: "task.recordResult",
    activityId: "cook-one", expectedRevision: current.revision,
    payload: { taskId: "check_inventory", value: [{ ingredientId: "tofu",
      quantity: { status: "known", amount: 100, unit: "g" }, observedAt: new Date().toISOString() }] } });
  current = await service.getBoard("cook-one");
  await service.activityCommand({ commandId: "inventory-completed", type: "task.transition",
    activityId: "cook-one", expectedRevision: current.revision,
    payload: { taskId: "check_inventory", to: "completed" } });
  current = await service.getBoard("cook-one");
  const requirements = await service.runTask({ activityId: "cook-one", taskId: "calculate_requirements",
    expectedRevision: current.revision, commandId: "requirements-recipe" });
  assert.deepEqual(requirements.output.items.find((item) => item.ingredientId === "tofu").missingQuantity,
    { status: "known", amount: 500, unit: "g" });
  current = await service.getBoard("cook-one");
  await assert.rejects(service.runTask({ activityId: "cook-one", taskId: "cook",
    expectedRevision: current.revision, commandId: "auto-cook" }),
  (error) => error.code === "DOMAIN_EXECUTION_UNAVAILABLE");
  await service.activityCommand({ commandId: "inventory-correction", type: "task.recordResult",
    activityId: "cook-one", expectedRevision: current.revision,
    payload: { taskId: "check_inventory", value: [{ ingredientId: "tofu",
      quantity: { status: "known", amount: 200, unit: "g" }, observedAt: new Date().toISOString() }] } });
  current = await service.getBoard("cook-one");
  assert.equal(current.tasks.find((task) => task.id === "calculate_requirements").needsReview, true);
  assert.equal(current.tasks.find((task) => task.id === "cook").readiness.status, "blocked");
  await assert.rejects(service.activityCommand({ commandId: "cook-stale-stock", type: "task.transition",
    activityId: "cook-one", expectedRevision: current.revision,
    payload: { taskId: "cook", to: "completed", output: { recipeId: created.recipeEntityId,
      completedAt: new Date().toISOString(), reportedBy: "person-1" } } }),
  (error) => error.code === "TASK_BLOCKED");
});

test("recipe ingredient correction creates an approval-gated patch without rewriting results", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createRecipeScenario(scenario());
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "accept-before-ingredient-change" });
  const before = await service.getBoard(created.activityId);
  const snapshot = await store.snapshot();
  const confirmed = snapshot.knowledge.assertions.find((item) =>
    item.subjectId === created.recipeEntityId && item.predicate === "recipe.confirmed_recipe" &&
    item.status === "active");
  const correctedRecipe = structuredClone(confirmed.typedValue.value);
  correctedRecipe.ingredients[0].quantity.amount = 450;
  await service.knowledgeCommand({ commandId: "correct-tofu-amount",
    type: "assertion.correct", payload: { assertionId: confirmed.id,
      expectedRevision: confirmed.revision,
      assertion: { id: "recipe-corrected-tofu", subjectId: confirmed.subjectId,
        predicate: confirmed.predicate, scope: confirmed.scope,
        origin: "user_reported", assertedBy: { type: "user", id: "person-1" },
        evidenceIds: confirmed.evidenceIds, observedAt: new Date().toISOString(),
        typedValue: { type: "recipe.recipe", value: correctedRecipe } } } });
  const requirement = snapshot.knowledge.assertions.find((item) =>
    item.predicate === "recipe.requirement_value" &&
    item.typedValue?.value?.id === "tofu-line" && item.status === "active");
  assert.equal((await service.getBoardReview(created.activityId)).reasonCode,
    "RECIPE_GRAPH_CONFLICT");
  await service.knowledgeCommand({ commandId: "correct-tofu-requirement",
    type: "assertion.correct", payload: { assertionId: requirement.id,
      expectedRevision: requirement.revision,
      assertion: { id: "recipe-corrected-tofu-requirement",
        subjectId: requirement.subjectId, predicate: requirement.predicate,
        scope: requirement.scope, origin: "user_reported",
        assertedBy: { type: "user", id: "person-1" },
        evidenceIds: requirement.evidenceIds, observedAt: new Date().toISOString(),
        typedValue: { type: requirement.typedValue.type,
          value: correctedRecipe.ingredients[0] } } } });
  const report = await service.getBoardReview(created.activityId);
  assert.equal(report.status, "ready");
  assert.ok(report.changes.some((item) => item.before.includes("300g") &&
    item.after.includes("450g")));
  assert.ok(report.affectedTasks.some((item) => item.id === "scale_servings"));
  const proposed = await service.proposeBoardReview({ activityId: created.activityId,
    commandId: "propose-ingredient-patch", expectedRevision: before.revision,
    confirmed: true });
  assert.equal(proposed.planKind, "patch");
  await service.acceptProposal({ proposalId: proposed.proposalId,
    commandId: "accept-ingredient-patch" });
  const after = await service.getBoard(created.activityId);
  assert.equal(after.tasks.find((task) => task.id === "scale_servings")
    .inputBindings.recipe.ingredients[0].quantity.amount, 450);
  assert.equal(after.currentPlanRevision, before.currentPlanRevision + 1);
  assert.equal(after.results.length, 0);
  assert.equal((await service.getBoardReview(created.activityId)).status, "current");
});

test("unconfirmed, missing imports, and invalid recipes leave no partial scenario", async (t) => {
  const { service, store } = await fixture(t);
  const initial = await store.snapshot();
  for (const request of [scenario({ confirmed: false }), scenario({ importId: "missing" }),
    scenario({ recipe: { ...sampleRecipe(), baseServings: 0 } }),
    scenario({ inventory: [{ ingredientId: "tofu", quantity: { status: "known", amount: 1, unit: "g" } }] }),
    scenario({ collectInventory: false }),
    scenario({ recipe: { ...sampleRecipe(), ingredients: Array.from({ length: 26 }, (_, index) => ({
      ...sampleRecipe().ingredients[0], id: `row-${index}` })) } })]) {
    await assert.rejects(service.createRecipeScenario(request));
    assert.deepEqual(await store.snapshot(), initial);
  }
});

test("a generated sample is explicitly marked synthetic in source and proposal", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createRecipeScenario(scenario({ synthetic: true }));
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.find((item) => item.id === created.confirmationSourceId)
    .provenance.synthetic, true);
  assert.equal((await service.getBoard(created.activityId)).pendingProposals[0].run.synthetic, true);
  await assert.rejects(service.createRecipeScenario(scenario({ commandId: "bad-sample",
    activityId: "bad-sample-activity", synthetic: true, importId: "arbitrary" })),
  (error) => error.code === "INVALID_REQUEST");
});

test("deleting an imported capture cascades to linked recipe and prevents replay", async (t) => {
  const { service, store } = await fixture(t);
  const importRequest = { importId: "capture-import", reviewed: true,
    reviewedAt: "2026-09-25T11:00:00Z",
    capture: { id: "capture-001", asset: { status: "unavailable" } },
    analysis: makeValidAnalysis() };
  const imported = await service.importReviewedCapture(importRequest);
  const created = await service.createRecipeScenario(scenario({ importId: "capture-import" }));
  const board = await service.getBoard(created.activityId);
  assert.equal(board.pendingProposals[0].run.importId, "capture-import");
  await service.knowledgeCommand({ commandId: "delete-import", type: "source.delete",
    payload: { sourceId: imported.sourceId } });
  await assert.rejects(service.createRecipeScenario(scenario({ commandId: "recipe-two",
    activityId: "cook-two", importId: "capture-import" })),
  (error) => error.code === "IMPORT_NOT_FOUND");
  await assert.rejects(service.getBoard(created.activityId), (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.importReviewedCapture(importRequest),
    (error) => error.code === "IMPORT_DELETED");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.importReceipts["capture-import"].deleted, true);
  assert.equal(snapshot.importReceipts["capture-import"].legacyCaptureId, undefined);
  assert.equal(snapshot.knowledge.sources.find((item) => item.id === created.confirmationSourceId).status, "deleted");
  assert.ok(snapshot.knowledge.entities.filter((item) => item.type === "ingestion.material").every((item) =>
    !Object.hasOwn(item.externalIds, "legacyCaptureId")));
});

test("a reviewed non-recipe capture cannot be presented as recipe evidence", async (t) => {
  const { service, store } = await fixture(t);
  await service.importReviewedCapture({ importId: "not-recipe", reviewed: true,
    reviewedAt: "2026-09-25T11:00:00Z",
    capture: { id: "capture-other", asset: { status: "unavailable" } },
    analysis: makeValidAnalysis({ domain: "unknown", contentKind: "unknown", ingredientGroups: [] }) });
  const before = await store.snapshot();
  await assert.rejects(service.createRecipeScenario(scenario({ importId: "not-recipe" })),
    (error) => error.code === "IMPORT_NOT_RECIPE");
  assert.deepEqual(await store.snapshot(), before);
});

test("delete by importId tombstones an in-flight or not-yet-committed import", async (t) => {
  const { service, store } = await fixture(t);
  const deletion = { importId: "uncertain-import", commandId: "delete-uncertain" };
  const first = await service.deleteReviewedCapture(deletion);
  assert.deepEqual(first, { importId: "uncertain-import", sourceId: null,
    deleted: true, replayed: false });
  assert.equal((await service.deleteReviewedCapture(deletion)).replayed, true);
  await assert.rejects(service.deleteReviewedCapture({ importId: "different-import",
    commandId: "delete-uncertain" }), (error) => error.code === "COMMAND_CONFLICT");
  await assert.rejects(service.importReviewedCapture({ importId: "uncertain-import", reviewed: true,
    reviewedAt: "2026-09-25T11:00:00Z",
    capture: { id: "capture-late", asset: { status: "unavailable" } },
    analysis: makeValidAnalysis() }), (error) => error.code === "IMPORT_DELETED");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.length, 0);
  assert.equal(snapshot.importReceipts["uncertain-import"].deleted, true);
});

test("delete by importId redacts a committed import and its scenario", async (t) => {
  const { service, store } = await fixture(t);
  const input = { importId: "import-to-delete", reviewed: true,
    reviewedAt: "2026-09-25T11:00:00Z",
    capture: { id: "capture-to-delete", asset: { status: "unavailable" } },
    analysis: makeValidAnalysis() };
  const imported = await service.importReviewedCapture(input);
  const created = await service.createRecipeScenario(scenario({ importId: "import-to-delete" }));
  const deletion = await service.deleteReviewedCapture({ importId: "import-to-delete",
    commandId: "delete-import-to-delete" });
  assert.equal(deletion.sourceId, imported.sourceId);
  assert.equal(deletion.deleted, true);
  assert.equal((await service.deleteReviewedCapture({ importId: "import-to-delete",
    commandId: "delete-import-to-delete" })).replayed, true);
  await assert.rejects(service.getBoard(created.activityId), (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.importReviewedCapture(input), (error) => error.code === "IMPORT_DELETED");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.find((item) => item.id === imported.sourceId).status, "deleted");
  assert.equal(JSON.stringify(snapshot).includes("capture-to-delete"), false);
});

test("deleting confirmation redacts plan copies and tombstones creation receipts", async (t) => {
  const { service, store } = await fixture(t);
  const first = await service.createRecipeScenario(scenario());
  const unboundContext = await service.createContext({ queries: [{
    subjectId: first.recipeEntityId, predicate: "recipe.confirmed_recipe",
    scope: { type: "activity", id: first.activityId },
  }] });
  assert.equal(unboundContext.resolutions[0].status, "resolved");
  await service.knowledgeCommand({ commandId: "delete-first-confirmation", type: "source.delete",
    payload: { sourceId: first.confirmationSourceId } });
  await assert.rejects(service.acceptProposal({ proposalId: first.proposalId,
    commandId: "accept-deleted-recipe" }), (error) => error.code === "PROPOSAL_NOT_FOUND");
  await assert.rejects(service.getBoard(first.activityId), (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.createRecipeScenario(scenario()),
    (error) => error.code === "SCENARIO_DELETED");

  const second = await service.createRecipeScenario(scenario({ commandId: "recipe-two", activityId: "cook-two" }));
  await service.acceptProposal({ proposalId: second.proposalId, commandId: "accept-second" });
  const before = await service.getBoard(second.activityId);
  await service.knowledgeCommand({ commandId: "delete-second-confirmation", type: "source.delete",
    payload: { sourceId: second.confirmationSourceId } });
  await assert.rejects(service.runTask({ activityId: second.activityId, taskId: "scale_servings",
    expectedRevision: before.revision, commandId: "scale-deleted" }),
  (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.getBoard(second.activityId), (error) => error.code === "NOT_FOUND");
  const snapshot = await store.snapshot();
  assert.equal(JSON.stringify(snapshot).includes("두부국"), false);
  assert.equal(JSON.stringify(snapshot).includes("소금"), false);
  assert.equal(snapshot.issuedContexts[unboundContext.contextId], undefined);
  assert.ok(Object.values(snapshot.recipeScenarioReceipts).every((receipt) => receipt.deleted));
});

test("editing a watched requirement invalidates the accepted recipe context", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createRecipeScenario(scenario());
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "accept-recipe" });
  const before = await service.getBoard(created.activityId);
  const snapshot = await store.snapshot();
  const requirement = snapshot.knowledge.assertions.find((item) =>
    item.predicate === "recipe.requirement_value");
  await service.knowledgeCommand({ commandId: "retract-requirement", type: "assertion.retract",
    payload: { assertionId: requirement.id } });
  await assert.rejects(service.runTask({ activityId: created.activityId, taskId: "scale_servings",
    expectedRevision: before.revision, commandId: "scale-stale" }),
  (error) => error.code === "CONTEXT_STALE");
});
