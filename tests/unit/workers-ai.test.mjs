// Workers AI paths of the translation function: node --test "tests/unit/*.test.mjs"
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, AI_MODEL, LLM_MODEL, cleanEntry } from "../../functions/api/translate.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const call = (qs, env) => onRequestGet({ request: new Request("https://kata.test/api/translate?" + qs), env });
const read = async (res) => JSON.parse(await res.text());
const noFetch = () => { globalThis.fetch = async () => { throw new Error("MyMemory should not be called"); }; };

const DEFOREST = {
  translation: "menebang hutan", alternatives: ["menyahhutankan", "menebang hutan", "", 42],
  partOfSpeech: "verb", meaning: "To clear an area of its trees.",
  example: "They plan to deforest the hillside.", exampleTranslation: "Mereka merancang untuk menebang hutan di lereng bukit itu.",
  romanization: ""
};

test("uses the Llama dictionary model first, with Malaysian Malay instructions", async () => {
  noFetch();
  const calls = [];
  const AI = { run: async (model, input) => { calls.push({ model, input }); return { response: DEFOREST }; } };
  const body = await read(await call("q=deforest&from=en-US&to=ms-MY", { AI }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, LLM_MODEL);
  assert.match(calls[0].input.messages[1].content, /Malaysian Malay/);
  assert.match(calls[0].input.messages[1].content, /never Indonesian/);
  assert.match(calls[0].input.messages[1].content, /Word or phrase: deforest/);
  assert.equal(calls[0].input.response_format.type, "json_schema");
  assert.equal(body.translation, "menebang hutan");
  assert.deepEqual(body.alternatives, ["menyahhutankan"]);
  assert.equal(body.partOfSpeech, "verb");
  assert.equal(body.example, "They plan to deforest the hillside.");
  assert.equal(body.source, "Cloudflare Workers AI");
});

test("accepts the model's JSON as a string", async () => {
  noFetch();
  const AI = { run: async () => ({ response: JSON.stringify(DEFOREST) }) };
  assert.equal((await read(await call("q=deforest&from=en-US&to=ms-MY", { AI }))).translation, "menebang hutan");
});

test("falls back to m2m100 with short codes when the dictionary model fails", async () => {
  noFetch();
  const calls = [];
  const AI = {
    run: async (model, input) => {
      calls.push(model);
      if (model === LLM_MODEL) throw new Error("busy");
      assert.deepEqual(input, { text: "hello", source_lang: "en", target_lang: "ms" });
      return { translated_text: "helo" };
    }
  };
  const body = await read(await call("q=hello&from=en-US&to=ms-MY", { AI }));
  assert.deepEqual(calls, [LLM_MODEL, AI_MODEL]);
  assert.deepEqual(body, { translation: "helo", alternatives: [], source: "Cloudflare Workers AI" });
});

test("falls back to m2m100 when the dictionary model returns junk", async () => {
  noFetch();
  const AI = { run: async (model) => (model === LLM_MODEL ? { response: "not json" } : { translated_text: "helo" }) };
  assert.equal((await read(await call("q=hello&from=en-US&to=ms-MY", { AI }))).translation, "helo");
});

test("falls back to MyMemory when both AI models fail", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "helo" }, matches: [] }) });
  const AI = { run: async () => { throw new Error("AI down"); } };
  assert.equal((await read(await call("q=hello&from=en-US&to=ms-MY", { AI }))).source, "MyMemory");
});

test("cleanEntry trims, caps lengths and drops bad fields", () => {
  const e = cleanEntry({ translation: "  水  ", alternatives: ["水", "みず", null, "お水", "冷水", "extra"], meaning: "x".repeat(500), partOfSpeech: 5 });
  assert.equal(e.translation, "水");
  assert.deepEqual(e.alternatives, ["みず", "お水", "冷水"]);
  assert.equal(e.meaning.length, 300);
  assert.equal(e.partOfSpeech, "");
  assert.equal(cleanEntry({ translation: "" }), null);
  assert.equal(cleanEntry(null), null);
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
  assert.equal((await read(res)).upstreamStatus, 403);
});
