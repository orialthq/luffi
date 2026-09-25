# Planning resource claims

This dependency-free kernel coordinates resource allocations across activity and
domain boundaries. It guarantees **planning allocation within the persisted
state**, not physical stock, consumption, payment, or a supplier's reservation.
External purchases/bookings need their own confirmed tool results. A `held`
claim is never proof that an external action happened.

## Public API

```js
import {
  createResourceState, applyResourceCommand, getResourceAvailability,
} from "./composition/index.js";

let state = createResourceState();
const now = "2026-09-25T09:00:00Z";
function run(commandId, type, payload, expectedRevision) {
  const response = applyResourceCommand(state, {
    ownerId: "owner-1", commandId, type, payload,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }, { now });
  state = response.state;
  return response;
}

run("register-a1", "activity.register", { activityId: "a1" });
run("create-rice", "resource.create", {
  resourceId: "rice-stock", kind: "quantity", allocationMode: "consumable",
  unitPolicy: {
    canonicalUnit: "g", precision: 3,
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  availability: {
    status: "known", quantity: 500, unit: "g", observationId: "stock-observation-1",
    observedAt: "2026-09-25T08:00:00Z", freshUntil: "2026-09-26T08:00:00Z",
  },
});
run("hold-rice-a1", "claim.acquire", {
  claimId: "rice-a1-claim", resourceId: "rice-stock", activityId: "a1",
  quantity: 0.3, unit: "kg",
}, 1);
getResourceAvailability(state, { ownerId: "owner-1", resourceId: "rice-stock" }, { now });
// { status: "known", capacity: 500, reserved: 300, remaining: 200,
//   guarantee: "planning_only", resourceRevision: 2, ... }
run("release-rice-a1", "claim.release", {
  claimId: "rice-a1-claim", resourceId: "rice-stock", activityId: "a1",
}, 2);
```

`applyResourceCommand` returns `{state, result, replayed}` and never mutates its
inputs. Returned results do not alias persisted records. State survives a plain
JSON round trip. Inject `now` (an ISO string, Date, or clock function) for replayable
tests; it defaults to the current clock. Timestamps include an explicit timezone,
real calendar date, and at most millisecond precision.

## Commands and ownership

| Command | Payload | Result |
| --- | --- | --- |
| `activity.register` | `{activityId}` | `{activity}` |
| `resource.create` | `{resourceId,kind,allocationMode?,unitPolicy?,availability?}` | `{resource,availability}` |
| `resource.observe` | `{resourceId,availability}` | `{resource,availability}` |
| `claim.acquire` | `{claimId,resourceId,activityId,quantity,unit,timeRange?}` | `{claim,resourceRevision,availability}` |
| `claim.release` | `{claimId,resourceId,activityId}` | `{claim,resourceRevision,availability}` |

Activity registration is an owner projection. The trusted service must first
verify the real activity belongs to the authenticated owner; it must not expose
arbitrary registration as a way to claim another activity. Resource IDs represent
the same canonical inventory or reusable asset across domains. Distinct IDs are
distinct resources; this kernel cannot discover physical identity duplicates.
All reads and writes filter by owner, and a release must match the exact activity
and resource that acquired the claim. Cancellation must release the activity's
held claims in the same service transaction. Claims do not expire or disappear
automatically after their time range.

`commandId` is unique within the owner's resource command stream. Identical input
replays the original result before checking freshness or current revisions.
Reusing it with different input (including `expectedRevision`) is a conflict.
Replay results are historical receipts: replaying acquire after release returns
the original acquisition receipt while the current claim remains released. Read
current state to display current status. A different command cannot reuse a claim
ID, even after release. Retry clients must preserve both command and claim IDs.

`expectedRevision` applies to the **resource** for observe/acquire/release, and
must be zero for creation/registration if supplied. Every acquisition, release,
and observation advances the resource revision. The embedding store must perform
read/apply/save and receipt persistence in one serialized or optimistic-locking
transaction. Merely running this pure function twice from the same stale snapshot
does not provide cross-process locking. For atomic multi-resource acquisition,
sort resource IDs, apply each command inside one store transaction, and discard
all changes if any fails. Persisted state is trusted kernel output, not client
supplied state.

## Availability and time

The default availability is `unknown`. Known/stale observations require
`{status,quantity,unit,observedAt,freshUntil,observationId}`. Unknown observations
require `{status:"unknown",observedAt,observationId}` and cannot include a
quantity. An optional `reason` is allowed. The trusted caller supplies an
already-resolved observation and its freshness policy. Older observations cannot
replace newer observations. Same-time corrections are permitted; use revision
checks when coordinating competing corrections.

At `now >= freshUntil`, known availability reads as `stale` without a write or
background scheduler. Explicit stale stays stale until a new observation arrives.
Both unknown and stale return `capacity:null` and `remaining:null`; zero is a
known empty inventory. The last measured value is separately labeled
`lastObservedQuantity`. Neither unknown nor stale allows acquisition. Existing
claims remain visible and become `allocationStatus:"unverified"`. Freshness is
the present observation's reliability, not a guarantee of stock on the activity's
future date.

A newer observation is the **total planning capacity before subtracting held
claims**, not capacity already net of those claims. Lower measurements are saved
even if they cause `allocationStatus:"overcommitted"`; affected claims are
returned and remain held until the service replans/releases them. Physical
consumption and the measurement basis must be reconciled by the service; releasing
a planning claim alone does not record real consumption or replenish stock.

Quantity resources require an explicit `allocationMode`:

- `consumable`: all held claims count, even when their time ranges do not overlap.
  The same rice cannot be allocated twice on different days.
- `concurrent`: count the maximum quantity used simultaneously inside the proposed
  time range. Disjoint earlier claims are not incorrectly summed. Useful for
  reusable capacity such as seats or equipment.

Exclusive resources use `kind:"exclusive"`, fixed `slot` units, precision zero,
and concurrent allocation. Omit unitPolicy/allocationMode. Availability is zero or
one slot; each claim is exactly one slot.

Time ranges are half-open `{start,end}` intervals: adjacent end/start instants do
not conflict. Missing/null ranges overlap all times conservatively. Concurrent
queries without a time range return the peak over all held intervals. Consumable
queries always include all held claims. `affectedClaimIds` lists claims relevant
to the query; it is not a minimal conflict explanation.

## Explicit unit policy

`unitPolicy` is immutable per resource: `{canonicalUnit,precision,conversions?}`.
Precision is 0–6 decimal places in the canonical unit. A conversion factor means
`canonical quantity = supplied quantity × factor`. No conversion is inferred,
including mass/volume, packages/count, or product-specific density. The trusted
caller is responsible for supplying valid domain-specific conversions.

Decimal multiplication is exact at the numeric JSON boundary. Quantities must
fit the configured precision **without rounding**, then use safe integer minor
units in persisted state, limited to 15 decimal digits so public numeric quantities
also round-trip at the configured precision. This avoids capacity errors such as
`0.1 + 0.2 > 0.3`. Excess precision, unsafe magnitudes, unknown units, negative or
nonfinite quantities are rejected. Acquisition quantities must be positive.
