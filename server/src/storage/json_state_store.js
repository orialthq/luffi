import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

// A single-process durable adapter for local development. The kernel depends
// only on snapshot()/transact(), so a transactional database can replace it.
export function createJsonStateStore({ filePath, initialState, fsApi = fs }) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new TypeError("filePath is required");
  }
  if (typeof initialState !== "function") {
    throw new TypeError("initialState must be a function");
  }

  let loaded = false;
  let current;
  let tail = Promise.resolve();

  async function load() {
    if (!loaded) {
      try {
        current = JSON.parse(await fsApi.readFile(filePath, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        current = initialState();
      }
      assertSerializableState(current);
      loaded = true;
    }
    return current;
  }

  async function persist(next) {
    const folder = dirname(filePath);
    await fsApi.mkdir(folder, { recursive: true, mode: 0o700 });
    const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      const handle = await fsApi.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(next), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fsApi.rename(temp, filePath);
      renamed = true;
      current = structuredClone(next);
      const directory = await fsApi.open(folder, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      if (!renamed) await fsApi.rm(temp, { force: true });
    }
  }

  function serialized(operation) {
    const pending = tail.then(operation);
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  return {
    snapshot() {
      return serialized(async () => structuredClone(await load()));
    },
    transact(change) {
      if (typeof change !== "function") throw new TypeError("change must be a function");
      return serialized(async () => {
        const state = structuredClone(await load());
        const outcome = await change(state);
        if (!outcome || typeof outcome !== "object" || !("state" in outcome)) {
          throw new TypeError("transaction must return {state, result}");
        }
        assertSerializableState(outcome.state);
        if (JSON.stringify(outcome.state) !== JSON.stringify(current)) {
          await persist(outcome.state);
        }
        return structuredClone(outcome.result);
      });
    },
  };
}

function assertSerializableState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("state must be a JSON object");
  }
  const visit = (value, ancestors) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || ancestors.has(value)) {
      throw new TypeError("state must be JSON serializable");
    }
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new TypeError("state must contain plain JSON objects");
    }
    ancestors.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new TypeError("state contains an unsafe key");
      }
      visit(child, ancestors);
    }
    ancestors.delete(value);
  };
  visit(state, new Set());
}
