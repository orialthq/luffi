import assert from "node:assert/strict";
import test from "node:test";
import { checkLabeledSplitIsolation } from "../src/evaluation/labeled_splits.js";

function manifest(dataset, split, entries) {
  return { schemaVersion: 1, dataset, dataClass: "consented_private",
    entries: entries.map(([id, sourceGroupId, inputSha256]) => ({ id, sourceGroupId,
      inputSha256, split, consentRef: "synthetic-consent", domain: "recipe",
      expected: { fields: [{ path: "/contentKind", value: "recipe",
        evidenceRequired: false }] } })) };
}

const development = manifest("development-test", "development", [
  ["capture-a", "post-a", "a".repeat(64)],
  ["capture-a-crop", "post-a", "b".repeat(64)],
]);
const holdout = manifest("holdout-test", "holdout", [
  ["capture-b", "post-b", "c".repeat(64)],
]);

test("separate development and holdout files pass only when sources and bytes are disjoint", () => {
  assert.deepEqual(checkLabeledSplitIsolation(development, holdout), {
    status: "isolated", development: { dataset: "development-test", cases: 2 },
    holdout: { dataset: "holdout-test", cases: 1 },
  });
  const overlappingSource = manifest("holdout-test", "holdout", [
    ["capture-b", "post-a", "c".repeat(64)],
  ]);
  assert.throws(() => checkLabeledSplitIsolation(development, overlappingSource),
    /EVALUATION_SPLIT_OVERLAP/);
  const overlappingBytes = manifest("holdout-test", "holdout", [
    ["capture-b", "post-b", "a".repeat(64)],
  ]);
  assert.throws(() => checkLabeledSplitIsolation(development, overlappingBytes),
    /EVALUATION_SPLIT_OVERLAP/);
  const overlappingId = manifest("holdout-test", "holdout", [
    ["capture-a", "post-b", "c".repeat(64)],
  ]);
  assert.throws(() => checkLabeledSplitIsolation(development, overlappingId),
    /EVALUATION_SPLIT_OVERLAP/);
});

test("split checker refuses swapped split labels and unconsented input class", () => {
  assert.throws(() => checkLabeledSplitIsolation(holdout, development),
    /INVALID_EVALUATION_SPLITS/);
  assert.throws(() => checkLabeledSplitIsolation({ ...development,
    dataClass: "synthetic" }, holdout), /INVALID_EVALUATION_SPLITS/);
});
