import { readFile } from "node:fs/promises";
import { evaluateLabeledBatch } from "../src/evaluation/labeled_analysis.js";
import { checkLabeledInputs } from "../src/evaluation/labeled_inputs.js";

const [manifestFile, predictionFile, imageDirectory] = process.argv.slice(2);
if (!manifestFile || !predictionFile || process.argv.length > 5) {
  throw new Error("Usage: node scripts/evaluate-labeled-analysis.mjs LABELS.json PREDICTIONS.json [IMAGES_DIR]");
}
try {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (manifest.dataClass === "consented_private" && !imageDirectory) {
    throw new Error("IMAGE_DIRECTORY_REQUIRED");
  }
  const inputs = imageDirectory ? await checkLabeledInputs(manifest, imageDirectory) : null;
  if (inputs && inputs.verified !== inputs.cases) throw new Error("INPUTS_NOT_VERIFIED");
  const predictions = JSON.parse(await readFile(predictionFile, "utf8"));
  const report = evaluateLabeledBatch(manifest, predictions);
  console.log(JSON.stringify({ ...report,
    ...(inputs ? { inputVerification: { cases: inputs.cases, verified: inputs.verified } } : {}) }, null, 2));
  if (report.matchedFields !== report.labeledFields ||
      report.passedGraphChecks !== report.graphChecks || report.unexpectedPredictions.length) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ status: "error", code: "INVALID_EVALUATION_INPUTS" }));
  process.exitCode = 1;
}
