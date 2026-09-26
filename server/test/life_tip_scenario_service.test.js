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

const imagePath = fileURLToPath(new URL("./fixtures/life_tip_receipts.png", import.meta.url));
const analysisPath = fileURLToPath(new URL(
  "./fixtures/life_tip_receipts_live_analysis.json", import.meta.url));
const imageHash = "711b224d91b4b1b6e888e281bf208ec310dd486c82b1975b472a328999f96b46";

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-life-tip-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "state.json");
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState });
  const service = createCommonKernelService({ ownerId: "reader", store });
  const image = await fs.readFile(imagePath);
  assert.equal(createHash("sha256").update(image).digest("hex"), imageHash);
  validateAnalyzeRequest({ image: { mimeType: "image/png",
    base64: image.toString("base64") },
  capture: { id: "receipts", sourceApp: "synthetic.life_tip", locale: "ko-KR" } });
  const analysis = JSON.parse(await fs.readFile(analysisPath, "utf8"));
  validateLegacyAnalysis(analysis);
  assert.equal(analysis.contentKind, "unknown");
  assert.equal(analysis.title.value, "영수증 정리 3단계");
  assert.deepEqual(analysis.facts.map((item) => item.label),
    ["1단계", "2단계", "3단계"]);
  assert.ok(analysis.facts.every((item) => item.evidenceIds.length));
  const imported = await service.importReviewedCapture({ importId: "receipts",
    reviewed: true, reviewedAt: "2026-09-27T09:00:00+09:00",
    capture: { id: "receipts", asset: { status: "unavailable" } }, analysis });
  return { service, store, filePath, imported, analysis };
}

const scenario = { commandId: "create-life-tip", activityId: "tip-1",
  confirmed: true, importId: "receipts" };
const resultValue = (board, taskId) => {
  const ref = board.tasks.find((task) => task.id === taskId).latestOutputRef;
  return board.results.find((result) => result.id === ref)?.value;
};

test("a live image analysis becomes a confirmed checklist and only done steps become executions", async (t) => {
  const { service, store, filePath } = await fixture(t);
  const created = await service.createLifeTipScenario(scenario);
  assert.equal(created.candidateCount, 3);
  assert.equal((await service.createLifeTipScenario(scenario)).replayed, true);
  assert.equal((await service.getBoard("tip-1")).tasks.length, 0);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-life-tip" });
  let board = await service.getBoard("tip-1");
  assert.deepEqual(board.tasks.map((item) => item.id),
    ["confirm_actions", "record_outcomes"]);
  const factIndexes = [1, 3];
  const confirmed = await service.confirmLifeTipActions({ commandId: "confirm-life-tip",
    activityId: "tip-1", expectedRevision: board.revision, factIndexes });
  board = await service.getBoard("tip-1");
  const plan = resultValue(board, "confirm_actions").plan;
  assert.equal(confirmed.planId, plan.id);
  assert.deepEqual(plan.actions.map((item) => item.factIndex), factIndexes);
  assert.equal(board.tasks[1].readiness.inputs.plan.id, plan.id);
  const before = await store.snapshot();
  assert.equal(before.knowledge.assertions.filter((item) => item.status === "active" &&
    item.predicate === "life_tip.action_text").length, 2);
  assert.equal(before.knowledge.assertions.filter((item) => item.status === "active" &&
    item.predicate === "life_tip.execution_for_action").length, 0);
  const actions = [{ actionId: plan.actions[0].id, status: "done" },
    { actionId: plan.actions[1].id, status: "skipped" }];
  const outcome = await service.recordLifeTipOutcomes({ commandId: "report-life-tip",
    activityId: "tip-1", expectedRevision: board.revision, actions });
  assert.deepEqual(outcome.doneActionIds, [plan.actions[0].id]);
  assert.equal(outcome.executionIds.length, 1);
  board = await service.getBoard("tip-1");
  assert.deepEqual(resultValue(board, "record_outcomes").actions, actions);
  const after = await store.snapshot();
  assert.deepEqual(after.knowledge.assertions.filter((item) =>
    item.predicate === "life_tip.execution_for_action" && item.status === "active")
    .map((item) => item.objectEntityId), [plan.actions[0].id]);
  const reopened = createCommonKernelService({ ownerId: "reader",
    store: createJsonStateStore({ filePath, initialState: createCommonKernelState }) });
  assert.equal((await reopened.confirmLifeTipActions({ commandId: "confirm-life-tip",
    activityId: "tip-1", expectedRevision: confirmed.revision - 1,
    factIndexes })).replayed, true);
  assert.equal((await reopened.recordLifeTipOutcomes({ commandId: "report-life-tip",
    activityId: "tip-1", expectedRevision: outcome.revision - 1,
    actions })).replayed, true);
});

test("life-tip plan refuses forged task completion and invalid selections or outcomes", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createLifeTipScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-life-tip" });
  let board = await service.getBoard("tip-1");
  await assert.rejects(service.activityCommand({ commandId: "forged-confirm",
    type: "task.transition", activityId: "tip-1", expectedRevision: board.revision,
    payload: { taskId: "confirm_actions",
      expectedTaskRevision: board.tasks[0].revision, to: "completed",
      output: { planId: "fake", plan: { id: "fake", revision: 1,
        tipId: "fake-tip", title: "fake", actions: [{ id: "fake-action",
          factIndex: 1, text: "fake", order: 1 }] },
      confirmedAt: new Date().toISOString() } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  for (const factIndexes of [[], [2, 1], [1, 1], [4]]) {
    await assert.rejects(service.confirmLifeTipActions({
      commandId: `bad-${factIndexes.join("-") || "empty"}`,
      activityId: "tip-1", expectedRevision: board.revision, factIndexes }),
    (error) => error.code === "INVALID_REQUEST");
  }
  await service.confirmLifeTipActions({ commandId: "confirm-life-tip",
    activityId: "tip-1", expectedRevision: board.revision, factIndexes: [1, 2] });
  board = await service.getBoard("tip-1");
  const plan = board.tasks[1].readiness.inputs.plan;
  await assert.rejects(service.activityCommand({ commandId: "forged-outcome",
    type: "task.transition", activityId: "tip-1", expectedRevision: board.revision,
    payload: { taskId: "record_outcomes",
      expectedTaskRevision: board.tasks[1].revision, to: "completed",
      output: { planId: plan.id, actions: plan.actions.map((item) =>
        ({ actionId: item.id, status: "done" })),
        reportedAt: new Date().toISOString() } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  await assert.rejects(service.recordLifeTipOutcomes({ commandId: "missing-action",
    activityId: "tip-1", expectedRevision: board.revision,
    actions: [{ actionId: plan.actions[0].id, status: "done" }] }),
  (error) => error.code === "INVALID_REQUEST");
  const unknown = await service.recordLifeTipOutcomes({ commandId: "all-unknown",
    activityId: "tip-1", expectedRevision: board.revision,
    actions: plan.actions.map((item) => ({ actionId: item.id, status: "unknown" })) });
  assert.deepEqual(unknown.executionIds, []);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.filter((item) => item.status === "active" &&
    item.kind === "user_report" && item.provenance?.scenario === "life_tip").length, 0);
});

test("deleted image source removes its life-tip plan and blocks replay", async (t) => {
  const { service, store, imported } = await fixture(t);
  const created = await service.createLifeTipScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-life-tip" });
  let board = await service.getBoard("tip-1");
  await service.confirmLifeTipActions({ commandId: "confirm-life-tip",
    activityId: "tip-1", expectedRevision: board.revision, factIndexes: [1] });
  board = await service.getBoard("tip-1");
  const plan = board.tasks[1].readiness.inputs.plan;
  await service.recordLifeTipOutcomes({ commandId: "report-life-tip",
    activityId: "tip-1", expectedRevision: board.revision,
    actions: [{ actionId: plan.actions[0].id, status: "done" }] });
  await service.knowledgeCommand({ commandId: "delete-tip", type: "source.delete",
    payload: { sourceId: imported.sourceId } });
  await assert.rejects(service.getBoard("tip-1"),
    (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.createLifeTipScenario(scenario),
    (error) => error.code === "SCENARIO_DELETED");
  const snapshot = await store.snapshot();
  assert.ok(!snapshot.knowledge.sources.some((item) => item.status === "active" &&
    item.provenance?.scenario === "life_tip"));
  assert.ok(!snapshot.knowledge.assertions.some((item) => item.status === "active" &&
    item.predicate?.startsWith("life_tip.") && item.scope?.id === "tip-1"));
});

test("changed fact invalidates a pending plan and non-tip content is refused", async (t) => {
  const { service, store, imported, analysis } = await fixture(t);
  const wrong = structuredClone(analysis);
  wrong.tags = wrong.tags.filter((item) => item.value !== "생활·팁");
  await service.importReviewedCapture({ importId: "not-life-tip",
    reviewed: true, reviewedAt: "2026-09-27T10:00:00+09:00",
    capture: { id: "not-life-tip", asset: { status: "unavailable" } },
    analysis: wrong });
  await assert.rejects(service.createLifeTipScenario({ ...scenario,
    commandId: "wrong-tip", activityId: "wrong-tip", importId: "not-life-tip" }),
  (error) => error.code === "IMPORT_NOT_LIFE_TIP");
  const created = await service.createLifeTipScenario(scenario);
  const snapshot = await store.snapshot();
  const field = snapshot.knowledge.assertions.find((item) =>
    item.status === "active" && item.subjectId === imported.materialId &&
    item.typedValue?.value?.path === "/facts/0/value");
  assert.ok(field);
  await service.knowledgeCommand({ commandId: "retract-fact",
    type: "assertion.retract", payload: { assertionId: field.id } });
  await assert.rejects(service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-stale-tip" }),
  (error) => error.code === "CONTEXT_STALE");
});

test("same-title captures do not automatically become one tip identity", async (t) => {
  const { service, analysis } = await fixture(t);
  await service.importReviewedCapture({ importId: "another-receipts",
    reviewed: true, reviewedAt: "2026-09-27T10:00:00+09:00",
    capture: { id: "another-receipts", asset: { status: "unavailable" } },
    analysis });
  const first = await service.createLifeTipScenario(scenario);
  const second = await service.createLifeTipScenario({ ...scenario,
    commandId: "create-another", activityId: "tip-2",
    importId: "another-receipts" });
  await service.acceptProposal({ proposalId: first.proposalId,
    commandId: "approve-first" });
  await service.acceptProposal({ proposalId: second.proposalId,
    commandId: "approve-second" });
  const one = await service.getBoard("tip-1");
  const two = await service.getBoard("tip-2");
  await service.confirmLifeTipActions({ commandId: "confirm-first",
    activityId: "tip-1", expectedRevision: one.revision, factIndexes: [1] });
  await service.confirmLifeTipActions({ commandId: "confirm-second",
    activityId: "tip-2", expectedRevision: two.revision, factIndexes: [1] });
  const firstPlan = resultValue(await service.getBoard("tip-1"),
    "confirm_actions").plan;
  const secondPlan = resultValue(await service.getBoard("tip-2"),
    "confirm_actions").plan;
  assert.equal(firstPlan.title, secondPlan.title);
  assert.notEqual(firstPlan.tipId, secondPlan.tipId);
});
