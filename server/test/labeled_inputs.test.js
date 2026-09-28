import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkLabeledInputs } from "../src/evaluation/labeled_inputs.js";

const fixture = new URL("./fixtures/beauty_a_cleanser.png", import.meta.url);

function labels(hash) {
  return { schemaVersion: 1, dataset: "synthetic-preflight", dataClass: "synthetic",
    entries: [{ id: "capture-a", domain: "beauty", inputSha256: hash,
      expected: { fields: [{ path: "/contentKind", value: "beauty_product",
        evidenceRequired: false }] } }] };
}

async function withImageDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "luffi-label-inputs-"));
  try { await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("synthetic image preflight verifies actual bytes against the label hash", async () => {
  await withImageDirectory(async (directory) => {
    const bytes = await readFile(fixture);
    const hash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(directory, "capture-a.png"), bytes);
    const report = await checkLabeledInputs(labels(hash), directory);
    assert.deepEqual(report, { dataset: "synthetic-preflight", dataClass: "synthetic",
      cases: 1, verified: 1, domains: { beauty: { cases: 1, verified: 1 } }, failures: [] });

    await writeFile(join(directory, "capture-a.png"), Buffer.concat([bytes, Buffer.from("changed")]));
    const changed = await checkLabeledInputs(labels(hash), directory);
    assert.deepEqual(changed.failures, [{ id: "capture-a", domain: "beauty",
      reason: "input_hash_mismatch" }]);
    assert.equal(JSON.stringify(changed).includes("changed"), false);
  });
});

test("preflight rejects missing, ambiguous, disguised and linked images", async () => {
  await withImageDirectory(async (directory) => {
    const bytes = await readFile(fixture);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const manifest = labels(hash);
    const reason = async () => (await checkLabeledInputs(manifest, directory)).failures[0].reason;
    assert.equal(await reason(), "missing_image");
    await writeFile(join(directory, "capture-a.png"), Buffer.from("not an image"));
    assert.equal(await reason(), "invalid_image_type");
    await writeFile(join(directory, "capture-a.png"), bytes);
    await writeFile(join(directory, "capture-a.jpg"), bytes);
    assert.equal(await reason(), "ambiguous_image");
    await rm(join(directory, "capture-a.jpg"));
    await rm(join(directory, "capture-a.png"));
    await symlink(fixture.pathname, join(directory, "capture-a.png"));
    assert.equal(await reason(), "invalid_image_file");
  });
});
