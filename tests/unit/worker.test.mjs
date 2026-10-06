// Unit tests for the Worker router: node --test "tests/unit/*.test.mjs"
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../../worker/index.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const env = { ASSETS: { fetch: async (req) => new Response("asset:" + new URL(req.url).pathname) } };
const ctx = { waitUntil: () => {} };

test("routes /api/translate to the translation function", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "helo" }, matches: [] }) });
  const res = await worker.fetch(new Request("https://kata.test/api/translate?q=hello&from=en-US&to=ms-MY"), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(await res.text()).translation, "helo");
});

test("rejects non-GET requests to the API", async () => {
  const res = await worker.fetch(new Request("https://kata.test/api/translate", { method: "POST" }), env, ctx);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "GET");
});

test("hands every other path to static assets", async () => {
  const res = await worker.fetch(new Request("https://kata.test/manifest.webmanifest"), env, ctx);
  assert.equal(await res.text(), "asset:/manifest.webmanifest");
});
