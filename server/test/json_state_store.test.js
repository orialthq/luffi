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

function applyOnce(commandId) {
  return (state) => {
    if (state.receipts[commandId]) {
      return { state, result: { ...state.receipts[commandId], replayed: true } };
    }
    state.count += 1;
    state.receipts[commandId] = { count: state.count };
    return { state, result: { count: state.count, replayed: false } };
  };
}

test("a failed directory sync after rename can be replayed without a duplicate commit", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "luffi-ambiguous-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  const fsApi = {
    ...fs,
    async open(path, flags, mode) {
      const handle = await fs.open(path, flags, mode);
      if (path !== root || flags !== "r") return handle;
      return {
        async sync() { throw new Error("directory sync failed"); },
        close: () => handle.close(),
      };
    },
  };
  const initialState = () => ({ count: 0, receipts: {} });
  const store = createJsonStateStore({ filePath, initialState, fsApi });

  await assert.rejects(store.transact(applyOnce("command-1")), /directory sync failed/);
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), {
    count: 1, receipts: { "command-1": { count: 1 } },
  });

  const reopened = createJsonStateStore({ filePath, initialState });
  assert.deepEqual(await reopened.transact(applyOnce("command-1")),
    { count: 1, replayed: true });
  assert.equal((await reopened.snapshot()).count, 1);
  assert.deepEqual(await reopened.transact(applyOnce("command-2")),
    { count: 2, replayed: false });
});

test("a failed rename preserves the previous state and removes its temporary file", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "luffi-precommit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = join(root, "state.json");
  const initialState = () => ({ count: 0, receipts: {} });
  const first = createJsonStateStore({ filePath, initialState });
  await first.transact(applyOnce("command-1"));
  const fsApi = {
    ...fs,
    async rename() { throw new Error("rename failed"); },
  };
  const failing = createJsonStateStore({ filePath, initialState, fsApi });

  await assert.rejects(failing.transact(applyOnce("command-2")), /rename failed/);
  assert.deepEqual(await fs.readdir(root), ["state.json"]);
  const reopened = createJsonStateStore({ filePath, initialState });
  assert.deepEqual(await reopened.snapshot(), {
    count: 1, receipts: { "command-1": { count: 1 } },
  });
  assert.deepEqual(await reopened.transact(applyOnce("command-2")),
    { count: 2, replayed: false });
});
