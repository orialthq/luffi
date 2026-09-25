import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

const OWNER = "resource-regression-owner";
const emptyPlan = () => ({ tasks: [], dependencyLinks: [], dataBindings: [], artifacts: [] });
const isCode = (code) => (error) => error?.code === code;

async function fixture(t, { beforeCommit } = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "luffi-resource-regression-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "state.json");
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState });
  const service = createCommonKernelService({ ownerId: OWNER, store: {
    snapshot: () => store.snapshot(),
    transact: (change) => store.transact(async (state) => {
      const outcome = await change(state);
      beforeCommit?.(outcome.state);
      return outcome;
    }),
  } });
  return { service, store, filePath,
    restart: () => createCommonKernelService({ ownerId: OWNER,
      store: createJsonStateStore({ filePath, initialState: createCommonKernelState }) }) };
}

async function createActivity(service, activityId, { tasks = [] } = {}) {
  return service.activityCommand({ commandId: `create-${activityId}`, type: "activity.create",
    activityId, expectedRevision: 0, payload: { title: activityId,
      planDraft: { ...emptyPlan(), tasks } } });
}

function scaleTask() {
  return { id: "scale", kind: "action", capabilityId: "recipe.scale_servings", inputBindings: {
    recipe: { id: "rice-recipe", revision: 1, title: "밥 준비", baseServings: 2,
      ingredients: [{ id: "rice-required", ingredientId: "rice", name: "쌀",
        quantity: { status: "known", amount: 100, unit: "g" }, scaling: "linear", optional: false }] },
    targetServings: 4,
  } };
}

async function createResource(service, resourceId, { observedAt, freshUntil } = {}) {
  return service.resourceCommand({ commandId: `create-${resourceId}`, type: "resource.create",
    expectedRevision: 0, payload: { resourceId, kind: "quantity", allocationMode: "consumable",
      unitPolicy: { canonicalUnit: "g", precision: 0 }, availability: { status: "known",
        quantity: 500, unit: "g", observationId: `${resourceId}-observation`,
        observedAt: observedAt ?? new Date(Date.now() - 60_000).toISOString(),
        freshUntil: freshUntil ?? new Date(Date.now() + 3_600_000).toISOString() } } });
}

function acquireCommand(activityId, resourceId, claimId, expectedRevision = 1, quantity = 100) {
  return { commandId: `acquire-${claimId}`, type: "claim.acquire", expectedRevision,
    payload: { activityId, resourceId, claimId, quantity, unit: "g" } };
}

async function watchResource(service, activityId, resourceId) {
  const context = await service.createContext({ activityId, queries: [], resourceIds: [resourceId] });
  await service.watchContext({ activityId, contextId: context.contextId });
  return context;
}

test("regression: resource freshness expiry invalidates context without a resource revision change", async (t) => {
  const realNow = Date.now();
  // The expiry is already in the real past; only issuance runs before it.
  // This avoids sleeps and proves elapsed freshness, rather than a new write,
  // invalidates an otherwise unexpired server-issued context.
  t.mock.timers.enable({ apis: ["Date"], now: realNow - 120_000 });
  const { service, store, filePath } = await fixture(t);
  await createActivity(service, "cook", { tasks: [scaleTask()] });
  await createResource(service, "rice", {
    observedAt: new Date(realNow - 180_000).toISOString(),
    freshUntil: new Date(realNow - 60_000).toISOString(),
  });
  const context = await watchResource(service, "cook", "rice");
  assert.equal(context.resourceAvailability[0].status, "known");
  assert.equal((await service.getBoard("cook")).tasks[0].readiness.status, "ready");
  const before = await store.snapshot();
  const diskBefore = await fs.readFile(filePath, "utf8");

  t.mock.timers.reset();
  assert.ok(Date.parse(before.issuedContexts[context.contextId].expiresAt) > Date.now(),
    "The context's own TTL must still be valid so the rejection is specifically resource freshness");
  const expired = await service.resourceAvailability({ resourceId: "rice" });
  assert.equal(expired.status, "stale");
  assert.equal(expired.remaining, null);
  assert.equal(expired.resourceRevision, context.resourceAvailability[0].resourceRevision);
  assert.deepEqual(await store.snapshot(), before, "Clock passage and resource reads must not write state");

  await assert.rejects(service.proposePlan({ activityId: "cook", contextId: context.contextId,
    kind: "draft", plan: emptyPlan() }), isCode("CONTEXT_STALE"));
  await assert.rejects(service.runTask({ activityId: "cook", taskId: "scale",
    commandId: "run-expired-resource", expectedRevision: 1 }), isCode("CONTEXT_STALE"));
  assert.deepEqual(await store.snapshot(), before, "Rejected proposal and execution cannot add receipts or results");
  assert.equal(await fs.readFile(filePath, "utf8"), diskBefore);
});

test("regression: acquiring and releasing a resource invalidates another Activity's watched context", async (t) => {
  const { service, store } = await fixture(t);
  await createActivity(service, "owner-activity");
  await createActivity(service, "watching-activity");
  await createResource(service, "rice");
  const beforeAcquire = await watchResource(service, "watching-activity", "rice");
  assert.equal((await service.getBoard("watching-activity")).pendingChanges.length, 0);

  await service.resourceCommand(acquireCommand("owner-activity", "rice", "rice-claim"));
  const afterAcquire = await service.getBoard("watching-activity");
  const acquireChanges = afterAcquire.pendingChanges.filter((item) => item.resourceId === "rice");
  assert.equal(afterAcquire.resourceClaims.length, 0, "The watcher is affected even though it holds no claim");
  assert.equal(afterAcquire.revision, beforeAcquire.activityRevision);
  assert.equal(acquireChanges.length, 1);
  const acquiredState = await store.snapshot();
  await assert.rejects(service.proposePlan({ activityId: "watching-activity",
    contextId: beforeAcquire.contextId, kind: "draft", plan: emptyPlan() }), isCode("CONTEXT_STALE"));
  assert.deepEqual(await store.snapshot(), acquiredState);

  const beforeRelease = await watchResource(service, "watching-activity", "rice");
  assert.equal(beforeRelease.resourceAvailability[0].remaining, 400);
  await service.resourceCommand({ commandId: "release-rice", type: "claim.release",
    expectedRevision: beforeRelease.resourceAvailability[0].resourceRevision,
    payload: { activityId: "owner-activity", resourceId: "rice", claimId: "rice-claim" } });
  const afterRelease = await service.getBoard("watching-activity");
  const releaseChanges = afterRelease.pendingChanges.filter((item) =>
    item.resourceId === "rice" && !acquireChanges.some((previous) => previous.key === item.key));
  assert.equal(releaseChanges.length, 1, "Release must add its own review event for the other Activity");
  assert.equal(afterRelease.revision, beforeRelease.activityRevision);
  assert.equal((await service.resourceAvailability({ resourceId: "rice" })).remaining, 500);
  const releasedState = await store.snapshot();
  await assert.rejects(service.proposePlan({ activityId: "watching-activity",
    contextId: beforeRelease.contextId, kind: "draft", plan: emptyPlan() }), isCode("CONTEXT_STALE"));
  assert.deepEqual(await store.snapshot(), releasedState);
});

test("regression: cancellation releases all claims atomically and acquisition retries never reacquire", async (t) => {
  let failCancellationCommit = false;
  let cancellationTransactions = 0;
  const commitFailure = new Error("Injected cancellation commit failure");
  const { service, store, filePath, restart } = await fixture(t, { beforeCommit: (state) => {
    if (state.activities.activities.cook?.lifecycle !== "canceled") return;
    cancellationTransactions += 1;
    assert.equal(state.resources.claims.filter((claim) => claim.activityId === "cook" && claim.state === "held").length, 0,
      "The transaction that cancels the Activity must already contain every claim release");
    if (failCancellationCommit) throw commitFailure;
  } });
  await createActivity(service, "cook");
  await createResource(service, "rice");
  await createResource(service, "tofu");
  const firstAcquire = acquireCommand("cook", "rice", "rice-first");
  const firstReceipt = await service.resourceCommand(firstAcquire);
  await service.resourceCommand(acquireCommand("cook", "rice", "rice-second", 2));
  await service.resourceCommand(acquireCommand("cook", "tofu", "tofu-first"));
  const before = await store.snapshot();
  const diskBefore = await fs.readFile(filePath, "utf8");
  const cancel = { commandId: "cancel-cook", type: "activity.cancel", activityId: "cook",
    expectedRevision: 1, payload: {} };

  failCancellationCommit = true;
  await assert.rejects(service.activityCommand(cancel), (error) => error === commitFailure);
  assert.equal(cancellationTransactions, 1);
  assert.deepEqual(await store.snapshot(), before, "Failed commit must roll back lifecycle, all releases, and all receipts");
  assert.equal(await fs.readFile(filePath, "utf8"), diskBefore);
  assert.equal((await restart().getBoard("cook")).lifecycle, "active");

  failCancellationCommit = false;
  const canceled = await service.activityCommand(cancel);
  assert.equal(cancellationTransactions, 2, "A successful cancellation must commit all changes in one transaction");
  assert.equal(canceled.lifecycle, "canceled");
  assert.equal(canceled.replayed, false, "The failed cancellation must not leave a command receipt");
  const restored = restart();
  const board = await restored.getBoard("cook");
  assert.equal(board.lifecycle, "canceled");
  assert.equal(board.resourceClaims.length, 3);
  assert.ok(board.resourceClaims.every((claim) => claim.state === "released"));
  for (const resourceId of ["rice", "tofu"]) {
    const availability = await restored.resourceAvailability({ resourceId });
    assert.equal(availability.reserved, 0);
    assert.equal(availability.remaining, 500);
  }
  const canceledState = await store.snapshot();
  const canceledDisk = await fs.readFile(filePath, "utf8");
  const rice = await restored.resourceAvailability({ resourceId: "rice" });
  await assert.rejects(restored.resourceCommand(acquireCommand("cook", "rice", "after-cancel", rice.resourceRevision)),
    isCode("INVALID_TRANSITION"));
  assert.equal(await fs.readFile(filePath, "utf8"), canceledDisk, "Rejected fresh acquisition cannot persist a claim or receipt");

  const replay = await restored.resourceCommand(firstAcquire);
  assert.deepEqual(replay, { ...firstReceipt, replayed: true }, "Retry must return the historical acquisition receipt");
  assert.equal((await restored.getBoard("cook")).resourceClaims.find((claim) => claim.id === "rice-first").state, "released");
  assert.equal((await restored.resourceAvailability({ resourceId: "rice" })).remaining, 500);
  assert.equal(await fs.readFile(filePath, "utf8"), canceledDisk, "Replay must neither reacquire nor append events");
  assert.deepEqual(await store.snapshot(), canceledState);
});
