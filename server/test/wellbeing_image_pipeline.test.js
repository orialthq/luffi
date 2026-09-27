import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCommonKernelService } from "../src/common/kernel_service.js";
import { createHttpServer } from "../src/http_app.js";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { createScenarioTestStore } from "./relational_fixture.js";

const cases = [
  { name: "beauty_a_cleanser", importId: "cleanser", sourceApp: "synthetic.beauty",
    hash: "114e7964624233360d5e46a97ca825383737e9c193efa46a044a7ae9c8c17dda",
    kind: "beauty_product" },
  { name: "health_home_workout", importId: "workout", sourceApp: "synthetic.health",
    hash: "c1000800307a89f4c8341d50111e6e2acbbcac6b8ad6e9be1d9048efa4f6abe7",
    kind: "unknown" },
  { name: "variation_life_tip_workout_prep", importId: "preparation",
    sourceApp: "synthetic.life_tip",
    hash: "2fb64f37eb1a20749f13e70674f0f8ee1f024c38542b4ca097e928b450251432",
    kind: "unknown" },
];

async function approve(service, created, commandId) {
  await service.acceptProposal({ proposalId: created.proposalId, commandId });
  return service.getBoard(created.activityId);
}

for (const backend of ["json", "postgres"]) {
test(`image API keeps beauty use, workout performance and tip execution separate (${backend})`, async (t) => {
  const fixtures = new Map();
  for (const item of cases) {
    const image = await readFile(fileURLToPath(new URL(
      `./fixtures/${item.name}.png`, import.meta.url)));
    assert.equal(createHash("sha256").update(image).digest("hex"), item.hash);
    const analysis = JSON.parse(await readFile(fileURLToPath(new URL(
      `./fixtures/${item.name}_live_analysis.json`, import.meta.url)), "utf8"));
    validateLegacyAnalysis(analysis);
    assert.equal(analysis.contentKind, item.kind);
    fixtures.set(item.name, { image, analysis, item });
  }
  const api = createHttpServer({ analysisService: { async analyze(input) {
    const fixture = fixtures.get(input.capture.id);
    assert.ok(fixture);
    assert.equal(createHash("sha256").update(Buffer.from(input.imageBase64, "base64"))
      .digest("hex"), fixture.item.hash);
    return fixture.analysis;
  } } });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const { store } = await createScenarioTestStore(t, backend, "wellbeing-image");
  const service = createCommonKernelService({ ownerId: "wellbeing-image-user", store });
  for (const item of cases) {
    const fixture = fixtures.get(item.name);
    const response = await fetch(`http://127.0.0.1:${api.address().port}/v1/analyze`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: { mimeType: "image/png",
        base64: fixture.image.toString("base64") },
      capture: { id: item.name, sourceApp: item.sourceApp, locale: "ko-KR" } }),
    });
    assert.equal(response.status, 200);
    const analysis = await response.json();
    assert.deepEqual(analysis, fixture.analysis);
    await service.importReviewedCapture({ importId: item.importId, reviewed: true,
      reviewedAt: "2026-09-27T09:00:00+09:00",
      capture: { id: item.name, asset: { status: "unavailable" } }, analysis });
  }

  const beauty = await service.createBeautyScenario({ commandId: "create-beauty",
    activityId: "beauty", confirmed: true, importIds: ["cleanser"],
    occasion: "운동 후", scheduledAt: "2026-09-28T19:00:00+09:00" });
  let beautyBoard = await approve(service, beauty, "approve-beauty");
  await service.confirmBeautyRoutine({ commandId: "confirm-beauty",
    activityId: "beauty", expectedRevision: beautyBoard.revision,
    selections: [{ importId: "cleanser", variantLabel: "젤 150 mL",
      stepTitle: "세안하기" }] });
  const health = await service.createHealthScenario({ commandId: "create-health",
    activityId: "health", confirmed: true, importId: "workout" });
  let healthBoard = await approve(service, health, "approve-health");
  await service.confirmHealthExercises({ commandId: "confirm-health",
    activityId: "health", expectedRevision: healthBoard.revision,
    factIndexes: [1, 2] });
  const tip = await service.createLifeTipScenario({ commandId: "create-tip",
    activityId: "tip", confirmed: true, importId: "preparation" });
  let tipBoard = await approve(service, tip, "approve-tip");
  await service.confirmLifeTipActions({ commandId: "confirm-tip",
    activityId: "tip", expectedRevision: tipBoard.revision,
    factIndexes: [1, 2, 3] });
  healthBoard = await service.getBoard("health");
  tipBoard = await service.getBoard("tip");
  await service.createScenarioConnection({ commandId: "link-health-tip",
    fromActivityId: "health", toActivityId: "tip", kind: "health_life_tip",
    confirmed: true, expectedFromRevision: healthBoard.revision,
    expectedToRevision: tipBoard.revision });

  const before = await store.snapshot();
  const active = (state, predicate) => state.knowledge.assertions.filter((item) =>
    item.status === "active" && item.predicate === predicate);
  for (const predicate of ["beauty.experience_in", "health.performance_in_session",
    "life_tip.execution_for_action"]) assert.equal(active(before, predicate).length, 0);
  beautyBoard = await service.getBoard("beauty");
  await service.runTask({ commandId: "instantiate-beauty", activityId: "beauty",
    taskId: "instantiate_routine", expectedRevision: beautyBoard.revision });
  beautyBoard = await service.getBoard("beauty");
  const beautySteps = beautyBoard.tasks.find((task) =>
    task.id === "record_routine_outcome").readiness.inputs.occurrence.steps;
  await service.recordBeautyRoutineOutcome({ commandId: "beauty-unknown",
    activityId: "beauty", expectedRevision: beautyBoard.revision,
    steps: beautySteps.map((step) => ({ templateStepId: step.templateStepId,
      status: "unknown" })) });
  healthBoard = await service.getBoard("health");
  const exercises = healthBoard.tasks.find((task) =>
    task.id === "record_exercise_outcomes").readiness.inputs.plan.exercises;
  await service.recordHealthExerciseOutcomes({ commandId: "health-unknown",
    activityId: "health", expectedRevision: healthBoard.revision,
    exercises: exercises.map((exercise) => ({ exerciseId: exercise.id,
      status: "unknown" })) });
  tipBoard = await service.getBoard("tip");
  const actions = tipBoard.tasks.find((task) =>
    task.id === "record_outcomes").readiness.inputs.plan.actions;
  await service.recordLifeTipOutcomes({ commandId: "tip-unknown",
    activityId: "tip", expectedRevision: tipBoard.revision,
    actions: actions.map((action) => ({ actionId: action.id,
      status: "unknown" })) });
  const after = await store.snapshot();
  for (const predicate of ["beauty.experience_in", "health.performance_in_session",
    "life_tip.execution_for_action"]) assert.equal(active(after, predicate).length, 0);
  assert.equal(active(after, "scenario.connection_from_subject").length, 1);
  assert.equal(active(after, "scenario.connection_to_subject").length, 1);
});
}
