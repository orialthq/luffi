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

const imagePath = fileURLToPath(new URL(
  "./fixtures/variation_shopping_old_current_price.png", import.meta.url));
const analysisPath = fileURLToPath(new URL(
  "./fixtures/variation_shopping_old_current_price_live_analysis.json", import.meta.url));
const imageHash = "7c3da692d80c16dc3d838743ec3496608e7579738f38fda3b386843f64bf3633";
const fieldKey = "shopping.displayed_price";

async function fixture(t, alterAnalysis = () => {}) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-field-review-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const store = createJsonStateStore({ filePath: join(folder, "state.json"),
    initialState: createCommonKernelState });
  const service = createCommonKernelService({ ownerId: "reviewer", store });
  const image = await fs.readFile(imagePath);
  assert.equal(createHash("sha256").update(image).digest("hex"), imageHash);
  validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: "ambiguous-price", sourceApp: "synthetic.shopping", locale: "ko-KR" } });
  const analysis = JSON.parse(await fs.readFile(analysisPath, "utf8"));
  alterAnalysis(analysis);
  validateLegacyAnalysis(analysis);
  const imported = await service.importReviewedCapture({ importId: "ambiguous-price",
    reviewed: true, reviewedAt: "2026-09-27T09:00:00+09:00",
    capture: { id: "ambiguous-price", asset: { status: "unavailable" } }, analysis });
  return { service, store, imported, analysis };
}

const review = (overrides = {}) => ({ commandId: "confirm-current-price",
  importId: "ambiguous-price", fieldKey, sourcePath: "/facts/4/value",
  expectedRevision: 0, confirmed: true, ...overrides });
const scenario = { commandId: "create-shopping", activityId: "shopping-board",
  confirmed: true, purpose: "수납함 고르기", importIds: ["ambiguous-price"] };

test("user-reviewed current price enters shopping while old price remains source-only", async (t) => {
  const { service, store, analysis } = await fixture(t);
  assert.deepEqual(await service.getImportedFieldReview("ambiguous-price", fieldKey),
    { importId: "ambiguous-price", fieldKey, status: "unreviewed", revision: 0 });
  await assert.rejects(service.createShoppingScenario(scenario),
    (error) => error.code === "IMPORT_NOT_SHOPPING");
  await assert.rejects(service.reviewImportedField(review({ commandId: "choose-old",
    sourcePath: "/facts/3/value" })),
  (error) => error.code === "INVALID_PRICE_SELECTION");
  await assert.rejects(service.reviewImportedField(review({ commandId: "choose-material",
    sourcePath: "/facts/0/value" })),
  (error) => error.code === "INVALID_PRICE_SELECTION");
  const selected = await service.reviewImportedField(review());
  assert.equal(selected.value, "12,900원");
  assert.equal(selected.revision, 1);
  assert.equal((await service.reviewImportedField(review())).replayed, true);
  assert.equal((await service.reviewImportedField(review({ commandId: "repeat-selection",
    expectedRevision: 1 }))).replayed, true);
  assert.equal((await service.getImportedFieldReview("ambiguous-price", fieldKey)).status,
    "reviewed");
  assert.equal(analysis.facts[3].value, "19,900원");
  assert.equal(analysis.facts[4].value, "12,900원");
  const created = await service.createShoppingScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-shopping" });
  const board = await service.getBoard("shopping-board");
  assert.equal(board.tasks[0].readiness.inputs.candidates[0].displayedPriceText,
    "12,900원");
  const snapshot = await store.snapshot();
  const assertion = snapshot.knowledge.assertions.find((item) =>
    item.status === "active" && item.predicate === "ingestion.reviewed_field");
  assert.equal(assertion.typedValue.value.sourcePath, "/facts/4/value");
  assert.equal(assertion.typedValue.value.value, "12,900원");
  assert.equal(assertion.origin, "user_reported");
  assert.equal(assertion.supportSets.length, 1);
  assert.equal(assertion.supportSets[0].length, 2);
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "shopping.actual_paid_krw" && item.status === "active").length, 0);
  await service.knowledgeCommand({ commandId: "retract-reviewed-price",
    type: "assertion.retract", payload: { assertionId: assertion.id } });
  assert.equal((await service.getImportedFieldReview("ambiguous-price", fieldKey)).status,
    "stale");
  await assert.rejects(service.confirmShoppingChoice({ commandId: "choose-shopping",
    activityId: "shopping-board", expectedRevision: board.revision,
    selectedImportId: "ambiguous-price", quantity: 1 }),
  (error) => error.code === "CONTEXT_STALE");
});

test("correcting a reviewed price keeps history and invalidates the previous plan", async (t) => {
  const { service, store } = await fixture(t, (analysis) => {
    analysis.facts[3].label = "판매가";
  });
  await service.reviewImportedField(review({ commandId: "initial-price",
    sourcePath: "/facts/3/value" }));
  const created = await service.createShoppingScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-before-correction" });
  const board = await service.getBoard("shopping-board");
  assert.equal(board.tasks[0].readiness.inputs.candidates[0].displayedPriceText,
    "19,900원");
  const corrected = await service.reviewImportedField(review({
    commandId: "correct-to-displayed", expectedRevision: 1 }));
  assert.equal(corrected.revision, 2);
  assert.equal((await service.getImportedFieldReview("ambiguous-price", fieldKey)).value,
    "12,900원");
  const snapshot = await store.snapshot();
  const reviews = snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "ingestion.reviewed_field");
  assert.equal(reviews.length, 2);
  assert.equal(reviews.filter((item) => item.status === "active").length, 1);
  assert.equal(reviews.find((item) => item.status === "active").typedValue.value.value,
    "12,900원");
  await assert.rejects(service.confirmShoppingChoice({ commandId: "choose-after-correction",
    activityId: "shopping-board", expectedRevision: board.revision,
    selectedImportId: "ambiguous-price", quantity: 1 }),
  (error) => error.code === "CONTEXT_STALE");
});

test("review ownership, optimistic revision, and capture deletion are enforced", async (t) => {
  const { service, store, imported } = await fixture(t);
  const foreign = createCommonKernelService({ ownerId: "another-user", store });
  await assert.rejects(foreign.getImportedFieldReview("ambiguous-price", fieldKey),
    (error) => error.code === "IMPORT_NOT_FOUND");
  await assert.rejects(foreign.reviewImportedField(review()),
    (error) => error.code === "IMPORT_NOT_FOUND");
  await assert.rejects(service.reviewImportedField(review({ expectedRevision: 1 })),
    (error) => error.code === "REVIEW_REVISION_CONFLICT");
  await service.reviewImportedField(review());
  await assert.rejects(service.reviewImportedField(review({ commandId: "stale-review",
    expectedRevision: 0 })), (error) => error.code === "REVIEW_REVISION_CONFLICT");
  await service.knowledgeCommand({ commandId: "delete-capture", type: "source.delete",
    payload: { sourceId: imported.sourceId } });
  await assert.rejects(service.getImportedFieldReview("ambiguous-price", fieldKey),
    (error) => error.code === "IMPORT_NOT_FOUND");
  await assert.rejects(service.reviewImportedField(review()),
    (error) => error.code === "REVIEW_DELETED");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.filter((item) => item.status === "active" &&
    item.provenance?.scenario === "field_review").length, 0);
  assert.equal(JSON.stringify(snapshot).includes("12,900원"), false);
});
