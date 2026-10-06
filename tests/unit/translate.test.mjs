// Unit tests for the Cloudflare Pages Function, run with Node's built-in test runner:
//   node --test tests/unit
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, decode } from "../../functions/api/translate.js";

const realFetch = globalThis.fetch;
let calls;

function mockUpstream(body, { ok = true, throws = false } = {}) {
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (throws) throw new Error("network down");
    return { ok, json: async () => body };
  };
}
const call = (qs, env = {}) => onRequestGet({ request: new Request("https://kata.test/api/translate?" + qs), env });
const body = async (res) => JSON.parse(await res.text());

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test("translates and returns de-duplicated alternatives", async () => {
  mockUpstream({
    responseStatus: 200,
    responseData: { translatedText: "terima kasih" },
    matches: [{ translation: "terima kasih" }, { translation: "Terima Kasih" }, { translation: "makasih" }, { translation: "ribuan terima kasih" }]
  });
  const res = await call("q=thank%20you&from=en-US&to=ms-MY");
  assert.equal(res.status, 200);
  assert.deepEqual(await body(res), { translation: "terima kasih", alternatives: ["makasih", "ribuan terima kasih"], source: "MyMemory" });
  assert.match(calls[0], /langpair=en%7Cms/);
  assert.match(res.headers.get("Cache-Control"), /max-age=86400/);
});

test("decodes HTML entities from the upstream service", async () => {
  mockUpstream({ responseStatus: 200, responseData: { translatedText: "l&#39;eau &amp; vous" }, matches: [] });
  const res = await call("q=water&from=en-US&to=fr-FR");
  assert.equal((await body(res)).translation, "l'eau & vous");
  assert.equal(decode("a&quot;b&#233;"), 'a"bé');
});

test("rejects empty, too-long and unsupported requests without calling upstream", async () => {
  mockUpstream({});
  assert.equal((await call("q=&from=en-US&to=ms-MY")).status, 400);
  assert.equal((await call("q=" + "a".repeat(201) + "&from=en-US&to=ms-MY")).status, 400);
  assert.equal((await call("q=hi&from=en-US&to=xx-XX")).status, 400);
  assert.equal((await call("q=hi&from=en-US&to=en-US")).status, 400);
  assert.equal(calls.length, 0);
});

test("reports the daily quota as 429", async () => {
  mockUpstream({ responseStatus: 429, responseData: { translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY" } });
  assert.equal((await call("q=hello&from=en-US&to=ms-MY")).status, 429);
});

test("returns 502 when the upstream service fails", async () => {
  mockUpstream({}, { throws: true });
  assert.equal((await call("q=hello&from=en-US&to=ms-MY")).status, 502);
  mockUpstream({}, { ok: false });
  assert.equal((await call("q=hello&from=en-US&to=ms-MY")).status, 502);
  mockUpstream({ responseStatus: 200, responseData: { translatedText: "" } });
  assert.equal((await call("q=hello&from=en-US&to=ms-MY")).status, 502);
});

test("passes the MYMEMORY_EMAIL secret upstream, never back to the browser", async () => {
  mockUpstream({ responseStatus: 200, responseData: { translatedText: "helo" }, matches: [] });
  const res = await call("q=hello&from=en-US&to=ms-MY", { MYMEMORY_EMAIL: "me@example.com" });
  assert.match(calls[0], /de=me%40example\.com/);
  assert.doesNotMatch(await res.text(), /example\.com/);
});
