import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateLabeledBatch, validateLabelManifest } from "../src/evaluation/labeled_analysis.js";

const hash = createHash("sha256").update("synthetic fixture").digest("hex");
const manifest = { schemaVersion: 1, dataset: "synthetic-label-test", dataClass: "synthetic",
  entries: [{ id: "recipe-1", domain: "recipe", inputSha256: hash, expected: { fields: [
    { path: "/contentKind", value: "recipe", evidenceRequired: false },
    { path: "/title/value", value: "토마토 달걀 볶음", evidenceRequired: true },
    { path: "/ingredientGroups/0/ingredients/0/amount", value: "2", evidenceRequired: true },
  ] } }] };

test("versioned labels score values and their evidence separately without outputting source text", async () => {
  const analysis = JSON.parse(await readFile(new URL("./fixtures/recipe_tomato_egg_live_analysis.json", import.meta.url), "utf8"));
  const actualAmount = analysis.ingredientGroups[0].ingredients[0].amount;
  const labels = structuredClone(manifest);
  labels.entries[0].expected.fields[2].value = actualAmount;
  const good = evaluateLabeledBatch(labels, { "recipe-1": { inputSha256: hash, analysis } });
  assert.equal(good.matchedFields, 3);
  assert.equal(good.domains.recipe.validResponses, 1);
  const bad = structuredClone(analysis);
  bad.ingredientGroups[0].ingredients[0].amount = "999";
  const result = evaluateLabeledBatch(labels, { "recipe-1": { inputSha256: hash, analysis: bad } });
  assert.equal(result.matchedFields, 2);
  assert.deepEqual(result.failures, [{ id: "recipe-1", domain: "recipe",
    path: "/ingredientGroups/0/ingredients/0/amount", reason: "value_mismatch" }]);
  assert.equal(JSON.stringify(result).includes("토마토 달걀 볶음"), false);
});

test("missing predictions and unsafe or duplicate labels fail closed", () => {
  const missing = evaluateLabeledBatch(manifest, {});
  assert.equal(missing.validResponses, 0);
  assert.equal(missing.matchedFields, 0);
  assert.equal(missing.failures.length, 3);
  const mismatched = evaluateLabeledBatch(manifest, { "recipe-1": {
    inputSha256: "0".repeat(64), analysis: {} } });
  assert.equal(mismatched.failures[0].reason, "input_hash_mismatch");
  assert.deepEqual(evaluateLabeledBatch(manifest, { stray: {} }).unexpectedPredictions, ["stray"]);
  assert.throws(() => validateLabelManifest({ ...manifest,
    entries: [...manifest.entries, manifest.entries[0]] }), /INVALID_EVALUATION_LABELS/);
  const unsafe = structuredClone(manifest);
  unsafe.entries[0].expected.fields[0].path = "/__proto__/polluted";
  assert.throws(() => validateLabelManifest(unsafe), /INVALID_EVALUATION_LABELS/);
  assert.throws(() => validateLabelManifest({ ...manifest, dataClass: "consented_private" }),
    /INVALID_EVALUATION_LABELS/);
});

test("recipe ingredients and shopping facts match by meaning across reordered arrays", async () => {
  const recipe = JSON.parse(await readFile(new URL(
    "./fixtures/recipe_tomato_egg_live_analysis.json", import.meta.url), "utf8"));
  const shopping = JSON.parse(await readFile(new URL(
    "./fixtures/shopping_a_fabric_box_live_analysis.json", import.meta.url), "utf8"));
  const labels = { schemaVersion: 1, dataset: "order-independent", dataClass: "synthetic",
    entries: [
      { id: "recipe", domain: "recipe", inputSha256: hash, expected: { fields: [{
        id: "egg-amount", selector: { collection: "/ingredientGroups/*/ingredients/*",
          where: { name: "달걀" }, path: "/amount" }, value: "2", evidenceRequired: true,
      }] } },
      { id: "shopping", domain: "shopping", inputSha256: hash, expected: { fields: [{
        id: "displayed-price", selector: { collection: "/facts/*",
          where: { label: "가격" }, path: "/value" }, value: "12,900원", evidenceRequired: true,
      }] } },
    ] };
  recipe.ingredientGroups[0].ingredients.reverse();
  shopping.facts.reverse();
  const predictions = { recipe: { inputSha256: hash, analysis: recipe },
    shopping: { inputSha256: hash, analysis: shopping } };
  assert.equal(evaluateLabeledBatch(labels, predictions).matchedFields, 2);
  recipe.ingredientGroups[0].ingredients.push(structuredClone(
    recipe.ingredientGroups[0].ingredients.find((item) => item.name === "달걀")));
  assert.equal(evaluateLabeledBatch(labels, predictions).failures[0].reason, "ambiguous_match");
  recipe.ingredientGroups[0].ingredients.pop();
  recipe.ingredientGroups[0].ingredients = recipe.ingredientGroups[0].ingredients
    .filter((item) => item.name !== "달걀");
  assert.equal(evaluateLabeledBatch(labels, predictions).failures[0].reason, "missing_match");
});

test("graph labels isolate unsafe identity merge and action inference", async () => {
  const analysis = JSON.parse(await readFile(new URL(
    "./fixtures/dining_a_seongsu_live_analysis.json", import.meta.url), "utf8"));
  const labels = { schemaVersion: 1, dataset: "dining-graph", dataClass: "synthetic",
    entries: [{ id: "dining", domain: "dining", inputSha256: hash, expected: {
      fields: [{ path: "/place/name", value: "모퉁이식당 성수점", evidenceRequired: true }],
      graph: { ownerId: "owner-a", distinctMentions: [["seongsu-mention", "yeonnam-mention"]],
        forbiddenAssertions: [{ predicate: "dining.visited",
          scope: { type: "activity", id: "dining-board" } }] },
    } }] };
  const graph = { identityDecisions: [
    { ownerId: "owner-a", mentionId: "seongsu-mention", entityId: "place-a", status: "accepted" },
    { ownerId: "owner-a", mentionId: "yeonnam-mention", entityId: "place-b", status: "accepted" },
  ], assertions: [] };
  const predictions = { dining: { inputSha256: hash, analysis, graph } };
  const safe = evaluateLabeledBatch(labels, predictions);
  assert.equal(safe.matchedFields, 1);
  assert.equal(safe.passedGraphChecks, 2);
  graph.identityDecisions[1].entityId = "place-a";
  graph.assertions.push({ ownerId: "owner-a", status: "active", predicate: "dining.visited",
    scope: { type: "activity", id: "dining-board" } });
  const unsafe = evaluateLabeledBatch(labels, predictions);
  assert.deepEqual(unsafe.failures.map((item) => item.reason),
    ["unsafe_identity_merge", "forbidden_action_assertion"]);
  assert.equal(unsafe.matchedFields, 1);
  delete predictions.dining.graph;
  assert.equal(evaluateLabeledBatch(labels, predictions).failures.length, 2);
  const misspelled = structuredClone(labels);
  misspelled.entries[0].expected.graph.forbiddenAssertions[0].scpoe =
    misspelled.entries[0].expected.graph.forbiddenAssertions[0].scope;
  delete misspelled.entries[0].expected.graph.forbiddenAssertions[0].scope;
  assert.throws(() => validateLabelManifest(misspelled), /INVALID_EVALUATION_LABELS/);
});

test("all eight domains keep labeled observations when display lists reorder", async () => {
  const cases = [
    ["recipe", "recipe_tomato_egg", { collection: "/ingredientGroups/*/ingredients/*",
      where: { name: "토마토" }, path: "/amount" }, "200"],
    ["dining", "dining_a_seongsu", null, "모퉁이식당 성수점"],
    ["fashion", "fashion_a_blazer", { collection: "/facts/*",
      where: { label: "색상" }, path: "/value" }, "차콜"],
    ["beauty", "beauty_a_cleanser", { collection: "/facts/*",
      where: { label: "용량" }, path: "/value" }, "150 mL"],
    ["travel", "travel_a_viewpoint", null, "바람언덕 전망대"],
    ["life_tip", "life_tip_receipts", { collection: "/facts/*",
      where: { label: "2단계" }, path: "/value" }, "필요한 영수증과 버릴 영수증을 나눠요"],
    ["shopping", "shopping_a_fabric_box", { collection: "/facts/*",
      where: { label: "가격" }, path: "/value" }, "12,900원"],
    ["health", "health_home_workout", { collection: "/facts/*",
      where: { label: "2단계" }, path: "/value" }, "스쿼트 10회"],
  ];
  const entries = [];
  const predictions = {};
  for (const [domain, fixture, selector, value] of cases) {
    const analysis = JSON.parse(await readFile(new URL(
      `./fixtures/${fixture}_live_analysis.json`, import.meta.url), "utf8"));
    analysis.facts.reverse();
    for (const group of analysis.ingredientGroups) group.ingredients.reverse();
    entries.push({ id: domain, domain, inputSha256: hash, expected: { fields: [
      selector ? { id: `${domain}-detail`, selector, value, evidenceRequired: true }
        : { path: "/place/name", value, evidenceRequired: true },
    ] } });
    predictions[domain] = { inputSha256: hash, analysis };
  }
  const report = evaluateLabeledBatch({ schemaVersion: 1,
    dataset: "all-domains", dataClass: "synthetic", entries }, predictions);
  assert.equal(report.matchedFields, 8, JSON.stringify(report.failures));
  assert.equal(Object.keys(report.domains).length, 8);
});
