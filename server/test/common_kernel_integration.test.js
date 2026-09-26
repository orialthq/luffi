import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createHttpServer } from "../src/http_app.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { makeValidAnalysis } from "./fixtures.js";

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "luffi-kernel-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  const make = () => createCommonKernelService({
    ownerId: "person-1",
    store: createJsonStateStore({ filePath, initialState: createCommonKernelState }),
  });
  return { service: make(), make };
}

test("an unknown fact watched by a board becomes an evidence-backed review, then source deletion removes it", async (t) => {
  const { service, make } = await fixture(t);
  const knowledge = (commandId, type, payload) => service.knowledgeCommand({ commandId, type, payload });
  await knowledge("entity-1", "entity.create", { id: "reservation-1", type: "dining.reservation" });
  await service.activityCommand({
    commandId: "activity-1", type: "activity.create", activityId: "dinner",
    expectedRevision: 0, payload: { title: "토요일 저녁", goal: { text: "식당에 가기" } },
  });
  const query = { subjectId: "reservation-1", predicate: "dining.reservation_status",
    scope: { type: "activity", id: "dinner" } };
  const context = await service.createContext({ queries: [query], activityId: "dinner" });
  assert.equal(context.resolutions[0].status, "unknown");
  assert.deepEqual(context.queryWatches, [query]);
  await service.watchContext({ activityId: "dinner", contextId: context.contextId });

  await knowledge("source-1", "source.create", { id: "message", kind: "user_message" });
  await knowledge("version-1", "source.version.add", { id: "message:v1", sourceId: "message", contentHash: "sha256:confirmation", content: { text: "예약 확정" } });
  await knowledge("evidence-1", "evidence.add", { id: "confirmation", sourceVersionId: "message:v1", locator: { kind: "text", start: 0, end: 5 }, quote: "예약 확정" });
  await knowledge("assertion-1", "assertion.add", {
    id: "reservation-confirmed", subjectId: "reservation-1", predicate: "dining.reservation_status",
    typedValue: { type: "dining.reservation_status", value: "confirmed" }, scope: query.scope,
    origin: "external_observed", assertedBy: { type: "external", id: "restaurant" },
    evidenceIds: ["confirmation"], observedAt: "2026-09-25T11:00:00Z",
  });
  assert.equal((await service.resolveKnowledge(query)).status, "resolved");
  assert.ok((await service.getBoard("dinner")).pendingChanges.some((item) => item.eventIds.includes("knowledge:5")));
  await assert.rejects(service.activityCommand({ commandId: "complete-with-stale-fact",
    type: "activity.complete", activityId: "dinner", expectedRevision: 1,
    payload: { goalConfirmed: true } }), (error) => error.code === "CONTEXT_STALE");

  await knowledge("delete-1", "source.delete", { sourceId: "message" });
  assert.equal((await service.resolveKnowledge(query)).status, "unknown");
  assert.equal((await make().getBoard("dinner")).pendingChanges.length > 0, true);
});

test("a registered recipe capability executes once and keeps stable TaskResult history across restart", async (t) => {
  const { service, make } = await fixture(t);
  const recipe = {
    id: "tofu-stew", revision: 1, title: "두부찌개", baseServings: 2,
    ingredients: [{ id: "req-tofu", ingredientId: "tofu", name: "두부",
      quantity: { status: "known", amount: 300, unit: "g" }, scaling: "linear", optional: false }],
  };
  await service.activityCommand({
    commandId: "create-cook", type: "activity.create", activityId: "cook",
    expectedRevision: 0, payload: { title: "저녁 준비", goal: { text: "4인분 만들기" }, planDraft: {
      tasks: [{ id: "scale", kind: "action", capabilityId: "recipe.scale_servings",
        inputBindings: { recipe, targetServings: 4 } }],
      dependencyLinks: [], dataBindings: [], artifacts: [],
    } },
  });
  const first = await service.runTask({ activityId: "cook", taskId: "scale", commandId: "run-scale", expectedRevision: 1 });
  assert.equal(first.output.ingredients[0].quantity.amount, 600);
  const replay = await make().runTask({ activityId: "cook", taskId: "scale", commandId: "run-scale", expectedRevision: 1 });
  assert.equal(replay.replayed, true);
  const board = await make().getBoard("cook");
  assert.equal(board.tasks[0].executionStatus, "completed");
  assert.deepEqual(board.tasks[0].resultHistoryRefs, [first.resultId]);
  assert.equal(board.results.length, 1);
  await assert.rejects(
    make().runTask({ activityId: "cook", taskId: "scale", commandId: "run-scale", expectedRevision: 2 }),
    (error) => error.code === "COMMAND_CONFLICT",
  );
});

test("only server-issued contexts can authorize a plan and stale proposals cannot create an activity", async (t) => {
  const { service } = await fixture(t);
  await service.knowledgeCommand({ commandId: "entity", type: "entity.create",
    payload: { id: "reservation", type: "dining.reservation" } });
  const query = { subjectId: "reservation", predicate: "dining.reservation_status",
    scope: { type: "activity", id: "trip" } };
  const context = await service.createContext({ queries: [query] });
  const command = { commandId: "create-trip", type: "activity.create", activityId: "trip",
    expectedRevision: 0, contextId: context.contextId,
    payload: { title: "저녁 약속", goal: { text: "식당 방문" } } };
  assert.equal((await service.activityCommand(command)).revision, 1);
  await assert.rejects(service.watchContext({ activityId: "trip", context: { ...context, queryWatches: [] } }),
    (error) => error.code === "INVALID_REQUEST");

  const knowledge = (commandId, type, payload) => service.knowledgeCommand({ commandId, type, payload });
  await knowledge("source", "source.create", { id: "chat", kind: "message" });
  await knowledge("version", "source.version.add", { id: "chat-v1", sourceId: "chat", contentHash: "hash" });
  await knowledge("evidence", "evidence.add", { id: "quote", sourceVersionId: "chat-v1", locator: { line: 1 } });
  await knowledge("fact", "assertion.add", { id: "confirmed", subjectId: "reservation",
    predicate: query.predicate, typedValue: { type: "dining.reservation_status", value: "confirmed" },
    scope: query.scope, evidenceIds: ["quote"], origin: "user_reported",
    assertedBy: { type: "user", id: "person-1" }, observedAt: "2026-09-25T11:00:00Z" });

  assert.equal((await service.activityCommand(command)).replayed, true);
  await assert.rejects(service.activityCommand({ ...command, commandId: "create-too-late", activityId: "late" }),
    (error) => error.code === "CONTEXT_STALE");
  assert.equal((await service.listBoards()).length, 1);
});

test("plan proposals compile before review and only apply against their issued context and activity revision", async (t) => {
  const { service } = await fixture(t);
  await service.activityCommand({ commandId: "create", type: "activity.create", activityId: "visit",
    expectedRevision: 0, payload: { title: "식당 방문", goal: { text: "방문하기" } } });
  await service.knowledgeCommand({ commandId: "entity", type: "entity.create",
    payload: { id: "reservation", type: "dining.reservation" } });
  const query = { subjectId: "reservation", predicate: "dining.reservation_status",
    scope: { type: "activity", id: "visit" } };
  const context = await service.createContext({ queries: [query], activityId: "visit" });
  const plan = { tasks: [{ id: "confirm", kind: "observation", capabilityId: "dining.confirm_reservation" }],
    dependencyLinks: [], dataBindings: [], artifacts: [] };
  await assert.rejects(service.proposePlan({ activityId: "visit", contextId: context.contextId,
    kind: "draft", plan: { tasks: [{ id: "bad", kind: "action", capabilityId: "unregistered" }] } }),
    (error) => error.code === "INVALID_PLAN");
  const proposal = await service.proposePlan({ activityId: "visit", contextId: context.contextId,
    kind: "draft", plan, run: { model: "fixture", promptVersion: 1 } });
  assert.equal((await service.getBoard("visit")).pendingProposals.length, 1);

  const knowledge = (commandId, type, payload) => service.knowledgeCommand({ commandId, type, payload });
  await knowledge("source", "source.create", { id: "notice", kind: "message" });
  await knowledge("version", "source.version.add", { id: "notice-v1", sourceId: "notice", contentHash: "hash" });
  await knowledge("evidence", "evidence.add", { id: "text", sourceVersionId: "notice-v1", locator: { line: 1 } });
  await knowledge("fact", "assertion.add", { id: "confirmed", subjectId: "reservation",
    predicate: query.predicate, typedValue: { type: "dining.reservation_status", value: "confirmed" },
    scope: query.scope, evidenceIds: ["text"], origin: "user_reported",
    assertedBy: { type: "user", id: "person-1" }, observedAt: "2026-09-25T11:00:00Z" });
  await assert.rejects(service.acceptProposal({ proposalId: proposal.id, commandId: "accept-old" }),
    (error) => error.code === "CONTEXT_STALE");
  assert.equal((await service.getBoard("visit")).tasks.length, 0);

  const updatedContext = await service.createContext({ queries: [query], activityId: "visit" });
  const updated = await service.proposePlan({ activityId: "visit", contextId: updatedContext.contextId,
    kind: "draft", plan });
  const accepted = await service.acceptProposal({ proposalId: updated.id, commandId: "accept-new" });
  assert.equal(accepted.planRevision, 1);
  assert.equal((await service.acceptProposal({ proposalId: updated.id, commandId: "accept-new" })).replayed, true);
  assert.equal((await service.getBoard("visit")).tasks[0].id, "confirm");
});

test("reviewed legacy capture imports atomically without claiming an uploaded original or a resolved real-world identity", async (t) => {
  const { service, make } = await fixture(t);
  const input = { importId: "import-capture-1", reviewed: true,
    reviewedAt: "2026-09-25T11:00:00Z",
    capture: { id: "capture-001", capturedAt: "2026-07-31T12:00:00+09:00",
      asset: { status: "device_only", deviceAssetId: "opaque-device-asset" } },
    analysis: makeValidAnalysis() };
  const first = await service.importReviewedCapture(input);
  assert.equal(first.replayed, false);
  assert.ok(first.unresolvedMentions.length > 0);
  const facts = await service.queryKnowledge({ subjectId: first.materialId,
    predicate: "ingestion.extracted_field" });
  assert.ok(facts.some((item) => item.typedValue.value.path === "/title/value"));
  assert.ok(facts.every((item) => item.evidenceIds.length > 0));
  const restored = make();
  assert.equal((await restored.importReviewedCapture(input)).replayed, true);
  await assert.rejects(restored.importReviewedCapture({ ...input,
    analysis: makeValidAnalysis({ summary: "changed after review" }) }),
    (error) => error.code === "INGESTION_IMPORT_CONFLICT");
  assert.equal((await restored.queryKnowledge({ subjectId: first.materialId })).length, facts.length);
});

test("task results cannot cite evidence outside the authenticated knowledge graph", async (t) => {
  const { service } = await fixture(t);
  await service.activityCommand({ commandId: "create", type: "activity.create", activityId: "meal",
    expectedRevision: 0, payload: { title: "식사", planDraft: {
      tasks: [{ id: "reservation", kind: "observation", capabilityId: "dining.confirm_reservation" }],
      dependencyLinks: [], dataBindings: [], artifacts: [],
    } } });
  const result = { reservationId: "r1", placeId: "p1", status: "confirmed",
    confirmationReference: "ref", confirmedAt: "2026-09-25T11:00:00Z",
    evidenceIds: ["someone-elses-evidence"] };
  await assert.rejects(service.activityCommand({ commandId: "record", type: "task.recordResult",
    activityId: "meal", expectedRevision: 1,
    payload: { taskId: "reservation", value: result } }),
    (error) => error.code === "INVALID_EVIDENCE_REFERENCE");
  assert.equal((await service.getBoard("meal")).results.length, 0);
});

test("kernel HTTP routes require a bearer token and do not change legacy analysis routes", async (t) => {
  const { service } = await fixture(t);
  const token = "a".repeat(64);
  const server = createHttpServer({
    analysisService: { async analyze() { return { legacy: true }; } },
    kernelService: service, kernelToken: token,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const unauthorized = await fetch(`${base}/v1/kernel/boards`);
  assert.equal(unauthorized.status, 401);
  const accepted = await fetch(`${base}/v1/kernel/contracts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual((await accepted.json()).packs.map((item) => item.id),
    ["recipe", "dining", "fashion", "beauty", "travel", "life_tip"]);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
