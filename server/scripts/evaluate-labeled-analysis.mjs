import { readFile } from "node:fs/promises";
import { evaluateLabeledBatch } from "../src/evaluation/labeled_analysis.js";

const [manifestFile, predictionFile] = process.argv.slice(2);
if (!manifestFile || !predictionFile || process.argv.length !== 4) {
  throw new Error("Usage: node scripts/evaluate-labeled-analysis.mjs LABELS.json PREDICTIONS.json");
}
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const predictions = JSON.parse(await readFile(predictionFile, "utf8"));
const report = evaluateLabeledBatch(manifest, predictions);
console.log(JSON.stringify(report, null, 2));
if (report.matchedFields !== report.labeledFields ||
    report.passedGraphChecks !== report.graphChecks || report.unexpectedPredictions.length) process.exitCode = 1;
