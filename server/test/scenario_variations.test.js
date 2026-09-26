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

// Every response was recorded from /v1/analyze for the exact PNG below.
const captures = {
  recipe: ["variation_recipe_tofu_egg_as_needed", "4ee2de07ece75c1a7b467430701efbc19e1775584738147bd427ab0129baf47e", "synthetic.recipe"],
  tofu: ["variation_shopping_tofu_ingredient", "7a87bb882a641e8a344ce59750f7b34d9c4842d659f6ed91898b856d8602c442", "synthetic.shopping"],
  price: ["variation_shopping_old_current_price", "7c3da692d80c16dc3d838743ec3496608e7579738f38fda3b386843f64bf3633", "synthetic.shopping"],
  travel: ["travel_a_viewpoint", "07ddb947d3d725a1cd0737346f8a5817a7bd63e67301a88277cad4cbce483099", "synthetic.travel"],
  dining: ["variation_dining_jeju_noodles", "207ca5abbbfa507fade08f353f744d407be4f780266ca37f0b94329fe5a166d3", "synthetic.dining"],
  fashion: ["fashion_a_blazer", "33a5db2639a0125196de6ccfb64cd668c8d5066eceeffe8676303a14e423643d", "synthetic.fashion"],
  beauty: ["beauty_a_cleanser", "114e7964624233360d5e46a97ca825383737e9c193efa46a044a7ae9c8c17dda", "synthetic.beauty"],
  health: ["health_home_workout", "c1000800307a89f4c8341d50111e6e2acbbcac6b8ad6e9be1d9048efa4f6abe7", "synthetic.health"],
  tip: ["variation_life_tip_workout_prep", "2fb64f37eb1a20749f13e70674f0f8ee1f024c38542b4ca097e928b450251432", "synthetic.life_tip"],
};

async function setup(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-variations-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const store = createJsonStateStore({ filePath: join(folder, "state.json"),
    initialState: createCommonKernelState });
  return { store, service: createCommonKernelService({ ownerId: "variation-user", store }) };
}

async function importCapture(service, key) {
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
  const imported = await service.importReviewedCapture({ importId: key,
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

test("recipe amount 'as needed' stays nonnumeric and an actual tofu offer links without a purchase", async (t) => {
  const { service, store } = await setup(t);
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
  const state = await store.snapshot();
  assert.equal(active(state, "scenario.connection_from_subject").length, 1);
  assert.equal(active(state, "scenario.connection_to_subject").length, 1);
  assert.ok(active(state, "scenario.connection_to_subject")[0].evidenceIds.length >= 2);
  assert.equal(active(state, "shopping.actual_paid_krw").length, 0);
  assert.equal(active(state, "shopping.purchase_for_choice").length, 0);
  await service.knowledgeCommand({ commandId: "erase-recipe-image", type: "source.delete",
    payload: { sourceId: recipeImport.sourceId } });
  assert.deepEqual((await service.listScenarioConnections("shopping-board")).connections, []);
  await assert.rejects(service.getBoard("recipe-board"), (error) => error.code === "NOT_FOUND");
  assert.equal((await service.getBoard("shopping-board")).id, "shopping-board");
});

test("old and current displayed prices require review instead of silently choosing one", async (t) => {
  const { service, store } = await setup(t);
  const captured = await importCapture(service, "price");
  assert.equal(captured.analysis.facts.find((item) => item.label === "이전 표시가")?.value, "19,900원");
  assert.equal(captured.analysis.facts.find((item) => item.label === "화면 표시가")?.value, "12,900원");
  await assert.rejects(service.createShoppingScenario({ commandId: "unsafe-price",
    activityId: "unsafe-shopping", confirmed: true, importIds: ["price"],
    purpose: "표시 가격 확인" }), (error) => error.code === "IMPORT_NOT_SHOPPING");
  assert.equal(active(await store.snapshot(), "shopping.displayed_price").length, 0);
});

test("Jeju travel and Jeju restaurant are linked after real image-backed selections, without visits", async (t) => {
  const { service, store } = await setup(t);
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

test("fashion and beauty plans link without implying that the outfit was worn or routine used", async (t) => {
  const { service, store } = await setup(t);
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

test("workout and preparation tip link ordered steps but do not imply either was done", async (t) => {
  const { service, store } = await setup(t);
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

test("retracting a captured tip step invalidates the pending plan", async (t) => {
  const { service, store } = await setup(t);
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
