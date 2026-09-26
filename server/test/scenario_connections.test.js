import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { CONNECTION_KINDS } from "../src/domains/scenario_connections.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-connections-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, "state.json");
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState });
  const service = createCommonKernelService({ ownerId: "owner-a", store });
  for (const scenario of ["recipe", "dining", "fashion", "beauty", "travel",
    "life_tip", "shopping", "health"]) {
    await service.activityCommand({ commandId: `create-${scenario}`, type: "activity.create",
      activityId: scenario, expectedRevision: 0,
      payload: { title: `${scenario} 보드`, goal: { description: "연결 검증" } } });
  }
  // Scenario creation is tested separately. Seed accepted scenario receipts here
  // so this test exercises only the cross-scenario contract and graph lifecycle.
  await store.transact((state) => {
    const receiptKeys = { recipe: "recipeScenarioReceipts", dining: "diningScenarioReceipts",
      fashion: "fashionScenarioReceipts", beauty: "beautyScenarioReceipts",
      travel: "travelScenarioReceipts", life_tip: "lifeTipScenarioReceipts",
      shopping: "shoppingScenarioReceipts", health: "healthScenarioReceipts" };
    for (const [scenario, key] of Object.entries(receiptKeys)) {
      state.activities.activities[scenario].currentPlanRevision = 1;
      state[key][scenario] = { result: { activityId: scenario } };
    }
    return { state, result: null };
  });
  return { service, store, filePath };
}

const link = (kind, commandId = kind) => ({ commandId, kind, confirmed: true,
  fromActivityId: CONNECTION_KINDS[kind][0], toActivityId: CONNECTION_KINDS[kind][1],
  expectedFromRevision: 1, expectedToRevision: 1 });

test("all supported scenario pairs persist as three user-evidenced graph relations", async (t) => {
  const { service, store, filePath } = await fixture(t);
  for (const kind of Object.keys(CONNECTION_KINDS)) {
    const created = await service.createScenarioConnection(link(kind));
    assert.equal(created.replayed, false);
    assert.equal((await service.createScenarioConnection(link(kind))).replayed, true);
    const [from, to] = CONNECTION_KINDS[kind];
    assert.equal((await service.listScenarioConnections(from)).connections
      .some((entry) => entry.kind === kind && entry.otherActivityId === to), true);
    assert.equal((await service.listScenarioConnections(to)).connections
      .some((entry) => entry.kind === kind && entry.otherActivityId === from), true);
  }
  const state = await store.snapshot();
  assert.equal(state.knowledge.entities.filter((item) => item.type === "scenario.activity").length, 8);
  assert.equal(state.knowledge.entities.filter((item) => item.type === "scenario.connection").length, 9);
  assert.equal(state.knowledge.assertions.filter((item) => item.predicate.startsWith("scenario.") &&
    item.status === "active").length, 27);
  assert.ok(state.knowledge.assertions.filter((item) => item.predicate.startsWith("scenario.")).every(
    (item) => item.origin === "user_reported" && item.evidenceIds.length === 1));
  const reopened = createCommonKernelService({ ownerId: "owner-a",
    store: createJsonStateStore({ filePath, initialState: createCommonKernelState }) });
  assert.equal((await reopened.listScenarioConnections("recipe")).connections.length, 2);
});

test("connections reject unsupported pairings, stale revisions, duplicates and cross-owner boards", async (t) => {
  const { service, store } = await fixture(t);
  const valid = link("travel_dining", "first");
  await assert.rejects(service.createScenarioConnection({ ...valid, confirmed: false }),
    (error) => error.code === "INVALID_REQUEST");
  await assert.rejects(service.createScenarioConnection({ ...valid, fromActivityId: "recipe" }),
    (error) => error.code === "INVALID_CONNECTION");
  await assert.rejects(service.createScenarioConnection({ ...valid, expectedToRevision: 999 }),
    (error) => error.code === "REVISION_CONFLICT");
  await service.createScenarioConnection(valid);
  await assert.rejects(service.createScenarioConnection(link("travel_dining", "second")),
    (error) => error.code === "CONNECTION_EXISTS");
  await assert.rejects(service.createScenarioConnection({ ...valid, note: "different" }),
    (error) => error.code === "COMMAND_ID_CONFLICT");
  const foreign = createCommonKernelService({ ownerId: "owner-b", store });
  await assert.rejects(foreign.listScenarioConnections("travel"),
    (error) => error.code === "FORBIDDEN");
  await assert.rejects(foreign.createScenarioConnection(link("travel_dining", "foreign")),
    (error) => error.code === "FORBIDDEN");
});

test("a generic user-confirmed association connects any two different scenario domains", async (t) => {
  const { service } = await fixture(t);
  const request = { commandId: "generic", kind: "related", confirmed: true,
    fromActivityId: "dining", toActivityId: "fashion",
    expectedFromRevision: 1, expectedToRevision: 1 };
  await service.createScenarioConnection(request);
  assert.equal((await service.listScenarioConnections("fashion")).connections[0].kind, "related");
  await assert.rejects(service.createScenarioConnection({ ...request, commandId: "same-domain",
    toActivityId: "dining" }), (error) => error.code === "INVALID_REQUEST");
});

test("a confirmed scenario result already present when linking becomes a typed subject edge", async (t) => {
  const { service, store } = await fixture(t);
  await service.knowledgeCommand({ commandId: "recipe-entity", type: "entity.create",
    payload: { id: "recipe-result", type: "recipe.recipe", label: "토마토 달걀 볶음" } });
  await store.transact((state) => {
    state.recipeScenarioReceipts.recipe.result.recipeEntityId = "recipe-result";
    return { state, result: null };
  });
  const created = await service.createScenarioConnection(link("recipe_shopping"));
  assert.equal((await store.snapshot()).knowledge.assertions.find((item) =>
    item.id === `${created.id}:from-subject`)?.objectEntityId, "recipe-result");
  assert.equal((await service.listScenarioConnections("shopping")).connections[0]
    .otherSubject?.entityId, "recipe-result");
});

test("unlinking and source deletion remove graph support and board navigation", async (t) => {
  const { service, store } = await fixture(t);
  const created = await service.createScenarioConnection(link("recipe_shopping"));
  const state = await store.snapshot();
  const sourceId = state.scenarioConnections[created.id].sourceId;
  const removed = await service.deleteScenarioConnection({ commandId: "unlink", connectionId: created.id });
  assert.equal(removed.deleted, true);
  assert.equal((await service.deleteScenarioConnection({ commandId: "unlink",
    connectionId: created.id })).replayed, true);
  assert.deepEqual((await service.listScenarioConnections("recipe")).connections, []);
  assert.equal((await store.snapshot()).knowledge.sources.find((item) => item.id === sourceId).status,
    "deleted");
  const next = await service.createScenarioConnection(link("recipe_shopping", "again"));
  await service.knowledgeCommand({ commandId: "delete-source", type: "source.delete",
    payload: { sourceId: (await store.snapshot()).scenarioConnections[next.id].sourceId } });
  assert.deepEqual((await service.listScenarioConnections("shopping")).connections, []);
});

test("deleting a scenario's confirmation cascades to its connections without deleting the peer", async (t) => {
  const { service, store } = await fixture(t);
  const linkResult = await service.createScenarioConnection(link("recipe_shopping"));
  await service.knowledgeCommand({ commandId: "recipe-source", type: "source.create",
    payload: { id: "recipe-confirmation", kind: "user_confirmation",
      title: "recipe confirmation", provenance: { scenario: "recipe", activityId: "recipe" } } });
  await store.transact((state) => {
    state.recipeScenarioReceipts.recipe.result.confirmationSourceId = "recipe-confirmation";
    return { state, result: null };
  });
  await service.knowledgeCommand({ commandId: "erase-recipe", type: "source.delete",
    payload: { sourceId: "recipe-confirmation" } });
  const after = await store.snapshot();
  assert.equal(after.scenarioConnections[linkResult.id].deleted, true);
  const anchor = after.knowledge.entities.find((item) => item.type === "scenario.activity" &&
    item.externalIds.activityId === "recipe");
  assert.equal(anchor, undefined);
  assert.ok(after.knowledge.entities.some((item) => item.type === "scenario.activity" &&
    item.status === "deleted" && item.label === ""));
  assert.deepEqual((await service.listScenarioConnections("shopping")).connections, []);
  await assert.rejects(service.getBoard("recipe"), (error) => error.code === "NOT_FOUND");
  assert.equal((await service.getBoard("shopping")).id, "shopping");
});
