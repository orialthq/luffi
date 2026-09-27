import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { checkRestoreDeletionSafety } from "../src/storage/restore_safety.js";
import { makeValidAnalysis } from "./fixtures.js";

test("post-deletion JSON backup restores tombstones, owner isolation, and independent sources", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "luffi-backup-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = join(root, "original.json");
  const backup = join(root, "backup.json");
  const restored = join(root, "restored.json");
  const serviceAt = (path, ownerId) => createCommonKernelService({ ownerId,
    store: createJsonStateStore({ filePath: path, initialState: createCommonKernelState }) });
  const seed = serviceAt(original, "owner-a");
  const input = (id) => ({ importId: id, reviewed: true,
    reviewedAt: "2026-09-27T09:00:00Z",
    capture: { id, asset: { status: "unavailable" } }, analysis: makeValidAnalysis() });
  const deleted = await seed.importReviewedCapture(input("backup-deleted"));
  const retained = await seed.importReviewedCapture(input("backup-retained"));
  const beforeDeletion = JSON.parse(await readFile(original, "utf8"));
  await seed.deleteReviewedCapture({ importId: "backup-deleted", commandId: "backup-delete" });
  await copyFile(original, backup);
  await copyFile(backup, restored);

  const saved = JSON.parse(await readFile(backup, "utf8"));
  const recovered = JSON.parse(await readFile(restored, "utf8"));
  assert.deepEqual(recovered, saved);
  assert.equal(checkRestoreDeletionSafety(saved, recovered).safe, true);
  assert.deepEqual(checkRestoreDeletionSafety(saved, beforeDeletion), {
    safe: false, checkedDeletedImports: 1, checkedDeletedSources: 1,
    missingImportTombstones: 1, reactivatedSources: 1,
  });
  const sameOwner = serviceAt(restored, "owner-a");
  const otherOwner = serviceAt(restored, "owner-b");
  assert.deepEqual((await sameOwner.checkReviewedCaptureImports({
    importIds: ["backup-deleted", "backup-retained"],
  })).imports, [
    { importId: "backup-deleted", status: "deleted" },
    { importId: "backup-retained", status: "active", sourceId: retained.sourceId },
  ]);
  assert.equal((await otherOwner.checkReviewedCaptureImports({
    importIds: ["backup-deleted", "backup-retained"],
  })).imports.every((item) => item.status === "missing"), true);
  assert.equal((await sameOwner.queryKnowledge({ subjectId: deleted.materialId })).length, 0);
  assert.ok((await sameOwner.queryKnowledge({ subjectId: retained.materialId })).length > 0);
  await assert.rejects(sameOwner.importReviewedCapture(input("backup-deleted")),
    (error) => error.code === "IMPORT_DELETED");
  assert.equal((await sameOwner.deleteReviewedCapture({ importId: "backup-deleted",
    commandId: "backup-delete" })).replayed, true);
});
