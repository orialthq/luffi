import test from "node:test";
import assert from "node:assert/strict";
import { createResourceState, applyResourceCommand, getResourceAvailability, ResourceError } from "../src/composition/index.js";

const NOW = "2026-09-25T09:00:00.000Z";
const FRESH = "2026-09-26T09:00:00.000Z";
const EARLIER = "2026-09-25T08:00:00.000Z";
const range = (start, end) => ({ start: `2026-09-25T${start}:00:00Z`, end: `2026-09-25T${end}:00:00Z` });
const errorCode = (code) => (error) => error instanceof ResourceError && error.code === code;
const availability = (quantity, unit = "g", overrides = {}) => ({
  status: "known", quantity, unit, observedAt: EARLIER, freshUntil: FRESH, observationId: "observation-1", ...overrides,
});
function harness() {
  let state = createResourceState();
  let sequence = 0;
  return {
    get state() { return state; },
    apply(type, payload, options = {}) {
      const { ownerId = "owner", commandId = `command-${++sequence}`, expectedRevision, now = NOW } = options;
      const command = { ownerId, commandId, type, payload, ...(expectedRevision == null ? {} : { expectedRevision }) };
      const applied = applyResourceCommand(state, command, { now });
      state = applied.state;
      return applied;
    },
    query(resourceId = "resource", timeRange = null, now = NOW) {
      return getResourceAvailability(state, { ownerId: "owner", resourceId, timeRange }, { now });
    },
  };
}
function setup({ kind = "quantity", allocationMode = "consumable", quantity = 500, fresh = true, policy } = {}) {
  const h = harness();
  h.apply("activity.register", { activityId: "recipe-activity" });
  h.apply("activity.register", { activityId: "dining-activity" });
  h.apply("resource.create", {
    resourceId: "resource", kind,
    ...(kind === "exclusive" ? {} : { allocationMode, unitPolicy: policy ?? { canonicalUnit: "g", precision: 3, conversions: [{ unit: "kg", factor: 1000 }] } }),
    ...(fresh ? { availability: availability(kind === "exclusive" ? 1 : quantity, kind === "exclusive" ? "slot" : (policy?.canonicalUnit ?? "g")) } : {}),
  });
  return h;
}
function claim(id, quantity, extra = {}) {
  return { claimId: id, resourceId: "resource", activityId: "recipe-activity", quantity, unit: "g", ...extra };
}
function release(claimId, activityId = "recipe-activity") { return { claimId, resourceId: "resource", activityId }; }

test("two activities cannot hold the same consumable stock even at different times", () => {
  const h = setup();
  h.apply("claim.acquire", claim("cooking", 400, { timeRange: range("10", "11") }));
  assert.throws(() => h.apply("claim.acquire", claim("picnic", 101, {
    activityId: "dining-activity", timeRange: range("15", "16"),
  })), errorCode("RESOURCE_CAPACITY_CONFLICT"));
  h.apply("claim.acquire", claim("picnic", 100, { activityId: "dining-activity", timeRange: range("15", "16") }));
  assert.equal(h.query().remaining, 0);
  assert.equal(h.query().guarantee, "planning_only");
});

test("concurrent quantity uses peak overlap, not sum of all intersecting claims", () => {
  const h = setup({ allocationMode: "concurrent", quantity: 3, policy: { canonicalUnit: "seat", precision: 0 } });
  h.apply("claim.acquire", claim("morning", 2, { unit: "seat", timeRange: range("10", "11") }));
  h.apply("claim.acquire", claim("noon", 2, { unit: "seat", timeRange: range("12", "13") }));
  h.apply("claim.acquire", claim("long-meeting", 1, { unit: "seat", timeRange: range("10", "13") }));
  assert.equal(h.query().reserved, 3);
  assert.equal(h.query("resource", range("11", "12")).remaining, 2);
  assert.throws(() => h.apply("claim.acquire", claim("overlap", 1, { unit: "seat", timeRange: range("12", "14") })), errorCode("RESOURCE_CAPACITY_CONFLICT"));
  h.apply("claim.acquire", claim("gap", 2, { unit: "seat", timeRange: range("11", "12") }));
  assert.equal(h.query().reserved, 3);
});

test("exclusive resources reject overlap but allow adjacent half-open intervals", () => {
  const h = setup({ kind: "exclusive" });
  h.apply("claim.acquire", claim("outfit-1", 1, { unit: "slot", timeRange: range("10", "12") }));
  assert.throws(() => h.apply("claim.acquire", claim("outfit-2", 1, { unit: "slot", timeRange: range("11", "13") })), errorCode("RESOURCE_CAPACITY_CONFLICT"));
  h.apply("claim.acquire", claim("outfit-2", 1, { unit: "slot", timeRange: range("12", "13") }));
  assert.equal(h.query("resource", range("13", "14")).remaining, 1);
});

test("timeless claims conservatively conflict with every interval", () => {
  const h = setup({ kind: "exclusive" });
  h.apply("claim.acquire", claim("time-unknown", 1, { unit: "slot" }));
  assert.throws(() => h.apply("claim.acquire", claim("timed", 1, { unit: "slot", timeRange: range("10", "11") })), errorCode("RESOURCE_CAPACITY_CONFLICT"));
  h.apply("claim.release", release("time-unknown"));
  h.apply("claim.acquire", claim("timed", 1, { unit: "slot", timeRange: range("10", "11") }));
  assert.throws(() => h.apply("claim.acquire", claim("new-time-unknown", 1, { unit: "slot" })), errorCode("RESOURCE_CAPACITY_CONFLICT"));
});

test("unknown is not zero and cannot yield a confirmed planning claim", () => {
  const h = setup({ fresh: false });
  assert.equal(h.query().status, "unknown");
  assert.equal(h.query().capacity, null);
  assert.equal(h.query().remaining, null);
  assert.equal(h.query().allocationStatus, "unverified");
  assert.throws(() => h.apply("claim.acquire", claim("missing-observation", 1)), errorCode("RESOURCE_UNAVAILABLE"));
  h.apply("resource.observe", { resourceId: "resource", availability: availability(0) });
  assert.equal(h.query().status, "known");
  assert.equal(h.query().capacity, 0);
  assert.throws(() => h.apply("claim.acquire", claim("known-empty", 1)), errorCode("RESOURCE_CAPACITY_CONFLICT"));
});

test("freshness expiration makes availability stale without an extra write", () => {
  const h = setup();
  assert.equal(h.query("resource", null, FRESH).status, "stale");
  assert.equal(h.query("resource", null, FRESH).remaining, null);
  assert.equal(h.query("resource", null, FRESH).lastObservedQuantity, 500);
  assert.throws(() => h.apply("claim.acquire", claim("expired", 1), { now: FRESH }), errorCode("RESOURCE_UNAVAILABLE"));
  h.apply("resource.observe", { resourceId: "resource", availability: availability(500, "g", { status: "stale" }) });
  assert.equal(h.query().status, "stale");
  assert.throws(() => h.apply("claim.acquire", claim("marked-stale", 1)), errorCode("RESOURCE_UNAVAILABLE"));
});

test("command retry is durable across JSON round trips and later release, without reacquiring", () => {
  const h = setup();
  const payload = claim("c1", 400);
  const first = h.apply("claim.acquire", payload, { commandId: "acquire-fixed", expectedRevision: 1 });
  h.apply("claim.release", release("c1"));
  const restored = JSON.parse(JSON.stringify(h.state));
  const retried = applyResourceCommand(restored, {
    ownerId: "owner", commandId: "acquire-fixed", type: "claim.acquire", payload, expectedRevision: 1,
  }, { now: FRESH });
  assert.equal(retried.replayed, true);
  assert.deepEqual(retried.result, first.result);
  assert.equal(retried.state.claims[0].state, "released");
  assert.equal(retried.state.sequence, restored.sequence);
  assert.equal(getResourceAvailability(retried.state, { ownerId: "owner", resourceId: "resource" }, { now: NOW }).remaining, 500);
  assert.throws(() => h.apply("claim.acquire", { ...payload, quantity: 401 }, { commandId: "acquire-fixed", expectedRevision: 1 }), errorCode("RESOURCE_COMMAND_CONFLICT"));
});

test("a second command cannot acquire the same claim id or reuse a released claim", () => {
  const h = setup();
  h.apply("claim.acquire", claim("c1", 10));
  assert.throws(() => h.apply("claim.acquire", claim("c1", 10)), errorCode("RESOURCE_ID_EXISTS"));
  h.apply("claim.release", release("c1"), { commandId: "release-fixed" });
  const sequence = h.state.sequence;
  assert.equal(h.apply("claim.release", release("c1"), { commandId: "release-fixed" }).replayed, true);
  assert.equal(h.state.sequence, sequence);
  assert.throws(() => h.apply("claim.acquire", claim("c1", 10)), errorCode("RESOURCE_ID_EXISTS"));
  assert.throws(() => h.apply("claim.release", release("c1")), errorCode("RESOURCE_CLAIM_RELEASED"));
});

test("resource revision detects two activities racing from the same read", () => {
  const h = setup({ quantity: 500 });
  h.apply("claim.acquire", claim("first", 200), { expectedRevision: 1 });
  assert.throws(() => h.apply("claim.acquire", claim("racing", 200, { activityId: "dining-activity" }), { expectedRevision: 1 }), errorCode("RESOURCE_REVISION_CONFLICT"));
  h.apply("claim.acquire", claim("racing", 200, { activityId: "dining-activity" }), { expectedRevision: 2 });
  assert.equal(h.query().remaining, 100);
});

test("owner and activity boundaries apply to acquisition, release, and reads", () => {
  const h = setup();
  h.apply("activity.register", { activityId: "other-activity" }, { ownerId: "other" });
  assert.throws(() => h.apply("claim.acquire", claim("bad-activity", 100, { activityId: "other-activity" })), errorCode("RESOURCE_NOT_FOUND"));
  assert.throws(() => h.apply("claim.acquire", claim("foreign", 100, { activityId: "other-activity" }), { ownerId: "other" }), errorCode("RESOURCE_NOT_FOUND"));
  h.apply("claim.acquire", claim("c1", 100));
  assert.throws(() => h.apply("claim.release", release("c1", "dining-activity")), errorCode("RESOURCE_NOT_FOUND"));
  assert.throws(() => h.apply("claim.release", release("c1", "other-activity"), { ownerId: "other" }), errorCode("RESOURCE_NOT_FOUND"));
  assert.throws(() => getResourceAvailability(h.state, { ownerId: "other", resourceId: "resource" }, { now: NOW }), errorCode("RESOURCE_NOT_FOUND"));
  assert.equal(h.query().reserved, 100);
});

test("explicit unit conversions share the same canonical capacity without implicit density conversion", () => {
  const h = setup();
  const acquired = h.apply("claim.acquire", claim("kilograms", 0.4, { unit: "kg" }));
  assert.equal(acquired.result.claim.quantity, 400);
  assert.equal(acquired.result.claim.unit, "g");
  assert.equal(h.query().remaining, 100);
  assert.throws(() => h.apply("claim.acquire", claim("different-dimension", 1, { unit: "ml" })), errorCode("RESOURCE_UNIT_MISMATCH"));
  assert.throws(() => h.apply("claim.acquire", claim("too-fine", 0.0001)), errorCode("RESOURCE_PRECISION_MISMATCH"));
});

test("decimal capacities do not round down or overallocate through floating point addition", () => {
  const h = setup({ quantity: 0.3, policy: { canonicalUnit: "l", precision: 1 } });
  h.apply("claim.acquire", claim("decimal-1", 0.1, { unit: "l" }));
  h.apply("claim.acquire", claim("decimal-2", 0.2, { unit: "l" }));
  assert.equal(h.query().remaining, 0);
  assert.equal(h.query().reserved, 0.3);
  assert.throws(() => h.apply("claim.acquire", claim("overflow", 0.1, { unit: "l" })), errorCode("RESOURCE_CAPACITY_CONFLICT"));
});

test("lower observations preserve claims and expose overcommitment until reconciled", () => {
  const h = setup();
  h.apply("claim.acquire", claim("c1", 400));
  const observed = h.apply("resource.observe", { resourceId: "resource", availability: availability(300, "g", {
    observationId: "observation-2", observedAt: NOW,
  }) });
  assert.equal(observed.result.availability.allocationStatus, "overcommitted");
  assert.equal(h.state.claims[0].state, "held");
  assert.equal(h.query().reserved, 400);
  assert.equal(h.query().remaining, 0);
  assert.deepEqual(h.query().affectedClaimIds, ["c1"]);
  assert.throws(() => h.apply("claim.acquire", claim("more", 1)), errorCode("RESOURCE_CAPACITY_CONFLICT"));
  h.apply("claim.release", release("c1"));
  assert.equal(h.query().allocationStatus, "within_capacity");
  assert.equal(h.query().remaining, 300);
});

test("a new unknown observation invalidates confidence without deleting existing allocation", () => {
  const h = setup();
  h.apply("claim.acquire", claim("c1", 400));
  h.apply("resource.observe", { resourceId: "resource", availability: {
    status: "unknown", observedAt: NOW, observationId: "stock-unverified", reason: "Inventory moved",
  } });
  assert.equal(h.query().status, "unknown");
  assert.equal(h.query().reserved, 400);
  assert.equal(h.query().remaining, null);
  assert.equal(h.query().allocationStatus, "unverified");
  assert.throws(() => h.apply("claim.acquire", claim("more", 1)), errorCode("RESOURCE_UNAVAILABLE"));
  h.apply("claim.release", release("c1"));
  assert.equal(h.query().reserved, 0);
});

test("older observations cannot restore stale capacity and timestamps require real dates", () => {
  const h = setup();
  h.apply("resource.observe", { resourceId: "resource", availability: availability(300, "g", { observedAt: NOW, observationId: "newer" }) });
  assert.throws(() => h.apply("resource.observe", { resourceId: "resource", availability: availability(500) }), errorCode("RESOURCE_OBSERVATION_OUTDATED"));
  assert.throws(() => h.apply("resource.observe", { resourceId: "resource", availability: availability(500, "g", { observedAt: "2026-02-30T08:00:00Z" }) }), errorCode("INVALID_RESOURCE_INPUT"));
  assert.throws(() => h.apply("resource.observe", { resourceId: "resource", availability: availability(500, "g", { observedAt: FRESH }) }), errorCode("INVALID_RESOURCE_INPUT"));
  assert.throws(() => h.apply("claim.acquire", claim("backward", 1, { timeRange: range("12", "11") })), errorCode("INVALID_RESOURCE_INPUT"));
});

test("input state and command are immutable, including failures and returned result mutation", () => {
  const h = setup();
  const state = h.state;
  const before = JSON.stringify(state);
  const command = { ownerId: "owner", commandId: "pure", type: "claim.acquire", payload: claim("c1", 100) };
  const beforeCommand = JSON.stringify(command);
  const applied = applyResourceCommand(state, command, { now: NOW });
  assert.equal(JSON.stringify(state), before);
  assert.equal(JSON.stringify(command), beforeCommand);
  applied.result.claim.quantity = 999;
  assert.equal(applied.state.claims[0].quantity, 100);
  assert.equal(applied.state.receipts.at(-1).result.claim.quantity, 100);
  const appliedBefore = JSON.stringify(applied.state);
  assert.throws(() => applyResourceCommand(applied.state, { ...command, commandId: "fail", payload: claim("c2", 1000) }, { now: NOW }), errorCode("RESOURCE_CAPACITY_CONFLICT"));
  assert.equal(JSON.stringify(applied.state), appliedBefore);
  assert.deepEqual(JSON.parse(JSON.stringify(applied.state)), applied.state);
});

test("malformed quantity, unsupported units, and unsafe precision never enter persisted state", () => {
  const h = setup();
  for (const quantity of [NaN, Infinity, -1, 0]) {
    assert.throws(() => h.apply("claim.acquire", claim("invalid", quantity)), errorCode("INVALID_RESOURCE_INPUT"));
  }
  assert.throws(() => h.apply("claim.acquire", claim("unsafe", Number.MAX_VALUE)), errorCode("INVALID_RESOURCE_INPUT"));
  assert.throws(() => h.apply("resource.observe", { resourceId: "resource", availability: {
    status: "unknown", quantity: 0, observedAt: NOW, observationId: "bad", unit: "g",
  } }), errorCode("INVALID_RESOURCE_INPUT"));
  const exclusive = setup({ kind: "exclusive" });
  assert.throws(() => exclusive.apply("resource.observe", { resourceId: "resource", availability: availability(2, "slot") }), errorCode("INVALID_RESOURCE_INPUT"));
  assert.throws(() => exclusive.apply("claim.acquire", claim("double", 2, { unit: "slot" })), errorCode("INVALID_RESOURCE_INPUT"));
});

test("time zone normalization makes equal instants conflict", () => {
  const h = setup({ kind: "exclusive" });
  h.apply("claim.acquire", claim("utc", 1, { unit: "slot", timeRange: range("10", "11") }));
  assert.throws(() => h.apply("claim.acquire", claim("seoul", 1, { unit: "slot", timeRange: {
    start: "2026-09-25T19:00:00+09:00", end: "2026-09-25T20:00:00+09:00",
  } })), errorCode("RESOURCE_CAPACITY_CONFLICT"));
});
