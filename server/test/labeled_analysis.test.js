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
