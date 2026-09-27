import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { validateLegacyAnalysis } from "../ingestion/index.js";
import { validateAnalyzeRequest } from "../request_validation.js";

const fixtureDirectory = new URL("../../test/fixtures/", import.meta.url);
const manifestPath = new URL("../../evaluation/synthetic_corpus.v1.json", import.meta.url);
const idPattern = /^[a-z][a-z0-9_]*$/;

export function validateSyntheticManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.dataClass !== "synthetic" ||
      typeof manifest.dataset !== "string" || !idPattern.test(manifest.dataset.replaceAll("-", "_")) ||
      !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("INVALID_SYNTHETIC_MANIFEST");
  }
  const ids = new Set();
  const recordings = new Set();
  for (const entry of manifest.entries) {
    if (typeof entry?.id !== "string" || !idPattern.test(entry.id) ||
        typeof entry.domain !== "string" || !idPattern.test(entry.domain) ||
        !/^[a-f0-9]{64}$/.test(entry?.imageSha256) ||
        typeof entry?.recording !== "string" ||
        !/^[a-z][a-z0-9_]*_live_analysis\.json$/.test(entry.recording) ||
        typeof entry?.expected?.contentKind !== "string" ||
        typeof entry?.expected?.title !== "string" || !entry.expected.title.trim() ||
        ids.has(entry.id) || recordings.has(entry.recording)) {
      throw new Error("INVALID_SYNTHETIC_ENTRY");
    }
    ids.add(entry.id);
    recordings.add(entry.recording);
  }
  return manifest;
}

export async function loadSyntheticManifest() {
  return validateSyntheticManifest(JSON.parse(await readFile(manifestPath, "utf8")));
}

export function evaluateRecordedAnalysis(entry, analysis) {
  const failures = [];
  try {
    validateLegacyAnalysis(analysis);
  } catch {
    failures.push("schema_invalid");
    return failures;
  }
  if (analysis.contentKind !== entry.expected.contentKind) failures.push("kind_mismatch");
  if (analysis.title.value !== entry.expected.title) failures.push("title_mismatch");
  const evidence = new Set(analysis.evidence.map((item) => item.id));
  if (evidence.size !== analysis.evidence.length) failures.push("duplicate_evidence_id");
  const fields = [analysis.title, analysis.place, ...analysis.tags, ...analysis.facts,
    ...analysis.steps, ...analysis.ingredientGroups.flatMap((group) => group.ingredients)];
  if (fields.some((field) => field?.evidenceIds?.some((id) => !evidence.has(id)))) {
    failures.push("unresolved_evidence_id");
  }
  if (analysis.title.evidenceIds.length === 0) failures.push("title_without_evidence");
  return failures;
}

export async function evaluateSyntheticCorpus({ manifest, fixtureRoot = fixtureDirectory } = {}) {
  const checked = validateSyntheticManifest(manifest ?? await loadSyntheticManifest());
  const files = new Set(await readdir(fixtureRoot));
  const expectedFiles = new Set(checked.entries.flatMap((entry) =>
    [`${entry.id}.png`, entry.recording]));
  const extraFiles = [...files].filter((name) =>
    (name.endsWith(".png") || name.endsWith("_live_analysis.json")) && !expectedFiles.has(name));
  const cases = [];
  for (const entry of checked.entries) {
    const failures = [];
    try {
      const image = await readFile(new URL(`${entry.id}.png`, fixtureRoot));
      if (createHash("sha256").update(image).digest("hex") !== entry.imageSha256) {
        failures.push("image_hash_mismatch");
      }
      validateAnalyzeRequest({
        image: { mimeType: "image/png", base64: image.toString("base64") },
        capture: { id: entry.id, sourceApp: "synthetic.corpus", locale: "ko-KR" },
      });
    } catch {
      failures.push("image_missing_or_invalid");
    }
    try {
      const analysis = JSON.parse(await readFile(new URL(entry.recording, fixtureRoot), "utf8"));
      failures.push(...evaluateRecordedAnalysis(entry, analysis));
    } catch {
      failures.push("recording_missing_or_invalid");
    }
    cases.push({ id: entry.id, domain: entry.domain, failures });
  }
  const domains = Object.fromEntries([...new Set(cases.map((item) => item.domain))].sort()
    .map((domain) => {
      const subset = cases.filter((item) => item.domain === domain);
      return [domain, { total: subset.length, passing: subset.filter((item) => !item.failures.length).length }];
    }));
  return {
    dataset: checked.dataset,
    mode: "recorded_synthetic_regression",
    total: cases.length,
    passing: cases.filter((item) => !item.failures.length).length,
    domains,
    extraFiles,
    cases,
  };
}
