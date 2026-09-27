import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateRecordedAnalysis, evaluateSyntheticCorpus, loadSyntheticManifest,
  validateSyntheticManifest } from "../src/evaluation/synthetic_corpus.js";

test("public synthetic images and recorded responses pass the versioned regression contract", async () => {
  const result = await evaluateSyntheticCorpus();
  assert.equal(result.mode, "recorded_synthetic_regression");
  assert.equal(result.total, 21);
  assert.equal(result.passing, result.total, JSON.stringify(result.cases.filter((item) => item.failures.length)));
  assert.deepEqual(result.extraFiles, []);
  assert.equal(Object.values(result.domains).reduce((sum, item) => sum + item.total, 0), 21);
});

test("evaluation fails closed on changed labels, evidence, and duplicate IDs", async () => {
  const manifest = await loadSyntheticManifest();
  const entry = manifest.entries[0];
  assert.throws(() => validateSyntheticManifest({ ...manifest,
    entries: [...manifest.entries, entry] }), /INVALID_SYNTHETIC_ENTRY/);
  const analysis = JSON.parse(await readFile(new URL(`./fixtures/${entry.recording}`, import.meta.url), "utf8"));
  assert.ok(evaluateRecordedAnalysis(entry, { ...analysis, contentKind: "recipe" }).includes("kind_mismatch"));
  assert.ok(evaluateRecordedAnalysis(entry, { ...analysis,
    title: { ...analysis.title, value: "잘못된 제목" } }).includes("title_mismatch"));
  assert.ok(evaluateRecordedAnalysis(entry, { ...analysis,
    title: { ...analysis.title, evidenceIds: ["missing"] } }).includes("schema_invalid"));
  const changedHash = { ...manifest, entries: [{ ...entry,
    imageSha256: "0".repeat(64) }, ...manifest.entries.slice(1)] };
  const report = await evaluateSyntheticCorpus({ manifest: changedHash });
  assert.equal(report.passing, report.total - 1);
  assert.deepEqual(report.cases[0].failures, ["image_hash_mismatch"]);
});
