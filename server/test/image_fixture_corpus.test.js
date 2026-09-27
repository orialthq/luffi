import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateLegacyAnalysis } from "../src/ingestion/index.js";
import { validateAnalyzeRequest } from "../src/request_validation.js";

// Reviewed recordings from /v1/analyze. Keep this inventory explicit so a new
// image cannot silently enter the public corpus without a checked response.
const corpus = [
  ["beauty_a_cleanser", "114e7964624233360d5e46a97ca825383737e9c193efa46a044a7ae9c8c17dda", "beauty_product", "데일리 클렌징 젤"],
  ["beauty_b_moisturizer", "ca30083dc64a5f3dcc2dca95ad7b8b894d189e27508fc7d8e5d84f2f81b0944a", "beauty_product", "수분 장벽 크림"],
  ["dining_a_seongsu", "deb96a44db7455330d1bdff63ff77d21b0b89eaa6e244f145970e4b7b223d11b", "place", "모퉁이식당 성수점"],
  ["dining_b_yeonnam", "a74f847027b5ed15f66bafafa88de22045776d20538bda497d1ee3e9cda99955", "place", "모퉁이식당 연남점"],
  ["dining_c_seongsu", "0769efeb768dbf6095ed6a03a337d26e0f96a7c08c32248253ae98820520cbcd", "place", "모퉁이식당 성수점"],
  ["dining_d_noodles", "eeec1579bc1acf6e7d212629b7f160b9689e3c6cf8f28f62d7fe8ea2db19732e", "place", "성수국수집"],
  ["fashion_a_blazer", "33a5db2639a0125196de6ccfb64cd668c8d5066eceeffe8676303a14e423643d", "commerce_product", "차콜 싱글 재킷"],
  ["fashion_b_trousers", "3c0e56a2b659de402f0b67129a060d479274c8a093eb9fb1c3c2f0f63ecd9d65", "commerce_product", "베이지 슬랙스"],
  ["health_home_workout", "c1000800307a89f4c8341d50111e6e2acbbcac6b8ad6e9be1d9048efa4f6abe7", "unknown", "집에서 하는 3단계 홈트"],
  ["life_tip_receipts", "711b224d91b4b1b6e888e281bf208ec310dd486c82b1975b472a328999f96b46", "unknown", "영수증 정리 3단계"],
  ["recipe_tomato_egg_generated", "4344034d26aeab2e3d42316b08d0f24fa3894e5a61f7536b0dedb3cf33d65106", "recipe", "토마토 달걀 볶음"],
  ["shopping_a_fabric_box", "ce71495de8243c750e0b17a67499534c9f9e691b6d2cb818046e38706634e542", "commerce_product", "접이식 패브릭 수납함"],
  ["shopping_b_clear_box", "ab0406cd684d8f3021ed83dc37eb737a3a8bca9102d5d7ec4b142878a91fcbe5", "commerce_product", "투명 적층 수납함"],
  ["travel_a_viewpoint", "07ddb947d3d725a1cd0737346f8a5817a7bd63e67301a88277cad4cbce483099", "place", "바람언덕 전망대"],
  ["travel_b_coastwalk", "0746124c05158934bb348be03c57ea0f7408c2cb000477edaffe94c8806642d1", "place", "푸른곶 해안길"],
  ["variation_dining_jeju_noodles", "207ca5abbbfa507fade08f353f744d407be4f780266ca37f0b94329fe5a166d3", "place", "제주 바다국수"],
  ["variation_life_tip_workout_prep", "2fb64f37eb1a20749f13e70674f0f8ee1f024c38542b4ca097e928b450251432", "unknown", "집에서 운동할 때 준비 꿀팁"],
  ["variation_recipe_tofu_egg_as_needed", "4ee2de07ece75c1a7b467430701efbc19e1775584738147bd427ab0129baf47e", "recipe", "두부 달걀 볶음"],
  ["variation_shopping_egg_pack", "db39f40c0062dacd52cbfa6c87c41302cdd668405d783368a8b6f67515c9db6f", "commerce_product", "달걀 10개입"],
  ["variation_shopping_old_current_price", "7c3da692d80c16dc3d838743ec3496608e7579738f38fda3b386843f64bf3633", "commerce_product", "접이식 패브릭 수납함"],
  ["variation_shopping_tofu_ingredient", "7a87bb882a641e8a344ce59750f7b34d9c4842d659f6ed91898b856d8602c442", "commerce_product", "부침용 두부 300g"],
];

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

test("every public scenario image has a pinned recording with valid evidence references", async () => {
  const files = await fs.readdir(fixtures);
  assert.deepEqual(
    files.filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)).sort(),
    corpus.map(([name]) => name).sort(),
  );
  assert.deepEqual(
    files.filter((name) => name.endsWith("_live_analysis.json")).sort(),
    corpus.map(([name]) => `${name === "recipe_tomato_egg_generated" ? "recipe_tomato_egg" : name}_live_analysis.json`).sort(),
  );
  for (const [name, hash, kind, title] of corpus) {
    const image = await fs.readFile(new URL(`./fixtures/${name}.png`, import.meta.url));
    assert.equal(createHash("sha256").update(image).digest("hex"), hash, name);
    validateAnalyzeRequest({ image: { mimeType: "image/png", base64: image.toString("base64") },
      capture: { id: name, sourceApp: "synthetic.corpus", locale: "ko-KR" } });
    const responseName = name === "recipe_tomato_egg_generated" ? "recipe_tomato_egg" : name;
    const analysis = JSON.parse(await fs.readFile(new URL(
      `./fixtures/${responseName}_live_analysis.json`, import.meta.url), "utf8"));
    validateLegacyAnalysis(analysis);
    assert.equal(analysis.contentKind, kind, name);
    assert.equal(analysis.title.value, title, name);
    const evidence = new Set(analysis.evidence.map((item) => item.id));
    assert.equal(evidence.size, analysis.evidence.length, `${name}: duplicate evidence ID`);
    const fields = [analysis.title, analysis.place, ...analysis.tags, ...analysis.facts,
      ...analysis.steps, ...analysis.ingredientGroups.flatMap((group) => group.ingredients)];
    for (const field of fields) {
      for (const id of field.evidenceIds ?? []) {
        assert.ok(evidence.has(id), `${name}: unresolved evidence ${id}`);
      }
    }
    assert.ok(analysis.title.evidenceIds.length > 0, `${name}: title lacks image evidence`);
  }
});
