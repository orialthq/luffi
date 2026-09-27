import { assertSerializableState } from "./json_state_store.js";

// The kernel's snapshot()/transact() contract is preserved. SELECT FOR UPDATE
// serializes writers across processes, and command receipts live in the same
// row/transaction as the state they describe.
export function createPostgresStateStore({ pool, initialState,
  stateId = "common-kernel" }) {
  if (!pool || typeof pool.connect !== "function" ||
      typeof pool.query !== "function") throw new TypeError("pool is required");
  if (typeof initialState !== "function") {
    throw new TypeError("initialState must be a function");
  }
  if (typeof stateId !== "string" || !stateId.trim()) {
    throw new TypeError("stateId is required");
  }
  const initial = initialState();
  assertSerializableState(initial);
  const initialJson = JSON.stringify(initial);

  async function ensureRow(client) {
    await client.query(
      `INSERT INTO luffi_kernel_state (id, revision, payload)
       VALUES ($1, 1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
      [stateId, initialJson]);
  }

  async function transaction(change) {
    const client = await pool.connect();
    let begun = false;
    let broken = false;
    try {
      await client.query("BEGIN");
      begun = true;
      await ensureRow(client);
      const found = await client.query(
        "SELECT revision, payload FROM luffi_kernel_state WHERE id = $1 FOR UPDATE",
        [stateId]);
      if (found.rows.length !== 1) throw new Error("kernel state row is missing");
      const original = found.rows[0].payload;
      assertSerializableState(original);
      const outcome = await change(structuredClone(original));
      if (!outcome || typeof outcome !== "object" || !("state" in outcome)) {
        throw new TypeError("transaction must return {state, result}");
      }
      assertSerializableState(outcome.state);
      const nextJson = JSON.stringify(outcome.state);
      if (nextJson !== JSON.stringify(original)) {
        await client.query(
          `UPDATE luffi_kernel_state SET payload = $2::jsonb,
           revision = revision + 1, updated_at = now() WHERE id = $1`,
          [stateId, nextJson]);
      }
      await client.query("COMMIT");
      begun = false;
      return structuredClone(outcome.result);
    } catch (error) {
      if (begun) {
        try { await client.query("ROLLBACK"); }
        catch { broken = true; }
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  return {
    async ready() {
      // Fail at startup if migration 002 is not present or the connection is
      // invalid. Runtime requests must never silently fall back to JSON.
      await pool.query("SELECT id FROM luffi_kernel_state WHERE id = $1", [stateId]);
    },
    snapshot() {
      return transaction(async (state) => ({ state, result: state }));
    },
    transact(change) {
      if (typeof change !== "function") throw new TypeError("change must be a function");
      return transaction(change);
    },
  };
}
