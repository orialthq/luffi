import { open, lstat, mkdir, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { recordLabeledPredictions } from "../src/evaluation/record_labeled_predictions.js";

const localDirectory = fileURLToPath(new URL("../../tool/evals/local/", import.meta.url));
const [manifestFile, imageDirectory, outputName, serverCommit] = process.argv.slice(2);

try {
  if (!manifestFile || !imageDirectory || !outputName || !serverCommit ||
      process.argv.length !== 6 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(outputName)) {
    throw new Error("INVALID_EVALUATION_ARGUMENTS");
  }
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  try { await mkdir(localDirectory, { mode: 0o700 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  const directory = await lstat(localDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)) {
    throw new Error("INVALID_EVALUATION_OUTPUT_DIRECTORY");
  }
  const outputFile = join(localDirectory, `${outputName}.json`);
  let handle;
  try {
    handle = await open(outputFile, "wx", 0o600);
    const bundle = await recordLabeledPredictions({ manifest, imageDirectory,
      endpoint: process.env.LUFFI_ANALYSIS_BASE_URL ?? "http://127.0.0.1:8787",
      serverCommit });
    await handle.writeFile(`${JSON.stringify(bundle, null, 2)}\n`);
    await handle.sync();
  } catch (error) {
    if (handle) {
      await handle.close();
      handle = null;
      await rm(outputFile, { force: true });
    }
    throw error;
  } finally { await handle?.close(); }
  console.log(JSON.stringify({ status: "recorded", dataset: manifest.dataset,
    cases: manifest.entries.length, outputName }));
} catch {
  console.error(JSON.stringify({ status: "error", code: "LABELED_RECORDING_FAILED" }));
  process.exitCode = 1;
}
