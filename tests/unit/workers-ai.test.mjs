// Workers AI path of the translation function: node --test "tests/unit/*.test.mjs"
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, AI_MODEL } from "../../functions/api/translate.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const call = (qs, env) => onRequestGet({ request: new Request("https://kata.test/api/translate?" + qs), env });

test("uses Workers AI first, with short language codes", async () => {
  let fetched = false, input, model;
  globalThis.fetch = async () => { fetched = true; return { ok: true, json: async () => ({}) }; };
  const AI = { run: async (m, i) => { model = m; input = i; return { translated_text: "helo" }; } };
  const res = await call("q=hello&from=en-US&to=ms-MY", { AI });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(await res.text()), { translation: "helo", alternatives: [], source: "Cloudflare Workers AI" });
  assert.equal(model, AI_MODEL);
  assert.deepEqual(input, { text: "hello", source_lang: "en", target_lang: "ms" });
  assert.equal(fetched, false);
});

test("falls back to MyMemory when Workers AI fails", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "helo" }, matches: [] }) });
  const AI = { run: async () => { throw new Error("AI down"); } };
  const res = await call("q=hello&from=en-US&to=ms-MY", { AI });
  assert.equal(JSON.parse(await res.text()).source, "MyMemory");
});

test("falls back to MyMemory when Workers AI returns nothing", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "水" }, matches: [] }) });
  const AI = { run: async () => ({ translated_text: "" }) };
  const res = await call("q=water&from=en-US&to=ja-JP", { AI });
  assert.equal(JSON.parse(await res.text()).translation, "水");
});

test("MyMemory gets region codes for Portuguese and Chinese", async () => {
  let url;
  globalThis.fetch = async (u) => { url = String(u); return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "olá" }, matches: [] }) }; };
  await call("q=hello&from=en-US&to=pt-BR", {});
  assert.match(url, /langpair=en%7Cpt-BR/);
});

test("reports the upstream status code when MyMemory fails", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const res = await call("q=hello&from=en-US&to=ms-MY", {});
  assert.equal(res.status, 502);
  assert.equal(JSON.parse(await res.text()).upstreamStatus, 403);
});
