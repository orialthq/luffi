import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { validateAnalyzeRequest } from "../src/request_validation.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";
import { createRelationalTestPool } from "./relational_fixture.js";

// Every response was recorded from /v1/analyze for the exact PNG below.
const captures = {
  recipe: ["variation_recipe_tofu_egg_as_needed", "4ee2de07ece75c1a7b467430701efbc19e1775584738147bd427ab0129baf47e", "synthetic.recipe"],
  tofu: ["variation_shopping_tofu_ingredient", "7a87bb882a641e8a344ce59750f7b34d9c4842d659f6ed91898b856d8602c442", "synthetic.shopping"],
  egg: ["variation_shopping_egg_pack", "db39f40c0062dacd52cbfa6c87c41302cdd668405d783368a8b6f67515c9db6f", "synthetic.shopping"],
  price: ["variation_shopping_old_current_price", "7c3da692d80c16dc3d838743ec3496608e7579738f38fda3b386843f64bf3633", "synthetic.shopping"],
  travel: ["travel_a_viewpoint", "07ddb947d3d725a1cd0737346f8a5817a7bd63e67301a88277cad4cbce483099", "synthetic.travel"],
  dining: ["variation_dining_jeju_noodles", "207ca5abbbfa507fade08f353f744d407be4f780266ca37f0b94329fe5a166d3", "synthetic.dining"],
  fashion: ["fashion_a_blazer", "33a5db2639a0125196de6ccfb64cd668c8d5066eceeffe8676303a14e423643d", "synthetic.fashion"],
  beauty: ["beauty_a_cleanser", "114e7964624233360d5e46a97ca825383737e9c193efa46a044a7ae9c8c17dda", "synthetic.beauty"],
  health: ["health_home_workout", "c1000800307a89f4c8341d50111e6e2acbbcac6b8ad6e9be1d9048efa4f6abe7", "synthetic.health"],
  tip: ["variation_life_tip_workout_prep", "2fb64f37eb1a20749f13e70674f0f8ee1f024c38542b4ca097e928b450251432", "synthetic.life_tip"],
};

async function setup(t, backend = "json") {
  if (backend === "postgres") {
    const { pool } = await createRelationalTestPool(t);
    const store = createPostgresRelationalStore({ pool,
      initialState: createCommonKernelState });
    await store.ready();
    return { store, service: createCommonKernelService({
      ownerId: "variation-user", store }) };
  }
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-variations-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const store = createJsonStateStore({ filePath: join(folder, "state.json"),
    initialState: createCommonKernelState });
  return { store, service: createCommonKernelService({ ownerId: "variation-user", store }) };
}

async function importCapture(service, key, importId = key) {
  const [name, hash, sourceApp] = captures[key];
  const path = fileURLToPath(new URL(`./fixtures/${name}.png`, import.meta.url));
  const image = await fs.readFile(path);
  assert.equal(createHash("sha256").update(image).digest("hex"), hash);
  validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: name, sourceApp, locale: "ko-KR" } });
  const analysis = JSON.parse(await fs.readFile(fileURLToPath(new URL(
    `./fixtures/${name}_live_analysis.json`, import.meta.url)), "utf8"));
  validateLegacyAnalysis(analysis);
  const evidence = new Set(analysis.evidence.map((item) => item.id));
  assert.ok(analysis.title.evidenceIds.every((id) => evidence.has(id)));
  for (const item of [...analysis.facts, ...analysis.steps,
    ...analysis.ingredientGroups.flatMap((group) => group.ingredients)]) {
    assert.ok(item.evidenceIds.length > 0);
    assert.ok(item.evidenceIds.every((id) => evidence.has(id)));
  }
  const imported = await service.importReviewedCapture({ importId,
    reviewed: true, reviewedAt: "2026-09-27T09:00:00+09:00",
    capture: { id: name, asset: { status: "unavailable" } }, analysis });
  return { ...imported, analysis };
}

async function approve(service, created, commandId) {
  await service.acceptProposal({ proposalId: created.proposalId, commandId });
  return service.getBoard(created.activityId);
}

const active = (state, predicate) => state.knowledge.assertions.filter((item) =>
  item.status === "active" && item.predicate === predicate);
const activeInActivity = (state, predicate, activityId) =>
  active(state, predicate).filter((item) => item.scope?.id === activityId);

for (const backend of ["json", "postgres"]) {
test(`recipe amount 'as needed' stays nonnumeric and an actual tofu offer links without a purchase (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  const recipeImport = await importCapture(service, "recipe");
  const tofuImport = await importCapture(service, "tofu");
  assert.deepEqual(recipeImport.analysis.ingredientGroups[0].ingredients.map((item) =>
    [item.name, item.amount, item.unit]), [
    ["두부", "300", "g"], ["달걀", "2", "개"], ["소금", "약간", null],
  ]);
  assert.equal(tofuImport.analysis.facts.find((item) => item.label === "가격")?.value, "2,400원");

  const recipe = await service.createRecipeScenario({ commandId: "create-recipe",
    activityId: "recipe-board", confirmed: true, importId: "recipe", targetServings: 4,
    inventory: [], recipe: { id: "tofu-egg", revision: 1,
      title: "두부 달걀 볶음", baseServings: 2, ingredients: [
        { id: "tofu", ingredientId: "tofu", name: "두부",
          quantity: { status: "known", amount: 300, unit: "g" }, scaling: "linear" },
        { id: "egg", ingredientId: "egg", name: "달걀",
          quantity: { status: "known", amount: 2, unit: "count" }, scaling: "linear" },
        { id: "salt", ingredientId: "salt", name: "소금",
          quantity: { status: "as_needed" }, scaling: "fixed" },
      ] } });
  let recipeBoard = await approve(service, recipe, "approve-recipe");
  const scaled = await service.runTask({ commandId: "scale-recipe", activityId: "recipe-board",
    taskId: "scale_servings", expectedRevision: recipeBoard.revision });
  assert.deepEqual(scaled.output.ingredients.map((item) => item.quantity), [
    { status: "known", amount: 600, unit: "g" },
    { status: "known", amount: 4, unit: "count" },
    { status: "as_needed" },
  ]);

  const shopping = await service.createShoppingScenario({ commandId: "create-shopping",
    activityId: "shopping-board", confirmed: true, importIds: ["tofu"],
    purpose: "두부 달걀 볶음 재료 고르기" });
  let shopBoard = await approve(service, shopping, "approve-shopping");
  assert.equal(shopBoard.tasks[0].readiness.inputs.candidates[0].displayedPriceText, "2,400원");
  await service.confirmShoppingChoice({ commandId: "choose-tofu", activityId: "shopping-board",
    expectedRevision: shopBoard.revision, selectedImportId: "tofu", quantity: 1 });
  recipeBoard = await service.getBoard("recipe-board");
  shopBoard = await service.getBoard("shopping-board");
  const linked = await service.createScenarioConnection({ commandId: "link-recipe-shopping",
    fromActivityId: "recipe-board", toActivityId: "shopping-board",
    kind: "recipe_shopping", confirmed: true,
    expectedFromRevision: recipeBoard.revision, expectedToRevision: shopBoard.revision });
  const connection = (await service.listScenarioConnections("recipe-board")).connections[0];
  assert.equal(connection.id, linked.id);
  assert.equal(connection.otherSubject?.type, "shopping.purchase_choice");
  assert.equal(Object.hasOwn(connection, "recipeNeeds"), false);
  assert.equal((await service.listScenarioConnections("shopping-board"))
    .connections[0].recipeNeeds.status, "not_ready");
  recipeBoard = await service.getBoard("recipe-board");
  await service.activityCommand({ commandId: "record-empty-stock", type: "task.recordResult",
    activityId: "recipe-board", expectedRevision: recipeBoard.revision,
    payload: { taskId: "check_inventory", value: [] } });
  recipeBoard = await service.getBoard("recipe-board");
  await service.activityCommand({ commandId: "finish-stock-check", type: "task.transition",
    activityId: "recipe-board", expectedRevision: recipeBoard.revision,
    payload: { taskId: "check_inventory", to: "completed" } });
  recipeBoard = await service.getBoard("recipe-board");
  await service.runTask({ commandId: "calculate-needs", activityId: "recipe-board",
    taskId: "calculate_requirements", expectedRevision: recipeBoard.revision });
  const needs = (await service.listScenarioConnections("shopping-board"))
    .connections[0].recipeNeeds;
  assert.equal(needs.status, "ready");
  assert.equal(needs.targetServings, 4);
  assert.deepEqual(needs.items.map((item) => [item.name, item.requiredQuantity,
    item.missingQuantity, item.status]), [
    ["두부", { status: "known", amount: 600, unit: "g" }, { status: "unknown" }, "unknown"],
    ["달걀", { status: "known", amount: 4, unit: "count" }, { status: "unknown" }, "unknown"],
    ["소금", { status: "as_needed" }, { status: "as_needed" }, "as_needed"],
  ]);
  assert.ok(needs.sourceResultId);
  const state = await store.snapshot();
  assert.equal(active(state, "scenario.connection_from_subject").length, 1);
  assert.equal(active(state, "scenario.connection_to_subject").length, 1);
  assert.ok(active(state, "scenario.connection_to_subject")[0].evidenceIds.length >= 2);
  assert.equal(active(state, "shopping.actual_paid_krw").length, 0);
  assert.equal(active(state, "shopping.purchase_for_choice").length, 0);
  const recipeValue = active(state, "recipe.requirement_value").find((item) =>
    item.typedValue?.value?.name === "두부");
  assert.ok(recipeValue);
  await service.knowledgeCommand({ commandId: "retract-tofu-requirement",
    type: "assertion.retract", payload: { assertionId: recipeValue.id } });
  assert.equal((await service.listScenarioConnections("shopping-board"))
    .connections[0].recipeNeeds.status, "stale");
  await service.knowledgeCommand({ commandId: "erase-recipe-image", type: "source.delete",
    payload: { sourceId: recipeImport.sourceId } });
  assert.deepEqual((await service.listScenarioConnections("shopping-board")).connections, []);
  await assert.rejects(service.getBoard("recipe-board"), (error) => error.code === "NOT_FOUND");
  assert.equal((await service.getBoard("shopping-board")).id, "shopping-board");
});
}

for (const backend of ["json", "postgres"]) {
test(`image-backed recipe basket keeps unselected ingredients and reports purchases per product (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  await importCapture(service, "recipe");
  await importCapture(service, "tofu");
  await importCapture(service, "egg");
  const observedAt = "2026-09-27T09:00:00+09:00";
  const inventory = [{ ingredientId: "tofu",
    quantity: { status: "known", amount: 100, unit: "g" }, observedAt },
  { ingredientId: "egg", quantity: { status: "known", amount: 0,
    unit: "count" }, observedAt }];
  const created = await service.createRecipeScenario({ commandId: "basket-recipe",
    activityId: "basket-recipe-board", confirmed: true, importId: "recipe",
    targetServings: 4, inventory: [],
    recipe: { id: "basket-recipe", revision: 1, title: "두부 달걀 볶음",
      baseServings: 2, ingredients: [
        { id: "tofu", ingredientId: "tofu", name: "두부",
          quantity: { status: "known", amount: 300, unit: "g" }, scaling: "linear" },
        { id: "egg", ingredientId: "egg", name: "달걀",
          quantity: { status: "known", amount: 2, unit: "count" }, scaling: "linear" },
        { id: "salt", ingredientId: "salt", name: "소금",
          quantity: { status: "as_needed" }, scaling: "fixed" },
      ] } });
  let recipeBoard = await approve(service, created, "approve-basket-recipe");
  await service.runTask({ commandId: "basket-scale", activityId: recipeBoard.id,
    taskId: "scale_servings", expectedRevision: recipeBoard.revision });
  recipeBoard = await service.getBoard(recipeBoard.id);
  await service.activityCommand({ commandId: "basket-stock", type: "task.recordResult",
    activityId: recipeBoard.id, expectedRevision: recipeBoard.revision,
    payload: { taskId: "check_inventory", value: inventory } });
  recipeBoard = await service.getBoard(recipeBoard.id);
  await service.activityCommand({ commandId: "basket-stock-done", type: "task.transition",
    activityId: recipeBoard.id, expectedRevision: recipeBoard.revision,
    payload: { taskId: "check_inventory", to: "completed" } });
  recipeBoard = await service.getBoard(recipeBoard.id);
  await service.runTask({ commandId: "basket-needs", activityId: recipeBoard.id,
    taskId: "calculate_requirements", expectedRevision: recipeBoard.revision });
  const shopping = await service.createShoppingScenario({ commandId: "basket-shopping",
    activityId: "basket-shopping-board", confirmed: true, importIds: ["tofu", "egg"],
    purpose: "볶음 재료 장보기" });
  let shoppingBoard = await approve(service, shopping, "approve-basket-shopping");
  recipeBoard = await service.getBoard(recipeBoard.id);
  const link = await service.createScenarioConnection({ commandId: "basket-link",
    fromActivityId: recipeBoard.id, toActivityId: shoppingBoard.id,
    kind: "recipe_shopping", confirmed: true,
    expectedFromRevision: recipeBoard.revision,
    expectedToRevision: shoppingBoard.revision });
  const review = await service.getRecipeShoppingPlanReview(shoppingBoard.id, link.id);
  const proposal = await service.proposeRecipeShoppingPlan({ commandId: "basket-propose",
    shoppingActivityId: shoppingBoard.id, connectionId: link.id,
    expectedRevision: review.expectedRevision,
    expectedSourceResultId: review.reference.sourceResultId, confirmed: true });
  await service.acceptProposal({ proposalId: proposal.proposalId,
    commandId: "approve-basket-needs" });
  shoppingBoard = await service.getBoard(shoppingBoard.id);
  await assert.rejects(service.confirmShoppingBasket({ commandId: "basket-forged",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    selections: [{ ingredientId: "not-a-recipe-ingredient", selectedImportId: "tofu",
      quantity: 1, packageQuantity: { status: "known", amount: 300, unit: "g" } }] }),
  (error) => error.code === "INVALID_BASKET_SELECTION");
  await assert.rejects(service.confirmShoppingBasket({ commandId: "basket-forged-evidence",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    selections: [{ ingredientId: "tofu", selectedImportId: "tofu", quantity: 2,
      packageQuantity: { status: "known", amount: 300, unit: "g" },
      packageEvidenceIds: ["not-from-this-image"] }] }),
  (error) => error.code === "INVALID_PACKAGE_EVIDENCE");
  const titleEvidenceIds = shoppingBoard.tasks.find((item) =>
    item.id === "confirm_choice").readiness.inputs.candidates.find((item) =>
    item.importId === "tofu").titleEvidenceIds;
  const eggEvidenceIds = shoppingBoard.tasks.find((item) =>
    item.id === "confirm_choice").readiness.inputs.candidates.find((item) =>
    item.importId === "egg").titleEvidenceIds;
  const confirmed = await service.confirmShoppingBasket({ commandId: "confirm-basket",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    selections: [{ ingredientId: "tofu", selectedImportId: "tofu", quantity: 2,
      packageQuantity: { status: "known", amount: 300, unit: "g" },
      packageEvidenceIds: titleEvidenceIds },
    { ingredientId: "egg", selectedImportId: "egg", quantity: 1,
      packageQuantity: { status: "known", amount: 10, unit: "count" },
      packageEvidenceIds: eggEvidenceIds }] });
  assert.equal((await service.confirmShoppingBasket({ commandId: "confirm-basket",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    selections: [{ ingredientId: "tofu", selectedImportId: "tofu", quantity: 2,
      packageQuantity: { status: "known", amount: 300, unit: "g" },
      packageEvidenceIds: titleEvidenceIds },
    { ingredientId: "egg", selectedImportId: "egg", quantity: 1,
      packageQuantity: { status: "known", amount: 10, unit: "count" },
      packageEvidenceIds: eggEvidenceIds }] })).replayed, true);
  shoppingBoard = await service.getBoard(shoppingBoard.id);
  const basket = shoppingBoard.results.find((item) =>
    item.taskId === "confirm_choice").value.choice;
  assert.equal(basket.id, confirmed.basketId);
  assert.equal(basket.lines.length, 3);
  assert.deepEqual(basket.lines.find((line) => line.ingredientId === "tofu").coverage,
    { status: "sufficient", neededQuantity: { status: "known", amount: 500, unit: "g" },
      selectedQuantity: { status: "known", amount: 600, unit: "g" },
      shortfall: { status: "known", amount: 0, unit: "g" } });
  assert.deepEqual(basket.lines.find((line) => line.ingredientId === "salt").coverage,
    { status: "unselected" });
  assert.equal(basket.lines.find((line) => line.ingredientId === "egg")
    .coverage.status, "sufficient");
  const choiceId = basket.lines.find((line) => line.ingredientId === "tofu").choices[0].id;
  const eggChoiceId = basket.lines.find((line) => line.ingredientId === "egg").choices[0].id;
  assert.equal(active(await store.snapshot(), "shopping.basket_contains_choice").length, 2);
  assert.ok(active(await store.snapshot(), "shopping.package_quantity")[0]
    .evidenceIds.some((id) => titleEvidenceIds.includes(id)));
  assert.equal(active(await store.snapshot(), "shopping.purchase_for_choice").length, 0);
  await assert.rejects(service.recordShoppingBasketOutcomes({ commandId: "basket-missing-outcome",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    outcomes: [{ choiceId: "forged", status: "purchased", actualPaidKrw: 4800 }] }),
  (error) => error.code === "INVALID_BASKET_OUTCOME");
  await service.recordShoppingBasketOutcomes({ commandId: "basket-purchase",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    outcomes: [{ choiceId, status: "purchased", actualPaidKrw: 4800 },
      { choiceId: eggChoiceId, status: "not_purchased" }] });
  shoppingBoard = await service.getBoard(shoppingBoard.id);
  await assert.rejects(service.recordShoppingInventory({ commandId: "forged-inventory",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    observations: [{ ingredientId: "egg", quantity: { status: "known",
      amount: 4, unit: "count" }, supportingChoiceIds: [choiceId] }] }),
  (error) => error.code === "INVALID_INVENTORY_OBSERVATION");
  const stock = await service.recordShoppingInventory({ commandId: "observed-tofu",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    observations: [{ ingredientId: "tofu", quantity: { status: "known",
      amount: 700, unit: "g" }, supportingChoiceIds: [choiceId] }] });
  assert.equal((await service.recordShoppingInventory({ commandId: "observed-tofu",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    observations: [{ ingredientId: "tofu", quantity: { status: "known",
      amount: 700, unit: "g" }, supportingChoiceIds: [choiceId] }] })).replayed, true);
  assert.equal(stock.observations[0].quantity.amount, 700);
  const otherShopping = await service.createShoppingScenario({
    commandId: "other-shopping", activityId: "other-shopping-board", confirmed: true,
    importIds: ["tofu", "egg"], purpose: "같은 요리 재료 추가 장보기" });
  let otherBoard = await approve(service, otherShopping, "approve-other-shopping");
  const otherLink = await service.createScenarioConnection({
    commandId: "link-other-shopping", fromActivityId: recipeBoard.id,
    toActivityId: otherBoard.id, kind: "recipe_shopping", confirmed: true,
    expectedFromRevision: (await service.getBoard(recipeBoard.id)).revision,
    expectedToRevision: otherBoard.revision });
  const otherReview = await service.getRecipeShoppingPlanReview(otherBoard.id,
    otherLink.id);
  const otherProposal = await service.proposeRecipeShoppingPlan({
    commandId: "other-recipe-needs", shoppingActivityId: otherBoard.id,
    connectionId: otherLink.id, expectedRevision: otherReview.expectedRevision,
    expectedSourceResultId: otherReview.reference.sourceResultId, confirmed: true });
  await service.acceptProposal({ proposalId: otherProposal.proposalId,
    commandId: "approve-other-needs" });
  otherBoard = await service.getBoard(otherBoard.id);
  const otherCandidates = otherBoard.tasks.find((item) =>
    item.id === "confirm_choice").readiness.inputs.candidates;
  await service.confirmShoppingBasket({ commandId: "confirm-other-basket",
    activityId: otherBoard.id, expectedRevision: otherBoard.revision,
    selections: [{ ingredientId: "tofu", selectedImportId: "tofu", quantity: 1,
      packageQuantity: { status: "known", amount: 300, unit: "g" },
      packageEvidenceIds: otherCandidates.find((item) =>
        item.importId === "tofu").titleEvidenceIds },
    { ingredientId: "egg", selectedImportId: "egg", quantity: 1,
      packageQuantity: { status: "known", amount: 10, unit: "count" },
      packageEvidenceIds: otherCandidates.find((item) =>
        item.importId === "egg").titleEvidenceIds }] });
  otherBoard = await service.getBoard(otherBoard.id);
  const otherBasket = otherBoard.results.find((item) =>
    item.taskId === "confirm_choice").value.choice;
  const otherTofuChoice = otherBasket.lines.find((item) =>
    item.ingredientId === "tofu").choices[0].id;
  const otherEggChoice = otherBasket.lines.find((item) =>
    item.ingredientId === "egg").choices[0].id;
  await service.recordShoppingBasketOutcomes({ commandId: "purchase-other-basket",
    activityId: otherBoard.id, expectedRevision: otherBoard.revision,
    outcomes: [{ choiceId: otherTofuChoice, status: "purchased", actualPaidKrw: 2400 },
      { choiceId: otherEggChoice, status: "purchased", actualPaidKrw: 4900 }] });
  otherBoard = await service.getBoard(otherBoard.id);
  await service.recordShoppingInventory({ commandId: "other-observed-stock",
    activityId: otherBoard.id, expectedRevision: otherBoard.revision,
    observations: [{ ingredientId: "tofu", quantity: { status: "known",
      amount: 200, unit: "g" }, supportingChoiceIds: [otherTofuChoice] },
    { ingredientId: "egg", quantity: { status: "known",
      amount: 3, unit: "count" }, supportingChoiceIds: [otherEggChoice] }] });
  assert.equal((await service.getRecipeInventoryCarryoverReview(recipeBoard.id)).status,
    "new_activity_required");
  const recheckRequest = { commandId: "recheck-after-shopping",
    activityId: recipeBoard.id, expectedRevision: recipeBoard.revision,
    confirmed: true };
  const recheck = await service.createRecipeRecheck(recheckRequest);
  assert.equal((await service.createRecipeRecheck(recheckRequest)).replayed, true);
  assert.equal(recheck.recheckedFrom, recipeBoard.id);
  assert.equal((await service.getBoard(recheck.activityId)).recheckedFrom, recipeBoard.id);
  let recheckBoard = await approve(service, recheck, "approve-recheck");
  await service.runTask({ commandId: "scale-recheck", activityId: recheck.activityId,
    taskId: "scale_servings", expectedRevision: recheckBoard.revision });
  recheckBoard = await service.getBoard(recheck.activityId);
  const carryover = await service.getRecipeInventoryCarryoverReview(recheck.activityId);
  assert.equal(carryover.status, "available");
  const sourceStock = carryover.sources.find((item) =>
    item.shoppingActivityId === shoppingBoard.id);
  const otherSourceStock = carryover.sources.find((item) =>
    item.shoppingActivityId === otherBoard.id);
  assert.equal(carryover.conflicts[0].ingredientId, "tofu");
  const tofuStock = sourceStock.observations.find((item) => item.ingredientId === "tofu");
  const otherEggStock = otherSourceStock.observations.find((item) =>
    item.ingredientId === "egg");
  assert.equal(tofuStock.quantity.amount, 700);
  const adoptionRequest = { commandId: "adopt-tofu-stock",
    activityId: recheck.activityId, expectedRevision: recheckBoard.revision,
    sources: [{ shoppingActivityId: shoppingBoard.id,
      purchaseFingerprint: sourceStock.purchaseFingerprint,
      observations: [{ observationId: tofuStock.observationId,
        graphFingerprint: tofuStock.graphFingerprint }] },
    { shoppingActivityId: otherBoard.id,
      purchaseFingerprint: otherSourceStock.purchaseFingerprint,
      observations: [{ observationId: otherEggStock.observationId,
        graphFingerprint: otherEggStock.graphFingerprint }] }], confirmed: true };
  await assert.rejects(service.adoptShoppingInventoryForRecipe({ ...adoptionRequest,
    commandId: "forged-stock", sources: [{ ...adoptionRequest.sources[0],
      observations: [{ observationId: "unrelated",
        graphFingerprint: tofuStock.graphFingerprint }] }, adoptionRequest.sources[1]] }),
  (error) => error.code === "INVENTORY_REVIEW_STALE");
  await assert.rejects(service.adoptShoppingInventoryForRecipe({ ...adoptionRequest,
    commandId: "stale-stock", sources: [{ ...adoptionRequest.sources[0],
      observations: [{ observationId: tofuStock.observationId,
        graphFingerprint: "outdated" }] }, adoptionRequest.sources[1]] }),
  (error) => error.code === "INVENTORY_REVIEW_STALE");
  const otherTofuStock = otherSourceStock.observations.find((item) =>
    item.ingredientId === "tofu");
  await assert.rejects(service.adoptShoppingInventoryForRecipe({ ...adoptionRequest,
    commandId: "double-count-tofu", sources: [adoptionRequest.sources[0],
      { ...adoptionRequest.sources[1], observations: [
        { observationId: otherTofuStock.observationId,
          graphFingerprint: otherTofuStock.graphFingerprint },
        ...adoptionRequest.sources[1].observations ] }] }),
  (error) => error.code === "INVALID_REQUEST");
  const adopted = await service.adoptShoppingInventoryForRecipe(adoptionRequest);
  assert.equal((await service.adoptShoppingInventoryForRecipe(adoptionRequest)).replayed, true);
  assert.equal(adopted.observationIds[0], tofuStock.observationId);
  recheckBoard = await service.getBoard(recheck.activityId);
  const inventoryResult = recheckBoard.results.find((item) => item.id === adopted.resultId);
  assert.equal(inventoryResult.value[0].quantity.amount, 700);
  assert.equal(inventoryResult.value[1].quantity.amount, 3);
  assert.ok(inventoryResult.evidenceRefs.length > 0);
  await service.runTask({ commandId: "calculate-recheck", activityId: recheck.activityId,
    taskId: "calculate_requirements", expectedRevision: recheckBoard.revision });
  recheckBoard = await service.getBoard(recheck.activityId);
  const newNeeds = recheckBoard.results.find((item) =>
    item.taskId === "calculate_requirements").value;
  assert.equal(newNeeds.items.find((item) => item.ingredientId === "tofu")
    .missingQuantity.amount, 0);
  assert.equal(newNeeds.items.find((item) => item.ingredientId === "egg")
    .missingQuantity.amount, 1);
  assert.equal((await service.listScenarioConnections(shoppingBoard.id)).connections[0]
    .recipeNeeds.items.find((item) => item.ingredientId === "tofu")
    .missingQuantity.amount, 500);
  assert.equal((await service.getRecipeInventoryCarryoverReview(recheck.activityId)).status,
    "adopted");
  let purchaseReview = await service.getShoppingPurchaseOutcomes(shoppingBoard.id);
  assert.equal(purchaseReview.outcomes.length, 2);
  const paidCorrectionRequest = { commandId: "correct-tofu-payment",
    activityId: shoppingBoard.id, choiceId,
    expectedOutcomeFingerprint: purchaseReview.fingerprint,
    status: "purchased", actualPaidKrw: 4700 };
  const paidCorrection = await service.correctShoppingPurchaseOutcome(
    paidCorrectionRequest);
  assert.equal((await service.correctShoppingPurchaseOutcome(
    paidCorrectionRequest)).replayed, true);
  assert.equal(paidCorrection.outcome.actualPaidKrw, 4700);
  assert.equal((await service.getRecipeInventoryCarryoverReview(recheck.activityId)).status,
    "adopted");
  assert.equal(activeInActivity(await store.snapshot(), "shopping.actual_paid_krw",
    shoppingBoard.id).some((item) => item.typedValue.value === 4700), true);
  await assert.rejects(service.correctShoppingPurchaseOutcome({
    ...paidCorrectionRequest, commandId: "stale-payment", actualPaidKrw: 4600,
  }), (error) => error.code === "SHOPPING_OUTCOME_CONFLICT");
  purchaseReview = await service.getShoppingPurchaseOutcomes(shoppingBoard.id);
  const eggPurchase = await service.correctShoppingPurchaseOutcome({
    commandId: "correct-egg-purchase", activityId: shoppingBoard.id,
    choiceId: eggChoiceId, expectedOutcomeFingerprint: purchaseReview.fingerprint,
    status: "purchased", actualPaidKrw: 3900 });
  assert.equal((await service.getRecipeInventoryCarryoverReview(recheck.activityId)).status,
    "adopted");
  assert.equal(active(await store.snapshot(), "shopping.purchase_for_choice")
    .some((item) => item.objectEntityId === eggChoiceId), true);
  const tofuBeforeRelink = (await service.listShoppingInventory(shoppingBoard.id))
    .observations.find((item) => item.ingredientId === "tofu");
  await assert.rejects(service.correctShoppingInventorySupport({
    commandId: "wrong-ingredient-inventory-support", activityId: shoppingBoard.id,
    observationId: tofuBeforeRelink.observationId,
    expectedGraphFingerprint: tofuBeforeRelink.graphFingerprint,
    supportingChoiceIds: [eggChoiceId],
  }), (error) => error.code === "INVALID_INVENTORY_SUPPORT");
  const eggStock = await service.recordShoppingInventory({
    commandId: "observed-egg-after-correction", activityId: shoppingBoard.id,
    expectedRevision: shoppingBoard.revision,
    observations: [{ ingredientId: "egg", quantity: { status: "known",
      amount: 10, unit: "count" }, supportingChoiceIds: [eggChoiceId] }] });
  const eggObservation = (await service.listShoppingInventory(shoppingBoard.id))
    .observations.find((item) => item.ingredientId === "egg");
  const eggInventoryCorrectionRequest = { commandId: "correct-observed-egg",
    activityId: shoppingBoard.id,
    observationId: eggStock.observations[0].observationId,
    expectedAssertionId: eggObservation.assertionId,
    quantity: { status: "known", amount: 8, unit: "count" } };
  await service.correctShoppingInventoryObservation(eggInventoryCorrectionRequest);
  assert.equal((await service.listShoppingInventory(shoppingBoard.id))
    .observations.find((item) => item.ingredientId === "egg").quantity.amount, 8);
  await assert.rejects(service.correctShoppingPurchaseOutcome({
    commandId: "remove-supported-tofu-purchase", activityId: shoppingBoard.id,
    choiceId, expectedOutcomeFingerprint: eggPurchase.fingerprint,
    status: "not_purchased",
  }), (error) => error.code === "INVENTORY_DEPENDS_ON_PURCHASE");
  await assert.rejects(service.correctShoppingPurchaseOutcome({
    commandId: "remove-supported-egg-purchase", activityId: shoppingBoard.id,
    choiceId: eggChoiceId, expectedOutcomeFingerprint: eggPurchase.fingerprint,
    status: "not_purchased",
  }), (error) => error.code === "INVENTORY_DEPENDS_ON_PURCHASE");
  const eggInventorySourceId = eggStock.observations[0].observationId
    .replace(/:observation:\d+$/, "");
  await service.knowledgeCommand({ commandId: "delete-egg-inventory-report",
    type: "source.delete", payload: { sourceId: eggInventorySourceId } });
  await assert.rejects(service.correctShoppingInventoryObservation(
    eggInventoryCorrectionRequest),
  (error) => error.code === "CORRECTION_DELETED");
  assert.equal((await service.listShoppingInventory(shoppingBoard.id))
    .observations.some((item) => item.ingredientId === "egg"), false);
  await service.correctShoppingPurchaseOutcome({
    commandId: "correct-egg-unpurchased", activityId: shoppingBoard.id,
    choiceId: eggChoiceId, expectedOutcomeFingerprint: eggPurchase.fingerprint,
    status: "not_purchased" });
  assert.equal(active(await store.snapshot(), "shopping.purchase_for_choice")
    .some((item) => item.objectEntityId === eggChoiceId), false);
  let observations = (await service.listShoppingInventory(shoppingBoard.id)).observations;
  assert.equal(observations[0].quantity.amount, 700);
  const inventoryCorrectionRequest = { commandId: "correct-observed-tofu",
    activityId: shoppingBoard.id, observationId: stock.observations[0].observationId,
    expectedAssertionId: observations[0].assertionId,
    quantity: { status: "known", amount: 650, unit: "g" } };
  const inventoryCorrection = await service.correctShoppingInventoryObservation(
    inventoryCorrectionRequest);
  assert.equal((await service.correctShoppingInventoryObservation(
    inventoryCorrectionRequest)).replayed, true);
  observations = (await service.listShoppingInventory(shoppingBoard.id)).observations;
  assert.equal(observations[0].quantity.amount, 650);
  assert.equal((await service.getRecipeInventoryCarryoverReview(recheck.activityId)).status,
    "stale");
  assert.equal((await service.getBoard(recheck.activityId)).pendingChanges.some((item) =>
    item.reasonCode === "INVENTORY_OBSERVATION_STALE"), true);
  const refreshed = await service.createRecipeRecheck({ commandId: "recheck-corrected-stock",
    activityId: recheck.activityId,
    expectedRevision: (await service.getBoard(recheck.activityId)).revision,
    confirmed: true });
  let refreshedBoard = await approve(service, refreshed, "approve-corrected-recheck");
  await service.runTask({ commandId: "scale-corrected-recheck",
    activityId: refreshed.activityId, taskId: "scale_servings",
    expectedRevision: refreshedBoard.revision });
  refreshedBoard = await service.getBoard(refreshed.activityId);
  const refreshedReview = await service.getRecipeInventoryCarryoverReview(refreshed.activityId);
  assert.equal(refreshedReview.status, "available");
  const refreshedSource = refreshedReview.sources.find((item) =>
    item.shoppingActivityId === shoppingBoard.id);
  const refreshedTofu = refreshedSource.observations.find((item) =>
    item.ingredientId === "tofu");
  assert.equal(refreshedTofu.quantity.amount, 650);
  await service.adoptShoppingInventoryForRecipe({ commandId: "adopt-corrected-stock",
    activityId: refreshed.activityId, shoppingActivityId: shoppingBoard.id,
    expectedRevision: refreshedBoard.revision,
    purchaseFingerprint: refreshedSource.purchaseFingerprint,
    observations: [{ observationId: refreshedTofu.observationId,
      graphFingerprint: refreshedTofu.graphFingerprint }], confirmed: true });
  assert.equal((await service.getBoard(refreshed.activityId)).results.find((item) =>
    item.taskId === "check_inventory").value[0].quantity.amount, 650);
  assert.equal((await service.getRecipeInventoryCarryoverReview(refreshed.activityId)).status,
    "adopted");
  assert.equal(observations[0].assertionId, inventoryCorrection.assertionId);
  assert.equal(activeInActivity(await store.snapshot(), "recipe.observes_inventory",
    shoppingBoard.id).length, 1);
  assert.equal(activeInActivity(await store.snapshot(), "shopping.inventory_after_choice",
    shoppingBoard.id).length, 1);
  await assert.rejects(service.correctShoppingInventoryObservation({
    ...inventoryCorrectionRequest, commandId: "stale-tofu-stock",
    quantity: { status: "known", amount: 600, unit: "g" },
  }), (error) => error.code === "INVENTORY_REVISION_CONFLICT");
  const state = await store.snapshot();
  assert.equal(activeInActivity(state, "shopping.purchase_for_choice",
    shoppingBoard.id).length, 1);
  assert.equal(activeInActivity(state, "shopping.purchase_for_choice",
    shoppingBoard.id)[0].objectEntityId, choiceId);
  assert.equal(activeInActivity(state, "recipe.observed_inventory",
    shoppingBoard.id).length, 1);
  assert.equal(activeInActivity(state, "shopping.inventory_after_choice",
    shoppingBoard.id).length, 1);
  assert.equal((await service.listScenarioConnections(shoppingBoard.id)).connections[0]
    .recipeNeeds.items.find((item) => item.ingredientId === "tofu")
    .missingQuantity.amount, 500);
  assert.equal((await service.getShoppingBasketReview(shoppingBoard.id)).status,
    "current");
  const editableBasket = await service.getEditableShoppingBasket(shoppingBoard.id);
  assert.equal(editableBasket.basket.id, basket.id);
  await assert.rejects(service.correctShoppingBasket({
    commandId: "unchanged-basket", activityId: shoppingBoard.id,
    expectedGraphFingerprint: editableBasket.graphFingerprint,
    selections: basket.lines.flatMap((line) => line.choices.map((choice) => ({
      ingredientId: line.ingredientId, selectedImportId: choice.importId,
      quantity: choice.quantity, packageQuantity: choice.packageQuantity,
      ...(choice.packageEvidenceIds ?
        { packageEvidenceIds: choice.packageEvidenceIds } : {}),
    }))), confirmed: true }),
  (error) => error.code === "UNCHANGED_BASKET");
  await assert.rejects(service.correctShoppingBasket({
    commandId: "forged-basket-evidence", activityId: shoppingBoard.id,
    expectedGraphFingerprint: editableBasket.graphFingerprint,
    selections: [{ ingredientId: "tofu", selectedImportId: "tofu",
      quantity: 1, packageQuantity: { status: "known", amount: 250, unit: "g" },
      packageEvidenceIds: ["not-from-capture"] }], confirmed: true }),
  (error) => error.code === "INVALID_PACKAGE_EVIDENCE");
  const basketCorrectionRequest = { commandId: "correct-basket",
    activityId: shoppingBoard.id,
    expectedGraphFingerprint: editableBasket.graphFingerprint,
    selections: [{ ingredientId: "tofu", selectedImportId: "tofu",
      quantity: 1, packageQuantity: { status: "known", amount: 250, unit: "g" } }],
    confirmed: true };
  const basketCorrection = await service.correctShoppingBasket(basketCorrectionRequest);
  assert.equal((await service.correctShoppingBasket(basketCorrectionRequest)).replayed, true);
  await assert.rejects(service.recordShoppingBasketOutcomes({
    commandId: "purchase-after-basket-correction", activityId: shoppingBoard.id,
    expectedRevision: shoppingBoard.revision,
    outcomes: [{ choiceId, status: "purchased", actualPaidKrw: 4800 },
      { choiceId: eggChoiceId, status: "not_purchased" }] }),
  (error) => error.code === "SHOPPING_BASKET_CORRECTED");
  await assert.rejects(service.correctShoppingBasket({ ...basketCorrectionRequest,
    commandId: "stale-basket", selections: [] }),
  (error) => error.code === "SHOPPING_REVISION_CONFLICT");
  let correctedBasket = await service.getEditableShoppingBasket(shoppingBoard.id);
  assert.equal(correctedBasket.basket.id, basketCorrection.basketId);
  assert.equal(correctedBasket.basket.lines.find((line) =>
    line.ingredientId === "egg").coverage.status, "unselected");
  assert.equal(correctedBasket.basket.lines.find((line) =>
    line.ingredientId === "tofu").coverage.status, "insufficient");
  assert.equal(active(await store.snapshot(), "shopping.basket_supersedes_basket")
    .find((item) => item.subjectId === basketCorrection.basketId)?.objectEntityId,
  basket.id);
  assert.equal(activeInActivity(await store.snapshot(), "shopping.purchase_for_choice",
    shoppingBoard.id)[0]
    .objectEntityId, choiceId);
  assert.equal(activeInActivity(await store.snapshot(), "shopping.inventory_after_choice",
    shoppingBoard.id)[0]
    .objectEntityId, choiceId);
  const reassigned = await service.correctShoppingBasket({
    commandId: "reassign-basket", activityId: shoppingBoard.id,
    expectedGraphFingerprint: correctedBasket.graphFingerprint,
    selections: [{ ingredientId: "egg", selectedImportId: "tofu",
      quantity: 1, packageQuantity: { status: "known", amount: 250, unit: "g" } },
    { ingredientId: "tofu", selectedImportId: "egg",
      quantity: 2, packageQuantity: { status: "unknown" } }],
    confirmed: true });
  correctedBasket = await service.getEditableShoppingBasket(shoppingBoard.id);
  assert.equal(correctedBasket.basket.id, reassigned.basketId);
  assert.equal(correctedBasket.basket.lines.find((line) =>
    line.ingredientId === "egg").choices[0].importId, "tofu");
  assert.equal(correctedBasket.basket.lines.find((line) =>
    line.ingredientId === "egg").coverage.status, "incompatible_unit");
  assert.equal((await service.getBoardReview(shoppingBoard.id)).status, "blocked");
  const reviewBoard = await service.getBoard(shoppingBoard.id);
  const successor = await service.createReviewSuccessor({
    commandId: "continue-corrected-basket", activityId: shoppingBoard.id,
    expectedRevision: reviewBoard.revision, confirmed: true });
  assert.equal(successor.continuedFrom, shoppingBoard.id);
  assert.equal((await service.getBoard(successor.activityId)).scenario, "shopping");
  const emptied = await service.correctShoppingBasket({
    commandId: "empty-basket", activityId: shoppingBoard.id,
    expectedGraphFingerprint: correctedBasket.graphFingerprint,
    selections: [], confirmed: true });
  assert.equal((await service.getEditableShoppingBasket(shoppingBoard.id))
    .basket.id, emptied.basketId);
  assert.equal((await service.getEditableShoppingBasket(shoppingBoard.id))
    .basket.lines.every((line) => line.coverage.status === "unselected"), true);
  assert.deepEqual((await service.getBoard(shoppingBoard.id)).results.find((item) =>
    item.taskId === "confirm_choice").value.choice, basket);
  const editable = await service.getEditableRecipe(recipeBoard.id);
  await service.correctRecipe({ commandId: "basket-recipe-correction",
    activityId: recipeBoard.id, expectedAssertionId: editable.assertionId,
    confirmed: true, recipe: { title: editable.recipe.title,
      baseServings: editable.recipe.baseServings,
      ingredients: editable.recipe.ingredients.map((item) => item.id === "tofu"
        ? { ...item, quantity: { status: "known", amount: 350, unit: "g" } }
        : item), steps: editable.recipe.steps ?? [] } });
  assert.equal((await service.getShoppingBasketReview(shoppingBoard.id)).status,
    "stale");
  await assert.rejects(service.getEditableShoppingBasket(shoppingBoard.id),
    (error) => error.code === "RECIPE_NEEDS_STALE");
  assert.deepEqual((await service.getBoard(shoppingBoard.id)).results.find((item) =>
    item.taskId === "confirm_choice").value.choice, basket);
  await service.recordShoppingInventory({ commandId: "observed-tofu-again",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    observations: [{ ingredientId: "tofu", quantity: { status: "known",
      amount: 650, unit: "g" }, supportingChoiceIds: [choiceId] }] });
  assert.equal((await service.listShoppingInventory(shoppingBoard.id))
    .observations.length, 2);
  await service.deleteReviewedCapture({ importId: "egg",
    commandId: "delete-basket-egg-image" });
  assert.equal((await service.getRecipeInventoryCarryoverReview(recheck.activityId)).status,
    "stale");
  assert.equal((await service.getBoard(recheck.activityId)).results.find((item) =>
    item.taskId === "calculate_requirements").value.items.find((item) =>
    item.ingredientId === "tofu").missingQuantity.amount, 0);
  assert.equal(active(await store.snapshot(), "recipe.observed_inventory").length, 0);
  assert.equal((await store.snapshot()).knowledge.assertions.filter((item) =>
    item.status === "active" && item.scope?.id === shoppingBoard.id &&
    item.predicate?.startsWith("shopping.")).length, 0);
  await assert.rejects(service.recordShoppingInventory({ commandId: "observed-tofu",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    observations: [{ ingredientId: "tofu", quantity: { status: "known",
      amount: 700, unit: "g" }, supportingChoiceIds: [choiceId] }] }),
  (error) => error.code === "SCENARIO_DELETED");
  await assert.rejects(service.correctShoppingBasket(basketCorrectionRequest),
    (error) => error.code === "CORRECTION_DELETED");
  await assert.rejects(service.correctShoppingPurchaseOutcome(
    paidCorrectionRequest),
  (error) => error.code === "CORRECTION_DELETED");
  await assert.rejects(service.correctShoppingInventoryObservation(
    inventoryCorrectionRequest),
  (error) => error.code === "CORRECTION_DELETED");
});
}

for (const backend of ["json", "postgres"]) {
test(`one inventory observation can change its purchased support and then be canceled (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  await importCapture(service, "recipe");
  await importCapture(service, "tofu");
  await importCapture(service, "tofu", "tofu_alt");
  const recipe = await service.createRecipeScenario({ commandId: "support-recipe",
    activityId: "support-recipe-board", confirmed: true, importId: "recipe",
    targetServings: 2, inventory: [], recipe: { id: "support-recipe",
      revision: 1, title: "두부 볶음", baseServings: 2,
      ingredients: [{ id: "tofu", ingredientId: "tofu", name: "두부",
        quantity: { status: "known", amount: 300, unit: "g" },
        scaling: "linear" }] } });
  let recipeBoard = await approve(service, recipe, "approve-support-recipe");
  await service.runTask({ commandId: "support-scale", activityId: recipeBoard.id,
    taskId: "scale_servings", expectedRevision: recipeBoard.revision });
  recipeBoard = await service.getBoard(recipeBoard.id);
  await assert.rejects(service.activityCommand({ commandId: "support-unrelated-stock",
    type: "task.recordResult", activityId: recipeBoard.id,
    expectedRevision: recipeBoard.revision,
    payload: { taskId: "check_inventory", value: [{ ingredientId: "unrelated",
      quantity: { status: "known", amount: 100, unit: "g" },
      observedAt: "2026-09-27T09:00:00+09:00" }] } }),
  (error) => error.code === "INVALID_OUTPUT");
  await service.activityCommand({ commandId: "support-stock", type: "task.recordResult",
    activityId: recipeBoard.id, expectedRevision: recipeBoard.revision,
    payload: { taskId: "check_inventory", value: [{ ingredientId: "tofu",
      quantity: { status: "known", amount: 0, unit: "g" },
      observedAt: "2026-09-27T09:00:00+09:00" }] } });
  recipeBoard = await service.getBoard(recipeBoard.id);
  await service.activityCommand({ commandId: "support-stock-done",
    type: "task.transition", activityId: recipeBoard.id,
    expectedRevision: recipeBoard.revision,
    payload: { taskId: "check_inventory", to: "completed" } });
  recipeBoard = await service.getBoard(recipeBoard.id);
  await service.runTask({ commandId: "support-needs", activityId: recipeBoard.id,
    taskId: "calculate_requirements", expectedRevision: recipeBoard.revision });
  const shopping = await service.createShoppingScenario({ commandId: "support-shopping",
    activityId: "support-shopping-board", confirmed: true,
    importIds: ["tofu", "tofu_alt"], purpose: "두부 장보기" });
  let shoppingBoard = await approve(service, shopping, "approve-support-shopping");
  recipeBoard = await service.getBoard(recipeBoard.id);
  const link = await service.createScenarioConnection({ commandId: "support-link",
    fromActivityId: recipeBoard.id, toActivityId: shoppingBoard.id,
    kind: "recipe_shopping", confirmed: true,
    expectedFromRevision: recipeBoard.revision,
    expectedToRevision: shoppingBoard.revision });
  const review = await service.getRecipeShoppingPlanReview(shoppingBoard.id, link.id);
  const proposed = await service.proposeRecipeShoppingPlan({
    commandId: "support-propose", shoppingActivityId: shoppingBoard.id,
    connectionId: link.id, expectedRevision: review.expectedRevision,
    expectedSourceResultId: review.reference.sourceResultId, confirmed: true });
  await service.acceptProposal({ proposalId: proposed.proposalId,
    commandId: "approve-support-needs" });
  shoppingBoard = await service.getBoard(shoppingBoard.id);
  const candidates = shoppingBoard.tasks.find((item) => item.id === "confirm_choice")
    .readiness.inputs.candidates;
  await service.confirmShoppingBasket({ commandId: "support-basket",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    selections: candidates.map((candidate) => ({ ingredientId: "tofu",
      selectedImportId: candidate.importId, quantity: 1,
      packageQuantity: { status: "known", amount: 300, unit: "g" },
      packageEvidenceIds: candidate.titleEvidenceIds })) });
  shoppingBoard = await service.getBoard(shoppingBoard.id);
  const basket = shoppingBoard.results.find((item) =>
    item.taskId === "confirm_choice").value.choice;
  const [firstChoice, secondChoice] = basket.lines[0].choices.map((item) => item.id);
  await service.recordShoppingBasketOutcomes({ commandId: "support-purchases",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    outcomes: [firstChoice, secondChoice].map((choiceId) => ({ choiceId,
      status: "purchased", actualPaidKrw: 2400 })) });
  shoppingBoard = await service.getBoard(shoppingBoard.id);
  const recorded = await service.recordShoppingInventory({ commandId: "support-observed",
    activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
    observations: [{ ingredientId: "tofu", quantity: { status: "known",
      amount: 400, unit: "g" }, supportingChoiceIds: [firstChoice] }] });
  const observationId = recorded.observations[0].observationId;
  const before = (await service.listShoppingInventory(shoppingBoard.id)).observations[0];
  assert.deepEqual(before.supportingChoiceIds, [firstChoice]);
  await assert.rejects(service.correctShoppingInventorySupport({
    commandId: "support-forged", activityId: shoppingBoard.id,
    observationId, expectedGraphFingerprint: before.graphFingerprint,
    supportingChoiceIds: ["not-a-purchased-choice"],
  }), (error) => error.code === "INVALID_INVENTORY_SUPPORT");
  const request = { commandId: "support-relink", activityId: shoppingBoard.id,
    observationId, expectedGraphFingerprint: before.graphFingerprint,
    supportingChoiceIds: [secondChoice] };
  const corrected = await service.correctShoppingInventorySupport(request);
  assert.equal((await service.correctShoppingInventorySupport(request)).replayed, true);
  const after = (await service.listShoppingInventory(shoppingBoard.id)).observations[0];
  assert.deepEqual(after.supportingChoiceIds, [secondChoice]);
  assert.equal(after.quantity.amount, 400);
  assert.equal(after.graphFingerprint, corrected.graphFingerprint);
  assert.deepEqual(active(await store.snapshot(), "shopping.inventory_after_choice")
    .map((item) => item.objectEntityId), [secondChoice]);
  await assert.rejects(service.correctShoppingInventorySupport({
    ...request, commandId: "support-stale", supportingChoiceIds: [firstChoice],
  }), (error) => error.code === "INVENTORY_REVISION_CONFLICT");
  const recheck = await service.createRecipeRecheck({ commandId: "support-recheck",
    activityId: recipeBoard.id, expectedRevision: recipeBoard.revision,
    confirmed: true });
  let recheckBoard = await approve(service, recheck, "approve-support-recheck");
  await service.runTask({ commandId: "support-recheck-scale",
    activityId: recheck.activityId, taskId: "scale_servings",
    expectedRevision: recheckBoard.revision });
  recheckBoard = await service.getBoard(recheck.activityId);
  const carryover = await service.getRecipeInventoryCarryoverReview(recheck.activityId);
  const candidate = carryover.sources.find((item) =>
    item.shoppingActivityId === shoppingBoard.id);
  await service.adoptShoppingInventoryForRecipe({ commandId: "support-adopt",
    activityId: recheck.activityId, expectedRevision: recheckBoard.revision,
    confirmed: true, sources: [{ shoppingActivityId: shoppingBoard.id,
      purchaseFingerprint: candidate.purchaseFingerprint,
      observations: [{ observationId,
        graphFingerprint: candidate.observations[0].graphFingerprint }] }] });
  recheckBoard = await service.getBoard(recheck.activityId);
  const adoptedResult = recheckBoard.results.find((item) =>
    item.taskId === "check_inventory");
  const cancelRequest = { commandId: "support-cancel", activityId: shoppingBoard.id,
    observationId, expectedGraphFingerprint: after.graphFingerprint };
  const canceled = await service.cancelShoppingInventoryObservation(cancelRequest);
  assert.equal((await service.cancelShoppingInventoryObservation(cancelRequest)).replayed, true);
  assert.equal(canceled.canceled, true);
  assert.deepEqual((await service.listShoppingInventory(shoppingBoard.id)).observations, []);
  assert.equal((await service.getRecipeInventoryCarryoverReview(recheck.activityId)).status,
    "stale");
  await assert.rejects(service.runTask({ commandId: "support-canceled-needs",
    activityId: recheck.activityId, taskId: "calculate_requirements",
    expectedRevision: recheckBoard.revision }),
  (error) => ["CONTEXT_STALE", "TASK_BLOCKED"].includes(error.code));
  assert.deepEqual((await service.getBoard(recheck.activityId)).results.find((item) =>
    item.id === adoptedResult.id), adoptedResult);
  const state = await store.snapshot();
  assert.equal(state.knowledge.sources.find((item) =>
    item.id === recorded.observations[0].observationId.replace(/:observation:\d+$/, ""))
    .status, "active");
  assert.equal(active(state, "recipe.observed_inventory").length, 0);
  assert.equal(active(state, "recipe.observes_inventory").length, 0);
  assert.equal(active(state, "shopping.inventory_after_choice").length, 0);
  const purchase = await service.getShoppingPurchaseOutcomes(shoppingBoard.id);
  await service.correctShoppingPurchaseOutcome({ commandId: "unpurchase-after-cancel",
    activityId: shoppingBoard.id, choiceId: secondChoice,
    expectedOutcomeFingerprint: purchase.fingerprint, status: "not_purchased" });
  await assert.rejects(service.cancelShoppingInventoryObservation({
    ...cancelRequest, commandId: "cancel-again",
  }), (error) => error.code === "INVENTORY_GRAPH_CONFLICT");
  await service.knowledgeCommand({ commandId: "delete-inventory-cancellation",
    type: "source.delete", payload: { sourceId: canceled.sourceId } });
  await assert.rejects(service.getBoard(shoppingBoard.id),
    (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.correctShoppingInventorySupport(request),
    (error) => error.code === "CORRECTION_DELETED");
});
}

for (const backend of ["json", "postgres"]) {
test(`a corrected image-backed recipe hides old shopping amounts until a successor recalculates (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  await importCapture(service, "recipe");
  await importCapture(service, "tofu");
  const createdRecipe = await service.createRecipeScenario({ commandId: "create-correctable-recipe",
    activityId: "correctable-recipe", confirmed: true, importId: "recipe",
    targetServings: 4, inventory: [], recipe: { id: "tofu-egg-correction", revision: 1,
      title: "두부 달걀 볶음", baseServings: 2, ingredients: [
        { id: "tofu", ingredientId: "tofu", name: "두부",
          quantity: { status: "known", amount: 300, unit: "g" }, scaling: "linear" },
        { id: "egg", ingredientId: "egg", name: "달걀",
          quantity: { status: "known", amount: 2, unit: "count" }, scaling: "linear" },
      ] } });
  await approve(service, createdRecipe, "approve-correctable-recipe");
  const createdShopping = await service.createShoppingScenario({ commandId: "create-linked-shopping",
    activityId: "linked-shopping", confirmed: true, importIds: ["tofu"],
    purpose: "두부 달걀 볶음 재료 고르기" });
  await approve(service, createdShopping, "approve-linked-shopping");
  const connect = async (fromActivityId, commandId) => {
    const from = await service.getBoard(fromActivityId);
    const to = await service.getBoard("linked-shopping");
    return service.createScenarioConnection({ commandId, confirmed: true,
      kind: "recipe_shopping", fromActivityId, toActivityId: "linked-shopping",
      expectedFromRevision: from.revision, expectedToRevision: to.revision });
  };
  const oldLink = await connect("correctable-recipe", "link-old-recipe");
  const calculate = async (activityId, stem) => {
    let current = await service.getBoard(activityId);
    await service.runTask({ commandId: `${stem}-scale`, activityId,
      taskId: "scale_servings", expectedRevision: current.revision });
    current = await service.getBoard(activityId);
    await service.activityCommand({ commandId: `${stem}-stock`, type: "task.recordResult",
      activityId, expectedRevision: current.revision,
      payload: { taskId: "check_inventory", value: [] } });
    current = await service.getBoard(activityId);
    await service.activityCommand({ commandId: `${stem}-finish-stock`, type: "task.transition",
      activityId, expectedRevision: current.revision,
      payload: { taskId: "check_inventory", to: "completed" } });
    current = await service.getBoard(activityId);
    await service.runTask({ commandId: `${stem}-needs`, activityId,
      taskId: "calculate_requirements", expectedRevision: current.revision });
  };
  await calculate("correctable-recipe", "old");
  const needsFor = async (id) => (await service.listScenarioConnections("linked-shopping"))
    .connections.find((item) => item.id === id)?.recipeNeeds;
  const oldReady = await needsFor(oldLink.id);
  assert.equal(oldReady.status, "ready");
  assert.equal(oldReady.recipeRevision, 1);
  assert.equal(oldReady.items.find((item) => item.ingredientId === "tofu")
    .requiredQuantity.amount, 600);
  const oldReview = await service.getRecipeShoppingPlanReview("linked-shopping", oldLink.id);
  assert.equal(oldReview.after.items.find((item) => item.ingredientId === "tofu")
    .requiredQuantity.amount, 600);
  const oldProposalRequest = { commandId: "propose-old-recipe-needs",
    shoppingActivityId: "linked-shopping", connectionId: oldLink.id,
    expectedRevision: oldReview.expectedRevision,
    expectedSourceResultId: oldReview.reference.sourceResultId, confirmed: true };
  await assert.rejects(service.proposeRecipeShoppingPlan({ ...oldProposalRequest,
    commandId: "unreviewed-needs", expectedSourceResultId: "another-result" }),
  (error) => error.code === "RECIPE_NEEDS_STALE");
  const oldProposal = await service.proposeRecipeShoppingPlan(oldProposalRequest);
  assert.equal((await service.proposeRecipeShoppingPlan(oldProposalRequest)).replayed, true);
  assert.equal((await service.getBoard("linked-shopping")).tasks.find((item) =>
    item.id === "confirm_choice").inputBindings.linkedRecipe, undefined);
  const setStoredOutputRevision = async (revision) => store.transact((state) => {
    const activity = state.activities.activities["correctable-recipe"];
    const task = activity.tasks.find((item) => item.id === "calculate_requirements");
    activity.results.find((item) => item.id === task.latestOutputRef)
      .value.recipeRevision = revision;
    return { state, result: null };
  });
  await setStoredOutputRevision(9);
  assert.deepEqual(await needsFor(oldLink.id), { status: "stale" });
  await setStoredOutputRevision(1);
  assert.equal((await needsFor(oldLink.id)).status, "ready");

  const editable = await service.getEditableRecipe("correctable-recipe");
  await service.correctRecipe({ commandId: "change-tofu-amount",
    activityId: "correctable-recipe", expectedAssertionId: editable.assertionId,
    confirmed: true, recipe: { title: editable.recipe.title,
      baseServings: editable.recipe.baseServings,
      ingredients: editable.recipe.ingredients.map((item) => item.id === "tofu"
        ? { ...item, quantity: { status: "known", amount: 350, unit: "g" } } : item),
      steps: editable.recipe.steps ?? [] } });
  const stale = await needsFor(oldLink.id);
  assert.deepEqual(stale, { status: "stale" });
  await assert.rejects(service.acceptProposal({ proposalId: oldProposal.proposalId,
    commandId: "accept-old-needs" }), (error) => error.code === "RECIPE_NEEDS_STALE");
  assert.equal((await service.getBoardReview("correctable-recipe")).reasonCode,
    "STARTED_TASK_PROTECTED");

  const oldBoard = await service.getBoard("correctable-recipe");
  const successor = await service.createReviewSuccessor({ commandId: "continue-corrected-recipe",
    activityId: "correctable-recipe", expectedRevision: oldBoard.revision,
    confirmed: true });
  await service.acceptProposal({ proposalId: successor.proposalId,
    commandId: "approve-corrected-successor" });
  const transferPreview = await service.getRecipeShoppingTransferReview(oldLink.id);
  assert.equal(transferPreview.successors.find((item) =>
    item.activityId === successor.activityId).recipeNeeds.status, "not_ready");
  await calculate(successor.activityId, "new");
  const transferReview = await service.getRecipeShoppingTransferReview(oldLink.id);
  const candidate = transferReview.successors.find((item) =>
    item.activityId === successor.activityId);
  assert.equal(candidate.recipeNeeds.status, "ready");
  const transferRequest = { commandId: "move-corrected-recipe", confirmed: true,
    connectionId: oldLink.id, successorActivityId: successor.activityId,
    expectedSourceRevision: transferReview.expectedSourceRevision,
    expectedShoppingRevision: transferReview.expectedShoppingRevision,
    expectedSuccessorRevision: candidate.revision,
    expectedSourceResultId: candidate.recipeNeeds.sourceResultId };
  await assert.rejects(service.transferRecipeShoppingConnection({ ...transferRequest,
    commandId: "move-unreviewed-result", expectedSourceResultId: "wrong-result" }),
  (error) => error.code === "RECIPE_NEEDS_STALE");
  await assert.rejects(service.transferRecipeShoppingConnection({ ...transferRequest,
    commandId: "move-unrelated-recipe", successorActivityId: "correctable-recipe" }),
  (error) => error.code === "INVALID_SUCCESSOR");
  const moved = await service.transferRecipeShoppingConnection(transferRequest);
  assert.equal((await service.transferRecipeShoppingConnection(transferRequest)).replayed, true);
  await assert.rejects(service.transferRecipeShoppingConnection({ ...transferRequest,
    successorActivityId: "correctable-recipe" }),
  (error) => error.code === "COMMAND_ID_CONFLICT");
  const nextLink = { id: moved.connectionId };
  assert.equal((await service.listScenarioConnections("linked-shopping")).connections
    .some((entry) => entry.id === oldLink.id), false);
  const current = await needsFor(nextLink.id);
  assert.equal(current.status, "ready");
  assert.equal(current.recipeRevision, 1);
  assert.equal(current.sourceActivityId, successor.activityId);
  assert.notEqual(current.sourceResultId, oldReady.sourceResultId);
  assert.equal(current.items.find((item) => item.ingredientId === "tofu")
    .requiredQuantity.amount, 700);
  assert.equal(await needsFor(oldLink.id), undefined);
  const newReview = await service.getRecipeShoppingPlanReview("linked-shopping", nextLink.id);
  assert.equal(newReview.before, null);
  assert.equal(newReview.changes.length, 2);
  const newProposal = await service.proposeRecipeShoppingPlan({
    commandId: "propose-new-recipe-needs", shoppingActivityId: "linked-shopping",
    connectionId: nextLink.id, expectedRevision: newReview.expectedRevision,
    expectedSourceResultId: newReview.reference.sourceResultId,
    confirmed: true });
  await service.acceptProposal({ proposalId: newProposal.proposalId,
    commandId: "accept-new-needs" });
  const shoppingBoard = await service.getBoard("linked-shopping");
  assert.deepEqual(shoppingBoard.pendingChanges, []);
  assert.equal(shoppingBoard.tasks.find((item) => item.id === "confirm_choice")
    .inputBindings.linkedRecipe.sourceResultId, current.sourceResultId);
  assert.equal(shoppingBoard.tasks.find((item) => item.id === "confirm_choice")
    .executionStatus, "not_started");
  const successorRecipe = await service.getEditableRecipe(successor.activityId);
  await service.correctRecipe({ commandId: "change-linked-recipe-again",
    activityId: successor.activityId, expectedAssertionId: successorRecipe.assertionId,
    confirmed: true, recipe: { title: successorRecipe.recipe.title,
      baseServings: successorRecipe.recipe.baseServings,
      ingredients: successorRecipe.recipe.ingredients.map((item) => item.id === "tofu"
        ? { ...item, quantity: { status: "known", amount: 400, unit: "g" } } : item),
      steps: successorRecipe.recipe.steps ?? [] } });
  assert.deepEqual(await needsFor(nextLink.id), { status: "stale" });
  assert.ok((await service.getBoard("linked-shopping")).pendingChanges.some((item) =>
    item.reasonCode === "RECIPE_NEEDS_STALE"));
  await assert.rejects(service.confirmShoppingChoice({ commandId: "choose-stale-tofu",
    activityId: "linked-shopping", expectedRevision: shoppingBoard.revision,
    selectedImportId: "tofu", quantity: 1 }),
  (error) => ["CONTEXT_STALE", "RECIPE_NEEDS_STALE"].includes(error.code));
  const successorBoard = await service.getBoard(successor.activityId);
  const secondSuccessor = await service.createReviewSuccessor({
    commandId: "continue-recipe-again", activityId: successor.activityId,
    expectedRevision: successorBoard.revision, confirmed: true });
  await service.acceptProposal({ proposalId: secondSuccessor.proposalId,
    commandId: "approve-second-successor" });
  await calculate(secondSuccessor.activityId, "second");
  const secondTransferReview = await service.getRecipeShoppingTransferReview(nextLink.id);
  const secondCandidate = secondTransferReview.successors.find((item) =>
    item.activityId === secondSuccessor.activityId);
  const secondTransfer = await service.transferRecipeShoppingConnection({
    commandId: "move-second-successor", confirmed: true,
    connectionId: nextLink.id, successorActivityId: secondSuccessor.activityId,
    expectedSourceRevision: secondTransferReview.expectedSourceRevision,
    expectedShoppingRevision: secondTransferReview.expectedShoppingRevision,
    expectedSuccessorRevision: secondCandidate.revision,
    expectedSourceResultId: secondCandidate.recipeNeeds.sourceResultId });
  const secondLink = { id: secondTransfer.connectionId };
  assert.equal((await service.listScenarioConnections("linked-shopping")).connections.length, 1);
  assert.equal((await service.getBoardReview("linked-shopping")).reasonCode,
    "RECIPE_NEEDS_STALE");
  await assert.rejects(service.createReviewSuccessor({
    commandId: "do-not-drop-unstarted-recipe-link", activityId: "linked-shopping",
    expectedRevision: (await service.getBoard("linked-shopping")).revision,
    confirmed: true }), (error) => error.code === "RECIPE_NEEDS_STALE");
  const secondReview = await service.getRecipeShoppingPlanReview(
    "linked-shopping", secondLink.id);
  assert.equal(secondReview.before.items.find((item) => item.ingredientId === "tofu")
    .requiredQuantity.amount, 700);
  assert.equal(secondReview.after.items.find((item) => item.ingredientId === "tofu")
    .requiredQuantity.amount, 800);
  assert.equal(secondReview.changes.find((item) =>
    item.after?.ingredientId === "tofu")?.type, "changed");
  const secondProposal = await service.proposeRecipeShoppingPlan({
    commandId: "propose-second-recipe-needs", shoppingActivityId: "linked-shopping",
    connectionId: secondLink.id, expectedRevision: secondReview.expectedRevision,
    expectedSourceResultId: secondReview.reference.sourceResultId,
    confirmed: true });
  await service.acceptProposal({ proposalId: secondProposal.proposalId,
    commandId: "accept-second-needs" });
  assert.equal((await service.getBoard("linked-shopping")).tasks.find((item) =>
    item.id === "confirm_choice").inputBindings.linkedRecipe.connectionId,
  secondLink.id);
  const readyShopping = await service.getBoard("linked-shopping");
  await assert.rejects(service.confirmShoppingChoice({ commandId: "match-missing",
    activityId: "linked-shopping", expectedRevision: readyShopping.revision,
    selectedImportId: "tofu", quantity: 1 }),
  (error) => error.code === "INGREDIENT_MATCH_REQUIRED");
  await assert.rejects(service.confirmShoppingChoice({ commandId: "match-forged",
    activityId: "linked-shopping", expectedRevision: readyShopping.revision,
    selectedImportId: "tofu", quantity: 1,
    ingredientMatch: { status: "matched", ingredientId: "not-in-recipe" } }),
  (error) => error.code === "INVALID_INGREDIENT_MATCH");
  await assert.rejects(service.confirmShoppingChoice({ commandId: "missing-package",
    activityId: "linked-shopping", expectedRevision: readyShopping.revision,
    selectedImportId: "tofu", quantity: 1,
    ingredientMatch: { status: "matched", ingredientId: "tofu" } }),
  (error) => error.code === "PACKAGE_QUANTITY_REQUIRED");
  await assert.rejects(service.confirmShoppingChoice({ commandId: "invalid-package",
    activityId: "linked-shopping", expectedRevision: readyShopping.revision,
    selectedImportId: "tofu", quantity: 1,
    ingredientMatch: { status: "matched", ingredientId: "tofu" },
    packageQuantity: { status: "known", amount: 0, unit: "g" } }),
  (error) => error.code === "PACKAGE_QUANTITY_REQUIRED");
  await assert.rejects(service.confirmShoppingChoice({ commandId: "unverified-package",
    activityId: "linked-shopping", expectedRevision: readyShopping.revision,
    selectedImportId: "tofu", quantity: 1,
    ingredientMatch: { status: "unverified" },
    packageQuantity: { status: "known", amount: 300, unit: "g" } }),
  (error) => error.code === "INVALID_PACKAGE_QUANTITY");
  await service.confirmShoppingChoice({ commandId: "choose-reviewed-tofu",
    activityId: "linked-shopping", expectedRevision: readyShopping.revision,
    selectedImportId: "tofu", quantity: 1,
    ingredientMatch: { status: "matched", ingredientId: "tofu" },
    packageQuantity: { status: "known", amount: 300, unit: "g" } });
  assert.equal((await service.confirmShoppingChoice({ commandId: "choose-reviewed-tofu",
    activityId: "linked-shopping", expectedRevision: readyShopping.revision,
    selectedImportId: "tofu", quantity: 1,
    ingredientMatch: { status: "matched", ingredientId: "tofu" },
    packageQuantity: { status: "known", amount: 300, unit: "g" } })).replayed, true);
  await assert.rejects(service.confirmShoppingChoice({ commandId: "choose-reviewed-tofu",
    activityId: "linked-shopping", expectedRevision: readyShopping.revision,
    selectedImportId: "tofu", quantity: 1,
    ingredientMatch: { status: "unverified" } }),
  (error) => error.code === "COMMAND_CONFLICT");
  const matchedState = await store.snapshot();
  const matchRelation = active(matchedState, "shopping.choice_matches_ingredient");
  assert.equal(matchRelation.length, 1);
  assert.equal(matchedState.knowledge.entities.find((item) =>
    item.id === matchRelation[0].subjectId)?.type, "shopping.purchase_choice");
  assert.equal(matchedState.knowledge.entities.find((item) =>
    item.id === matchRelation[0].objectEntityId)?.type, "recipe.ingredient");
  assert.ok(matchRelation[0].evidenceIds.length >= 3);
  assert.equal(active(matchedState, "shopping.package_quantity").length, 1);
  assert.deepEqual((await service.getBoard("linked-shopping")).results.find((item) =>
    item.taskId === "confirm_choice").value.choice.recipeCoverage,
  { status: "unknown_need" });
  assert.equal(active(await store.snapshot(), "shopping.purchase_for_choice").length, 0);
  await assert.rejects(service.getRecipeShoppingPlanReview("linked-shopping", secondLink.id),
    (error) => error.code === "STARTED_TASK_PROTECTED");
  await assert.rejects(service.getRecipeShoppingTransferReview(secondLink.id),
    (error) => error.code === "STARTED_TASK_PROTECTED");
  const startedShopping = await service.getBoard("linked-shopping");
  const oldShoppingResults = structuredClone(startedShopping.results);
  const secondEditable = await service.getEditableRecipe(secondSuccessor.activityId);
  await service.correctRecipe({ commandId: "change-recipe-after-shopping-choice",
    activityId: secondSuccessor.activityId,
    expectedAssertionId: secondEditable.assertionId, confirmed: true,
    recipe: { title: secondEditable.recipe.title,
      baseServings: secondEditable.recipe.baseServings,
      ingredients: secondEditable.recipe.ingredients.map((item) => item.id === "tofu"
        ? { ...item, quantity: { status: "known", amount: 450, unit: "g" } } : item),
      steps: secondEditable.recipe.steps ?? [] } });
  const blockedShopping = await service.getBoardReview("linked-shopping");
  assert.equal(blockedShopping.reasonCode, "STARTED_TASK_PROTECTED");
  await assert.rejects(service.proposeBoardReview({ activityId: "linked-shopping",
    commandId: "do-not-rewrite-started-shopping", expectedRevision: startedShopping.revision,
    confirmed: true }), (error) => error.code === "RECIPE_NEEDS_STALE");
  const continuedShopping = await service.createReviewSuccessor({
    commandId: "continue-started-shopping", activityId: "linked-shopping",
    expectedRevision: startedShopping.revision, confirmed: true });
  assert.equal((await service.createReviewSuccessor({
    commandId: "continue-started-shopping", activityId: "linked-shopping",
    expectedRevision: startedShopping.revision, confirmed: true })).replayed, true);
  assert.equal((await service.getBoard(continuedShopping.activityId)).currentPlanRevision, 0);
  await service.acceptProposal({ proposalId: continuedShopping.proposalId,
    commandId: "approve-new-shopping" });
  const newShopping = await service.getBoard(continuedShopping.activityId);
  assert.equal(newShopping.continuedFrom, "linked-shopping");
  assert.equal(newShopping.tasks.find((item) => item.id === "confirm_choice")
    .inputBindings.linkedRecipe, undefined);
  assert.deepEqual((await service.getBoard("linked-shopping")).results,
    oldShoppingResults);
  const thirdRecipe = await service.createReviewSuccessor({
    commandId: "continue-final-recipe", activityId: secondSuccessor.activityId,
    expectedRevision: (await service.getBoard(secondSuccessor.activityId)).revision,
    confirmed: true });
  await service.acceptProposal({ proposalId: thirdRecipe.proposalId,
    commandId: "approve-final-recipe" });
  await calculate(thirdRecipe.activityId, "third");
  const newLink = await service.createScenarioConnection({
    commandId: "link-final-recipe-new-shopping", confirmed: true,
    kind: "recipe_shopping", fromActivityId: thirdRecipe.activityId,
    toActivityId: continuedShopping.activityId,
    expectedFromRevision: (await service.getBoard(thirdRecipe.activityId)).revision,
    expectedToRevision: newShopping.revision });
  const newShoppingReview = await service.getRecipeShoppingPlanReview(
    continuedShopping.activityId, newLink.id);
  assert.equal(newShoppingReview.before, null);
  assert.equal(newShoppingReview.after.items.find((item) =>
    item.ingredientId === "tofu").requiredQuantity.amount, 900);
  const newShoppingProposal = await service.proposeRecipeShoppingPlan({
    commandId: "propose-new-shopping-recipe-needs", confirmed: true,
    shoppingActivityId: continuedShopping.activityId, connectionId: newLink.id,
    expectedRevision: newShoppingReview.expectedRevision,
    expectedSourceResultId: newShoppingReview.reference.sourceResultId });
  await service.acceptProposal({ proposalId: newShoppingProposal.proposalId,
    commandId: "accept-new-shopping-recipe-needs" });
  const newShoppingReady = await service.getBoard(continuedShopping.activityId);
  assert.equal(newShoppingReady.tasks.find((item) => item.id === "confirm_choice")
    .inputBindings.linkedRecipe.connectionId, newLink.id);
  await service.confirmShoppingChoice({ commandId: "choose-new-shopping-tofu",
    activityId: continuedShopping.activityId,
    expectedRevision: newShoppingReady.revision,
    selectedImportId: "tofu", quantity: 1,
    ingredientMatch: { status: "unverified" } });
  assert.equal((await service.getBoard(continuedShopping.activityId)).results.find((item) =>
    item.taskId === "confirm_choice")?.value.choice.ingredientMatch.status, "unverified");
  assert.equal(active(await store.snapshot(), "shopping.choice_matches_ingredient").length, 1);
  assert.deepEqual((await service.getBoard("linked-shopping")).results,
    oldShoppingResults);
  assert.equal(active(await store.snapshot(), "shopping.purchase_for_choice").length, 0);
  await service.deleteReviewedCapture({ importId: "recipe",
    commandId: "delete-linked-recipe-image" });
  assert.equal(active(await store.snapshot(), "shopping.choice_matches_ingredient").length, 0);
  assert.deepEqual((await service.listScenarioConnections("linked-shopping")).connections, []);
  const survivingShopping = await service.getBoard("linked-shopping");
  assert.ok(survivingShopping.pendingChanges.some((item) =>
    item.reasonCode === "RECIPE_NEEDS_STALE"));
  await assert.rejects(service.proposeRecipeShoppingPlan({
    commandId: "propose-second-recipe-needs", shoppingActivityId: "linked-shopping",
    connectionId: secondLink.id, expectedRevision: secondReview.expectedRevision,
    expectedSourceResultId: secondReview.reference.sourceResultId,
    confirmed: true }), (error) => error.code === "SCENARIO_DELETED");
});
}

for (const backend of ["json", "postgres"]) {
test(`old and current displayed prices require review instead of silently choosing one (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  const captured = await importCapture(service, "price");
  assert.equal(captured.analysis.facts.find((item) => item.label === "이전 표시가")?.value, "19,900원");
  assert.equal(captured.analysis.facts.find((item) => item.label === "화면 표시가")?.value, "12,900원");
  await assert.rejects(service.createShoppingScenario({ commandId: "unsafe-price",
    activityId: "unsafe-shopping", confirmed: true, importIds: ["price"],
    purpose: "표시 가격 확인" }), (error) => error.code === "IMPORT_NOT_SHOPPING");
  assert.equal(active(await store.snapshot(), "shopping.displayed_price").length, 0);
});
}

for (const backend of ["json", "postgres"]) {
test(`Jeju travel and Jeju restaurant link without visits (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  await importCapture(service, "travel");
  const restaurant = await importCapture(service, "dining");
  assert.equal(restaurant.analysis.place.address, "제주 서귀포시 성산읍");
  const travel = await service.createTravelScenario({ commandId: "create-travel",
    activityId: "travel-board", confirmed: true, importIds: ["travel"],
    area: "제주", startAt: "2026-09-28T09:00:00+09:00" });
  let travelBoard = await approve(service, travel, "approve-travel");
  await service.confirmTravelItinerary({ commandId: "confirm-itinerary",
    activityId: "travel-board", expectedRevision: travelBoard.revision,
    selections: [{ importId: "travel", plannedAt: "2026-09-28T10:00:00+09:00" }] });
  const dining = await service.createDiningScenario({ commandId: "create-dining",
    activityId: "dining-board", confirmed: true, importIds: ["dining"],
    scheduledAt: "2026-09-28T12:00:00+09:00", area: "성산읍", partySize: 2 });
  let diningBoard = await approve(service, dining, "approve-dining");
  const candidate = diningBoard.tasks.find((item) => item.id === "select_place")
    .readiness.inputs.candidates[0];
  assert.equal(candidate.name, "제주 바다국수");
  await service.selectDiningPlace({ commandId: "choose-dining", activityId: "dining-board",
    expectedRevision: diningBoard.revision, candidateId: candidate.id });
  travelBoard = await service.getBoard("travel-board");
  diningBoard = await service.getBoard("dining-board");
  await service.createScenarioConnection({ commandId: "link-travel-dining", confirmed: true,
    kind: "travel_dining", fromActivityId: "travel-board", toActivityId: "dining-board",
    expectedFromRevision: travelBoard.revision, expectedToRevision: diningBoard.revision });
  const connection = (await service.listScenarioConnections("travel-board")).connections[0];
  assert.equal(connection.otherSubject?.type, "dining.place");
  const state = await store.snapshot();
  assert.equal(active(state, "scenario.connection_from_subject").length, 1);
  assert.equal(active(state, "scenario.connection_to_subject").length, 1);
  assert.equal(active(state, "dining.visited").length, 0);
  assert.equal(active(state, "travel.visit_of_stop").length, 0);
});
}

for (const backend of ["json", "postgres"]) {
test(`fashion and beauty plans link without implying that the outfit was worn or routine used (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  await importCapture(service, "fashion");
  await importCapture(service, "beauty");
  const fashion = await service.createFashionScenario({ commandId: "create-fashion",
    activityId: "fashion-board", confirmed: true, importIds: ["fashion"],
    occasion: "주말 모임", scheduledAt: "2026-09-28T18:00:00+09:00" });
  let fashionBoard = await approve(service, fashion, "approve-fashion");
  await service.confirmFashionOutfit({ commandId: "confirm-fashion",
    activityId: "fashion-board", expectedRevision: fashionBoard.revision,
    selections: [{ importId: "fashion", slot: "outerwear", color: "차콜",
      size: "M", ownership: "candidate" }] });
  const beauty = await service.createBeautyScenario({ commandId: "create-beauty",
    activityId: "beauty-board", confirmed: true, importIds: ["beauty"],
    occasion: "주말 모임", scheduledAt: "2026-09-28T17:00:00+09:00" });
  let beautyBoard = await approve(service, beauty, "approve-beauty");
  await service.confirmBeautyRoutine({ commandId: "confirm-beauty",
    activityId: "beauty-board", expectedRevision: beautyBoard.revision,
    selections: [{ importId: "beauty", variantLabel: "젤 150 mL",
      stepTitle: "젤 세안하기" }] });
  fashionBoard = await service.getBoard("fashion-board");
  beautyBoard = await service.getBoard("beauty-board");
  await service.createScenarioConnection({ commandId: "link-fashion-beauty", confirmed: true,
    kind: "fashion_beauty", fromActivityId: "fashion-board", toActivityId: "beauty-board",
    expectedFromRevision: fashionBoard.revision, expectedToRevision: beautyBoard.revision });
  const state = await store.snapshot();
  assert.equal(active(state, "scenario.connection_from_subject").length, 1);
  assert.equal(active(state, "scenario.connection_to_subject").length, 1);
  assert.equal(active(state, "fashion.wore_outfit").length, 0);
  assert.equal(active(state, "beauty.experience_in").length, 0);
});
}

for (const backend of ["json", "postgres"]) {
test(`workout and preparation tip link without implied execution (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  await importCapture(service, "health");
  const tipImport = await importCapture(service, "tip");
  assert.equal(tipImport.analysis.facts.length, 0);
  assert.deepEqual(tipImport.analysis.steps.map((item) => item.order), [1, 2, 3]);
  const health = await service.createHealthScenario({ commandId: "create-health",
    activityId: "health-board", confirmed: true, importId: "health" });
  let healthBoard = await approve(service, health, "approve-health");
  await service.confirmHealthExercises({ commandId: "confirm-health",
    activityId: "health-board", expectedRevision: healthBoard.revision, factIndexes: [1, 2] });
  const tip = await service.createLifeTipScenario({ commandId: "create-tip",
    activityId: "tip-board", confirmed: true, importId: "tip" });
  assert.equal(tip.candidateCount, 3);
  let tipBoard = await approve(service, tip, "approve-tip");
  await service.confirmLifeTipActions({ commandId: "confirm-tip",
    activityId: "tip-board", expectedRevision: tipBoard.revision, factIndexes: [1, 2, 3] });
  healthBoard = await service.getBoard("health-board");
  tipBoard = await service.getBoard("tip-board");
  await service.createScenarioConnection({ commandId: "link-health-tip", confirmed: true,
    kind: "health_life_tip", fromActivityId: "health-board", toActivityId: "tip-board",
    expectedFromRevision: healthBoard.revision, expectedToRevision: tipBoard.revision });
  const state = await store.snapshot();
  assert.equal(active(state, "scenario.connection_from_subject").length, 1);
  assert.equal(active(state, "scenario.connection_to_subject").length, 1);
  assert.equal(active(state, "life_tip.execution_for_action").length, 0);
  assert.equal(active(state, "health.performance_in_session").length, 0);
  assert.equal(active(state, "health.session_for_plan").length, 0);
});
}

for (const backend of ["json", "postgres"]) {
test(`retracting a captured tip step invalidates the pending plan (${backend})`, async (t) => {
  const { service, store } = await setup(t, backend);
  const imported = await importCapture(service, "tip");
  const created = await service.createLifeTipScenario({ commandId: "create-tip",
    activityId: "tip-board", confirmed: true, importId: "tip" });
  const state = await store.snapshot();
  const stepField = state.knowledge.assertions.find((item) => item.status === "active" &&
    item.subjectId === imported.materialId &&
    item.typedValue?.value?.path === "/steps/1/instruction");
  assert.ok(stepField);
  await service.knowledgeCommand({ commandId: "retract-step", type: "assertion.retract",
    payload: { assertionId: stepField.id } });
  await assert.rejects(service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-stale-tip" }), (error) => error.code === "CONTEXT_STALE");
});
}
