import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const keyHash = (ownerId, id) => digest(`${ownerId}\u0000${id}`);
const validHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function deletionKeys(state) {
  const keys = new Set();
  for (const [id, receipt] of Object.entries(state.importReceipts ?? {})) {
    if (receipt?.deleted) keys.add(`import:${keyHash(receipt.ownerId, id)}`);
  }
  for (const source of state.knowledge?.sources ?? []) {
    if (source.status === "deleted") keys.add(`source:${keyHash(source.ownerId, source.id)}`);
  }
  return keys;
}

function activeRecords(state) {
  const records = [];
  for (const [id, receipt] of Object.entries(state.importReceipts ?? {})) {
    if (!receipt?.deleted) records.push({ kind: "import", ownerId: receipt.ownerId,
      id, keyHash: keyHash(receipt.ownerId, id) });
  }
  for (const source of state.knowledge?.sources ?? []) {
    if (source.status === "active") records.push({ kind: "source", ownerId: source.ownerId,
      id: source.id, keyHash: keyHash(source.ownerId, source.id) });
  }
  return records;
}

function decodeLedger(text) {
  if (!text) return [];
  if (!text.endsWith("\n")) throw new Error("DELETION_LEDGER_TRUNCATED");
  const records = [];
  let previousHash = "0".repeat(64);
  for (const line of text.trimEnd().split("\n")) {
    let entry;
    try { entry = JSON.parse(line); }
    catch { throw new Error("DELETION_LEDGER_CORRUPT"); }
    if (entry?.version !== 1 || !["import", "source"].includes(entry.kind) ||
        !validHash(entry.keyHash) || entry.previousHash !== previousHash ||
        !validHash(entry.digest) || Object.keys(entry).length !== 5 ||
        digest(JSON.stringify({ version: 1, kind: entry.kind,
          keyHash: entry.keyHash, previousHash })) !== entry.digest) {
      throw new Error("DELETION_LEDGER_CORRUPT");
    }
    records.push(entry);
    previousHash = entry.digest;
  }
  return records;
}

export function createDeletionLedger({ filePath, fsApi = fs }) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new TypeError("filePath is required");

  async function read() {
    try { return decodeLedger(await fsApi.readFile(filePath, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function assertSafe(state) {
    try { await fsApi.stat(filePath); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (deletionKeys(state).size) throw new Error("DELETION_LEDGER_MISSING");
    }
    const expected = await read();
    const active = new Set(activeRecords(state).map((item) => `${item.kind}:${item.keyHash}`));
    const resurrected = expected.filter((entry) => active.has(`${entry.kind}:${entry.keyHash}`));
    if (resurrected.length) throw new Error(`DELETION_LEDGER_RESTORE_UNSAFE: ${resurrected.length}`);
  }

  async function pending(state) {
    await fsApi.stat(filePath);
    const expected = new Set((await read()).map((entry) => `${entry.kind}:${entry.keyHash}`));
    return activeRecords(state).filter((item) => expected.has(`${item.kind}:${item.keyHash}`))
      .map(({ kind, ownerId, id }) => ({ kind, ownerId, id }));
  }

  async function recordTransitions(before, after) {
    const prior = deletionKeys(before);
    const newKeys = [...deletionKeys(after)].filter((key) => !prior.has(key)).sort();
    if (!newKeys.length) return;
    const records = await read();
    let previousHash = records.at(-1)?.digest ?? "0".repeat(64);
    const lines = newKeys.map((key) => {
      const separator = key.indexOf(":");
      const body = { version: 1, kind: key.slice(0, separator),
        keyHash: key.slice(separator + 1), previousHash };
      const entry = { ...body, digest: digest(JSON.stringify(body)) };
      previousHash = entry.digest;
      return JSON.stringify(entry);
    }).join("\n") + "\n";
    const folder = dirname(filePath);
    await fsApi.mkdir(folder, { recursive: true, mode: 0o700 });
    const handle = await fsApi.open(filePath, "a", 0o600);
    try {
      await handle.writeFile(lines, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    const directory = await fsApi.open(folder, "r");
    try { await directory.sync(); }
    finally { await directory.close(); }
  }

  async function bootstrap(trustedState) {
    const folder = dirname(filePath);
    await fsApi.mkdir(folder, { recursive: true, mode: 0o700 });
    const handle = await fsApi.open(filePath, "wx", 0o600);
    try { await handle.sync(); }
    finally { await handle.close(); }
    await recordTransitions({ importReceipts: {}, knowledge: { sources: [] } }, trustedState);
    await assertSafe(trustedState);
    return (await read()).length;
  }

  return { read, assertSafe, pending, recordTransitions, bootstrap };
}
