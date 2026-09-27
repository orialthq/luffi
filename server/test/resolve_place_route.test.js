import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { PlaceSearchTransportError } from "../src/errors.js";
import { createHttpServer } from "../src/http_app.js";
import { makeValidAnalysis } from "./fixtures.js";

const 페스카데리아 = {
  id: "12345",
  name: "페스카데리아",
  address: "서울 성동구 성수동2가 315-13",
  roadAddress: "서울 성동구 연무장길 5",
  category: "음식점",
  latitude: 37.5445,
  longitude: 127.0557,
  placeUrl: "https://place.map.kakao.com/12345",
};

async function startServer(t, placeResolutionService) {
  const server = createHttpServer({
    analysisService: {
      async analyze() {
        return makeValidAnalysis();
      },
    },
    placeResolutionService,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function post(baseUrl, body) {
  return fetch(`${baseUrl}/v1/resolve-place`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("returns the verified place", async (t) => {
  const baseUrl = await startServer(t, {
    async resolve() {
      return { place: 페스카데리아, candidateCount: 3 };
    },
  });

  const response = await post(baseUrl, {
    name: "페스카데리아",
    address: "성수동",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    place: 페스카데리아,
    candidateCount: 3,
  });
});

test("a miss is a success with no place, not an error", async (t) => {
  const baseUrl = await startServer(t, {
    async resolve() {
      return { place: null, candidateCount: 7 };
    },
  });

  const response = await post(baseUrl, { name: "없는가게" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { place: null, candidateCount: 7 });
});

test("reports the feature as unconfigured without a resolution service", async (t) => {
  const baseUrl = await startServer(t, null);

  const response = await post(baseUrl, { name: "가게" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "PLACE_SEARCH_NOT_CONFIGURED");
});

test("rejects a request with neither a name nor an address", async (t) => {
  const baseUrl = await startServer(t, {
    async resolve() {
      throw new Error("must not be called");
    },
  });

  for (const body of [{}, { name: "  ", address: "" }]) {
    const response = await post(baseUrl, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  }
});

test("rejects unknown request fields", async (t) => {
  const baseUrl = await startServer(t, {
    async resolve() {
      throw new Error("must not be called");
    },
  });

  const response = await post(baseUrl, { name: "가게", latitude: 37.5 });
  assert.equal(response.status, 400);
});

test("maps an upstream key failure without leaking the cause", async (t) => {
  const baseUrl = await startServer(t, {
    async resolve() {
      throw new PlaceSearchTransportError("authentication", {
        upstreamStatus: 401,
      });
    },
  });

  const response = await post(baseUrl, { name: "가게" });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "PLACE_SEARCH_NOT_CONFIGURED");
  assert.equal(body.error.message.includes("401"), false);
});

test("rejects a non-POST method", async (t) => {
  const baseUrl = await startServer(t, {
    async resolve() {
      return { place: null, candidateCount: 0 };
    },
  });

  const response = await fetch(`${baseUrl}/v1/resolve-place`);
  assert.equal(response.status, 405);
});
