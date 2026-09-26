import { array, assertUnique, enumeration, object, ref, text } from "./schema.js";
import { artifact, capability, relation, valueRelation } from "./shared.js";

const stop = object({ id: text, placeId: text, title: text,
  plannedAt: ref("core.timestamp") });
const itinerary = object({ id: text, revision: ref("core.revision"),
  area: text, startAt: ref("core.timestamp"), stops: array(ref("travel.stop"), 1) });

export const travelPack = {
  id: "travel", version: 1, compatibleKernelVersions: [1],
  entityTypes: ["travel.place", "travel.day_itinerary", "travel.stop", "travel.visit"],
  types: [
    { id: "travel.place", schema: object({ id: text, name: text,
      searchArea: text, address: text }, ["id", "name"]) },
    { id: "travel.stop", schema: stop },
    { id: "travel.day_itinerary", schema: itinerary,
      validate: (value) => assertUnique(value.stops, "id", "$.stops") },
    { id: "travel.visit", schema: object({ id: text, itineraryId: text,
      stopId: text, placeId: text, reportedAt: ref("core.timestamp") }) },
    { id: "travel.capture_candidate", schema: object({ importId: text,
      name: text, searchArea: text, mentionId: text,
      evidenceIds: ref("core.evidence_ids") }) },
    { id: "travel.confirm_input", schema: object({ area: text,
      startAt: ref("core.timestamp"),
      candidates: array(ref("travel.capture_candidate"), 1) }) },
    { id: "travel.confirm_result", schema: object({ itineraryId: text,
      itinerary: ref("travel.day_itinerary"),
      confirmedAt: ref("core.timestamp") }) },
    { id: "travel.outcome_input", schema: object({
      itinerary: ref("travel.day_itinerary") }) },
    { id: "travel.stop_outcome", schema: object({ stopId: text,
      status: enumeration("visited", "skipped", "unknown") }) },
    { id: "travel.day_outcome", schema: object({ itineraryId: text,
      stops: array(ref("travel.stop_outcome"), 1),
      reportedAt: ref("core.timestamp") }),
      validate: (value) => assertUnique(value.stops, "stopId", "$.stops") },
  ],
  relations: [
    relation("travel.has_stop", ["travel.day_itinerary"], ["travel.stop"]),
    valueRelation("travel.area", ["travel.day_itinerary"], "core.text",
      "explicit_user_confirmation"),
    valueRelation("travel.stop_order", ["travel.stop"], "core.revision",
      "explicit_user_confirmation"),
    valueRelation("travel.planned_at", ["travel.stop"], "core.timestamp",
      "explicit_user_confirmation"),
    relation("travel.stop_at", ["travel.stop"], ["travel.place"], "one"),
    relation("travel.visit_of_stop", ["travel.visit"], ["travel.stop"], "one"),
    relation("travel.visit_at_place", ["travel.visit"], ["travel.place"], "one"),
  ],
  capabilities: [
    capability({ id: "travel.confirm_itinerary", taskKind: "decision",
      inputType: "travel.confirm_input", outputType: "travel.confirm_result" }),
    capability({ id: "travel.record_stop_outcomes", taskKind: "observe",
      inputType: "travel.outcome_input", outputType: "travel.day_outcome" }),
  ],
  slots: [],
  artifacts: [artifact("travel.day_itinerary", "travel.day_itinerary",
    "travel.itinerary")],
};
