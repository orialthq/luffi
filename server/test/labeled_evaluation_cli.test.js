import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("../scripts/evaluate-labeled-analysis.mjs", import.meta.url).pathname;

test("private report CLI requires verified image bytes and a reproducible run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "luffi-eval-cli-"));
  try {
    const bytes = await readFile(new URL("./fixtures/recipe_tomato_egg_generated.png", import.meta.url));
    const analysis = JSON.parse(await readFile(new URL(
      "./fixtures/recipe_tomato_egg_live_analysis.json", import.meta.url), "utf8"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    const labels = { schemaVersion: 1, dataset: "synthetic-private-contract",
      dataClass: "consented_private", entries: [{ id: "capture-a", domain: "recipe",
        consentRef: "synthetic-consent", sourceGroupId: "synthetic-post", split: "holdout",
        inputSha256: hash, expected: { fields: [{ path: "/contentKind", value: "recipe",
          evidenceRequired: false }] } }] };
    const predictions = { schemaVersion: 1,
      run: { modelId: "synthetic-model", promptVersion: "prompt-1",
        analysisSchemaVersion: "2.1", serverCommit: "a".repeat(40),
        executedAt: "2026-09-28T00:00:00.000Z" },
      predictions: { "capture-a": { inputSha256: hash, analysis } } };
    const labelsFile = join(directory, "labels.json");
    const predictionsFile = join(directory, "predictions.json");
    const imageFile = join(directory, "capture-a.png");
    await writeFile(labelsFile, JSON.stringify(labels));
    await writeFile(predictionsFile, JSON.stringify(predictions));
    await writeFile(imageFile, bytes);
    const run = (...args) => spawnSync(process.execPath, [script, labelsFile,
      predictionsFile, ...args], { encoding: "utf8" });
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /INVALID_EVALUATION_INPUTS/);
    const good = run(directory);
    assert.equal(good.status, 0, good.stderr);
    assert.deepEqual(JSON.parse(good.stdout).inputVerification, { cases: 1, verified: 1 });
    await writeFile(imageFile, Buffer.concat([bytes, Buffer.from("modified")]));
    const changed = run(directory);
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /INVALID_EVALUATION_INPUTS/);
    assert.equal(changed.stderr.includes("modified"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
