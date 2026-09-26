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
import { makeFiling, makeTag, makeValidAnalysis } from "./fixtures.js";
import { correctExtractedField } from "./scenario_recovery_helpers.js";

const cases = [
  ["a_cleanser", "데일리 클렌징 젤", "114e7964624233360d5e46a97ca825383737e9c193efa46a044a7ae9c8c17dda"],
  ["b_moisturizer", "수분 장벽 크림", "ca30083dc64a5f3dcc2dca95ad7b8b894d189e27508fc7d8e5d84f2f81b0944a"],
];

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-beauty-scenario-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "state.json");
  const store = createJsonStateStore({ filePath,
    initialState: createCommonKernelState });
  const service = createCommonKernelService({ ownerId: "beauty-user", store });
  const imports = {};
  for (const [name, title, hash] of cases) {
    const image = await fs.readFile(fileURLToPath(new URL(`./fixtures/beauty_${name}.png`, import.meta.url)));
    assert.equal(createHash("sha256").update(image).digest("hex"), hash);
    validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: name, sourceApp: "synthetic.beauty", locale: "ko-KR" } });
    const analysis = JSON.parse(await fs.readFile(fileURLToPath(
      new URL(`./fixtures/beauty_${name}_live_analysis.json`, import.meta.url)), "utf8"));
    validateLegacyAnalysis(analysis);
    assert.equal(analysis.contentKind, "beauty_product");
    assert.equal(analysis.title.status, "observed");
    assert.equal(analysis.title.value, title);
    assert.ok(analysis.evidence.some((item) => item.text.includes(title)));
    imports[name] = await service.importReviewedCapture({ importId: name, reviewed: true,
      reviewedAt: "2026-09-26T09:00:00+09:00",
      capture: { id: name, asset: { status: "unavailable" } }, analysis });
  }
  return { service, store, filePath, imports };
}

const scenario = { commandId: "create-beauty", activityId: "beauty-1", confirmed: true,
  importIds: ["a_cleanser", "b_moisturizer"], occasion: "주말 저녁",
  scheduledAt: "2026-09-27T20:00:00+09:00" };

// Deliberately reverse the image's displayed use-stage order. Only the user's
// selection is the routine order; capture facts never decide it.
const selections = [
  { importId: "b_moisturizer", variantLabel: "크림 50 mL", stepTitle: "크림 바르기" },
  { importId: "a_cleanser", variantLabel: "젤 150 mL", stepTitle: "젤 세안하기" },
];

const resultValue = (board, taskId) => {
  const ref = board.tasks.find((task) => task.id === taskId).latestOutputRef;
  return board.results.find((result) => result.id === ref)?.value;
};

test("real beauty image analyses become an approved, ordered routine and an explicit use report", async (t) => {
  const { service, store, filePath } = await fixture(t);
  const created = await service.createBeautyScenario(scenario);
  assert.equal(created.candidateCount, 2);
  assert.equal((await service.createBeautyScenario(scenario)).replayed, true);
  assert.equal((await service.getBoard("beauty-1")).tasks.length, 0);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-beauty" });
  let board = await service.getBoard("beauty-1");
  assert.deepEqual(board.tasks.map((item) => item.id), [
    "confirm_routine", "instantiate_routine", "record_routine_outcome"]);
  assert.deepEqual(board.tasks[0].readiness.inputs.candidates.map((item) => item.importId),
    ["a_cleanser", "b_moisturizer"]);
  const beforeConfirmationRevision = board.revision;
  const confirmed = await service.confirmBeautyRoutine({ commandId: "confirm-beauty",
    activityId: "beauty-1", expectedRevision: board.revision, selections });
  assert.ok(confirmed.templateId);
  assert.ok(confirmed.occurrenceId);
  board = await service.getBoard("beauty-1");
  const template = resultValue(board, "confirm_routine").template;
  assert.deepEqual(template.steps.map((item) => item.title), ["크림 바르기", "젤 세안하기"]);
  assert.equal(template.revision, 1);
  assert.deepEqual(board.tasks.find((item) => item.id === "instantiate_routine")
    .readiness.inputs.template, template);
  const beforeRun = await store.snapshot();
  assert.deepEqual(beforeRun.knowledge.assertions.filter((item) =>
    item.predicate === "beauty.step_order" && item.status === "active")
    .map((item) => item.typedValue.value), [1, 2]);
  assert.equal(beforeRun.knowledge.assertions.filter((item) =>
    item.predicate === "beauty.has_step" && item.status === "active").length, 2);
  assert.equal(beforeRun.knowledge.assertions.filter((item) =>
    item.predicate === "beauty.uses_variant" && item.status === "active").length, 2);
  assert.equal(beforeRun.knowledge.assertions.filter((item) =>
    item.predicate === "beauty.experience_in" && item.status === "active").length, 0);
  assert.ok(!beforeRun.knowledge.assertions.some((item) =>
    item.predicate?.startsWith("beauty.") &&
    /건조한 피부에 촉촉함|사용 단계|효능|적합/.test(JSON.stringify(item))));
  const instantiated = await service.runTask({ commandId: "instantiate-beauty",
    activityId: "beauty-1", taskId: "instantiate_routine", expectedRevision: board.revision });
  assert.equal(instantiated.output.id, confirmed.occurrenceId);
  assert.deepEqual(instantiated.output.steps.map((item) => item.status), ["pending", "pending"]);
  board = await service.getBoard("beauty-1");
  const occurrence = board.tasks.find((item) => item.id === "record_routine_outcome")
    .readiness.inputs.occurrence;
  assert.deepEqual(occurrence, instantiated.output);
  const steps = occurrence.steps.map((item, index) => ({ templateStepId: item.templateStepId,
    status: index === 0 ? "completed" : "skipped" }));
  const recorded = await service.recordBeautyRoutineOutcome({ commandId: "report-beauty",
    activityId: "beauty-1", expectedRevision: board.revision, steps });
  assert.deepEqual(recorded.completedStepIds, [occurrence.steps[0].templateStepId]);
  assert.equal(recorded.experienceIds.length, 1);
  board = await service.getBoard("beauty-1");
  assert.deepEqual(resultValue(board, "record_routine_outcome").steps, steps);
  assert.deepEqual(resultValue(board, "instantiate_routine").steps.map((item) => item.status),
    ["pending", "pending"]); // Occurrence is a creation snapshot; outcome is the later result.
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "beauty.experience_in" && item.status === "active").length, 1);
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "beauty.experience_uses_variant" && item.status === "active").length, 1);
  assert.equal(snapshot.knowledge.assertions.find((item) =>
    item.predicate === "beauty.experience_for_step" && item.status === "active")
    .objectEntityId, occurrence.steps[0].templateStepId);
  assert.equal(snapshot.knowledge.sources.filter((item) => item.status === "active" &&
    item.kind === "user_report" && item.provenance?.scenario === "beauty").length, 1);
  assert.ok(!snapshot.knowledge.assertions.some((item) =>
    /ownership|efficacy|skin_type/.test(item.predicate ?? "")));
  const reopenedStore = createJsonStateStore({ filePath,
    initialState: createCommonKernelState });
  const restarted = createCommonKernelService({ ownerId: "beauty-user", store: reopenedStore });
  assert.equal((await restarted.createBeautyScenario(scenario)).replayed, true);
  assert.equal((await restarted.confirmBeautyRoutine({ commandId: "confirm-beauty",
    activityId: "beauty-1", expectedRevision: beforeConfirmationRevision,
    selections })).replayed, true);
  assert.equal((await restarted.recordBeautyRoutineOutcome({ commandId: "report-beauty",
    activityId: "beauty-1", expectedRevision: recorded.revision - 1, steps })).replayed, true);
});

test("routine confirmation and outcome reject generic bypass, missing steps, and non-beauty captures", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createBeautyScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-beauty" });
  let board = await service.getBoard("beauty-1");
  const confirmation = board.tasks.find((item) => item.id === "confirm_routine");
  await assert.rejects(service.activityCommand({ commandId: "generic-confirm", type: "task.transition",
    activityId: "beauty-1", expectedRevision: board.revision,
    payload: { taskId: "confirm_routine", expectedTaskRevision: confirmation.revision,
      to: "completed", output: { templateId: "fake", occurrenceId: "fake",
        template: { id: "fake", revision: 1, title: "fake",
          steps: [{ id: "fake", title: "fake" }] },
        confirmedAt: "2026-09-26T09:00:00+09:00" } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  await assert.rejects(service.confirmBeautyRoutine({ commandId: "duplicate",
    activityId: "beauty-1", expectedRevision: board.revision,
    selections: [selections[0], selections[0]] }),
  (error) => error.code === "INVALID_REQUEST");
  await service.confirmBeautyRoutine({ commandId: "confirm-beauty", activityId: "beauty-1",
    expectedRevision: board.revision, selections });
  board = await service.getBoard("beauty-1");
  await service.runTask({ commandId: "instantiate-beauty", activityId: "beauty-1",
    taskId: "instantiate_routine", expectedRevision: board.revision });
  board = await service.getBoard("beauty-1");
  const outcomeTask = board.tasks.find((item) => item.id === "record_routine_outcome");
  await assert.rejects(service.activityCommand({ commandId: "generic-outcome", type: "task.transition",
    activityId: "beauty-1", expectedRevision: board.revision,
    payload: { taskId: "record_routine_outcome", expectedTaskRevision: outcomeTask.revision,
      to: "completed", output: { occurrenceId: outcomeTask.readiness.inputs.occurrence.id,
        steps: outcomeTask.readiness.inputs.occurrence.steps.map((item) =>
          ({ templateStepId: item.templateStepId, status: "completed" })),
        recordedAt: "2026-09-26T09:00:00+09:00" } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  const occurrence = outcomeTask.readiness.inputs.occurrence;
  await assert.rejects(service.recordBeautyRoutineOutcome({ commandId: "incomplete-outcome",
    activityId: "beauty-1", expectedRevision: board.revision,
    steps: [{ templateStepId: occurrence.steps[0].templateStepId, status: "completed" }] }),
  (error) => error.code === "INVALID_REQUEST");
  const unknown = await service.recordBeautyRoutineOutcome({ commandId: "all-unknown",
    activityId: "beauty-1", expectedRevision: board.revision,
    steps: occurrence.steps.map((item) => ({ templateStepId: item.templateStepId,
      status: "unknown" })) });
  assert.deepEqual(unknown.experienceIds, []);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.filter((item) => item.status === "active" &&
    item.kind === "user_report" && item.provenance?.scenario === "beauty").length, 0);
  const appliance = makeValidAnalysis({ domain: "unknown", contentKind: "commerce_product",
    ingredientGroups: [], steps: [], facts: [], warnings: [],
    title: { value: "전기밥솥", status: "observed", confidence: 0.99, evidenceIds: ["e1"] },
    filing: makeFiling({ kinds: [makeTag("가전", ["전기밥솥"])] }) });
  await service.importReviewedCapture({ importId: "appliance", reviewed: true,
    reviewedAt: "2026-09-26T09:00:00+09:00",
    capture: { id: "appliance", asset: { status: "unavailable" } }, analysis: appliance });
  await assert.rejects(service.createBeautyScenario({ ...scenario, commandId: "appliance-beauty",
    activityId: "beauty-appliance", importIds: ["appliance"] }),
  (error) => error.code === "IMPORT_NOT_BEAUTY");
});

test("identical beauty product titles from separate captures remain separate products", async (t) => {
  const { service, store } = await fixture(t);
  const analysis = JSON.parse(await fs.readFile(fileURLToPath(
    new URL("./fixtures/beauty_a_cleanser_live_analysis.json", import.meta.url)), "utf8"));
  await service.importReviewedCapture({ importId: "a_cleanser_copy", reviewed: true,
    reviewedAt: "2026-09-26T09:00:00+09:00",
    capture: { id: "a-cleanser-copy", asset: { status: "unavailable" } }, analysis });
  const created = await service.createBeautyScenario({ ...scenario,
    commandId: "same-title-beauty", activityId: "same-title-routine",
    importIds: ["a_cleanser", "a_cleanser_copy"] });
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-same-title" });
  const board = await service.getBoard("same-title-routine");
  await service.confirmBeautyRoutine({ commandId: "confirm-same-title",
    activityId: "same-title-routine", expectedRevision: board.revision,
    selections: [
      { importId: "a_cleanser", variantLabel: "젤 150 mL", stepTitle: "1차 세안" },
      { importId: "a_cleanser_copy", variantLabel: "젤 150 mL", stepTitle: "2차 세안" },
    ] });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.identityDecisions.filter((item) =>
    item.status === "accepted").length, 2);
  assert.equal(snapshot.knowledge.entities.filter((item) =>
    item.type === "core.product" && item.status === "active").length, 2);
  assert.equal(snapshot.knowledge.entities.filter((item) =>
    item.type === "core.product_variant" && item.status === "active").length, 2);
});

test("the user can include one of several captured products without treating the other as used", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createBeautyScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-beauty" });
  let board = await service.getBoard("beauty-1");
  await service.confirmBeautyRoutine({ commandId: "confirm-one-product",
    activityId: "beauty-1", expectedRevision: board.revision,
    selections: [selections[0]] });
  board = await service.getBoard("beauty-1");
  assert.equal(resultValue(board, "confirm_routine").template.steps.length, 1);
  await service.runTask({ commandId: "instantiate-one-product",
    activityId: "beauty-1", taskId: "instantiate_routine", expectedRevision: board.revision });
  board = await service.getBoard("beauty-1");
  const occurrence = board.tasks.find((item) => item.id === "record_routine_outcome")
    .readiness.inputs.occurrence;
  assert.equal(occurrence.steps.length, 1);
  const result = await service.recordBeautyRoutineOutcome({ commandId: "skip-one-product",
    activityId: "beauty-1", expectedRevision: board.revision,
    steps: [{ templateStepId: occurrence.steps[0].templateStepId, status: "skipped" }] });
  assert.deepEqual(result.experienceIds, []);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.identityDecisions.filter((item) =>
    item.status === "accepted").length, 1);
  assert.equal(snapshot.knowledge.entities.filter((item) =>
    item.type === "beauty.use_experience" && item.status === "active").length, 0);
});

test("a changed capture title invalidates the pending beauty plan", async (t) => {
  const { service, store, imports } = await fixture(t);
  const created = await service.createBeautyScenario(scenario);
  const snapshot = await store.snapshot();
  const field = snapshot.knowledge.assertions.find((item) =>
    item.subjectId === imports.a_cleanser.materialId &&
    item.predicate === "ingestion.extracted_field" &&
    item.typedValue?.value?.path === "/title/value" && item.status === "active");
  assert.ok(field);
  await service.knowledgeCommand({ commandId: "retract-beauty-title",
    type: "assertion.retract", payload: { assertionId: field.id } });
  await assert.rejects(service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-stale-beauty" }), (error) => error.code === "CONTEXT_STALE");
  assert.equal((await service.getBoard("beauty-1")).tasks.length, 0);
  const review = await service.getBoardReview("beauty-1");
  assert.equal(review.status, "blocked");
  assert.equal(review.reasonCode, "CONTEXT_STALE");
});

test("a corrected beauty title replaces an unapproved draft", async (t) => {
  const { service, store, imports } = await fixture(t);
  const created = await service.createBeautyScenario(scenario);
  await correctExtractedField({ service, store,
    materialId: imports.a_cleanser.materialId, path: "/title/value",
    value: "데일리 클렌징 젤 플러스", ownerId: "beauty-user",
    commandId: "correct-beauty-title" });
  const review = await service.getBoardReview("beauty-1");
  assert.equal(review.status, "ready");
  assert.equal(review.planKind, "draft");
  const proposed = await service.proposeBoardReview({ activityId: "beauty-1",
    commandId: "propose-beauty-correction", expectedRevision: review.revision,
    confirmed: true });
  await assert.rejects(service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-superseded-beauty" }),
  (error) => error.code === "PROPOSAL_CONFLICT");
  await service.acceptProposal({ proposalId: proposed.proposalId,
    commandId: "approve-corrected-beauty" });
  const board = await service.getBoard("beauty-1");
  assert.equal(board.tasks[0].readiness.inputs.candidates[0].name,
    "데일리 클렌징 젤 플러스");
  assert.equal(board.tasks[1].inputBindings.scheduledAt, scenario.scheduledAt);
});

test("deleting an imported beauty capture removes its dependent activity and report", async (t) => {
  const { service, store, imports } = await fixture(t);
  const created = await service.createBeautyScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-beauty" });
  let board = await service.getBoard("beauty-1");
  const confirmed = await service.confirmBeautyRoutine({ commandId: "confirm-beauty",
    activityId: "beauty-1", expectedRevision: board.revision, selections });
  board = await service.getBoard("beauty-1");
  await service.runTask({ commandId: "instantiate-beauty", activityId: "beauty-1",
    taskId: "instantiate_routine", expectedRevision: board.revision });
  board = await service.getBoard("beauty-1");
  const steps = board.tasks.find((item) => item.id === "record_routine_outcome")
    .readiness.inputs.occurrence.steps.map((item) => ({ templateStepId: item.templateStepId,
      status: "completed" }));
  await service.recordBeautyRoutineOutcome({ commandId: "report-beauty",
    activityId: "beauty-1", expectedRevision: board.revision, steps });
  await service.knowledgeCommand({ commandId: "delete-cleanser", type: "source.delete",
    payload: { sourceId: imports.a_cleanser.sourceId } });
  await assert.rejects(service.getBoard("beauty-1"), (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.createBeautyScenario(scenario),
    (error) => error.code === "SCENARIO_DELETED");
  await assert.rejects(service.confirmBeautyRoutine({ commandId: "confirm-beauty",
    activityId: "beauty-1", expectedRevision: confirmed.revision - 1, selections }),
  (error) => error.code === "SCENARIO_DELETED");
  const snapshot = await store.snapshot();
  assert.ok(!snapshot.knowledge.sources.some((item) => item.status === "active" &&
    ["user_confirmation", "user_report"].includes(item.kind) &&
    item.provenance?.scenario === "beauty" && item.provenance.activityId === "beauty-1"));
  assert.ok(!snapshot.knowledge.assertions.some((item) => item.status === "active" &&
    item.predicate?.startsWith("beauty.") && item.scope?.id === "beauty-1"));
});
