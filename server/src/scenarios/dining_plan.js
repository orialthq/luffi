import { domainRegistry } from "../domains/index.js";

/** The order is fixed by the product contract; model output never writes a DAG. */
export function buildDiningPlanDraft({ candidates, scheduledAt, partySize },
  { registry = domainRegistry } = {}) {
  const selection = { candidates };
  registry.validateCapabilityInput("dining.select_place", selection);
  const task = (id, title, capabilityId, inputBindings) => ({
    id, title, capabilityId, kind: registry.getCapability(capabilityId).taskKind,
    inputBindings,
  });
  return {
    tasks: [
      task("select_place", "방문할 식당 지점 선택", "dining.select_place", selection),
      task("review_visit_details", "방문 전 정보 확인", "dining.review_visit_details",
        { scheduledAt, partySize }),
      task("record_visit_outcome", "방문 결과 기록", "dining.record_visit_outcome", {}),
    ],
    dependencyLinks: [
      { id: "selection_before_review", fromTaskId: "select_place", toTaskId: "review_visit_details" },
      { id: "review_before_outcome", fromTaskId: "review_visit_details", toTaskId: "record_visit_outcome" },
    ],
    dataBindings: [
      { id: "selected_place_for_review", sourceTaskId: "select_place",
        targetTaskId: "review_visit_details", inputKey: "placeId", outputKey: "placeId" },
      { id: "selected_place_for_outcome", sourceTaskId: "select_place",
        targetTaskId: "record_visit_outcome", inputKey: "placeId", outputKey: "placeId" },
    ],
    artifacts: [],
  };
}
