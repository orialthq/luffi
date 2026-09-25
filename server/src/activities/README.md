# Activity kernel integration

`index.js` has no I/O. Persist the returned state atomically (including command
receipts) under the application's storage lock/transaction. Calling this reducer
on two stale snapshots and saving both is not concurrency control.

```js
import { createActivityState, applyActivityCommand, getActivityBoard } from './activities/index.js';
let state = createActivityState();
const outcome = applyActivityCommand(state, {
  commandId: 'request-1',
  ownerId: authenticatedOwnerId,
  activityId: 'dinner-1',
  expectedRevision: 0,
  type: 'activity.create',
  payload: {
    title: 'Dinner',
    goal: { description: 'Prepare dinner' },
    planDraft: {
      tasks: [{ id: 'check', kind: 'observation', capabilityId: 'recipe.checkIngredients', capabilityVersion: 1 }],
      dependencyLinks: [], dataBindings: [], artifacts: [],
    },
  },
});
state = outcome.state;
const board = getActivityBoard(state, 'dinner-1', { ownerId: authenticatedOwnerId });
```

## Contract

- Commands require `commandId`, trusted `ownerId`, `type`, `expectedRevision`,
  and `payload`. Activity commands also require `activityId` (creation accepts
  `payload.id` instead).
- New Activity/Recurrence commands use revision 0. Activity commands compare the
  Activity revision, not the current plan revision. Recurrence materialization
  compares the recurrence definition revision.
- The same owner and command ID replay only when the entire command is identical,
  including its original expected revision. Reusing an ID with a changed payload
  is a conflict. Receipt lookup precedes revision checks.
- Task and artifact IDs are stable within their owning Activity. Cross-activity
  references must use `(activityId, taskId)`; a recurring template may reuse local
  task IDs in independent occurrences.
- `ActivityError` exposes `code`, `httpStatus`, and `details`.
- Both state and accepted commands contain only JSON values. Do not store callbacks,
  Maps, Date objects, or undefined properties in them.

## Commands

| Type | Payload |
| --- | --- |
| `activity.create` | `title`, `goal`, `constraints?`, `planDraft` |
| `plan.applyDraft` | `draft` (only an activity with no prior plan) |
| `plan.applyPatch` | `basePlanRevision`, `expectedTaskRevisions?`, `expectedKnowledgeDependencies?`, `operations`, `reasons?` |
| `task.transition` | `taskId`, `to`, `output?`, `expectedTaskRevision?`, `evidenceRefs?` |
| `task.recordResult` | `taskId`, `value`, `resultId?`, `evidenceRefs?`, `expectedTaskRevision?` |
| `task.resolveReview` | `taskId`, `resolution: 'keep_consumed'`, `note?`, `expectedTaskRevision?` |
| `artifact.update` | `artifactId`, `data`, `expectedArtifactRevision?` (explicit user edit, protects changed fields) |
| `activity.complete` | `goalConfirmed: true` |
| `activity.cancel` | `{}` |
| `recurrence.create` | `id`, `rule`, `timeZone`, `templateVersion?`, `planDraft`, `title?`, `goal?` |
| `recurrence.materialize` | `recurrenceId`, `occurrenceKey`, `scheduledAt`, `activityId?` |
| `reminder.schedule` | `id`, `taskId`, `dueAt`, `timeZone`, `occurrenceId?` |
| `reminder.reschedule` | `reminderId`, `expectedReminderRevision`, `dueAt`, `timeZone?` |
| `reminder.transition` | `reminderId`, `expectedReminderRevision`, `to` |

Patch operations use `type`: `addTask {task}`, `updateTaskInput {taskId, inputs}`,
`addDependency {dependency}`, `removeDependency {dependencyId}`,
`addDataBinding {binding}`, `removeDataBinding {bindingId}`,
`replaceArtifact {artifactId, data, expectedRevision?}`,
`addArtifact {artifact}`, `cancelPendingTask {taskId}`,
`markTaskNeedsReview {taskId}`. `replaceArtifact` merges generated fields while
retaining other existing fields and rejecting protected user fields; it is not a
whole-object deletion operation.

A dependency has `id, fromTaskId, toTaskId, acceptedStatuses?` (default
`['completed']`) and optional `when: {operator: 'equals'|'not_equals'|'exists',
field, value?}`. Conditions refer to top-level output fields.

A data binding has `id, sourceTaskId, targetTaskId, inputKey, outputKey?`, optional
`acceptedStatuses`, and `policy: 'latest_until_started'|'fixed'`. Fixed bindings
require an existing `resultId`. Starting/completing a task pins the versions it
consumes. Later source corrections mark consumers for review without replacing
historical values. Explicit review keeps consumed versions; different inputs for
already-started work require a successor task.

## Validation and integration boundaries

Options accept `now` (ISO string or synchronous clock), `capabilities`/`renderers`
(object or Map registries), and synchronous hooks `validateTask(task)`,
`validateOutput(task, value)`, `validateTaskCompletion(task, activity)`,
`validateKnowledgeDependencies(dependencies)`. Hooks may throw or return false.
Never pass async validators. Registries are optional for independent kernel tests;
production plan entry points should inject domain registries and validators.

Built-in value validation supports `type`, `enum`, object `properties/required/
additionalProperties`, and array `items`; domain hooks enforce full domain
constraints, external completion evidence, units, and semantic validity. The
kernel does not perform external actions, authenticate tokens, fetch knowledge,
calculate recurrence dates from RRULE, run a clock, or deliver notifications.
A scheduler supplies validated recurrence occurrence keys and timestamps, then
invokes reminder transitions. Stale timer revisions are rejected. Delivery
completion does not imply task completion. External operation management owns
reservation/payment outcomes and must supply their evidence through trusted
validators; an output field alone cannot bypass a task's explicit
`requiresExternalConfirmation` policy.
