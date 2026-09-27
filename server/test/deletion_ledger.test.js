import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { createDeletionLedger } from "../src/storage/deletion_ledger.js";
import { createJsonStateStore } from "../src/storage/json_state_store.js";
import { reconcileDeletionLedger } from "../src/storage/reconcile_deletions.js";
import { makeValidAnalysis } from "./fixtures.js";

const input = { importId: "private-capture-1", reviewed: true,
  reviewedAt: "2026-09-27T09:00:00Z",
  capture: { id: "private-capture-1", asset: { status: "unavailable" } },
  analysis: makeValidAnalysis() };

test("independent write-ahead ledger blocks an older JSON backup before serving it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "luffi-ledger-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateFile = join(root, "state.json");
  const oldFile = join(root, "old.json");
  const currentFile = join(root, "current.json");
  const ledgerFile = join(root, "independent", "deleted.ndjson");
  const ledger = createDeletionLedger({ filePath: ledgerFile });
  const serviceAt = (path) => createCommonKernelService({ ownerId: "owner-a",
    store: createJsonStateStore({ filePath: path, initialState: createCommonKernelState,
      deletionLedger: ledger }) });
  const service = serviceAt(stateFile);
  await service.importReviewedCapture(input);
  await copyFile(stateFile, oldFile);
  await service.deleteReviewedCapture({ importId: input.importId, commandId: "delete-once" });
  await copyFile(stateFile, currentFile);
  const entries = await ledger.read();
  assert.deepEqual(entries.map((entry) => entry.kind).sort(), ["import", "source"]);
  assert.equal((await stat(ledgerFile)).mode & 0o777, 0o600);
  assert.equal((await readFile(ledgerFile, "utf8")).includes(input.importId), false);
  await assert.rejects(serviceAt(oldFile).checkReviewedCaptureImports({
    importIds: [input.importId] }), /DELETION_LEDGER_RESTORE_UNSAFE/);
  const quarantined = createJsonStateStore({ filePath: oldFile,
    initialState: createCommonKernelState });
  assert.deepEqual(await reconcileDeletionLedger({ store: quarantined, ledger }), {
    pendingImports: 1, pendingSources: 1, applied: false,
  });
  assert.deepEqual(await reconcileDeletionLedger({ store: quarantined, ledger, apply: true }), {
    pendingImports: 1, pendingSources: 1, applied: true,
  });
  assert.equal((await serviceAt(oldFile).checkReviewedCaptureImports({
    importIds: [input.importId] })).imports[0].status, "deleted");
  assert.deepEqual((await serviceAt(currentFile).checkReviewedCaptureImports({
    importIds: [input.importId] })).imports[0].status, "deleted");
  const tampered = (await readFile(ledgerFile, "utf8")).replace('"kind":"import"', '"kind":"source"');
  await writeFile(ledgerFile, tampered);
  await assert.rejects(ledger.read(), /DELETION_LEDGER_CORRUPT/);
});

test("a backup from before the import cannot recreate a later deleted source", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "luffi-ledger-old-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  const backup = join(root, "before-import.json");
  const ledger = createDeletionLedger({ filePath: join(root, "separate", "deleted.ndjson") });
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState,
    deletionLedger: ledger });
  const service = createCommonKernelService({ ownerId: "owner-a", store });
  await store.transact((state) => ({ state, result: null }));
  await writeFile(backup, JSON.stringify(createCommonKernelState()));
  await service.importReviewedCapture(input);
  await service.deleteReviewedCapture({ importId: input.importId, commandId: "deleted-after-backup" });
  const old = createCommonKernelService({ ownerId: "owner-a",
    store: createJsonStateStore({ filePath: backup,
      initialState: createCommonKernelState, deletionLedger: ledger }) });
  await assert.rejects(old.importReviewedCapture(input), /DELETION_LEDGER_RESTORE_UNSAFE/);
});

test("direct source deletion also enters the ledger and cannot be restored active", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "luffi-ledger-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  const oldPath = join(root, "old.json");
  const ledger = createDeletionLedger({ filePath: join(root, "other", "deleted.ndjson") });
  const store = createJsonStateStore({ filePath, initialState: createCommonKernelState,
    deletionLedger: ledger });
  const service = createCommonKernelService({ ownerId: "owner-a", store });
  await service.knowledgeCommand({ commandId: "source-create", type: "source.create",
    payload: { id: "standalone-source", kind: "user_note" } });
  await copyFile(filePath, oldPath);
  await service.knowledgeCommand({ commandId: "source-delete", type: "source.delete",
    payload: { sourceId: "standalone-source" } });
  assert.deepEqual((await ledger.read()).map((item) => item.kind), ["source"]);
  await assert.rejects(createJsonStateStore({ filePath: oldPath,
    initialState: createCommonKernelState, deletionLedger: ledger }).snapshot(),
  /DELETION_LEDGER_RESTORE_UNSAFE/);
});

test("ledger failure prevents JSON deletion from committing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "luffi-ledger-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  const seeded = createCommonKernelService({ ownerId: "owner-a",
    store: createJsonStateStore({ filePath, initialState: createCommonKernelState }) });
  await seeded.importReviewedCapture(input);
  const failing = createCommonKernelService({ ownerId: "owner-a",
    store: createJsonStateStore({ filePath, initialState: createCommonKernelState,
      deletionLedger: { async assertSafe() {}, async recordTransitions() {
        throw new Error("ledger sync failed");
      } } }) });
  await assert.rejects(failing.deleteReviewedCapture({ importId: input.importId,
    commandId: "delete-fails" }), /ledger sync failed/);
  assert.equal((await seeded.checkReviewedCaptureImports({
    importIds: [input.importId] })).imports[0].status, "active");
});

test("existing tombstones require an explicit one-time ledger bootstrap", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "luffi-ledger-bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  const ledger = createDeletionLedger({ filePath: join(root, "separate", "deleted.ndjson") });
  const originalStore = createJsonStateStore({ filePath,
    initialState: createCommonKernelState });
  const original = createCommonKernelService({ ownerId: "owner-a", store: originalStore });
  await original.importReviewedCapture(input);
  await original.deleteReviewedCapture({ importId: input.importId, commandId: "old-delete" });
  const protectedStore = createJsonStateStore({ filePath,
    initialState: createCommonKernelState, deletionLedger: ledger });
  await assert.rejects(protectedStore.snapshot(), /DELETION_LEDGER_MISSING/);
  assert.equal(await ledger.bootstrap(await originalStore.snapshot()), 2);
  assert.equal((await protectedStore.snapshot()).importReceipts[input.importId].deleted, true);
  await assert.rejects(ledger.bootstrap(await originalStore.snapshot()),
    (error) => error.code === "EEXIST");
});
