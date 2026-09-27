import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCommonKernelService } from "../src/common/kernel_service.js";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { validateAnalyzeRequest } from "../src/request_validation.js";
import { createScenarioTestStore } from "./relational_fixture.js";
import { makeValidAnalysis, makeFiling, makeTag } from "./fixtures.js";
import { correctExtractedField } from "./scenario_recovery_helpers.js";

const cases = [
  ["a_blazer", "차콜 싱글 재킷", "33a5db2639a0125196de6ccfb64cd668c8d5066eceeffe8676303a14e423643d"],
  ["b_trousers", "베이지 슬랙스", "3c0e56a2b659de402f0b67129a060d479274c8a093eb9fb1c3c2f0f63ecd9d65"],
];

async function fixture(t, backend) {
  const { store } = await createScenarioTestStore(t, backend, "fashion");
  const service = createCommonKernelService({ ownerId: "stylist", store });
  const imports = {};
  for (const [name, title, hash] of cases) {
    const image = await fs.readFile(fileURLToPath(new URL(`./fixtures/fashion_${name}.png`, import.meta.url)));
    assert.equal(createHash("sha256").update(image).digest("hex"), hash);
    validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: name, sourceApp: "synthetic.fashion", locale: "ko-KR" } });
    const analysis = JSON.parse(await fs.readFile(fileURLToPath(
      new URL(`./fixtures/fashion_${name}_live_analysis.json`, import.meta.url)), "utf8"));
    validateLegacyAnalysis(analysis);
    assert.equal(analysis.contentKind, "commerce_product");
    assert.equal(analysis.title.value, title);
    assert.ok(analysis.tags.some((tag) => tag.facet === "kind" && tag.value === "패션"));
    imports[name] = await service.importReviewedCapture({ importId: name, reviewed: true,
      reviewedAt: "2026-09-26T09:00:00+09:00",
      capture: { id: name, asset: { status: "unavailable" } }, analysis });
  }
  return { service, store, imports };
}

const scenario = { commandId: "create-outfit", activityId: "outfit-1", confirmed: true,
  importIds: ["a_blazer", "b_trousers"], occasion: "토요일 모임",
  scheduledAt: "2026-09-27T18:00:00+09:00" };
const selections = [
  { importId: "a_blazer", slot: "outerwear", color: "차콜", size: "M", ownership: "candidate" },
  { importId: "b_trousers", slot: "bottom", color: "베이지", size: "30", ownership: "owned" },
];

for (const backend of ["json", "postgres"]) {
test(`fashion correction upgrades an older outfit without slot assertions (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const created = await service.createFashionScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-legacy" });
  const board = await service.getBoard("outfit-1");
  await service.confirmFashionOutfit({ commandId: "confirm-legacy",
    activityId: "outfit-1", expectedRevision: board.revision, selections });
  const slotAssertions = (await store.snapshot()).knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === "fashion.item_slot" &&
    item.scope?.id === "outfit-1");
  for (const assertion of slotAssertions) {
    await service.knowledgeCommand({ commandId: `legacy-remove:${assertion.id}`,
      type: "assertion.retract", payload: { assertionId: assertion.id,
        expectedRevision: assertion.revision } });
  }
  const editable = await service.getEditableFashionOutfit("outfit-1");
  assert.deepEqual(editable.items.map((item) => item.slot), ["outerwear", "bottom"]);
  await service.correctFashionOutfit({ commandId: "correct-legacy", activityId: "outfit-1",
    expectedGraphFingerprint: editable.graphFingerprint, confirmed: true,
    items: editable.items.map((item, index) => ({ variantId: item.variantId,
      slot: item.slot, ownership: index === 0 ? "owned" : item.ownership })) });
  const upgraded = (await store.snapshot()).knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === "fashion.item_slot" &&
    item.scope?.id === "outfit-1");
  assert.equal(upgraded.length, 2);
});

test(`fashion correction changes slots and ownership without rewriting wear history (${backend})`, async (t) => {
  const { service, store, imports } = await fixture(t, backend);
  const created = await service.createFashionScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-outfit" });
  let board = await service.getBoard("outfit-1");
  await service.confirmFashionOutfit({ commandId: "confirm-outfit",
    activityId: "outfit-1", expectedRevision: board.revision, selections });
  board = await service.getBoard("outfit-1");
  const recorded = await service.recordFashionWearOutcome({ commandId: "wear-outfit",
    activityId: "outfit-1", expectedRevision: board.revision, status: "worn" });
  assert.ok(recorded.experienceId);
  const history = structuredClone((await service.getBoard("outfit-1")).results);
  const editable = await service.getEditableFashionOutfit("outfit-1");
  assert.deepEqual(editable.items.map((item) => item.slot), ["outerwear", "bottom"]);
  const request = { commandId: "correct-outfit", activityId: "outfit-1",
    expectedGraphFingerprint: editable.graphFingerprint, confirmed: true,
    items: [
      { variantId: editable.items[0].variantId, slot: "top", ownership: "owned" },
      { variantId: editable.items[1].variantId, slot: "bottom", ownership: "unknown" },
    ] };
  const corrected = await service.correctFashionOutfit(request);
  assert.ok(corrected.sourceId);
  assert.equal((await service.correctFashionOutfit(request)).replayed, true);
  assert.equal((await service.getEditableFashionOutfit("outfit-1")).items[0].slot, "top");
  const graph = (await store.snapshot()).knowledge;
  assert.deepEqual(graph.assertions.filter((item) => item.status === "active" &&
    item.predicate === "fashion.item_slot" && item.scope?.id === "outfit-1")
    .map((item) => item.typedValue.value), ["bottom", "top"]);
  assert.deepEqual(graph.assertions.filter((item) => item.status === "active" &&
    item.predicate === "fashion.ownership" && item.scope?.id === "outfit-1")
    .map((item) => item.typedValue.value), ["owned"]);
  const after = await service.getBoard("outfit-1");
  assert.deepEqual(after.results, history);
  assert.equal(after.results.find((item) => item.id === board.tasks.find((task) =>
    task.id === "confirm_outfit").latestOutputRef).value.outfit.items[0].slot, "outerwear");
  const review = await service.getBoardReview("outfit-1");
  assert.equal(review.reasonCode, "STARTED_TASK_PROTECTED");
  assert.deepEqual(review.affectedTasks.map((item) => item.id), ["record_wear"]);
  await assert.rejects(service.proposeBoardReview({ activityId: "outfit-1",
    commandId: "patch-old", expectedRevision: after.revision, confirmed: true }),
  (error) => error.code === "STARTED_TASK_PROTECTED");
  const next = await service.createReviewSuccessor({ activityId: "outfit-1",
    commandId: "continue-outfit", expectedRevision: after.revision, confirmed: true });
  assert.equal(next.continuedFrom, "outfit-1");
  await assert.rejects(service.correctFashionOutfit({ ...request, commandId: "stale-outfit" }),
    (error) => error.code === "FASHION_REVISION_CONFLICT");
  await service.knowledgeCommand({ commandId: "delete-outfit-capture",
    type: "source.delete", payload: { sourceId: imports.a_blazer.sourceId } });
  await assert.rejects(service.correctFashionOutfit(request),
    (error) => error.code === "CORRECTION_DELETED");
  await assert.rejects(service.getBoard("outfit-1"),
    (error) => error.code === "NOT_FOUND");
});

test(`real fashion image responses become a user-confirmed outfit and a reported wear (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const created = await service.createFashionScenario(scenario);
  assert.equal(created.candidateCount, 2);
  assert.equal((await service.createFashionScenario(scenario)).replayed, true);
  assert.equal((await service.getBoard("outfit-1")).tasks.length, 0);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-outfit" });
  let board = await service.getBoard("outfit-1");
  const task = board.tasks.find((item) => item.id === "confirm_outfit");
  assert.deepEqual(task.readiness.inputs.candidates.map((item) => item.importId),
    ["a_blazer", "b_trousers"]);
  await assert.rejects(service.activityCommand({ commandId: "bypass", type: "task.transition",
    activityId: "outfit-1", expectedRevision: board.revision,
    payload: { taskId: task.id, expectedTaskRevision: task.revision, to: "completed",
      output: { outfitId: "fake", confirmedAt: "2026-09-26T09:00:00+09:00",
        outfit: { id: "fake", occasion: "토요일 모임", items: [
          { slot: "outerwear", variantId: "fake-variant", ownership: "unknown" }] } } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  const confirmed = await service.confirmFashionOutfit({ commandId: "confirm-outfit",
    activityId: "outfit-1", expectedRevision: board.revision, selections });
  assert.ok(confirmed.outfitId);
  board = await service.getBoard("outfit-1");
  const wear = board.tasks.find((item) => item.id === "record_wear");
  assert.equal(wear.readiness.inputs.outfitId, confirmed.outfitId);
  const confirmation = board.results.find((item) =>
    item.id === board.tasks.find((entry) => entry.id === "confirm_outfit").latestOutputRef);
  assert.deepEqual(confirmation.value.outfit.items.map((item) =>
    [item.slot, item.color, item.size, item.ownership]), [
    ["outerwear", "차콜", "M", "candidate"], ["bottom", "베이지", "30", "owned"]]);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "fashion.has_item" && item.status === "active").length, 2);
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "fashion.ownership" && item.status === "active").length, 2);
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "fashion.variant_options" && item.status === "active").length, 2);
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "fashion.wore_outfit" && item.status === "active").length, 0);
  // The model's false "합성 재료" fact stays in the capture snapshot, not fashion assertions.
  assert.ok(!snapshot.knowledge.assertions.some((item) =>
    item.predicate?.startsWith("fashion.") && JSON.stringify(item).includes("합성 재료")));
  const result = await service.recordFashionWearOutcome({ commandId: "worn-outfit",
    activityId: "outfit-1", expectedRevision: board.revision, status: "worn" });
  assert.ok(result.experienceId);
  assert.equal((await service.recordFashionWearOutcome({ commandId: "worn-outfit",
    activityId: "outfit-1", expectedRevision: board.revision, status: "worn" })).replayed, true);
  const resolved = await service.resolveKnowledge({ subjectId: result.experienceId,
    predicate: "fashion.wore_outfit", scope: { type: "activity", id: "outfit-1" } });
  assert.equal(resolved.values[0].objectEntityId, confirmed.outfitId);
  const next = await service.createFashionScenario({ ...scenario,
    commandId: "create-outfit-again", activityId: "outfit-2" });
  await service.acceptProposal({ proposalId: next.proposalId, commandId: "approve-outfit-again" });
  const nextBoard = await service.getBoard("outfit-2");
  await service.confirmFashionOutfit({ commandId: "confirm-outfit-again",
    activityId: "outfit-2", expectedRevision: nextBoard.revision, selections });
  const nextState = await store.snapshot();
  assert.equal(nextState.knowledge.identityDecisions.filter((item) =>
    item.status === "accepted").length, 2);
  assert.equal(nextState.knowledge.entities.filter((item) =>
    item.type === "core.product_variant" && item.status === "active").length, 2);
});

test(`duplicate slots and unconfirmed wear cannot invent ownership or wearing (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const created = await service.createFashionScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-outfit" });
  let board = await service.getBoard("outfit-1");
  await assert.rejects(service.confirmFashionOutfit({ commandId: "bad-slots",
    activityId: "outfit-1", expectedRevision: board.revision,
    selections: [{ ...selections[0] }, { ...selections[1], slot: "outerwear" }] }),
  (error) => error.code === "INVALID_REQUEST");
  await service.confirmFashionOutfit({ commandId: "confirm-outfit", activityId: "outfit-1",
    expectedRevision: board.revision,
    selections: [{ ...selections[0], ownership: "unknown" }] });
  board = await service.getBoard("outfit-1");
  const result = await service.recordFashionWearOutcome({ commandId: "not-worn",
    activityId: "outfit-1", expectedRevision: board.revision, status: "not_worn" });
  assert.equal(result.experienceId, null);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    ["fashion.ownership", "fashion.wore_outfit"].includes(item.predicate) &&
    item.status === "active").length, 0);
});

test(`corrected product title produces a reviewed fashion patch (${backend})`, async (t) => {
  const { service, store, imports } = await fixture(t, backend);
  const created = await service.createFashionScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-before-title-correction" });
  const before = await service.getBoard("outfit-1");
  await correctExtractedField({ service, store,
    materialId: imports.a_blazer.materialId, path: "/title/value",
    value: "차콜 싱글 블레이저", ownerId: "stylist",
    commandId: "correct-fashion-title" });
  const report = await service.getBoardReview("outfit-1");
  assert.equal(report.status, "ready");
  assert.deepEqual(report.affectedTasks.map((item) => item.id), ["confirm_outfit"]);
  const proposed = await service.proposeBoardReview({ activityId: "outfit-1",
    commandId: "propose-fashion-correction", expectedRevision: before.revision,
    confirmed: true });
  assert.equal((await service.getBoard("outfit-1")).tasks[0]
    .readiness.inputs.candidates[0].name, "차콜 싱글 재킷");
  await service.acceptProposal({ proposalId: proposed.proposalId,
    commandId: "approve-fashion-correction" });
  const after = await service.getBoard("outfit-1");
  assert.equal(after.tasks[0].readiness.inputs.candidates[0].name,
    "차콜 싱글 블레이저");
  assert.equal(after.pendingChanges.length, 0);
});

test(`confirmed outfit remains unchanged when its source title is corrected (${backend})`, async (t) => {
  const { service, store, imports } = await fixture(t, backend);
  const created = await service.createFashionScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-protected-outfit" });
  const board = await service.getBoard("outfit-1");
  await service.confirmFashionOutfit({ commandId: "confirm-protected-outfit",
    activityId: "outfit-1", expectedRevision: board.revision, selections });
  const resultBefore = (await service.getBoard("outfit-1")).results;
  await correctExtractedField({ service, store,
    materialId: imports.a_blazer.materialId, path: "/title/value",
    value: "차콜 싱글 블레이저", ownerId: "stylist",
    commandId: "correct-confirmed-fashion-title" });
  const review = await service.getBoardReview("outfit-1");
  assert.equal(review.status, "blocked");
  assert.equal(review.reasonCode, "STARTED_TASK_PROTECTED");
  assert.deepEqual((await service.getBoard("outfit-1")).results, resultBefore);
});

test(`source deletion removes the dependent fashion activity and blocks replay (${backend})`, async (t) => {
  const { service, store, imports } = await fixture(t, backend);
  const created = await service.createFashionScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-outfit" });
  let board = await service.getBoard("outfit-1");
  const confirmed = await service.confirmFashionOutfit({ commandId: "confirm-outfit",
    activityId: "outfit-1", expectedRevision: board.revision, selections });
  board = await service.getBoard("outfit-1");
  await service.recordFashionWearOutcome({ commandId: "worn-outfit",
    activityId: "outfit-1", expectedRevision: board.revision, status: "worn" });
  await service.knowledgeCommand({ commandId: "delete-blazer", type: "source.delete",
    payload: { sourceId: imports.a_blazer.sourceId } });
  await assert.rejects(service.getBoard("outfit-1"), (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.createFashionScenario(scenario),
    (error) => error.code === "SCENARIO_DELETED");
  await assert.rejects(service.confirmFashionOutfit({ commandId: "confirm-outfit",
    activityId: "outfit-1", expectedRevision: confirmed.revision - 1, selections }),
  (error) => error.code === "SCENARIO_DELETED");
  const snapshot = await store.snapshot();
  assert.ok(!snapshot.knowledge.sources.some((item) => item.status === "active" &&
    ["user_confirmation", "user_report"].includes(item.kind) &&
    item.provenance?.scenario === "fashion" && item.provenance.activityId === "outfit-1"));
});

test(`identical product titles from separate captures stay separate (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const analysis = JSON.parse(await fs.readFile(fileURLToPath(
    new URL("./fixtures/fashion_a_blazer_live_analysis.json", import.meta.url)), "utf8"));
  await service.importReviewedCapture({ importId: "a_blazer_copy", reviewed: true,
    reviewedAt: "2026-09-26T09:00:00+09:00",
    capture: { id: "a-blazer-copy", asset: { status: "unavailable" } }, analysis });
  const created = await service.createFashionScenario({ ...scenario,
    commandId: "same-title-scenario", activityId: "same-title-outfit",
    importIds: ["a_blazer", "a_blazer_copy"] });
  assert.equal(created.candidateCount, 2);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-same-title" });
  const board = await service.getBoard("same-title-outfit");
  await service.confirmFashionOutfit({ commandId: "confirm-same-title",
    activityId: "same-title-outfit", expectedRevision: board.revision,
    selections: [selections[0], { ...selections[0], importId: "a_blazer_copy", slot: "top" }] });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.identityDecisions.filter((item) =>
    item.status === "accepted").length, 2);
  assert.equal(snapshot.knowledge.entities.filter((item) =>
    item.type === "core.product" && item.status === "active").length, 2);
});

test(`a generic commerce product without fashion classification cannot enter the outfit flow (${backend})`, async (t) => {
  const { service } = await fixture(t, backend);
  const appliance = makeValidAnalysis({ domain: "unknown", contentKind: "commerce_product",
    ingredientGroups: [], steps: [], facts: [], warnings: [],
    title: { value: "전기밥솥", status: "observed", confidence: 0.99, evidenceIds: ["e1"] },
    filing: makeFiling({ kinds: [makeTag("가전", ["전기밥솥"])] }) });
  await service.importReviewedCapture({ importId: "appliance", reviewed: true,
    reviewedAt: "2026-09-26T09:00:00+09:00",
    capture: { id: "appliance", asset: { status: "unavailable" } }, analysis: appliance });
  await assert.rejects(service.createFashionScenario({ ...scenario,
    commandId: "reject-appliance", activityId: "appliance-outfit", importIds: ["appliance"] }),
  (error) => error.code === "IMPORT_NOT_FASHION");
});

test(`retracted outfit item prevents a wear report (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const created = await service.createFashionScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-outfit" });
  let board = await service.getBoard("outfit-1");
  await service.confirmFashionOutfit({ commandId: "confirm-outfit", activityId: "outfit-1",
    expectedRevision: board.revision, selections });
  const edge = (await store.snapshot()).knowledge.assertions.find((item) =>
    item.status === "active" && item.predicate === "fashion.has_item");
  await service.knowledgeCommand({ commandId: "retract-outfit-item", type: "assertion.retract",
    payload: { assertionId: edge.id } });
  board = await service.getBoard("outfit-1");
  await assert.rejects(service.recordFashionWearOutcome({ commandId: "wear-stale",
    activityId: "outfit-1", expectedRevision: board.revision, status: "worn" }),
  (error) => error.code === "CONTEXT_STALE");
  assert.equal((await store.snapshot()).knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === "fashion.wore_outfit").length, 0);
});
}
