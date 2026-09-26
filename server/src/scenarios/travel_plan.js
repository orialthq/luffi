import { domainRegistry } from "../domains/index.js";

/** Place captures provide candidates; the user, not the model, orders stops. */
export function buildTravelPlanDraft({ candidates, area, startAt },
  { registry = domainRegistry } = {}) {
  const confirmation = { candidates, area, startAt };
  registry.validateCapabilityInput("travel.confirm_itinerary", confirmation);
  const task = (id, title, capabilityId, inputBindings) => ({
    id, title, capabilityId, kind: registry.getCapability(capabilityId).taskKind,
    inputBindings,
  });
  return {
    tasks: [
      task("confirm_itinerary", "장소 순서와 시각 확인",
        "travel.confirm_itinerary", confirmation),
      task("record_stop_outcomes", "장소별 방문 결과 기록",
        "travel.record_stop_outcomes", {}),
    ],
    dependencyLinks: [{ id: "itinerary_before_outcomes",
      fromTaskId: "confirm_itinerary", toTaskId: "record_stop_outcomes" }],
    dataBindings: [{ id: "confirmed_itinerary",
      sourceTaskId: "confirm_itinerary", targetTaskId: "record_stop_outcomes",
      inputKey: "itinerary", outputKey: "itinerary" }],
    artifacts: [],
  };
}
