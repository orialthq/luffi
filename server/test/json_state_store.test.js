import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJsonStateStore } from "../src/storage/json_state_store.js";

test("serializes concurrent transactions and restores committed state", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "luffi-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = join(root, "private", "state.json");
  const store = createJsonStateStore({ filePath, initialState: () => ({ count: 0 }) });
  await Promise.all(Array.from({ length: 20 }, () => store.transact(async (state) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { state: { count: state.count + 1 }, result: state.count + 1 };
  })));
  assert.deepEqual(await store.snapshot(), { count: 20 });
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);

  const restored = createJsonStateStore({ filePath, initialState: () => ({ count: -1 }) });
  assert.deepEqual(await restored.snapshot(), { count: 20 });
  await assert.rejects(restored.transact(() => { throw new Error("rejected"); }), /rejected/);
  assert.deepEqual(await restored.snapshot(), { count: 20 });
});

test("never silently resets a corrupt durable state", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "luffi-corrupt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  await fs.writeFile(filePath, "{broken", "utf8");
  const store = createJsonStateStore({ filePath, initialState: () => ({ count: 0 }) });
  await assert.rejects(store.snapshot(), SyntaxError);
  assert.equal(await fs.readFile(filePath, "utf8"), "{broken");
});

test("a returned transaction result cannot mutate committed in-memory state", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "luffi-isolation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  const store = createJsonStateStore({ filePath, initialState: () => ({ record: { count: 0 } }) });
  const result = await store.transact((state) => {
    state.record.count = 1;
    return { state, result: state.record };
  });
  result.count = 900;
  assert.equal((await store.snapshot()).record.count, 1);
  assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).record.count, 1);
  await assert.rejects(store.transact((state) => ({ state: { ...state, bad: undefined }, result: null })),
    /JSON serializable/);
});
