import { readFile } from "node:fs/promises";
import { checkLabeledSplitIsolation } from "../src/evaluation/labeled_splits.js";

const [developmentFile, holdoutFile] = process.argv.slice(2);
if (!developmentFile || !holdoutFile || process.argv.length !== 4) {
  throw new Error("Usage: node scripts/check-labeled-splits.mjs DEVELOPMENT_LABELS.json HOLDOUT_LABELS.json");
}
try {
  const development = JSON.parse(await readFile(developmentFile, "utf8"));
  const holdout = JSON.parse(await readFile(holdoutFile, "utf8"));
  console.log(JSON.stringify(checkLabeledSplitIsolation(development, holdout), null, 2));
} catch {
  console.error(JSON.stringify({ status: "error", code: "INVALID_EVALUATION_SPLITS" }));
  process.exitCode = 1;
}
