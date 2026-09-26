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
import { correctExtractedField } from "./scenario_recovery_helpers.js";

const imagePath = fileURLToPath(new URL("./fixtures/health_home_workout.png", import.meta.url));
const analysisPath = fileURLToPath(new URL(
  "./fixtures/health_home_workout_live_analysis.json", import.meta.url));
const imageHash = "c1000800307a89f4c8341d50111e6e2acbbcac6b8ad6e9be1d9048efa4f6abe7";
const scenario = { commandId: "create-health", activityId: "workout-1",
  confirmed: true, importId: "home-workout" };

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-health-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "state.json");
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState });
  const service = createCommonKernelService({ ownerId: "exerciser", store });
  const image = await fs.readFile(imagePath);
  assert.equal(createHash("sha256").update(image).digest("hex"), imageHash);
  validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
    capture: { id: "home-workout", sourceApp: "synthetic.health", locale: "ko-KR" } });
  const analysis = JSON.parse(await fs.readFile(analysisPath, "utf8"));
  validateLegacyAnalysis(analysis);
  assert.equal(analysis.contentKind, "unknown");
  assert.equal(analysis.completeness, "complete");
  assert.ok(analysis.tags.some((tag) => tag.value === "건강·운동"));
  assert.deepEqual(analysis.facts.map((item) => item.label),
    ["1단계", "2단계", "3단계"]);
  const imported = await service.importReviewedCapture({ importId: "home-workout",
    reviewed: true, reviewedAt: "2026-09-27T09:00:00+09:00",
    capture: { id: "home-workout", asset: { status: "unavailable" } }, analysis });
  return { service, store, filePath, imported, analysis };
}

const output = (board, taskId) => {
  const task = board.tasks.find((item) => item.id === taskId);
  return board.results.find((item) => item.id === task.latestOutputRef)?.value;
};

test("real workout screenshot becomes a plan; only reported performance creates a session", async (t) => {
  const { service, store, filePath } = await fixture(t);
  const created = await service.createHealthScenario(scenario);
  assert.equal(created.candidateCount, 3);
  assert.equal((await service.createHealthScenario(scenario)).replayed, true);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-health" });
  let board = await service.getBoard("workout-1");
  assert.deepEqual(board.tasks.map((item) => item.id),
    ["confirm_exercises", "record_exercise_outcomes"]);
  const confirmed = await service.confirmHealthExercises({ commandId: "confirm-health",
    activityId: "workout-1", expectedRevision: board.revision,
    factIndexes: [1, 3] });
  board = await service.getBoard("workout-1");
  const plan = output(board, "confirm_exercises").plan;
  assert.deepEqual(plan.exercises.map((item) => item.factIndex), [1, 3]);
  assert.equal(board.tasks[1].readiness.inputs.plan.id, plan.id);
  let state = await store.snapshot();
  assert.equal(state.knowledge.assertions.filter((item) => item.status === "active" &&
    item.predicate === "health.performance_of_exercise").length, 0);
  const exercises = [{ exerciseId: plan.exercises[0].id, status: "done",
    actualAmount: 4, actualUnit: "minutes" },
  { exerciseId: plan.exercises[1].id, status: "skipped" }];
  const reported = await service.recordHealthExerciseOutcomes({ commandId: "report-health",
    activityId: "workout-1", expectedRevision: board.revision, exercises });
  assert.equal(reported.performanceIds.length, 1);
  board = await service.getBoard("workout-1");
  assert.deepEqual(output(board, "record_exercise_outcomes").exercises, exercises);
  state = await store.snapshot();
  assert.deepEqual(state.knowledge.assertions.filter((item) => item.status === "active" &&
    item.predicate === "health.actual_amount").map((item) => item.typedValue.value), [4]);
  assert.deepEqual(state.knowledge.assertions.filter((item) => item.status === "active" &&
    item.predicate === "health.actual_unit").map((item) => item.typedValue.value), ["minutes"]);
  assert.deepEqual(state.knowledge.assertions.filter((item) => item.status === "active" &&
    item.predicate === "health.performance_of_exercise").map((item) => item.objectEntityId),
  [plan.exercises[0].id]);
  const reopened = createCommonKernelService({ ownerId: "exerciser",
    store: createJsonStateStore({ filePath, initialState: createCommonKernelState }) });
  assert.equal((await reopened.confirmHealthExercises({ commandId: "confirm-health",
    activityId: "workout-1", expectedRevision: confirmed.revision - 1,
    factIndexes: [1, 3] })).replayed, true);
  assert.equal((await reopened.recordHealthExerciseOutcomes({ commandId: "report-health",
    activityId: "workout-1", expectedRevision: reported.revision - 1,
    exercises })).replayed, true);
});

test("health flow rejects bypasses, missing actual amounts, and unselected exercises", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createHealthScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-health" });
  let board = await service.getBoard("workout-1");
  await assert.rejects(service.activityCommand({ commandId: "forge-health",
    type: "task.transition", activityId: "workout-1", expectedRevision: board.revision,
    payload: { taskId: "confirm_exercises",
      expectedTaskRevision: board.tasks[0].revision, to: "completed",
      output: { planId: "fake", plan: { id: "fake", revision: 1,
        workoutId: "fake", title: "fake", exercises: [{ id: "fake", factIndex: 1,
          text: "fake", order: 1 }] }, confirmedAt: new Date().toISOString() } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  for (const indexes of [[], [2, 1], [1, 1], [4]]) {
    await assert.rejects(service.confirmHealthExercises({ commandId: `bad-${indexes}`,
      activityId: "workout-1", expectedRevision: board.revision,
      factIndexes: indexes }), (error) => error.code === "INVALID_REQUEST");
  }
  await service.confirmHealthExercises({ commandId: "confirm-health",
    activityId: "workout-1", expectedRevision: board.revision,
    factIndexes: [1, 2] });
  board = await service.getBoard("workout-1");
  const plan = board.tasks[1].readiness.inputs.plan;
  await assert.rejects(service.activityCommand({ commandId: "forge-outcome",
    type: "task.transition", activityId: "workout-1", expectedRevision: board.revision,
    payload: { taskId: "record_exercise_outcomes",
      expectedTaskRevision: board.tasks[1].revision, to: "completed",
      output: { planId: plan.id, exercises: plan.exercises.map((item) =>
        ({ exerciseId: item.id, status: "unknown" })),
      reportedAt: new Date().toISOString() } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  await assert.rejects(service.recordHealthExerciseOutcomes({ commandId: "missing-amount",
    activityId: "workout-1", expectedRevision: board.revision,
    exercises: [{ exerciseId: plan.exercises[0].id, status: "done" },
      { exerciseId: plan.exercises[1].id, status: "unknown" }] }),
  (error) => error.code === "INVALID_REQUEST");
  await assert.rejects(service.recordHealthExerciseOutcomes({ commandId: "missing-exercise",
    activityId: "workout-1", expectedRevision: board.revision,
    exercises: [{ exerciseId: plan.exercises[0].id, status: "skipped" }] }),
  (error) => error.code === "INVALID_REQUEST");
  const allUnknown = await service.recordHealthExerciseOutcomes({ commandId: "unknown-health",
    activityId: "workout-1", expectedRevision: board.revision,
    exercises: plan.exercises.map((item) => ({ exerciseId: item.id, status: "unknown" })) });
  assert.equal(allUnknown.sessionId, null);
  assert.deepEqual(allUnknown.performanceIds, []);
  const state = await store.snapshot();
  assert.equal(state.knowledge.entities.filter((item) => item.status === "active" &&
    item.type === "health.workout_session").length, 0);
});

test("source deletion cascades to health plan and reported performance", async (t) => {
  const { service, store, imported } = await fixture(t);
  const created = await service.createHealthScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-health" });
  let board = await service.getBoard("workout-1");
  await service.confirmHealthExercises({ commandId: "confirm-health",
    activityId: "workout-1", expectedRevision: board.revision, factIndexes: [1] });
  board = await service.getBoard("workout-1");
  const exercise = board.tasks[1].readiness.inputs.plan.exercises[0];
  await service.recordHealthExerciseOutcomes({ commandId: "report-health",
    activityId: "workout-1", expectedRevision: board.revision,
    exercises: [{ exerciseId: exercise.id, status: "done",
      actualAmount: 5, actualUnit: "minutes" }] });
  await service.knowledgeCommand({ commandId: "delete-health", type: "source.delete",
    payload: { sourceId: imported.sourceId } });
  await assert.rejects(service.getBoard("workout-1"),
    (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.createHealthScenario(scenario),
    (error) => error.code === "SCENARIO_DELETED");
  const state = await store.snapshot();
  assert.ok(!state.knowledge.assertions.some((item) => item.status === "active" &&
    item.predicate?.startsWith("health.") && item.scope?.id === "workout-1"));
});

test("changed exercise text invalidates approval; a non-exercise capture is refused", async (t) => {
  const { service, store, imported, analysis } = await fixture(t);
  const wrong = structuredClone(analysis);
  wrong.tags = wrong.tags.filter((item) => item.value !== "운동");
  await service.importReviewedCapture({ importId: "not-exercise", reviewed: true,
    reviewedAt: "2026-09-27T10:00:00+09:00",
    capture: { id: "not-exercise", asset: { status: "unavailable" } }, analysis: wrong });
  await assert.rejects(service.createHealthScenario({ ...scenario,
    commandId: "wrong-health", activityId: "wrong-health", importId: "not-exercise" }),
  (error) => error.code === "IMPORT_NOT_HEALTH");
  const created = await service.createHealthScenario(scenario);
  const state = await store.snapshot();
  const field = state.knowledge.assertions.find((item) => item.status === "active" &&
    item.subjectId === imported.materialId &&
    item.typedValue?.value?.path === "/facts/0/value");
  assert.ok(field);
  await service.knowledgeCommand({ commandId: "retract-exercise",
    type: "assertion.retract", payload: { assertionId: field.id } });
  await assert.rejects(service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-stale-health" }),
  (error) => error.code === "CONTEXT_STALE");
});

test("corrected exercise text reaches the confirmed workout after review", async (t) => {
  const { service, store, imported } = await fixture(t);
  const created = await service.createHealthScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-before-exercise-correction" });
  const before = await service.getBoard("workout-1");
  await correctExtractedField({ service, store, materialId: imported.materialId,
    path: "/facts/0/value", value: "스쿼트 12회씩 3세트",
    ownerId: "exerciser", commandId: "correct-exercise-step" });
  const review = await service.getBoardReview("workout-1");
  assert.equal(review.status, "ready");
  const proposed = await service.proposeBoardReview({ activityId: "workout-1",
    commandId: "propose-exercise-correction", expectedRevision: before.revision,
    confirmed: true });
  await service.acceptProposal({ proposalId: proposed.proposalId,
    commandId: "approve-exercise-correction" });
  const board = await service.getBoard("workout-1");
  assert.equal(board.tasks[0].readiness.inputs.candidates[0].text,
    "스쿼트 12회씩 3세트");
  await service.confirmHealthExercises({ commandId: "confirm-corrected-health",
    activityId: "workout-1", expectedRevision: board.revision,
    factIndexes: [1] });
  const plan = output(await service.getBoard("workout-1"), "confirm_exercises").plan;
  assert.equal(plan.exercises[0].text, "스쿼트 12회씩 3세트");
});
