import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { createCommonKernelService, createCommonKernelState } from "../src/common/kernel_service.js";
import { domainRegistry } from "../src/domains/index.js";
import { applyKnowledgeCommand } from "../src/knowledge/index.js";
import { createPostgresRelationalStore } from "../src/storage/postgres_relational_store.js";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";

const run = promisify(execFile);
const databaseUrl = process.env.LUFFI_TEST_POSTGRES_URL;

function legacySnapshot() {
  const state = createCommonKernelState();
  const now = "2026-09-27T09:00:00Z";
  let sequence = 0;
  const apply = (type, payload) => {
    state.knowledge = applyKnowledgeCommand(state.knowledge, {
      ownerId: "integration-user", commandId: `seed-${++sequence}`,
      type, payload,
    }, { predicates: domainRegistry.listRelations(), now }).state;
  };
  apply("source.create", { id: "legacy-source", kind: "user_note",
    title: "이관할 메모" });
  apply("source.version.add", { id: "legacy-version", sourceId: "legacy-source",
    contentHash: "legacy-hash", content: { title: "이관할 메모" },
    capturedAt: now });
  apply("evidence.add", { id: "legacy-evidence", sourceVersionId: "legacy-version",
    quote: "이관할 메모", locator: { kind: "text" } });
  apply("entity.create", { id: "legacy-recipe", type: "recipe.recipe",
    label: "레시피" });
  apply("entity.create", { id: "legacy-step", type: "recipe.step",
    label: "단계" });
  apply("assertion.add", { id: "legacy-step-link", subjectId: "legacy-recipe",
    predicate: "recipe.has_step", objectEntityId: "legacy-step",
    scope: { type: "activity", id: "legacy-board" }, origin: "user_reported",
    assertedBy: { type: "user", id: "integration-user" },
    evidenceIds: ["legacy-evidence"], observedAt: now });
  return state;
}

test("real PostgreSQL migrates, imports, serializes concurrent writes, and rolls back graph failures",
  { skip: !databaseUrl && "Set LUFFI_TEST_POSTGRES_URL to run against PostgreSQL" },
  async () => {
    const schema = `luffi_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: databaseUrl,
      connectionTimeoutMillis: 5000 });
    const folder = await mkdtemp(join(tmpdir(), "luffi-pg-integration-"));
    const path = join(folder, "legacy.json");
    let pool;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const env = { ...process.env, LUFFI_KERNEL_DATABASE_URL: databaseUrl,
        PGOPTIONS: `-c search_path=${schema}` };
      await run(process.execPath, [fileURLToPath(new URL(
        "../scripts/migrate-kernel-state.mjs", import.meta.url))], { env });
      const legacy = legacySnapshot();
      await writeFile(path, JSON.stringify(legacy));
      await run(process.execPath, [fileURLToPath(new URL(
        "../scripts/import-kernel-json.mjs", import.meta.url)), path], { env });
      pool = new pg.Pool({ connectionString: databaseUrl,
        options: `-c search_path=${schema}`, max: 4 });
      const first = createPostgresRelationalStore({ pool,
        initialState: createCommonKernelState });
      await first.ready();
      assert.deepEqual((await first.snapshot()).knowledge, legacy.knowledge);
      const payload = (await pool.query("SELECT payload FROM luffi_kernel_state"))
        .rows[0].payload;
      assert.equal(Object.hasOwn(payload.knowledge, "assertions"), false);
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM luffi_assertion"))
        .rows[0].n, 1);

      const second = createPostgresRelationalStore({ pool,
        initialState: createCommonKernelState });
      await Promise.all([first, second].map((store) => store.transact((state) => {
        state.shoppingCommandReceipts["integration:counter"] =
          (state.shoppingCommandReceipts["integration:counter"] ?? 0) + 1;
        return { state, result: null };
      })));
      assert.equal((await second.snapshot()).shoppingCommandReceipts
        ["integration:counter"], 2);

      await assert.rejects(first.transact((state) => {
        state.knowledge.assertions.push({ ...state.knowledge.assertions[0],
          id: "broken-foreign-key", objectEntityId: "missing-entity" });
        state.shoppingCommandReceipts["integration:failed"] = true;
        return { state, result: null };
      }), /foreign key|violates|constraint/i);
      const reopened = createPostgresRelationalStore({ pool,
        initialState: createCommonKernelState });
      const restored = await reopened.snapshot();
      assert.equal(restored.knowledge.assertions.length, 1);
      assert.equal(restored.shoppingCommandReceipts["integration:failed"], undefined);
      assert.equal(restored.shoppingCommandReceipts["integration:counter"], 2);

      const fashion = createCommonKernelService({ ownerId: "integration-fashion-user",
        store: reopened });
      for (const [importId, fixture] of [
        ["pg-blazer", "fashion_a_blazer_live_analysis.json"],
        ["pg-trousers", "fashion_b_trousers_live_analysis.json"],
      ]) {
        const analysis = JSON.parse(await readFile(fileURLToPath(new URL(
          `./fixtures/${fixture}`, import.meta.url)), "utf8"));
        await fashion.importReviewedCapture({ importId, reviewed: true,
          reviewedAt: "2026-09-27T09:00:00Z",
          capture: { id: importId, asset: { status: "unavailable" } }, analysis });
      }
      const created = await fashion.createFashionScenario({ commandId: "pg-create-outfit",
        activityId: "pg-outfit", confirmed: true,
        importIds: ["pg-blazer", "pg-trousers"], occasion: "검증용 모임",
        scheduledAt: "2026-09-28T18:00:00+09:00" });
      await fashion.acceptProposal({ proposalId: created.proposalId,
        commandId: "pg-approve-outfit" });
      const board = await fashion.getBoard("pg-outfit");
      await fashion.confirmFashionOutfit({ commandId: "pg-confirm-outfit",
        activityId: "pg-outfit", expectedRevision: board.revision,
        selections: [
          { importId: "pg-blazer", slot: "outerwear", color: "차콜",
            size: "M", ownership: "candidate" },
          { importId: "pg-trousers", slot: "bottom", color: "베이지",
            size: "30", ownership: "owned" },
        ] });
      const editable = await fashion.getEditableFashionOutfit("pg-outfit");
      await fashion.correctFashionOutfit({ commandId: "pg-change-option",
        activityId: "pg-outfit", expectedGraphFingerprint: editable.graphFingerprint,
        confirmed: true, items: editable.items.map((item, index) => ({
          variantId: item.variantId, slot: item.slot, ownership: item.ownership,
          color: index === 0 ? "검정" : item.color,
          size: index === 0 ? "L" : item.size })) });
      const afterRestart = createCommonKernelService({ ownerId: "integration-fashion-user",
        store: createPostgresRelationalStore({ pool,
          initialState: createCommonKernelState }) });
      const current = await afterRestart.getEditableFashionOutfit("pg-outfit");
      assert.notEqual(current.items[0].variantId, editable.items[0].variantId);
      assert.deepEqual([current.items[0].color, current.items[0].size], ["검정", "L"]);
      assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM luffi_assertion
        WHERE owner_id = $1 AND scope_id = $2 AND predicate = 'fashion.line_variant'
          AND status = 'active'`, ["integration-fashion-user", "pg-outfit"]))
        .rows[0].n, 2);
    } finally {
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      await rm(folder, { recursive: true, force: true });
    }
  });

test("real PostgreSQL preserves an image-backed recipe-shopping link across restart and isolates source deletion",
  { skip: !databaseUrl && "Set LUFFI_TEST_POSTGRES_URL to run against PostgreSQL" },
  async () => {
    const schema = `luffi_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: databaseUrl,
      connectionTimeoutMillis: 5000 });
    let pool;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const env = { ...process.env, LUFFI_KERNEL_DATABASE_URL: databaseUrl,
        PGOPTIONS: `-c search_path=${schema}` };
      await run(process.execPath, [fileURLToPath(new URL(
        "../scripts/migrate-kernel-state.mjs", import.meta.url))], { env });
      pool = new pg.Pool({ connectionString: databaseUrl,
        options: `-c search_path=${schema}`, max: 4 });
      const store = createPostgresRelationalStore({ pool,
        initialState: createCommonKernelState });
      await store.ready();
      const ownerId = "integration-recipe-shopping-user";
      const service = createCommonKernelService({ ownerId, store });
      const captures = [
        ["pg-recipe", "variation_recipe_tofu_egg_as_needed",
          "4ee2de07ece75c1a7b467430701efbc19e1775584738147bd427ab0129baf47e"],
        ["pg-tofu", "variation_shopping_tofu_ingredient",
          "7a87bb882a641e8a344ce59750f7b34d9c4842d659f6ed91898b856d8602c442"],
      ];
      for (const [importId, name, expectedHash] of captures) {
        const png = await readFile(fileURLToPath(new URL(
          `./fixtures/${name}.png`, import.meta.url)));
        assert.equal(createHash("sha256").update(png).digest("hex"), expectedHash);
        const analysis = JSON.parse(await readFile(fileURLToPath(new URL(
          `./fixtures/${name}_live_analysis.json`, import.meta.url)), "utf8"));
        validateLegacyAnalysis(analysis);
        await service.importReviewedCapture({ importId, reviewed: true,
          reviewedAt: "2026-09-27T09:00:00Z",
          capture: { id: name, asset: { status: "unavailable" } }, analysis });
      }

      const recipe = await service.createRecipeScenario({ commandId: "pg-create-recipe",
        activityId: "pg-recipe-board", confirmed: true, importId: "pg-recipe",
        targetServings: 4, inventory: [],
        recipe: { id: "tofu-egg", revision: 1, title: "두부 달걀 볶음",
          baseServings: 2, ingredients: [
            { id: "tofu", ingredientId: "tofu", name: "두부",
              quantity: { status: "known", amount: 300, unit: "g" },
              scaling: "linear" },
            { id: "egg", ingredientId: "egg", name: "달걀",
              quantity: { status: "known", amount: 2, unit: "count" },
              scaling: "linear" },
            { id: "salt", ingredientId: "salt", name: "소금",
              quantity: { status: "as_needed" }, scaling: "fixed" },
          ] } });
      await service.acceptProposal({ proposalId: recipe.proposalId,
        commandId: "pg-approve-recipe" });
      let recipeBoard = await service.getBoard("pg-recipe-board");
      await service.runTask({ commandId: "pg-scale-recipe",
        activityId: recipeBoard.id, taskId: "scale_servings",
        expectedRevision: recipeBoard.revision });
      recipeBoard = await service.getBoard(recipeBoard.id);
      await service.activityCommand({ commandId: "pg-empty-inventory",
        type: "task.recordResult", activityId: recipeBoard.id,
        expectedRevision: recipeBoard.revision,
        payload: { taskId: "check_inventory", value: [] } });
      recipeBoard = await service.getBoard(recipeBoard.id);
      await service.activityCommand({ commandId: "pg-finish-inventory",
        type: "task.transition", activityId: recipeBoard.id,
        expectedRevision: recipeBoard.revision,
        payload: { taskId: "check_inventory", to: "completed" } });
      recipeBoard = await service.getBoard(recipeBoard.id);
      await service.runTask({ commandId: "pg-calculate-needs",
        activityId: recipeBoard.id, taskId: "calculate_requirements",
        expectedRevision: recipeBoard.revision });

      const shopping = await service.createShoppingScenario({ commandId: "pg-create-shopping",
        activityId: "pg-shopping-board", confirmed: true, importIds: ["pg-tofu"],
        purpose: "두부 달걀 볶음 재료 고르기" });
      await service.acceptProposal({ proposalId: shopping.proposalId,
        commandId: "pg-approve-shopping" });
      let shoppingBoard = await service.getBoard("pg-shopping-board");
      await service.confirmShoppingChoice({ commandId: "pg-choose-tofu",
        activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
        selectedImportId: "pg-tofu", quantity: 1 });
      shoppingBoard = await service.getBoard(shoppingBoard.id);
      await service.recordShoppingPurchaseOutcome({ commandId: "pg-not-purchased",
        activityId: shoppingBoard.id, expectedRevision: shoppingBoard.revision,
        status: "not_purchased" });
      recipeBoard = await service.getBoard(recipeBoard.id);
      shoppingBoard = await service.getBoard(shoppingBoard.id);
      await service.createScenarioConnection({ commandId: "pg-link-recipe-shopping",
        fromActivityId: recipeBoard.id, toActivityId: shoppingBoard.id,
        kind: "recipe_shopping", confirmed: true,
        expectedFromRevision: recipeBoard.revision,
        expectedToRevision: shoppingBoard.revision });

      const restarted = createCommonKernelService({ ownerId,
        store: createPostgresRelationalStore({ pool,
          initialState: createCommonKernelState }) });
      const needs = (await restarted.listScenarioConnections("pg-shopping-board"))
        .connections[0].recipeNeeds;
      assert.equal(needs.status, "ready");
      assert.deepEqual(needs.items.map((item) => [item.name, item.requiredQuantity,
        item.missingQuantity]), [
        ["두부", { status: "known", amount: 600, unit: "g" }, { status: "unknown" }],
        ["달걀", { status: "known", amount: 4, unit: "count" }, { status: "unknown" }],
        ["소금", { status: "as_needed" }, { status: "as_needed" }],
      ]);
      const countActive = async (predicate) => (await pool.query(
        `SELECT count(*)::integer AS n FROM luffi_assertion
         WHERE owner_id = $1 AND predicate = $2 AND status = 'active'`,
        [ownerId, predicate])).rows[0].n;
      assert.equal(await countActive("scenario.connection_to_subject"), 1);
      assert.equal(await countActive("shopping.purchase_for_choice"), 0);
      assert.equal(await countActive("shopping.choice_offer"), 1);

      await restarted.deleteReviewedCapture({ importId: "pg-recipe",
        commandId: "pg-delete-recipe-image" });
      const afterDeletion = createCommonKernelService({ ownerId,
        store: createPostgresRelationalStore({ pool,
          initialState: createCommonKernelState }) });
      await assert.rejects(afterDeletion.getBoard("pg-recipe-board"),
        (error) => error.code === "NOT_FOUND");
      assert.equal((await afterDeletion.getBoard("pg-shopping-board")).id,
        "pg-shopping-board");
      assert.deepEqual((await afterDeletion.listScenarioConnections("pg-shopping-board"))
        .connections, []);
      assert.equal(await countActive("scenario.connection_to_subject"), 0);
      assert.equal(await countActive("shopping.choice_offer"), 1);
    } finally {
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
