import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCommonKernelState } from "../src/common/kernel_service.js";
import { createDeletionLedger } from "../src/storage/deletion_ledger.js";

test("server starts with independent kernel state, deletion ledger, and batch queue", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "luffi-isolated-server-"));
  const ledgerPath = join(root, "ledger", "deletions.ndjson");
  const statePath = join(root, "kernel", "state.json");
  const batchDir = join(root, "batch-jobs");
  await createDeletionLedger({ filePath: ledgerPath }).bootstrap(createCommonKernelState());
  const token = "isolated-test-token-12345678901234567890";
  const child = spawn(process.execPath,
    [fileURLToPath(new URL("../src/index.js", import.meta.url))], {
      env: { ...process.env, OPENAI_API_KEY: "test-only",
        LUFFI_KERNEL_TOKEN: token, LUFFI_KERNEL_OWNER_ID: "isolated-owner",
        LUFFI_KERNEL_STATE_PATH: statePath,
        LUFFI_KERNEL_DELETION_LEDGER_PATH: ledgerPath,
        LUFFI_BATCH_DATA_DIR: batchDir, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  });
  let output = "";
  let errorOutput = "";
  child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("server startup timed out")), 15000);
    const finish = (error, value) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => finish(new Error(`server exited ${code}: ${output} ${errorOutput}`)));
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const found = /luffi analysis server: (http:\/\/[^\s]+)/.exec(output);
      if (found) finish(null, found[1]);
    });
  });
  assert.equal((await (await fetch(`${address}/health`)).json()).status, "ok");
  const response = await fetch(`${address}/v1/kernel/contracts`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).kernelVersion);
  assert.ok((await stat(join(batchDir, "tasks"))).isDirectory());
  assert.equal((await stat(ledgerPath)).mode & 0o777, 0o600);
});
