import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

test("activities claim a shared resource once and receive review when observed capacity shrinks", async (t) => {
  const folder = await fs.mkdtemp(join(tmpdir(), "luffi-resources-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const service = createCommonKernelService({ ownerId: "person-1",
    store: createJsonStateStore({ filePath: join(folder, "state.json"), initialState: createCommonKernelState }) });
  await service.activityCommand({ commandId: "create-a", type: "activity.create", activityId: "cook-a",
    expectedRevision: 0, payload: { title: "첫 요리" } });
  await service.activityCommand({ commandId: "create-b", type: "activity.create", activityId: "cook-b",
    expectedRevision: 0, payload: { title: "둘째 요리" } });
  const created = await service.resourceCommand({ commandId: "resource-create", type: "resource.create",
    expectedRevision: 0, payload: { resourceId: "rice", kind: "quantity", allocationMode: "consumable",
      unitPolicy: { canonicalUnit: "g", precision: 3, conversions: [{ unit: "kg", factor: 1000 }] },
      availability: { status: "known", quantity: 500, unit: "g", observedAt: "2025-01-01T00:00:00Z",
        freshUntil: "2030-01-01T00:00:00Z", observationId: "stock-1" } } });
  assert.equal(created.availability.remaining, 500);
  const held = await service.resourceCommand({ commandId: "claim-a", type: "claim.acquire",
    expectedRevision: 1, payload: { claimId: "claim-rice-a", resourceId: "rice",
      activityId: "cook-a", quantity: 300, unit: "g" } });
  assert.equal(held.availability.remaining, 200);
  assert.equal((await service.resourceCommand({ commandId: "claim-a", type: "claim.acquire",
    expectedRevision: 1, payload: { claimId: "claim-rice-a", resourceId: "rice",
      activityId: "cook-a", quantity: 300, unit: "g" } })).replayed, true);
  await assert.rejects(service.resourceCommand({ commandId: "claim-b", type: "claim.acquire",
    expectedRevision: 2, payload: { claimId: "claim-rice-b", resourceId: "rice",
      activityId: "cook-b", quantity: 300, unit: "g" } }),
  (error) => error.code === "RESOURCE_CAPACITY_CONFLICT");
  const context = await service.createContext({ activityId: "cook-a", queries: [], resourceIds: ["rice"] });
  assert.equal(context.resourceAvailability[0].remaining, 200);
  const revised = await service.resourceCommand({ commandId: "stock-update", type: "resource.observe",
    expectedRevision: 2, payload: { resourceId: "rice", availability: { status: "known",
      quantity: 200, unit: "g", observedAt: "2025-02-01T00:00:00Z",
      freshUntil: "2030-01-01T00:00:00Z", observationId: "stock-2" } } });
  assert.equal(revised.availability.allocationStatus, "overcommitted");
  assert.equal((await service.getBoard("cook-a")).pendingChanges.some((item) => item.resourceId === "rice"), true);
  await assert.rejects(service.proposePlan({ activityId: "cook-a", contextId: context.contextId,
    kind: "draft", plan: { tasks: [], dependencyLinks: [], dataBindings: [], artifacts: [] } }),
  (error) => error.code === "CONTEXT_STALE");
});
