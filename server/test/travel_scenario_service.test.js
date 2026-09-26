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

const cases = [
  ["a_viewpoint", "바람언덕 전망대", "07ddb947d3d725a1cd0737346f8a5817a7bd63e67301a88277cad4cbce483099"],
  ["b_coastwalk", "푸른곶 해안길", "0746124c05158934bb348be03c57ea0f7408c2cb000477edaffe94c8806642d1"],
];

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-travel-scenario-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "state.json");
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState });
  const service = createCommonKernelService({ ownerId: "traveler", store });
  const imports = {};
  for (const [name, placeName, hash] of cases) {
    const image = await fs.readFile(fileURLToPath(new URL(`./fixtures/travel_${name}.png`, import.meta.url)));
    assert.equal(createHash("sha256").update(image).digest("hex"), hash);
    validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: name, sourceApp: "synthetic.travel", locale: "ko-KR" } });
    const analysis = JSON.parse(await fs.readFile(fileURLToPath(
      new URL(`./fixtures/travel_${name}_live_analysis.json`, import.meta.url)), "utf8"));
    validateLegacyAnalysis(analysis);
    assert.equal(analysis.contentKind, "place");
    assert.equal(analysis.place.name, placeName);
    assert.equal(analysis.place.searchArea, "제주");
    assert.equal(analysis.place.category, "activity");
    assert.ok(analysis.place.evidenceIds.length > 0);
    imports[name] = await service.importReviewedCapture({ importId: name, reviewed: true,
      reviewedAt: "2026-09-27T09:00:00+09:00",
      capture: { id: name, asset: { status: "unavailable" } }, analysis });
  }
  return { service, store, filePath, imports };
}

const scenario = { commandId: "create-travel", activityId: "trip-1", confirmed: true,
  importIds: ["a_viewpoint", "b_coastwalk"], area: "제주",
  startAt: "2026-09-28T09:00:00+09:00" };
const selections = [
  { importId: "b_coastwalk", plannedAt: "2026-09-28T10:00:00+09:00" },
  { importId: "a_viewpoint", plannedAt: "2026-09-28T13:00:00+09:00" },
];
const resultValue = (board, taskId) => {
  const ref = board.tasks.find((task) => task.id === taskId).latestOutputRef;
  return board.results.find((result) => result.id === ref)?.value;
};

test("real travel image analyses become an ordered day plan and visited-stop evidence", async (t) => {
  const { service, store, filePath } = await fixture(t);
  const created = await service.createTravelScenario(scenario);
  assert.equal(created.candidateCount, 2);
  assert.equal((await service.createTravelScenario(scenario)).replayed, true);
  assert.equal((await service.getBoard("trip-1")).tasks.length, 0);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-travel" });
  let board = await service.getBoard("trip-1");
  assert.deepEqual(board.tasks.map((item) => item.id),
    ["confirm_itinerary", "record_stop_outcomes"]);
  const confirmed = await service.confirmTravelItinerary({ commandId: "confirm-travel",
    activityId: "trip-1", expectedRevision: board.revision, selections });
  board = await service.getBoard("trip-1");
  const itinerary = resultValue(board, "confirm_itinerary").itinerary;
  assert.equal(confirmed.itineraryId, itinerary.id);
  assert.deepEqual(itinerary.stops.map((item) => item.title),
    ["푸른곶 해안길", "바람언덕 전망대"]);
  assert.deepEqual(board.tasks[1].readiness.inputs.itinerary, itinerary);
  const before = await store.snapshot();
  assert.deepEqual(before.knowledge.assertions.filter((item) =>
    item.predicate === "travel.stop_order" && item.status === "active")
    .map((item) => item.typedValue.value), [1, 2]);
  assert.equal(before.knowledge.assertions.filter((item) =>
    item.predicate === "travel.stop_at" && item.status === "active").length, 2);
  assert.equal(before.knowledge.assertions.filter((item) =>
    item.predicate === "travel.visit_of_stop" && item.status === "active").length, 0);
  assert.ok(!before.knowledge.assertions.some((item) =>
    item.predicate?.startsWith("travel.") && /이동시간|영업시간|예약/.test(JSON.stringify(item))));
  const stops = itinerary.stops.map((item, index) => ({ stopId: item.id,
    status: index === 0 ? "visited" : "skipped" }));
  const reported = await service.recordTravelStopOutcomes({ commandId: "report-travel",
    activityId: "trip-1", expectedRevision: board.revision, stops });
  assert.deepEqual(reported.visitedStopIds, [itinerary.stops[0].id]);
  assert.equal(reported.visitIds.length, 1);
  board = await service.getBoard("trip-1");
  assert.deepEqual(resultValue(board, "record_stop_outcomes").stops, stops);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.assertions.filter((item) =>
    item.predicate === "travel.visit_of_stop" && item.status === "active").length, 1);
  assert.equal(snapshot.knowledge.assertions.find((item) =>
    item.predicate === "travel.visit_at_place" && item.status === "active")
    .objectEntityId, itinerary.stops[0].placeId);
  const reopened = createCommonKernelService({ ownerId: "traveler",
    store: createJsonStateStore({ filePath, initialState: createCommonKernelState }) });
  assert.equal((await reopened.recordTravelStopOutcomes({ commandId: "report-travel",
    activityId: "trip-1", expectedRevision: reported.revision - 1, stops })).replayed, true);
  assert.equal((await reopened.confirmTravelItinerary({ commandId: "confirm-travel",
    activityId: "trip-1", expectedRevision: confirmed.revision - 1, selections })).replayed, true);
});

test("travel confirmation rejects forged task results and invalid times or candidates", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createTravelScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-travel" });
  let board = await service.getBoard("trip-1");
  const task = board.tasks[0];
  await assert.rejects(service.activityCommand({ commandId: "bypass-travel",
    type: "task.transition", activityId: "trip-1", expectedRevision: board.revision,
    payload: { taskId: task.id, expectedTaskRevision: task.revision,
      to: "completed", output: { itineraryId: "fake", itinerary: { id: "fake",
        revision: 1, area: "제주", startAt: scenario.startAt,
        stops: [{ id: "fake-stop", placeId: "fake-place", title: "fake", plannedAt: scenario.startAt }] },
      confirmedAt: scenario.startAt } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  for (const invalid of [
    [selections[0], selections[0]],
    [selections[1], selections[0]],
    [{ ...selections[0], plannedAt: "2026-09-29T10:00:00+09:00" }],
    [{ ...selections[0], importId: "foreign" }],
  ]) {
    await assert.rejects(service.confirmTravelItinerary({ commandId: `invalid-${invalid.length}-${invalid[0].plannedAt}-${invalid[0].importId}`,
      activityId: "trip-1", expectedRevision: board.revision, selections: invalid }),
    (error) => error.code === "INVALID_REQUEST");
  }
  await service.confirmTravelItinerary({ commandId: "confirm-travel",
    activityId: "trip-1", expectedRevision: board.revision, selections });
  board = await service.getBoard("trip-1");
  const itinerary = board.tasks[1].readiness.inputs.itinerary;
  await assert.rejects(service.activityCommand({ commandId: "bypass-travel-outcome",
    type: "task.transition", activityId: "trip-1", expectedRevision: board.revision,
    payload: { taskId: board.tasks[1].id,
      expectedTaskRevision: board.tasks[1].revision, to: "completed",
      output: { itineraryId: itinerary.id,
        stops: itinerary.stops.map((item) => ({ stopId: item.id,
          status: "visited" })), reportedAt: new Date().toISOString() } } }),
  (error) => error.code === "TASK_EXECUTION_RESTRICTED");
  await assert.rejects(service.recordTravelStopOutcomes({ commandId: "missing-stop",
    activityId: "trip-1", expectedRevision: board.revision,
    stops: [{ stopId: itinerary.stops[0].id, status: "visited" }] }),
  (error) => error.code === "INVALID_REQUEST");
  const unknown = await service.recordTravelStopOutcomes({ commandId: "all-unknown",
    activityId: "trip-1", expectedRevision: board.revision,
    stops: itinerary.stops.map((item) => ({ stopId: item.id, status: "unknown" })) });
  assert.deepEqual(unknown.visitIds, []);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.sources.filter((item) => item.status === "active" &&
    item.kind === "user_report" && item.provenance?.scenario === "travel").length, 0);
});

test("source deletion removes the dependent travel activity and prevents command replay", async (t) => {
  const { service, store, imports } = await fixture(t);
  const created = await service.createTravelScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId, commandId: "approve-travel" });
  let board = await service.getBoard("trip-1");
  await service.confirmTravelItinerary({ commandId: "confirm-travel",
    activityId: "trip-1", expectedRevision: board.revision, selections });
  board = await service.getBoard("trip-1");
  const itinerary = board.tasks[1].readiness.inputs.itinerary;
  await service.recordTravelStopOutcomes({ commandId: "report-travel",
    activityId: "trip-1", expectedRevision: board.revision,
    stops: itinerary.stops.map((item) => ({ stopId: item.id, status: "visited" })) });
  await service.knowledgeCommand({ commandId: "delete-coast", type: "source.delete",
    payload: { sourceId: imports.b_coastwalk.sourceId } });
  await assert.rejects(service.getBoard("trip-1"), (error) => error.code === "NOT_FOUND");
  await assert.rejects(service.createTravelScenario(scenario),
    (error) => error.code === "SCENARIO_DELETED");
  await assert.rejects(service.confirmTravelItinerary({ commandId: "confirm-travel",
    activityId: "trip-1", expectedRevision: board.revision - 1, selections }),
  (error) => error.code === "SCENARIO_DELETED");
  const snapshot = await store.snapshot();
  assert.ok(!snapshot.knowledge.sources.some((item) => item.status === "active" &&
    ["user_confirmation", "user_report"].includes(item.kind) &&
    item.provenance?.scenario === "travel" && item.provenance.activityId === "trip-1"));
  assert.ok(!snapshot.knowledge.assertions.some((item) => item.status === "active" &&
    item.predicate?.startsWith("travel.") && item.scope?.id === "trip-1"));
});

test("a changed place field invalidates a pending travel plan", async (t) => {
  const { service, store, imports } = await fixture(t);
  const created = await service.createTravelScenario(scenario);
  const snapshot = await store.snapshot();
  const field = snapshot.knowledge.assertions.find((item) => item.status === "active" &&
    item.subjectId === imports.a_viewpoint.materialId &&
    item.typedValue?.value?.path === "/place/searchArea");
  assert.ok(field);
  await service.knowledgeCommand({ commandId: "retract-area", type: "assertion.retract",
    payload: { assertionId: field.id } });
  await assert.rejects(service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-stale-travel" }), (error) => error.code === "CONTEXT_STALE");
});

test("a corrected place name reaches the approved itinerary", async (t) => {
  const { service, store, imports } = await fixture(t);
  const created = await service.createTravelScenario(scenario);
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-before-place-correction" });
  const before = await service.getBoard("trip-1");
  await correctExtractedField({ service, store,
    materialId: imports.a_viewpoint.materialId, path: "/place/name",
    value: "바람언덕 전망 쉼터", ownerId: "traveler",
    commandId: "correct-travel-name" });
  const review = await service.getBoardReview("trip-1");
  assert.equal(review.status, "ready");
  const proposed = await service.proposeBoardReview({ activityId: "trip-1",
    commandId: "propose-travel-correction", expectedRevision: before.revision,
    confirmed: true });
  await service.acceptProposal({ proposalId: proposed.proposalId,
    commandId: "approve-travel-correction" });
  const board = await service.getBoard("trip-1");
  assert.equal(board.tasks[0].readiness.inputs.candidates[0].name,
    "바람언덕 전망 쉼터");
  await service.confirmTravelItinerary({ commandId: "confirm-corrected-travel",
    activityId: "trip-1", expectedRevision: board.revision, selections });
  const itinerary = resultValue(await service.getBoard("trip-1"),
    "confirm_itinerary").itinerary;
  assert.equal(itinerary.stops[1].title, "바람언덕 전망 쉼터");
});

test("same-name captures remain separate places until a user resolves identity", async (t) => {
  const { service, store } = await fixture(t);
  const analysis = JSON.parse(await fs.readFile(fileURLToPath(
    new URL("./fixtures/travel_a_viewpoint_live_analysis.json", import.meta.url)), "utf8"));
  await service.importReviewedCapture({ importId: "another_viewpoint", reviewed: true,
    reviewedAt: "2026-09-27T10:00:00+09:00",
    capture: { id: "another_viewpoint", asset: { status: "unavailable" } }, analysis });
  const created = await service.createTravelScenario({ ...scenario,
    commandId: "create-same-name", activityId: "same-name-trip",
    importIds: ["a_viewpoint", "another_viewpoint"] });
  await service.acceptProposal({ proposalId: created.proposalId,
    commandId: "approve-same-name" });
  const board = await service.getBoard("same-name-trip");
  await service.confirmTravelItinerary({ commandId: "confirm-same-name",
    activityId: "same-name-trip", expectedRevision: board.revision, selections: [
      { importId: "a_viewpoint", plannedAt: "2026-09-28T10:00:00+09:00" },
      { importId: "another_viewpoint", plannedAt: "2026-09-28T12:00:00+09:00" },
    ] });
  const itinerary = resultValue(await service.getBoard("same-name-trip"),
    "confirm_itinerary").itinerary;
  assert.deepEqual(itinerary.stops.map((item) => item.title),
    ["바람언덕 전망대", "바람언덕 전망대"]);
  assert.notEqual(itinerary.stops[0].placeId, itinerary.stops[1].placeId);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.knowledge.identityDecisions.filter((item) =>
    item.status === "accepted" && itinerary.stops.some((stop) =>
      stop.placeId === item.entityId)).length, 2);
});

test("other regions and restaurant captures cannot enter the travel plan", async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(service.createTravelScenario({ ...scenario,
    commandId: "wrong-area", activityId: "wrong-area-trip", area: "서울" }),
  (error) => error.code === "IMPORT_NOT_TRAVEL");
  const analysis = JSON.parse(await fs.readFile(fileURLToPath(
    new URL("./fixtures/travel_a_viewpoint_live_analysis.json", import.meta.url)), "utf8"));
  analysis.place.category = "restaurant";
  await service.importReviewedCapture({ importId: "restaurant", reviewed: true,
    reviewedAt: "2026-09-27T10:00:00+09:00",
    capture: { id: "restaurant", asset: { status: "unavailable" } }, analysis });
  await assert.rejects(service.createTravelScenario({ ...scenario,
    commandId: "restaurant-trip", activityId: "restaurant-trip",
    importIds: ["restaurant"] }),
  (error) => error.code === "IMPORT_NOT_TRAVEL");
});
