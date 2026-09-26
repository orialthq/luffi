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

async function setup(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-field-correction-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const store = createJsonStateStore({ filePath: join(folder, "state.json"),
    initialState: createCommonKernelState });
  return { store, service: createCommonKernelService({ ownerId: "editor", store }) };
}

async function importImage(service, name, expectedHash) {
  const image = await fs.readFile(new URL(`./fixtures/${name}.png`, import.meta.url));
  assert.equal(createHash("sha256").update(image).digest("hex"), expectedHash);
  validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: name, sourceApp: "synthetic" } });
  const analysis = JSON.parse(await fs.readFile(new URL(
    `./fixtures/${name}_live_analysis.json`, import.meta.url), "utf8"));
  validateLegacyAnalysis(analysis);
  return service.importReviewedCapture({ importId: name, reviewed: true,
    reviewedAt: "2026-09-27T09:00:00+09:00",
    capture: { id: name, asset: { status: "unavailable" } }, analysis });
}

test("an image-backed restaurant name correction reaches a reviewed board without changing the snapshot", async (t) => {
  const { store, service } = await setup(t);
  const imported = await importImage(service, "dining_a_seongsu",
    "deb96a44db7455330d1bdff63ff77d21b0b89eaa6e244f145970e4b7b223d11b");
  const proposed = await service.createDiningScenario({ commandId: "create-dining",
    activityId: "dinner", confirmed: true, importIds: ["dining_a_seongsu"],
    scheduledAt: "2026-09-28T19:00:00+09:00", area: "성수", partySize: 2 });
  await service.acceptProposal({ proposalId: proposed.proposalId, commandId: "accept-dining" });
  const before = await service.getBoard("dinner");
  const editable = await service.getEditableCaptureFields("dining_a_seongsu");
  assert.deepEqual(editable.fields.map((item) => item.path),
    ["/place/name", "/place/searchArea"]);
  const name = editable.fields.find((item) => item.path === "/place/name");
  assert.equal(name.value, "모퉁이식당 성수점");
  assert.ok(name.evidence.some((item) => item.quote.includes("모퉁이식당")));
  const request = { commandId: "correct-name", importId: "dining_a_seongsu",
    path: "/place/name", value: "모퉁이식당 성수 본점",
    expectedRevision: name.revision, confirmed: true };
  const corrected = await service.correctImportedField(request);
  assert.equal(corrected.replayed, false);
  assert.equal((await service.correctImportedField(request)).replayed, true);
  assert.equal((await service.getEditableCaptureFields("dining_a_seongsu")).fields
    .find((item) => item.path === "/place/name").value, "모퉁이식당 성수 본점");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sourceVersions.find((item) =>
    item.id === imported.sourceVersionId).content.analysis.place.name, "모퉁이식당 성수점");
  assert.equal(snapshot.knowledge.assertions.find((item) => item.status === "active" &&
    item.typedValue?.value?.path === "/place/name").origin, "user_reported");
  const review = await service.getBoardReview("dinner");
  assert.equal(review.status, "ready");
  assert.ok(review.changes.some((item) => item.after.includes("모퉁이식당 성수 본점")));
  const update = await service.proposeBoardReview({ activityId: "dinner",
    commandId: "propose-corrected-dinner", expectedRevision: before.revision, confirmed: true });
  assert.equal((await service.getBoard("dinner")).tasks[0].readiness.inputs
    .candidates[0].name, "모퉁이식당 성수점");
  await service.acceptProposal({ proposalId: update.proposalId, commandId: "accept-corrected-dinner" });
  assert.equal((await service.getBoard("dinner")).tasks[0].readiness.inputs
    .candidates[0].name, "모퉁이식당 성수 본점");
  await assert.rejects(service.correctImportedField({ ...request, commandId: "stale-edit",
    value: "또 다른 이름" }), (error) => error.code === "FIELD_REVISION_CONFLICT");
  await assert.rejects(service.correctImportedField({ ...request, value: "다른 이름" }),
    (error) => error.code === "COMMAND_CONFLICT");
  await assert.rejects(service.correctImportedField({ ...request, commandId: "category-edit",
    path: "/place/category" }), (error) => error.code === "FIELD_NOT_EDITABLE");
  const latest = (await service.getEditableCaptureFields("dining_a_seongsu")).fields
    .find((item) => item.path === "/place/name");
  assert.equal(latest.revision, 2);
  const second = await service.correctImportedField({ ...request,
    commandId: "correct-name-again", expectedRevision: latest.revision,
    value: "모퉁이식당 성수 본관" });
  assert.equal(second.revision, 3);
  assert.equal((await service.getEditableCaptureFields("dining_a_seongsu")).fields
    .find((item) => item.path === "/place/name").value, "모퉁이식당 성수 본관");
  await service.deleteReviewedCapture({ importId: "dining_a_seongsu", commandId: "delete-import" });
  const deleted = await store.snapshot();
  assert.equal(deleted.knowledge.sources.find((item) => item.id === corrected.sourceId).status,
    "deleted");
  assert.equal(deleted.knowledge.sources.find((item) => item.id === second.sourceId).status,
    "deleted");
  assert.equal(deleted.knowledge.sourceVersions.find((item) =>
    item.sourceId === corrected.sourceId).content, null);
  await assert.rejects(service.correctImportedField(request),
    (error) => error.code === "IMPORT_NOT_FOUND");
});

test("an image-backed ordered step correction preserves a started checklist and offers a successor", async (t) => {
  const { service } = await setup(t);
  await importImage(service, "life_tip_receipts",
    "711b224d91b4b1b6e888e281bf208ec310dd486c82b1975b472a328999f96b46");
  const proposed = await service.createLifeTipScenario({ commandId: "create-tip",
    activityId: "tip", confirmed: true, importId: "life_tip_receipts" });
  await service.acceptProposal({ proposalId: proposed.proposalId, commandId: "accept-tip" });
  let board = await service.getBoard("tip");
  await service.confirmLifeTipActions({ commandId: "confirm-tip", activityId: "tip",
    expectedRevision: board.revision, factIndexes: [1] });
  board = await service.getBoard("tip");
  const oldResults = structuredClone(board.results);
  const editable = await service.getEditableCaptureFields("life_tip_receipts");
  const step = editable.fields.find((item) => item.path === "/facts/0/value");
  assert.ok(step.evidence.length > 0);
  await service.correctImportedField({ commandId: "correct-step", importId: "life_tip_receipts",
    path: step.path, value: "영수증을 날짜별로 먼저 분류한다",
    expectedRevision: step.revision, confirmed: true });
  const review = await service.getBoardReview("tip");
  assert.equal(review.status, "blocked");
  assert.equal(review.reasonCode, "STARTED_TASK_PROTECTED");
  assert.deepEqual((await service.getBoard("tip")).results, oldResults);
  const next = await service.createReviewSuccessor({ activityId: "tip",
    commandId: "continue-tip", expectedRevision: board.revision, confirmed: true });
  assert.ok(next.activityId);
  const successor = await service.getBoard(next.activityId);
  assert.equal(successor.pendingProposals.length, 1);
  await service.acceptProposal({ proposalId: next.proposalId, commandId: "accept-new-tip" });
  assert.equal((await service.getBoard(next.activityId)).tasks[0].readiness.inputs
    .candidates[0].text, "영수증을 날짜별로 먼저 분류한다");
  assert.deepEqual((await service.getBoard("tip")).results, oldResults);
});

test("editable paths cover fashion, beauty, travel and exercise without exposing unrelated facts", async (t) => {
  const { store, service } = await setup(t);
  const fixtures = [
    ["fashion_a_blazer", ["/title/value"]],
    ["beauty_a_cleanser", ["/title/value"]],
    ["travel_a_viewpoint", ["/place/name", "/place/searchArea"]],
    ["health_home_workout", ["/facts/0/value", "/facts/1/value",
      "/facts/2/value", "/title/value"]],
  ];
  for (const [name, paths] of fixtures) {
    const analysis = JSON.parse(await fs.readFile(new URL(
      `./fixtures/${name}_live_analysis.json`, import.meta.url), "utf8"));
    validateLegacyAnalysis(analysis);
    await service.importReviewedCapture({ importId: name, reviewed: true,
      reviewedAt: "2026-09-27T09:00:00+09:00",
      capture: { id: name, asset: { status: "unavailable" } }, analysis });
    assert.deepEqual((await service.getEditableCaptureFields(name)).fields
      .map((item) => item.path), paths);
  }
  const foreign = createCommonKernelService({ ownerId: "other-user", store });
  await assert.rejects(foreign.getEditableCaptureFields("fashion_a_blazer"),
    (error) => error.code === "IMPORT_NOT_FOUND");
  await assert.rejects(foreign.correctImportedField({ commandId: "foreign-edit",
    importId: "fashion_a_blazer", path: "/title/value", value: "위조 값",
    expectedRevision: 1, confirmed: true }),
  (error) => error.code === "IMPORT_NOT_FOUND");
});
