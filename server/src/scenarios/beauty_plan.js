import { domainRegistry } from "../domains/index.js";

/** Capture analysis supplies candidates; only approved tasks can turn them into a routine. */
export function buildBeautyPlanDraft({ candidates, occasion, scheduledAt, occurrenceId },
  { registry = domainRegistry } = {}) {
  const confirmation = { candidates, occasion };
  registry.validateCapabilityInput("beauty.confirm_routine", confirmation);
  const task = (id, title, capabilityId, inputBindings) => ({
    id, title, capabilityId, kind: registry.getCapability(capabilityId).taskKind,
    inputBindings,
  });
  return {
    tasks: [
      task("confirm_routine", "제품·단계 순서 확인", "beauty.confirm_routine", confirmation),
      task("instantiate_routine", "확정한 루틴 일정 만들기",
        "beauty.instantiate_routine", { occurrenceId, scheduledAt }),
      task("record_routine_outcome", "실제 사용 여부 기록",
        "beauty.record_routine_outcome", {}),
    ],
    dependencyLinks: [
      { id: "confirmation_before_occurrence", fromTaskId: "confirm_routine",
        toTaskId: "instantiate_routine" },
      { id: "occurrence_before_outcome", fromTaskId: "instantiate_routine",
        toTaskId: "record_routine_outcome" },
    ],
    dataBindings: [
      { id: "confirmed_template", sourceTaskId: "confirm_routine",
        targetTaskId: "instantiate_routine", inputKey: "template", outputKey: "template" },
      { id: "routine_occurrence", sourceTaskId: "instantiate_routine",
        targetTaskId: "record_routine_outcome", inputKey: "occurrence" },
    ],
    artifacts: [],
  };
}
