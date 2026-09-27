import { createHash } from "node:crypto";
import { assertSerializableState } from "./json_state_store.js";

const GRAPH = [
  { key: "sources", table: "luffi_source", columns: {
    kind: (r) => r.kind, title: (r) => r.title, provenance: (r) => r.provenance,
    status: (r) => r.status, revision: (r) => r.revision,
    created_at: (r) => r.createdAt, deleted_at: (r) => r.deletedAt,
  }, json: ["provenance"] },
  { key: "sourceVersions", table: "luffi_source_version", columns: {
    source_id: (r) => r.sourceId, content_hash: (r) => r.contentHash,
    content: (r) => r.content, asset: (r) => r.asset,
    captured_at: (r) => r.capturedAt, status: (r) => r.status,
    revision: (r) => r.revision, created_at: (r) => r.createdAt,
    deleted_at: (r) => r.deletedAt,
  }, json: ["content", "asset"] },
  { key: "evidence", table: "luffi_evidence", columns: {
    source_version_id: (r) => r.sourceVersionId, locator: (r) => r.locator,
    quote: (r) => r.quote, status: (r) => r.status,
    revision: (r) => r.revision, created_at: (r) => r.createdAt,
    deleted_at: (r) => r.deletedAt,
  }, json: ["locator"] },
  { key: "entities", table: "luffi_entity", columns: {
    type_id: (r) => r.type, label: (r) => r.label,
    external_ids: (r) => r.externalIds, status: (r) => r.status,
    revision: (r) => r.revision, created_at: (r) => r.createdAt,
  }, json: ["external_ids"] },
  { key: "entityMentions", table: "luffi_entity_mention", columns: {
    source_version_id: (r) => r.sourceVersionId, surface_text: (r) => r.text,
    entity_type_id: (r) => r.entityType, status: (r) => r.status,
    revision: (r) => r.revision, created_at: (r) => r.createdAt,
  }, links: { table: "luffi_mention_evidence", parent: "mention_id",
    values: (r) => r.evidenceIds.map((id) => [id]) } },
  { key: "identityDecisions", table: "luffi_identity_decision", columns: {
    mention_id: (r) => r.mentionId, entity_id: (r) => r.entityId,
    status: (r) => r.status, reason: (r) => r.reason,
    revision: (r) => r.revision, created_at: (r) => r.createdAt,
    accepted_at: (r) => r.acceptedAt, retracted_at: (r) => r.retractedAt,
    superseded_at: (r) => r.supersededAt,
    invalidated_at: (r) => r.invalidatedAt,
  }, links: { table: "luffi_identity_evidence", parent: "decision_id",
    values: (r) => r.evidenceIds.map((id) => [id]) } },
  { key: "assertions", table: "luffi_assertion", columns: {
    subject_id: (r) => r.subjectId,
    subject_mention_id: (r) => r.subjectMentionId,
    identity_decision_id: (r) => r.identityDecisionId,
    predicate: (r) => r.predicate,
    object_entity_id: (r) => r.objectEntityId,
    typed_value: (r) => r.typedValue,
    scope_type: (r) => r.scope.type, scope_id: (r) => r.scope.id,
    origin: (r) => r.origin, asserted_by: (r) => r.assertedBy,
    observed_at: (r) => r.observedAt, valid_from: (r) => r.validFrom,
    valid_to: (r) => r.validTo, refresh_due_at: (r) => r.refreshDueAt,
    recorded_at: (r) => r.recordedAt, status: (r) => r.status,
    supersedes_id: (r) => r.supersedesId, revision: (r) => r.revision,
  }, json: ["typed_value", "asserted_by"], links: {
    table: "luffi_assertion_evidence", parent: "assertion_id",
    values: (r) => r.supportSets.flatMap((set, group) =>
      set.map((id) => [id, group])),
  } },
];

const GRAPH_KEYS = GRAPH.map((item) => item.key);
const recordKey = (record) => `${record.ownerId}\0${record.id}`;
const sqlValue = (value, json) => value == null ? null : json
  ? JSON.stringify(value) : value;
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) =>
      [key, canonical(value[key])]))
    : value;
function graphDigest(graph) {
  const records = Object.fromEntries(GRAPH_KEYS.map((key) => [key, graph[key]]));
  return createHash("sha256").update(JSON.stringify(canonical(records)))
    .digest("hex");
}
function columnMatches(actual, expected, name, json) {
  if (actual == null || expected == null) return actual == null && expected == null;
  if (json) return JSON.stringify(canonical(actual)) ===
    JSON.stringify(canonical(expected));
  if (name.endsWith("_at")) return (actual instanceof Date
    ? actual.getTime() : Date.parse(actual)) === Date.parse(expected);
  if (typeof expected === "number") return Number(actual) === expected;
  return actual === expected;
}

function graphless(state) {
  const payload = structuredClone(state);
  payload.graphStorageVersion = 1;
  payload.graphDigest = graphDigest(state.knowledge);
  for (const key of GRAPH_KEYS) delete payload.knowledge[key];
  return payload;
}

function emptyGraph() {
  return Object.fromEntries(GRAPH_KEYS.map((key) => [key, []]));
}

async function loadGraph(client) {
  const graph = {};
  for (const item of GRAPH) {
    const result = await client.query(
      `SELECT * FROM ${item.table} ORDER BY position, owner_id, id`);
    if (result.rows.some((row) => !row.record)) {
      throw new Error(`unmigrated ${item.table} row without a record`);
    }
    graph[item.key] = result.rows.map((row, position) => {
      const record = row.record;
      const mismatched = Object.entries(item.columns).find(([name, read]) =>
        !columnMatches(row[name], read(record), name,
          item.json?.includes(name)));
      if (record.ownerId !== row.owner_id || record.id !== row.id ||
          Number(row.position) !== position || mismatched) {
        throw new Error(`relational columns disagree with ${item.table} record${
          mismatched ? ` (${mismatched[0]})` : ""}`);
      }
      return record;
    });
    if (item.links) {
      const { table, parent, values } = item.links;
      const result = await client.query(`SELECT owner_id, ${parent}, evidence_id${
        item.key === "assertions" ? ", support_group" : ""} FROM ${table}`);
      const encode = (row) => JSON.stringify([
        row.owner_id, row[parent], row.evidence_id,
        ...(item.key === "assertions" ? [Number(row.support_group)] : [])]);
      const actual = result.rows.map(encode).sort();
      const expected = graph[item.key].flatMap((record) =>
        values(record).map((entry) => encode({ owner_id: record.ownerId,
          [parent]: record.id, evidence_id: entry[0],
          support_group: entry[1] }))).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`relational links disagree with ${table} records`);
      }
    }
  }
  return graph;
}

async function writeLinks(client, item, record) {
  if (!item.links) return;
  const { table, parent, values } = item.links;
  await client.query(`DELETE FROM ${table} WHERE owner_id = $1 AND ${parent} = $2`,
    [record.ownerId, record.id]);
  for (const entry of values(record)) {
    const columns = ["owner_id", parent, "evidence_id",
      ...(entry.length > 1 ? ["support_group"] : [])];
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, index) =>
        `$${index + 1}`).join(", ")})`,
      [record.ownerId, record.id, ...entry]);
  }
}

async function writeRecord(client, item, record, position) {
  const fields = ["owner_id", "id", ...Object.keys(item.columns), "record", "position"];
  const values = [record.ownerId, record.id,
    ...Object.entries(item.columns).map(([name, read]) =>
      sqlValue(read(record), item.json?.includes(name))),
    JSON.stringify(record), position];
  const jsonFields = new Set([...(item.json ?? []), "record"]);
  const placeholders = fields.map((name, index) =>
    `$${index + 1}${jsonFields.has(name) ? "::jsonb" : ""}`);
  const updates = fields.slice(2).map((name) => `${name} = EXCLUDED.${name}`);
  await client.query(
    `INSERT INTO ${item.table} (${fields.join(", ")})
     VALUES (${placeholders.join(", ")})
     ON CONFLICT (owner_id, id) DO UPDATE SET ${updates.join(", ")}`,
    values);
  await writeLinks(client, item, record);
}

async function writeGraph(client, before, after) {
  for (const item of GRAPH) {
    const oldRecords = before[item.key] ?? [];
    const newRecords = after[item.key] ?? [];
    const previous = new Map(oldRecords.map((record, position) =>
      [recordKey(record), { record, position }]));
    const nextKeys = new Set(newRecords.map(recordKey));
    if (nextKeys.size !== newRecords.length || oldRecords.some((record) =>
      !nextKeys.has(recordKey(record)))) {
      throw new Error(`graph records cannot be removed or duplicated: ${item.key}`);
    }
    // Update existing decisions before inserting a replacement accepted identity;
    // the database permits only one accepted decision per mention.
    const changed = newRecords.map((record, position) => ({ record, position,
      old: previous.get(recordKey(record)) })).filter(({ record, position, old }) =>
      !old || old.position !== position ||
        JSON.stringify(old.record) !== JSON.stringify(record));
    for (const entry of changed.filter((value) => value.old)) {
      await writeRecord(client, item, entry.record, entry.position);
    }
    for (const entry of changed.filter((value) => !value.old)) {
      await writeRecord(client, item, entry.record, entry.position);
    }
  }
}

// Knowledge records are canonical in FK-backed rows. The single kernel row now
// keeps only non-graph state and knowledge metadata (sequence, events, receipts,
// subscriptions), so existing domain logic can retain its snapshot contract.
export function createPostgresRelationalStore({ pool, initialState,
  stateId = "common-kernel", deletionLedger = null }) {
  if (!pool || typeof pool.connect !== "function" ||
      typeof pool.query !== "function") throw new TypeError("pool is required");
  if (typeof initialState !== "function") {
    throw new TypeError("initialState must be a function");
  }
  if (stateId !== "common-kernel") {
    throw new TypeError("relational graph storage requires the common-kernel state ID");
  }
  const initial = initialState();
  assertSerializableState(initial);

  async function transaction(change) {
    const client = await pool.connect();
    let begun = false;
    let broken = false;
    try {
      await client.query("BEGIN");
      begun = true;
      await client.query(
        `INSERT INTO luffi_kernel_state (id, revision, payload)
         VALUES ($1, 1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
        [stateId, JSON.stringify(initial)]);
      const found = await client.query(
        "SELECT revision, payload FROM luffi_kernel_state WHERE id = $1 FOR UPDATE",
        [stateId]);
      if (found.rows.length !== 1) throw new Error("kernel state row is missing");
      const payload = found.rows[0].payload;
      assertSerializableState(payload);
      const legacy = payload.graphStorageVersion !== 1;
      if (legacy) {
        if (GRAPH_KEYS.some((key) => !Array.isArray(payload.knowledge?.[key]))) {
          throw new Error("legacy kernel state is missing graph arrays");
        }
        const existing = await loadGraph(client);
        if (GRAPH_KEYS.some((key) => existing[key].length)) {
          throw new Error("legacy graph cannot be imported into nonempty relational tables");
        }
      }
      const graph = legacy
        ? Object.fromEntries(GRAPH_KEYS.map((key) => [key,
          payload.knowledge[key] ?? []]))
        : await loadGraph(client);
      if (!legacy && payload.graphDigest !== graphDigest(graph)) {
        throw new Error("relational graph does not match the kernel state digest");
      }
      const original = { ...payload, knowledge: { ...payload.knowledge, ...graph } };
      assertSerializableState(original);
      if (deletionLedger) await deletionLedger.assertSafe(original);
      const outcome = await change(structuredClone(original));
      if (!outcome || typeof outcome !== "object" || !("state" in outcome)) {
        throw new TypeError("transaction must return {state, result}");
      }
      assertSerializableState(outcome.state);
      const changed = legacy || JSON.stringify(original) !==
        JSON.stringify(outcome.state);
      if (changed) {
        if (deletionLedger) await deletionLedger.recordTransitions(original, outcome.state);
        if (deletionLedger) await deletionLedger.assertSafe(outcome.state);
        await writeGraph(client, legacy ? emptyGraph() : graph,
          outcome.state.knowledge);
        await client.query(
          `UPDATE luffi_kernel_state SET payload = $2::jsonb,
           revision = revision + 1, updated_at = now() WHERE id = $1`,
          [stateId, JSON.stringify(graphless(outcome.state))]);
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
      await pool.query("SELECT record FROM luffi_source LIMIT 0");
      await transaction(async (state) => ({ state, result: null }));
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
