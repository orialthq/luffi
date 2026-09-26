import { array, assertUnique, enumeration, fail, integer, object, ref, text } from "./schema.js";
import { artifact, capability, relation, valueRelation } from "./shared.js";

const exercise = object({ id: text, factIndex: ref("core.revision"),
  text, order: ref("core.revision") });
const plan = object({ id: text, revision: ref("core.revision"), workoutId: text,
  title: text, exercises: array(ref("health.planned_exercise"), 1) });
const outcomeItem = object({ exerciseId: text,
  status: enumeration("done", "skipped", "unknown"),
  actualAmount: ref("health.actual_amount"),
  actualUnit: ref("health.actual_unit") }, ["exerciseId", "status"]);

export const healthPack = {
  id: "health", version: 1, compatibleKernelVersions: [1],
  entityTypes: ["health.workout", "health.workout_plan",
    "health.planned_exercise", "health.workout_session", "health.performance"],
  types: [
    { id: "health.workout", schema: object({ id: text, title: text }) },
    { id: "health.planned_exercise", schema: exercise },
    { id: "health.workout_plan", schema: plan,
      validate: (value) => {
        assertUnique(value.exercises, "id", "$.exercises");
        assertUnique(value.exercises, "factIndex", "$.exercises");
      } },
    { id: "health.workout_session", schema: object({ id: text,
      planId: text, reportedAt: ref("core.timestamp") }) },
    { id: "health.performance", schema: object({ id: text, sessionId: text,
      exerciseId: text, actualAmount: ref("health.actual_amount"),
      actualUnit: ref("health.actual_unit"), reportedAt: ref("core.timestamp") }) },
    { id: "health.actual_amount", schema: integer,
      validate: (value) => { if (value > 10000) fail("actual amount exceeds limit"); } },
    { id: "health.actual_unit", schema: enumeration("minutes", "repetitions") },
    { id: "health.fact_candidate", schema: object({ factIndex: ref("core.revision"),
      text, evidenceIds: ref("core.evidence_ids") }) },
    { id: "health.confirm_input", schema: object({ importId: text, title: text,
      mentionId: text, candidates: array(ref("health.fact_candidate"), 1) }) },
    { id: "health.confirm_result", schema: object({ planId: text,
      plan: ref("health.workout_plan"), confirmedAt: ref("core.timestamp") }) },
    { id: "health.outcome_input", schema: object({ plan: ref("health.workout_plan") }) },
    { id: "health.exercise_outcome", schema: outcomeItem,
      validate: (value) => {
        const hasAmount = Object.hasOwn(value, "actualAmount");
        const hasUnit = Object.hasOwn(value, "actualUnit");
        if ((value.status === "done") !== hasAmount || hasAmount !== hasUnit) {
          fail("actual amount and unit are required only for a performed exercise");
        }
      } },
    { id: "health.plan_outcome", schema: object({ planId: text,
      exercises: array(ref("health.exercise_outcome"), 1),
      reportedAt: ref("core.timestamp") }),
      validate: (value) => assertUnique(value.exercises, "exerciseId", "$.exercises") },
  ],
  relations: [
    valueRelation("health.workout_title", ["health.workout"], "core.text"),
    relation("health.plan_uses_workout", ["health.workout_plan"],
      ["health.workout"], "one"),
    relation("health.plan_has_exercise", ["health.workout_plan"],
      ["health.planned_exercise"]),
    valueRelation("health.exercise_order", ["health.planned_exercise"],
      "core.revision", "explicit_user_confirmation"),
    valueRelation("health.exercise_text", ["health.planned_exercise"],
      "core.text", "explicit_user_confirmation"),
    relation("health.session_for_plan", ["health.workout_session"],
      ["health.workout_plan"], "one"),
    relation("health.performance_in_session", ["health.performance"],
      ["health.workout_session"], "one"),
    relation("health.performance_of_exercise", ["health.performance"],
      ["health.planned_exercise"], "one"),
    valueRelation("health.actual_amount", ["health.performance"],
      "health.actual_amount", "explicit_user_observation"),
    valueRelation("health.actual_unit", ["health.performance"],
      "health.actual_unit", "explicit_user_observation"),
  ],
  capabilities: [
    capability({ id: "health.confirm_exercises", taskKind: "decision",
      inputType: "health.confirm_input", outputType: "health.confirm_result" }),
    capability({ id: "health.record_exercise_outcomes", taskKind: "observe",
      inputType: "health.outcome_input", outputType: "health.plan_outcome" }),
  ],
  slots: [],
  artifacts: [artifact("health.workout_plan", "health.workout_plan", "health.plan")],
};
