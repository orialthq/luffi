import { domainRegistry } from "../domains/index.js";

export function buildHealthPlanDraft({ candidate }, { registry = domainRegistry } = {}) {
  registry.validateCapabilityInput("health.confirm_exercises", candidate);
  const task = (id, title, capabilityId, inputBindings) => ({
    id, title, capabilityId,
    kind: registry.getCapability(capabilityId).taskKind, inputBindings,
  });
  return {
    tasks: [
      task("confirm_exercises", "이번에 할 운동 항목 확인",
        "health.confirm_exercises", candidate),
      task("record_exercise_outcomes", "실제 운동 결과 기록",
        "health.record_exercise_outcomes", {}),
    ],
    dependencyLinks: [{ id: "plan_before_exercise_report",
      fromTaskId: "confirm_exercises", toTaskId: "record_exercise_outcomes" }],
    dataBindings: [{ id: "confirmed_health_plan",
      sourceTaskId: "confirm_exercises", targetTaskId: "record_exercise_outcomes",
      inputKey: "plan", outputKey: "plan" }],
    artifacts: [],
  };
}
