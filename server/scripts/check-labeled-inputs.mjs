import { readFile } from "node:fs/promises";
import { checkLabeledInputs } from "../src/evaluation/labeled_inputs.js";

const [manifestFile, imageDirectory] = process.argv.slice(2);
if (!manifestFile || !imageDirectory || process.argv.length !== 4) {
  throw new Error("Usage: node scripts/check-labeled-inputs.mjs LABELS.json IMAGES_DIR");
}
try {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const report = await checkLabeledInputs(manifest, imageDirectory);
  console.log(JSON.stringify(report, null, 2));
  if (report.verified !== report.cases) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ status: "error", code: "INVALID_EVALUATION_INPUTS" }));
  process.exitCode = 1;
}
