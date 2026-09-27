import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresStateStore } from "../src/storage/postgres_state_store.js";

function fakePool() {
  const shared = { row: null, updates: 0, released: 0, rolledBack: 0,
    lockedReads: 0 };
  const pool = {
    shared,
    async query(sql) {
      if (!sql.startsWith("SELECT id FROM luffi_kernel_state")) {
        throw new Error(`unexpected pool query: ${sql}`);
      }
      return { rows: shared.row ? [{ id: "common-kernel" }] : [] };
    },
    async connect() {
      let staged;
      return {
        async query(sql, params = []) {
          if (sql === "BEGIN") { staged = structuredClone(shared.row); return {}; }
          if (sql === "COMMIT") { shared.row = staged; return {}; }
          if (sql === "ROLLBACK") { staged = null; shared.rolledBack++; return {}; }
          if (sql.includes("INSERT INTO luffi_kernel_state")) {
            staged ??= { revision: 1, payload: JSON.parse(params[1]) };
            return { rowCount: 1 };
          }
          if (sql.includes("FOR UPDATE")) {
            shared.lockedReads++;
            return { rows: [structuredClone(staged)] };
          }
          if (sql.includes("UPDATE luffi_kernel_state")) {
            staged = { revision: staged.revision + 1,
              payload: JSON.parse(params[1]) };
            shared.updates++;
            return { rowCount: 1 };
          }
          throw new Error(`unexpected client query: ${sql}`);
        },
        release() { shared.released++; },
      };
    },
  };
  return pool;
}

test("PostgreSQL adapter commits state and receipts together and skips read-only writes", async () => {
  const pool = fakePool();
  const store = createPostgresStateStore({ pool,
    initialState: () => ({ schemaVersion: 1, count: 0, receipts: {} }) });
  await store.ready();
  assert.deepEqual(await store.snapshot(),
    { schemaVersion: 1, count: 0, receipts: {} });
  assert.equal(pool.shared.updates, 0);
  const result = await store.transact((state) => {
    state.count++;
    state.receipts.command = { count: state.count };
    return { state, result: state.receipts.command };
  });
  assert.deepEqual(result, { count: 1 });
  assert.equal(pool.shared.row.revision, 2);
  assert.deepEqual((await store.snapshot()).receipts.command, { count: 1 });
  assert.equal(pool.shared.updates, 1);
  assert.equal(pool.shared.lockedReads, 3);
  assert.equal(pool.shared.released, 3);
});

test("PostgreSQL adapter rolls back an invalid change", async () => {
  const pool = fakePool();
  const store = createPostgresStateStore({ pool,
    initialState: () => ({ schemaVersion: 1, count: 0 }) });
  await store.snapshot();
  await assert.rejects(store.transact((state) => {
    state.count = Number.NaN;
    return { state, result: null };
  }), /JSON serializable/);
  assert.equal((await store.snapshot()).count, 0);
  assert.equal(pool.shared.rolledBack, 1);
});
