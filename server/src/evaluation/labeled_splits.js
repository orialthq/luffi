import { validateLabelManifest } from "./labeled_analysis.js";

export function checkLabeledSplitIsolation(development, holdout) {
  validateLabelManifest(development);
  validateLabelManifest(holdout);
  if (development.dataClass !== "consented_private" ||
      holdout.dataClass !== "consented_private" ||
      development.entries.some((entry) => entry.split !== "development") ||
      holdout.entries.some((entry) => entry.split !== "holdout")) {
    throw new Error("INVALID_EVALUATION_SPLITS");
  }
  const developmentIds = new Set(development.entries.map((entry) => entry.id));
  const developmentSources = new Set(development.entries.map((entry) => entry.sourceGroupId));
  const developmentHashes = new Set(development.entries.map((entry) => entry.inputSha256));
  if (holdout.entries.some((entry) => developmentIds.has(entry.id) ||
      developmentSources.has(entry.sourceGroupId) ||
      developmentHashes.has(entry.inputSha256))) {
    throw new Error("EVALUATION_SPLIT_OVERLAP");
  }
  return { status: "isolated", development: { dataset: development.dataset,
    cases: development.entries.length }, holdout: { dataset: holdout.dataset,
    cases: holdout.entries.length } };
}
