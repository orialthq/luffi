import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

test("Flutter's reviewed recipe JSON imports into the real knowledge graph once", async (t) => {
  // This synthetic fixture is produced by StructuredContentAnalysis.toJson() in
  // test/data/reviewed_capture_import_client_test.dart, not hand-translated.
  const request = JSON.parse(await readFile(new URL("./fixtures/flutter_reviewed_recipe_import.json", import.meta.url), "utf8"));
  const encoded = JSON.stringify(request);
  assert.equal(encoded.includes("private=removed"), false);
  assert.equal(encoded.includes("filePath"), false);
  assert.equal(encoded.includes("data:image/"), false);

  const directory = await mkdtemp(join(tmpdir(), "luffi-flutter-ingestion-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createJsonStateStore({
    filePath: join(directory, "state.json"), initialState: createCommonKernelState,
  });
  const service = createCommonKernelService({ store, ownerId: "synthetic-owner" });
  const first = await service.importReviewedCapture(request);
  const replay = await service.importReviewedCapture(request);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(first.sourceId, replay.sourceId);
  assert.equal(first.unresolvedMentions.length, 2);

  const state = await store.snapshot();
  assert.equal(state.knowledge.sources.length, 1);
  assert.equal(state.knowledge.sourceVersions.length, 1);
  assert.equal(state.knowledge.evidence.length, 3);
  assert.equal(state.knowledge.entityMentions.length, 2);
  assert.deepEqual(state.knowledge.sourceVersions[0].content.analysis, request.analysis);
  assert.equal(state.importReceipts[request.importId].sourceId, first.sourceId);
});
