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

const cases = [
  ["a_fabric_box", "ce71495de8243c750e0b17a67499534c9f9e691b6d2cb818046e38706634e542", "12,900원"],
  ["b_clear_box", "ab0406cd684d8f3021ed83dc37eb737a3a8bca9102d5d7ec4b142878a91fcbe5", "15,900원"],
];
const scenario = { commandId: "create-shopping", activityId: "shop-1",
  confirmed: true, purpose: "수납함 고르기", importIds: cases.map(([name]) => name) };

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-shopping-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "state.json");
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState });
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
  return { service, store, filePath, imported };
}

const output = (board, taskId) => {
  const task = board.tasks.find((item) => item.id === taskId);
  return board.results.find((item) => item.id === task.latestOutputRef)?.value;
};

test("analyzed shopping images become comparable candidates; only a user report creates purchase evidence", async (t) => {
  const { service, store, filePath } = await fixture(t);
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
    store: createJsonStateStore({ filePath, initialState: createCommonKernelState }) });
  assert.equal((await reopened.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shop-1", expectedRevision: confirmed.revision - 1,
    selectedImportId: "a_fabric_box", quantity: 2 })).replayed, true);
  assert.equal((await reopened.recordShoppingPurchaseOutcome({ commandId: "report-shopping",
    activityId: "shop-1", expectedRevision: reported.revision - 1,
    status: "purchased", actualPaidKrw: 13500 })).replayed, true);
});

test("shopping rejects task bypasses, out-of-plan choices, and unsupported purchase amounts", async (t) => {
  const { service, store } = await fixture(t);
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
});

test("deleting a source removes its shopping scenario and prevents replay", async (t) => {
  const { service, store, imported } = await fixture(t);
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

test("retracting observed price evidence invalidates an unapproved shopping plan", async (t) => {
  const { service, store, imported } = await fixture(t);
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
