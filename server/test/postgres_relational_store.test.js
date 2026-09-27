import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createCommonKernelState } from "../src/common/kernel_service.js";
import { domainRegistry } from "../src/domains/index.js";
import { applyKnowledgeCommand } from "../src/knowledge/index.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";

const NOW = "2026-09-27T09:00:00Z";

async function database() {
  const db = await PGlite.create();
  for (const name of ["001_common_kernel", "002_kernel_state",
    "003_relational_knowledge"]) {
    const sql = await readFile(fileURLToPath(new URL(
      `../migrations/${name}.sql`, import.meta.url)), "utf8");
    await db.exec(sql);
  }
  return { db, pool: {
    query(sql, params) { return db.query(sql, params); },
    async connect() { return {
      query(sql, params) { return db.query(sql, params); },
      release() {},
    }; },
  } };
}

function crossScenarioState() {
  const state = createCommonKernelState();
  let command = 0;
  const apply = (type, payload) => {
    state.knowledge = applyKnowledgeCommand(state.knowledge, {
      ownerId: "alice", commandId: `graph-${++command}`, type, payload,
    }, { predicates: domainRegistry.listRelations(), now: NOW }).state;
  };
  apply("source.create", { id: "shared-capture", kind: "user_note",
    title: "레시피와 뷰티를 함께 보관한 캡처" });
  apply("source.version.add", { id: "capture-v1", sourceId: "shared-capture",
    contentHash: "hash-v1", content: { screen: "two topics" },
    capturedAt: NOW });
  apply("evidence.add", { id: "recipe-evidence", sourceVersionId: "capture-v1",
    locator: { region: "upper" }, quote: "레시피 단계" });
  apply("evidence.add", { id: "beauty-evidence", sourceVersionId: "capture-v1",
    locator: { region: "lower" }, quote: "뷰티 단계" });
  apply("entity.create", { id: "recipe", type: "recipe.recipe", label: "요리" });
  apply("entity.create", { id: "recipe-step", type: "recipe.step", label: "굽기" });
  apply("entity.create", { id: "routine", type: "beauty.routine_template",
    label: "아침 루틴" });
  apply("entity.create", { id: "beauty-step", type: "beauty.routine_step",
    label: "세안" });
  apply("mention.create", { id: "beauty-mention", sourceVersionId: "capture-v1",
    text: "아침 루틴", entityType: "beauty.routine_template",
    evidenceIds: ["beauty-evidence"] });
  apply("identity.propose", { id: "beauty-identity", mentionId: "beauty-mention",
    entityId: "routine", evidenceIds: ["beauty-evidence"] });
  apply("identity.accept", { decisionId: "beauty-identity",
    expectedRevision: 1 });
  const common = { scope: { type: "activity", id: "cross-domain" },
    origin: "user_reported", assertedBy: { type: "user", id: "alice" },
    observedAt: NOW };
  apply("assertion.add", { ...common, id: "recipe-link", subjectId: "recipe",
    predicate: "recipe.has_step", objectEntityId: "recipe-step",
    evidenceIds: ["recipe-evidence"] });
  apply("assertion.add", { ...common, id: "beauty-link", subjectId: "routine",
    predicate: "beauty.has_step", objectEntityId: "beauty-step",
    evidenceIds: ["beauty-evidence"] });
  return state;
}

test("relational store migrates a shared recipe and beauty graph without duplicating it in JSONB", async () => {
  const { db, pool } = await database();
  try {
    const original = crossScenarioState();
    await db.query(`INSERT INTO luffi_kernel_state (id, revision, payload)
      VALUES ($1, 1, $2::jsonb)`, ["common-kernel", JSON.stringify(original)]);
    const store = createPostgresRelationalStore({ pool,
      initialState: createCommonKernelState });
    await store.ready();
    const snapshot = await store.snapshot();
    assert.deepEqual(snapshot.knowledge, original.knowledge);
    const payload = (await db.query("SELECT payload FROM luffi_kernel_state"))
      .rows[0].payload;
    assert.equal(payload.graphStorageVersion, 1);
    assert.equal(Object.hasOwn(payload.knowledge, "assertions"), false);
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM luffi_assertion"))
      .rows[0].n, 2);
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM luffi_assertion_evidence"))
      .rows[0].n, 2);
    assert.deepEqual((await db.query("SELECT predicate FROM luffi_assertion ORDER BY id"))
      .rows.map((row) => row.predicate), ["beauty.has_step", "recipe.has_step"]);
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM luffi_identity_decision"))
      .rows[0].n, 1);
    const reopen = createPostgresRelationalStore({ pool,
      initialState: createCommonKernelState });
    assert.deepEqual((await reopen.snapshot()).knowledge, original.knowledge);
    const row = (await db.query("SELECT record FROM luffi_entity WHERE id = 'recipe'"))
      .rows[0].record;
    await db.query(`UPDATE luffi_entity SET record = $1::jsonb
      WHERE id = 'recipe'`, [JSON.stringify({ ...row, label: "tampered" })]);
    await assert.rejects(store.snapshot(), /relational columns disagree|graph does not match/);
  } finally { await db.close(); }
});

test("relational graph and kernel receipts roll back together on a broken foreign key", async () => {
  const { db, pool } = await database();
  try {
    const store = createPostgresRelationalStore({ pool,
      initialState: createCommonKernelState });
    await store.ready();
    const original = crossScenarioState();
    await store.transact((state) => {
      state.knowledge = original.knowledge;
      state.shoppingCommandReceipts["alice:one"] = { hash: "one" };
      return { state, result: null };
    });
    await assert.rejects(store.transact((state) => {
      state.knowledge.assertions.push({ ...state.knowledge.assertions[0],
        id: "broken-link", objectEntityId: "missing-entity" });
      state.shoppingCommandReceipts["alice:two"] = { hash: "two" };
      return { state, result: null };
    }), /foreign key|violates|constraint/i);
    const restored = await store.snapshot();
    assert.equal(restored.knowledge.assertions.length, 2);
    assert.equal(restored.shoppingCommandReceipts["alice:one"].hash, "one");
    assert.equal(restored.shoppingCommandReceipts["alice:two"], undefined);
  } finally { await db.close(); }
});

test("relational recipe correction and identity replacement preserve history before source redaction", async () => {
  const { db, pool } = await database();
  try {
    const store = createPostgresRelationalStore({ pool,
      initialState: crossScenarioState });
    await store.ready();
    const change = async (commands) => store.transact((state) => {
      for (const [commandId, type, payload] of commands) {
        state.knowledge = applyKnowledgeCommand(state.knowledge, {
          ownerId: "alice", commandId, type, payload,
        }, { predicates: domainRegistry.listRelations(), now: NOW }).state;
      }
      return { state, result: null };
    });
    await change([
      ["step-v2", "entity.create", { id: "recipe-step-v2",
        type: "recipe.step", label: "다시 굽기" }],
      ["correct-link", "assertion.correct", { assertionId: "recipe-link",
        expectedRevision: 1, assertion: { id: "recipe-link-v2",
          subjectId: "recipe", predicate: "recipe.has_step",
          objectEntityId: "recipe-step-v2",
          scope: { type: "activity", id: "cross-domain" },
          origin: "user_reported", assertedBy: { type: "user", id: "alice" },
          evidenceIds: ["recipe-evidence"], observedAt: NOW } }],
      ["identity-v2", "identity.propose", { id: "beauty-identity-v2",
        mentionId: "beauty-mention", entityId: "routine",
        evidenceIds: ["beauty-evidence"] }],
      ["accept-identity-v2", "identity.accept", {
        decisionId: "beauty-identity-v2", expectedRevision: 1,
        replacesDecisionId: "beauty-identity" }],
    ]);
    const corrected = await store.snapshot();
    assert.equal(corrected.knowledge.assertions.find((item) =>
      item.id === "recipe-link").status, "corrected");
    assert.equal(corrected.knowledge.assertions.find((item) =>
      item.id === "recipe-link-v2").supersedesId, "recipe-link");
    assert.equal((await db.query(`SELECT count(*)::integer AS n FROM
      luffi_identity_decision WHERE status = 'accepted'`)).rows[0].n, 1);
    await change([["erase-shared", "source.delete", {
      sourceId: "shared-capture" }]]);
    const redacted = await store.snapshot();
    assert.equal(redacted.knowledge.assertions.find((item) =>
      item.id === "recipe-link-v2").status, "invalidated");
    assert.equal(redacted.knowledge.sourceVersions[0].content, null);
    assert.equal((await db.query(`SELECT content FROM luffi_source_version
      WHERE id = 'capture-v1'`)).rows[0].content, null);
    assert.equal((await db.query(`SELECT object_entity_id FROM luffi_assertion
      WHERE id = 'recipe-link-v2'`)).rows[0].object_entity_id, null);
  } finally { await db.close(); }
});
