import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordLabeledPredictions } from "../src/evaluation/record_labeled_predictions.js";

const fixture = new URL("./fixtures/beauty_a_cleanser.png", import.meta.url);
const analysisFixture = new URL("./fixtures/beauty_a_cleanser_live_analysis.json", import.meta.url);

test("recording sends verified synthetic bytes to a local backend and pins its versions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "luffi-record-eval-"));
  try {
    const bytes = await readFile(fixture);
    const analysis = JSON.parse(await readFile(analysisFixture, "utf8"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    const imageFile = join(directory, "capture-a.png");
    await writeFile(imageFile, bytes);
    const manifest = { schemaVersion: 1, dataset: "synthetic-recording",
      dataClass: "consented_private", entries: [{ id: "capture-a", domain: "beauty",
        consentRef: "synthetic-consent", sourceGroupId: "synthetic-post", split: "development",
        inputSha256: hash, expected: { fields: [{ path: "/contentKind",
          value: "beauty_product", evidenceRequired: false }] } }] };
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push(url.pathname);
      assert.equal(options.redirect, "error");
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", model: analysis.model,
          schemaVersion: analysis.schemaVersion, promptVersion: "3" });
      }
      const body = JSON.parse(options.body);
      assert.equal(body.capture.id, "capture-a");
      assert.equal(body.image.mimeType, "image/png");
      assert.deepEqual(Buffer.from(body.image.base64, "base64"), bytes);
      return Response.json(analysis);
    };
    const args = { manifest, imageDirectory: directory, endpoint: "http://127.0.0.1:8787",
      serverCommit: "a".repeat(40), fetchImpl,
      now: () => new Date("2026-09-28T00:00:00.000Z") };
    const bundle = await recordLabeledPredictions(args);
    assert.deepEqual(calls, ["/health", "/v1/analyze", "/health"]);
    assert.equal(bundle.run.modelId, analysis.model);
    assert.equal(bundle.run.promptVersion, "3");
    assert.equal(bundle.predictions["capture-a"].inputSha256, hash);
    assert.equal(bundle.predictions["capture-a"].analysis.contentKind, "beauty_product");

    await writeFile(imageFile, Buffer.concat([bytes, Buffer.from("changed")]));
    calls.length = 0;
    await assert.rejects(recordLabeledPredictions(args), /INVALID_EVALUATION_IMAGE/);
    assert.deepEqual(calls, []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("recording refuses external endpoints before reading or sending images", async () => {
  const manifest = { schemaVersion: 1, dataset: "synthetic-endpoint", dataClass: "synthetic",
    entries: [{ id: "capture-a", domain: "beauty", inputSha256: "a".repeat(64),
      expected: { fields: [{ path: "/contentKind", value: "beauty_product",
        evidenceRequired: false }] } }] };
  let calls = 0;
  await assert.rejects(recordLabeledPredictions({ manifest, imageDirectory: "/missing",
    endpoint: "https://example.com", serverCommit: "a".repeat(40),
    fetchImpl: () => { calls += 1; } }), /INVALID_EVALUATION_ENDPOINT/);
  assert.equal(calls, 0);
});
