import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCommonKernelService } from "../src/common/kernel_service.js";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { validateAnalyzeRequest } from "../src/request_validation.js";
import { createScenarioTestStore } from "./relational_fixture.js";

const cases = [
  ["a_fabric_box", "ce71495de8243c750e0b17a67499534c9f9e691b6d2cb818046e38706634e542", "12,900원"],
  ["b_clear_box", "ab0406cd684d8f3021ed83dc37eb737a3a8bca9102d5d7ec4b142878a91fcbe5", "15,900원"],
];
const scenario = { commandId: "create-shopping", activityId: "shop-1",
  confirmed: true, purpose: "수납함 고르기", importIds: cases.map(([name]) => name) };

async function fixture(t, backend) {
  const { store, reopenStore } = await createScenarioTestStore(t, backend, "shopping");
  const service = createCommonKernelService({ ownerId: "buyer", store });
  const imported = [];
  for (const [name, hash, price] of cases) {
    const image = await fs.readFile(fileURLToPath(new URL(
      `./fixtures/shopping_${name}.png`, import.meta.url)));
    assert.equal(createHash("sha256").update(image).digest("hex"), hash);
    validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: name, sourceApp: "synthetic.shopping", locale: "ko-KR" } });
    const analysis = JSON.parse(await fs.readFile(fileURLToPath(new URL(
      `./fixtures/shopping_${name}_live_analysis.json`, import.meta.url)), "utf8"));
    validateLegacyAnalysis(analysis);
    assert.equal(analysis.contentKind, "commerce_product");
    assert.equal(analysis.facts.find((fact) => fact.label === "가격")?.value, price);
    assert.ok(analysis.title.evidenceIds.length > 0);
    imported.push(await service.importReviewedCapture({ importId: name,
      reviewed: true, reviewedAt: "2026-09-27T09:00:00+09:00",
      capture: { id: name, asset: { status: "unavailable" } }, analysis }));
  }
  return { service, store, reopenStore, imported };
}

const output = (board, taskId) => {
  const task = board.tasks.find((item) => item.id === taskId);
  return board.results.find((item) => item.id === task.latestOutputRef)?.value;
};

for (const backend of ["json", "postgres"]) {
test(`analyzed shopping images become comparable candidates; only a user report creates purchase evidence (${backend})`, async (t) => {
  const { service, store, reopenStore } = await fixture(t, backend);
  const created = await service.createShoppingScenario(scenario);
  assert.equal((await service.createShoppingScenario(scenario)).replayed, true);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-shopping" });
  let board = await service.getBoard("shop-1");
  assert.deepEqual(board.tasks.map((item) => item.id),
    ["confirm_choice", "record_purchase_outcome"]);
  assert.deepEqual(board.tasks[0].readiness.inputs.candidates.map((item) =>
    item.displayedPriceText), ["12,900원", "15,900원"]);
  const confirmed = await service.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    selectedImportId: "a_fabric_box", quantity: 2 });
  board = await service.getBoard("shop-1");
  const choice = output(board, "confirm_choice").choice;
  assert.equal(choice.quantity, 2);
  assert.equal(choice.displayedPriceText, "12,900원");
  assert.equal(board.tasks[1].readiness.inputs.choice.id, choice.id);
  let state = await store.snapshot();
  assert.equal(state.knowledge.assertions.filter((item) => item.status === "active" &&
    item.predicate === "shopping.actual_paid_krw").length, 0);
  assert.equal(state.knowledge.assertions.find((item) => item.status === "active" &&
    item.predicate === "shopping.displayed_price")?.typedValue?.value, "12,900원");
  const reported = await service.recordShoppingPurchaseOutcome({ commandId: "report-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    status: "purchased", actualPaidKrw: 13500 });
  board = await service.getBoard("shop-1");
  assert.equal(output(board, "record_purchase_outcome").actualPaidKrw, 13500);
  state = await store.snapshot();
  assert.equal(state.knowledge.assertions.find((item) => item.status === "active" &&
    item.predicate === "shopping.actual_paid_krw")?.typedValue?.value, 13500);
  assert.equal(state.knowledge.assertions.find((item) => item.status === "active" &&
    item.predicate === "shopping.purchase_for_choice")?.objectEntityId, choice.id);
  const reopened = createCommonKernelService({ ownerId: "buyer",
    store: reopenStore() });
  assert.equal((await reopened.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: confirmed.revision - 1,
    selectedImportId: "a_fabric_box", quantity: 2 })).replayed, true);
  assert.equal((await reopened.recordShoppingPurchaseOutcome({ commandId: "report-shopping",
    activityId: "shop-1", expectedRevision: reported.revision - 1,
    status: "purchased", actualPaidKrw: 13500 })).replayed, true);
});

test(`shopping rejects task bypasses, out-of-plan choices, and unsupported purchase amounts (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const created = await service.createShoppingScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-shopping" });
  let board = await service.getBoard("shop-1");
  await assert.rejects(service.activityCommand({ commandId: "forge-shopping",
    type: "task.transition", activityId: "shop-1", expectedRevision: board.revision,
    payload: { taskId: "confirm_choice", expectedTaskRevision: board.tasks[0].revision,
      to: "completed", output: { choice: { id: "fake", productId: "fake-product",
        offerId: "fake-offer", importId: "a_fabric_box", title: "fake",
        quantity: 1, displayedPriceText: "12,900원" },
        confirmedAt: new Date().toISOString() } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  for (const [selectedImportId, quantity] of [["other", 1], ["a_fabric_box", 0],
    ["a_fabric_box", 21]]) {
    await assert.rejects(service.confirmShoppingChoice({ commandId: `bad-${selectedImportId}-${quantity}`,
      activityId: "shop-1", expectedRevision: board.revision, selectedImportId, quantity }),
    (error) => ["INVALID_REQUEST", "INVALID_PLAN"].includes(error.code));
  }
  await assert.rejects(service.confirmShoppingChoice({ commandId: "forge-ingredient-match",
    activityId: "shop-1", expectedRevision: board.revision,
    selectedImportId: "a_fabric_box", quantity: 1,
    ingredientMatch: { status: "matched", ingredientId: "tofu" } }),
  (error) => error.code === "INVALID_INGREDIENT_MATCH");
  await service.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    selectedImportId: "a_fabric_box", quantity: 1 });
  board = await service.getBoard("shop-1");
  await assert.rejects(service.activityCommand({ commandId: "forge-purchase",
    type: "task.transition", activityId: "shop-1", expectedRevision: board.revision,
    payload: { taskId: "record_purchase_outcome",
      expectedTaskRevision: board.tasks[1].revision, to: "completed",
      output: { choiceId: "fake", status: "purchased",
        actualPaidKrw: 100, reportedAt: new Date().toISOString() } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  for (const request of [{ status: "purchased" },
    { status: "not_purchased", actualPaidKrw: 500 },
    { status: "purchased", actualPaidKrw: 0 }]) {
    await assert.rejects(service.recordShoppingPurchaseOutcome({ commandId: `bad-report-${JSON.stringify(request)}`,
      activityId: "shop-1", expectedRevision: board.revision, ...request }),
    (error) => error.code === "INVALID_REQUEST");
  }
  await service.recordShoppingPurchaseOutcome({ commandId: "no-purchase",
    activityId: "shop-1", expectedRevision: board.revision, status: "not_purchased" });
  const state = await store.snapshot();
  assert.equal(state.knowledge.assertions.filter((item) => item.status === "active" &&
    item.predicate === "shopping.actual_paid_krw").length, 0);
  const current = await service.getShoppingPurchaseOutcomes("shop-1");
  assert.equal(current.outcomes[0].status, "not_purchased");
  await assert.rejects(service.correctShoppingPurchaseOutcome({
    commandId: "forged-purchase-correction", activityId: "shop-1",
    choiceId: "another-choice", expectedOutcomeFingerprint: current.fingerprint,
    status: "purchased", actualPaidKrw: 12000,
  }), (error) => error.code === "INVALID_PURCHASE_CHOICE");
  const request = { commandId: "purchase-correction", activityId: "shop-1",
    choiceId: current.outcomes[0].choiceId,
    expectedOutcomeFingerprint: current.fingerprint,
    status: "purchased", actualPaidKrw: 12000 };
  const corrected = await service.correctShoppingPurchaseOutcome(request);
  assert.equal((await service.getShoppingPurchaseOutcomes("shop-1"))
    .outcomes[0].actualPaidKrw, 12000);
  assert.equal((await store.snapshot()).knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === "shopping.purchase_for_choice"
    && item.objectEntityId === request.choiceId).length, 1);
  await service.knowledgeCommand({ commandId: "delete-purchase-correction",
    type: "source.delete", payload: { sourceId: corrected.sourceId } });
  await assert.rejects(service.getBoard("shop-1"),
    (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.correctShoppingPurchaseOutcome(request),
    (error) => error.code === "CORRECTION_DELETED");
});

test(`deleting a source removes its shopping scenario and prevents replay (${backend})`, async (t) => {
  const { service, store, imported } = await fixture(t, backend);
  const created = await service.createShoppingScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-shopping" });
  let board = await service.getBoard("shop-1");
  await service.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    selectedImportId: "a_fabric_box", quantity: 1 });
  board = await service.getBoard("shop-1");
  await service.recordShoppingPurchaseOutcome({ commandId: "report-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    status: "purchased", actualPaidKrw: 13000 });
  await service.knowledgeCommand({ commandId: "delete-shopping-source", type: "source.delete",
    payload: { sourceId: imported[0].sourceId } });
  await assert.rejects(service.getBoard("shop-1"), (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.createShoppingScenario(scenario),
    (error) => error.code === "SCENARIO_DELETED");
  const state = await store.snapshot();
  assert.ok(!state.knowledge.assertions.some((item) => item.status === "active" &&
    item.predicate?.startsWith("shopping.") && item.scope?.id === "shop-1"));
});

test(`retracting observed price evidence invalidates an unapproved shopping plan (${backend})`, async (t) => {
  const { service, store, imported } = await fixture(t, backend);
  const created = await service.createShoppingScenario(scenario);
  const state = await store.snapshot();
  const field = state.knowledge.assertions.find((item) => item.status === "active" &&
    item.subjectId === imported[0].materialId &&
    item.typedValue?.value?.path === "/facts/0/value");
  assert.ok(field);
  await service.knowledgeCommand({ commandId: "retract-price", type: "assertion.retract",
    payload: { assertionId: field.id } });
  await assert.rejects(service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-old-price" }), (error) => error.code === "CONTEXT_STALE");
});

test(`retracted offer link prevents a purchase outcome (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const created = await service.createShoppingScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-shopping" });
  let board = await service.getBoard("shop-1");
  await service.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    selectedImportId: "a_fabric_box", quantity: 1 });
  const edge = (await store.snapshot()).knowledge.assertions.find((item) =>
    item.status === "active" && item.predicate === "shopping.choice_offer");
  await service.knowledgeCommand({ commandId: "retract-choice-offer",
    type: "assertion.retract", payload: { assertionId: edge.id } });
  board = await service.getBoard("shop-1");
  await assert.rejects(service.recordShoppingPurchaseOutcome({
    commandId: "report-stale-shopping", activityId: "shop-1",
    expectedRevision: board.revision, status: "not_purchased" }),
  (error) => ["CONTEXT_STALE", "TASK_BLOCKED"].includes(error.code));
  assert.equal((await store.snapshot()).knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === "shopping.purchase_for_choice").length, 0);
});

test(`shopping correction preserves a purchased choice and chains a new graph (${backend})`, async (t) => {
  const { service, store, reopenStore, imported } = await fixture(t, backend);
  const created = await service.createShoppingScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-shopping" });
  let board = await service.getBoard("shop-1");
  await service.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    selectedImportId: "a_fabric_box", quantity: 2 });
  board = await service.getBoard("shop-1");
  const original = output(board, "confirm_choice").choice;
  await service.recordShoppingPurchaseOutcome({ commandId: "report-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    status: "purchased", actualPaidKrw: 13500 });
  let editable = await service.getEditableShoppingChoice("shop-1");
  assert.equal(editable.choice.id, original.id);
  await assert.rejects(service.correctShoppingChoice({ commandId: "unchanged",
    activityId: "shop-1", expectedGraphFingerprint: editable.graphFingerprint,
    selectedImportId: original.importId, quantity: original.quantity,
    confirmed: true }), (error) => error.code === "UNCHANGED_CHOICE");
  await assert.rejects(service.correctShoppingChoice({ commandId: "outside",
    activityId: "shop-1", expectedGraphFingerprint: editable.graphFingerprint,
    selectedImportId: "not-in-plan", quantity: 1, confirmed: true }),
  (error) => error.code === "INVALID_REQUEST");
  const request = { commandId: "correct-shopping", activityId: "shop-1",
    expectedGraphFingerprint: editable.graphFingerprint,
    selectedImportId: "b_clear_box", quantity: 3, confirmed: true };
  const corrected = await service.correctShoppingChoice(request);
  assert.equal((await service.correctShoppingChoice(request)).replayed, true);
  await assert.rejects(service.correctShoppingChoice({ ...request,
    quantity: 4 }), (error) => error.code === "COMMAND_CONFLICT");
  await assert.rejects(service.correctShoppingChoice({ ...request,
    commandId: "stale", quantity: 4 }),
  (error) => error.code === "SHOPPING_REVISION_CONFLICT");
  editable = await service.getEditableShoppingChoice("shop-1");
  assert.equal(editable.choice.id, corrected.choiceId);
  assert.equal(editable.choice.quantity, 3);
  assert.equal(editable.choice.displayedPriceText, "15,900원");
  let state = await store.snapshot();
  assert.equal(state.knowledge.assertions.find((item) => item.status === "active" &&
    item.predicate === "shopping.choice_supersedes_choice")?.objectEntityId,
  original.id);
  assert.equal(state.knowledge.assertions.find((item) => item.status === "active" &&
    item.predicate === "shopping.purchase_for_choice")?.objectEntityId,
  original.id);
  assert.equal(state.knowledge.assertions.find((item) => item.status === "active" &&
    item.predicate === "shopping.actual_paid_krw")?.typedValue?.value, 13500);
  assert.equal((await service.getBoardReview("shop-1")).status, "blocked");
  const reviewedBoard = await service.getBoard("shop-1");
  const successor = await service.createReviewSuccessor({
    commandId: "continue-corrected-shopping", activityId: "shop-1",
    expectedRevision: reviewedBoard.revision, confirmed: true });
  assert.equal(successor.continuedFrom, "shop-1");
  assert.equal((await service.getBoard(successor.activityId)).scenario, "shopping");
  const reopenedStore = reopenStore();
  const reopened = createCommonKernelService({ ownerId: "buyer", store: reopenedStore });
  assert.equal((await reopened.getEditableShoppingChoice("shop-1")).choice.id,
    corrected.choiceId);
  const second = await reopened.correctShoppingChoice({ commandId: "correct-shopping-2",
    activityId: "shop-1", expectedGraphFingerprint: editable.graphFingerprint,
    selectedImportId: "b_clear_box", quantity: 1, confirmed: true });
  assert.equal((await reopened.getEditableShoppingChoice("shop-1")).choice.quantity, 1);
  state = await reopenedStore.snapshot();
  assert.equal(state.knowledge.assertions.find((item) => item.status === "active" &&
    item.subjectId === second.choiceId &&
    item.predicate === "shopping.choice_supersedes_choice")?.objectEntityId,
  corrected.choiceId);
  await service.knowledgeCommand({ commandId: "delete-shopping-correction",
    type: "source.delete", payload: { sourceId: corrected.sourceId } });
  await assert.rejects(service.getBoard("shop-1"),
    (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.correctShoppingChoice(request),
    (error) => error.code === "CORRECTION_DELETED");
  assert.ok(imported.length === 2);
});

test(`shopping correction blocks an old unreported choice from a new purchase report (${backend})`, async (t) => {
  const { service, store } = await fixture(t, backend);
  const created = await service.createShoppingScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-shopping" });
  let board = await service.getBoard("shop-1");
  await service.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    selectedImportId: "a_fabric_box", quantity: 1 });
  const editable = await service.getEditableShoppingChoice("shop-1");
  await service.correctShoppingChoice({ commandId: "correct-shopping",
    activityId: "shop-1", expectedGraphFingerprint: editable.graphFingerprint,
    selectedImportId: "b_clear_box", quantity: 1, confirmed: true });
  board = await service.getBoard("shop-1");
  await assert.rejects(service.recordShoppingPurchaseOutcome({
    commandId: "report-old-shopping", activityId: "shop-1",
    expectedRevision: board.revision, status: "purchased",
    actualPaidKrw: 12900 }),
  (error) => error.code === "SHOPPING_CHOICE_CORRECTED");
  assert.equal((await store.snapshot()).knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === "shopping.purchase_for_choice").length, 0);
});

test(`removing a corrected shopping capture also removes the dependent choice (${backend})`, async (t) => {
  const { service, store, imported } = await fixture(t, backend);
  const created = await service.createShoppingScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-shopping" });
  const board = await service.getBoard("shop-1");
  await service.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: board.revision,
    selectedImportId: "a_fabric_box", quantity: 1 });
  const editable = await service.getEditableShoppingChoice("shop-1");
  const request = { commandId: "correct-shopping", activityId: "shop-1",
    expectedGraphFingerprint: editable.graphFingerprint,
    selectedImportId: "b_clear_box", quantity: 2, confirmed: true };
  await service.correctShoppingChoice(request);
  await service.knowledgeCommand({ commandId: "delete-capture",
    type: "source.delete", payload: { sourceId: imported[1].sourceId } });
  await assert.rejects(service.getBoard("shop-1"),
    (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.correctShoppingChoice(request),
    (error) => error.code === "CORRECTION_DELETED");
  const state = await store.snapshot();
  assert.deepEqual(state.knowledge.assertions.filter((item) => item.status === "active" &&
    item.scope?.id === "shop-1" && item.predicate?.startsWith("shopping."))
    .map((item) => ({ id: item.id, predicate: item.predicate })), []);
});

}
