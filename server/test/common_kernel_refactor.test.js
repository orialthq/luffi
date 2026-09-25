import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-refactor-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const store = createJsonStateStore({ filePath: join(folder, "state.json"), initialState: createCommonKernelState });
  return { store, service: createCommonKernelService({ ownerId: "person-1", store }) };
}

const emptyPlan = () => ({ tasks: [], dependencyLinks: [], dataBindings: [], artifacts: [] });
const code = (expected) => (error) => error?.code === expected;

async function createActivity(service, id, tasks = []) {
  return service.activityCommand({ commandId: `create-${id}`, type: "activity.create", activityId: id,
    expectedRevision: 0, payload: { title: `활동 ${id}`, planDraft: { ...emptyPlan(), tasks } } });
}

test("board summaries page stable IDs without copying TaskResult histories", async (t) => {
  const { service } = await fixture(t);
  for (const id of ["z", "a", "m"]) await createActivity(service, id);
  const first = await service.listBoardSummaries({ limit: 2 });
  assert.deepEqual(first.boards.map((board) => board.id), ["a", "m"]);
  assert.equal(first.nextCursor, "m");
  assert.equal(first.boards[0].taskCount, 0);
  assert.equal(first.boards[0].readyTaskCount, 0);
  assert.equal(Object.hasOwn(first.boards[0], "results"), false);
  assert.equal(Object.hasOwn(first.boards[0], "tasks"), false);
  const second = await service.listBoardSummaries({ limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.boards.map((board) => board.id), ["z"]);
  assert.equal(second.nextCursor, null);
  await assert.rejects(service.listBoardSummaries({ limit: 0 }), code("INVALID_REQUEST"));
  await assert.rejects(service.listBoardSummaries({ cursor: "" }), code("INVALID_REQUEST"));
});

test("board cursor uses an exact order even when Unicode IDs collate equally", async (t) => {
  const { service } = await fixture(t);
  for (const id of ["\u00e9", "e\u0301", "z"]) await createActivity(service, id);
  const seen = [];
  let cursor = null;
  do {
    const page = await service.listBoardSummaries({ limit: 1, cursor });
    seen.push(...page.boards.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor !== null);
  assert.deepEqual(seen, ["e\u0301", "z", "\u00e9"]);
});

test("board summary counts match a detailed board with work and pending review", async (t) => {
  const { service, store } = await fixture(t);
  await createActivity(service, "visit", [{ id: "record-visit", kind: "observation",
    capabilityId: "dining.record_visit", inputBindings: { placeId: "cafe" } }]);
  const context = await service.createContext({ activityId: "visit", queries: [] });
  await service.proposePlan({ activityId: "visit", contextId: context.contextId,
    kind: "patch", plan: { basePlanRevision: 1, operations: [] } });
  await store.transact((state) => {
    state.reviewEvents.push({ key: "visit:review", activityId: "visit", eventIds: ["source-change"], timeDue: false });
    return { state, result: null };
  });

  const detail = await service.getBoard("visit");
  const page = await service.listBoardSummaries({ limit: 1 });
  const summary = page.boards[0];
  assert.equal(summary.id, "visit");
  assert.equal(summary.taskCount, detail.tasks.length);
  assert.equal(summary.readyTaskCount, detail.nextActions.length);
  assert.equal(summary.pendingChangeCount, detail.pendingChanges.length);
  assert.equal(summary.pendingProposalCount, detail.pendingProposals.length);
  assert.deepEqual([summary.taskCount, summary.readyTaskCount, summary.pendingChangeCount,
    summary.pendingProposalCount], [1, 1, 1, 1]);
});

test("an issued context bound to one Activity cannot create another Activity", async (t) => {
  const { service, store } = await fixture(t);
  await createActivity(service, "first");
  const context = await service.createContext({ activityId: "first", queries: [] });
  const before = await store.snapshot();
  await assert.rejects(service.activityCommand({ commandId: "create-second", type: "activity.create",
    activityId: "second", contextId: context.contextId, expectedRevision: 0,
    payload: { title: "두 번째" } }), code("CONTEXT_STALE"));
  assert.deepEqual(await store.snapshot(), before);
});

test("a stale watch blocks manual task progress and an unrelated transition cannot clear review", async (t) => {
  const { service, store } = await fixture(t);
  await service.knowledgeCommand({ commandId: "entity", type: "entity.create",
    payload: { id: "reservation", type: "dining.reservation" } });
  await createActivity(service, "meal", [{ id: "confirm", kind: "observation",
    capabilityId: "dining.confirm_reservation",
    inputBindings: { reservationId: "reservation", placeId: "place" } }]);
  const query = { subjectId: "reservation", predicate: "dining.reservation_status",
    scope: { type: "activity", id: "meal" } };
  const old = await service.createContext({ activityId: "meal", queries: [query] });
  await service.watchContext({ activityId: "meal", contextId: old.contextId });
  await service.knowledgeCommand({ commandId: "source", type: "source.create",
    payload: { id: "message", kind: "message" } });
  await service.knowledgeCommand({ commandId: "version", type: "source.version.add",
    payload: { id: "message-v1", sourceId: "message", contentHash: "hash" } });
  await service.knowledgeCommand({ commandId: "evidence", type: "evidence.add",
    payload: { id: "quote", sourceVersionId: "message-v1", locator: { line: 1 } } });
  await service.knowledgeCommand({ commandId: "fact", type: "assertion.add",
    payload: { id: "confirmed", subjectId: "reservation", predicate: query.predicate,
      typedValue: { type: "dining.reservation_status", value: "confirmed" }, scope: query.scope,
      evidenceIds: ["quote"], origin: "user_reported", assertedBy: { type: "user", id: "person-1" },
      observedAt: "2026-09-25T10:00:00Z" } });
  const current = await service.getBoard("meal");
  assert.ok(current.pendingChanges.length > 0);
  const before = await store.snapshot();
  await assert.rejects(service.activityCommand({ commandId: "start-stale", type: "task.transition",
    activityId: "meal", expectedRevision: current.revision,
    payload: { taskId: "confirm", to: "in_progress" } }), code("CONTEXT_STALE"));
  assert.deepEqual(await store.snapshot(), before);

  const fresh = await service.createContext({ activityId: "meal", queries: [query] });
  await service.activityCommand({ commandId: "wait-after-review", type: "task.transition",
    activityId: "meal", contextId: fresh.contextId, expectedRevision: current.revision,
    payload: { taskId: "confirm", to: "waiting" } });
  assert.ok((await service.getBoard("meal")).pendingChanges.length > 0,
    "A task status change must not silently acknowledge plan review events");
});

test("patch knowledge dependencies revalidate resource changes and reject malformed requests", async (t) => {
  const { service, store } = await fixture(t);
  await createActivity(service, "meal", [{ id: "confirm", kind: "observation",
    capabilityId: "dining.confirm_reservation" }]);
  await service.resourceCommand({ commandId: "create-rice", type: "resource.create", expectedRevision: 0,
    payload: { resourceId: "rice", kind: "quantity", allocationMode: "consumable",
      unitPolicy: { canonicalUnit: "g", precision: 0 }, availability: { status: "known", quantity: 500,
        unit: "g", observedAt: "2025-01-01T00:00:00Z", freshUntil: "2030-01-01T00:00:00Z",
        observationId: "stock-1" } } });
  const context = await service.createContext({ activityId: "meal", queries: [], resourceIds: ["rice"] });
  await service.resourceCommand({ commandId: "observe-rice", type: "resource.observe", expectedRevision: 1,
    payload: { resourceId: "rice", availability: { status: "known", quantity: 400,
      unit: "g", observedAt: "2025-02-01T00:00:00Z", freshUntil: "2030-01-01T00:00:00Z",
      observationId: "stock-2" } } });
  const before = await store.snapshot();
  await assert.rejects(service.activityCommand({ commandId: "stale-patch", type: "plan.applyPatch",
    activityId: "meal", expectedRevision: 1,
    payload: { basePlanRevision: 1, expectedKnowledgeDependencies: [{ contextId: context.contextId }],
      operations: [] } }), code("REVISION_CONFLICT"));
  assert.deepEqual(await store.snapshot(), before);
  for (const call of [() => service.proposePlan(null), () => service.acceptProposal(null),
    () => service.watchContext(null), () => service.executeCapability(null)]) {
    await assert.rejects(call(), code("INVALID_REQUEST"));
  }
});

test("a system capability cannot receive a forged inline result through a non-completing transition", async (t) => {
  const { service, store } = await fixture(t);
  const inputBindings = { recipe: { id: "recipe", revision: 1, title: "두부",
    baseServings: 2, ingredients: [{ id: "tofu-line", ingredientId: "tofu", name: "두부",
      quantity: { status: "known", amount: 100, unit: "g" }, scaling: "linear", optional: false }] },
  targetServings: 4 };
  await createActivity(service, "cook", [{ id: "scale", kind: "action",
    capabilityId: "recipe.scale_servings", inputBindings }]);
  const output = (await service.executeCapability({ id: "recipe.scale_servings", input: inputBindings })).output;
  const before = await store.snapshot();
  await assert.rejects(service.activityCommand({ commandId: "forged-result", type: "task.transition",
    activityId: "cook", expectedRevision: 1,
    payload: { taskId: "scale", to: "waiting", output } }),
  (error) => ["INVALID_INPUT", "INVALID_TRANSITION", "TASK_EXECUTION_RESTRICTED"].includes(error?.code));
  assert.deepEqual(await store.snapshot(), before);
});
