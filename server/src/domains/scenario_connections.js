import { enumeration, object, text } from "./schema.js";
import { relation, valueRelation } from "./shared.js";

export const CONNECTION_KINDS = Object.freeze({
  recipe_shopping: ["recipe", "shopping"],
  recipe_health: ["recipe", "health"],
  travel_dining: ["travel", "dining"],
  travel_life_tip: ["travel", "life_tip"],
  fashion_beauty: ["fashion", "beauty"],
  fashion_shopping: ["fashion", "shopping"],
  beauty_shopping: ["beauty", "shopping"],
  shopping_life_tip: ["shopping", "life_tip"],
  health_life_tip: ["health", "life_tip"],
});
export const SCENARIO_TYPES = Object.freeze(["recipe", "dining", "fashion", "beauty",
  "travel", "life_tip", "shopping", "health"]);
export const SCENARIO_SUBJECT_TYPES = Object.freeze({
  recipe: "recipe.recipe", dining: "dining.place", fashion: "fashion.outfit",
  beauty: "beauty.routine_template", travel: "travel.day_itinerary",
  life_tip: "life_tip.action_plan", shopping: "shopping.purchase_choice",
  health: "health.workout_plan",
});

export const scenarioConnectionsPack = {
  id: "scenario_connections", version: 1, compatibleKernelVersions: [1],
  entityTypes: ["scenario.activity", "scenario.connection"],
  types: [
    { id: "scenario.activity", schema: object({ id: text, scenario: text }) },
    { id: "scenario.connection", schema: object({ id: text }) },
    { id: "scenario.connection_kind", schema: enumeration("related", ...Object.keys(CONNECTION_KINDS)) },
  ],
  relations: [
    relation("scenario.connection_from", ["scenario.connection"], ["scenario.activity"], "one"),
    relation("scenario.connection_to", ["scenario.connection"], ["scenario.activity"], "one"),
    relation("scenario.connection_from_subject", ["scenario.connection"],
      Object.values(SCENARIO_SUBJECT_TYPES), "one"),
    relation("scenario.connection_to_subject", ["scenario.connection"],
      Object.values(SCENARIO_SUBJECT_TYPES), "one"),
    valueRelation("scenario.connection_kind", ["scenario.connection"], "scenario.connection_kind",
      "explicit_user_confirmation"),
  ],
  capabilities: [], slots: [], artifacts: [],
};
