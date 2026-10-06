/**
 * GET /api/translate?q=hello&from=en-US&to=ms-MY
 *
 * 1. Workers AI: Llama 3.3 70B as a learner's dictionary (translation, meaning, example)
 * 2. Workers AI: Meta m2m100 translation model
 * 3. MyMemory free API
 * Answers are cached at the edge for a day.
 */

export const LANGS = {
  "en-US": "en", "ms-MY": "ms", "id-ID": "id", "es-ES": "es", "fr-FR": "fr", "de-DE": "de",
  "it-IT": "it", "pt-BR": "pt", "ja-JP": "ja", "ko-KR": "ko", "zh-CN": "zh", "ar-SA": "ar",
  "hi-IN": "hi", "ta-IN": "ta", "th-TH": "th", "vi-VN": "vi"
};
// MyMemory wants region codes for these two
const MYMEMORY_CODES = { pt: "pt-BR", zh: "zh-CN" };
export const MAX_CHARS = 200;
export const AI_MODEL = "@cf/meta/m2m100-1.2b";
export const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const LANG_NAMES = {
  en: "English",
  ms: "Malaysian Malay (Bahasa Melayu as used in Malaysia, Dewan Bahasa dan Pustaka standard; never Indonesian words or spelling)",
  id: "Indonesian", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Brazilian Portuguese",
  ja: "Japanese", ko: "Korean", zh: "Simplified Chinese (Mandarin)", ar: "Modern Standard Arabic",
  hi: "Hindi", ta: "Tamil", th: "Thai", vi: "Vietnamese"
};

export const SYSTEM_PROMPT = `You are a careful bilingual dictionary for language learners.
Give the single most natural translation a native speaker would actually use.
Rules:
- Keep the part of speech of the input: a verb stays a verb, a noun stays a noun.
- Prefer established native words over English loanwords when a standard native term exists.
- Never invent words. If unsure, choose the most common correct phrase.
- "romanization": Latin-letter pronunciation of the translation only if the target language uses a non-Latin script; otherwise "".
- "meaning": one short plain-English sentence explaining the meaning.
- "example": a short natural sentence in the source language using the word.
- "exampleTranslation": that same sentence in the target language.
- "alternatives": up to 3 other correct translations (may be empty).
Reply only with the JSON object.`;

const SCHEMA = {
  type: "object",
  properties: {
    translation: { type: "string" },
    alternatives: { type: "array", items: { type: "string" } },
    partOfSpeech: { type: "string" },
    meaning: { type: "string" },
    example: { type: "string" },
    exampleTranslation: { type: "string" },
    romanization: { type: "string" }
  },
  required: ["translation", "alternatives", "partOfSpeech", "meaning", "example", "exampleTranslation", "romanization"]
};

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function cleanEntry(r) {
  if (!r || typeof r !== "object") return null;
  const translation = str(r.translation, 120);
  if (!translation) return null;
  const seen = new Set([translation.toLowerCase()]);
  const alternatives = [];
  for (const a of Array.isArray(r.alternatives) ? r.alternatives : []) {
    const t = str(a, 60);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); alternatives.push(t); }
    if (alternatives.length === 3) break;
  }
  return {
    translation, alternatives,
    partOfSpeech: str(r.partOfSpeech, 30),
    meaning: str(r.meaning, 300),
    example: str(r.example, 200),
    exampleTranslation: str(r.exampleTranslation, 200),
    romanization: str(r.romanization, 120)
  };
}

async function viaLLM(ai, q, from, to) {
  const out = await ai.run(LLM_MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Source language: ${LANG_NAMES[from]}\nTarget language: ${LANG_NAMES[to]}\nWord or phrase: ${q}` }
    ],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 400,
    temperature: 0.2
  });
  let r = out && out.response;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { return null; } }
  const entry = cleanEntry(r);
  return entry ? { ...entry, source: "Cloudflare Workers AI" } : null;
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers }
  });

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#039;": "'" };
export const decode = (s) =>
  String(s || "")
    .replace(/&(amp|lt|gt|quot|#0?39);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

async function viaWorkersAI(ai, q, from, to) {
  const out = await ai.run(AI_MODEL, { text: q, source_lang: from, target_lang: to });
  const t = decode(out && out.translated_text);
  return t ? { translation: t, alternatives: [], source: "Cloudflare Workers AI" } : null;
}

async function viaMyMemory(q, from, to, env) {
  const upstream = new URL("https://api.mymemory.translated.net/get");
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("langpair", `${MYMEMORY_CODES[from] || from}|${MYMEMORY_CODES[to] || to}`);
  if (env && env.MYMEMORY_EMAIL) upstream.searchParams.set("de", env.MYMEMORY_EMAIL);

  let res, data;
  try {
    res = await fetch(upstream.toString(), {
      headers: { Accept: "application/json", "User-Agent": "Kata-vocab/1.0 (+https://github.com/zalenagit/kata-vocab-e2e)" }
    });
  } catch {
    return { error: json({ error: "Translation service unreachable." }, 502) };
  }
  if (!res.ok) return { error: json({ error: "Translation service unavailable.", upstreamStatus: res.status }, 502) };
  try { data = await res.json(); } catch { return { error: json({ error: "Translation service sent a bad reply." }, 502) }; }

  const status = Number(data && data.responseStatus);
  const raw = data && data.responseData && data.responseData.translatedText;
  if (status === 429 || /MYMEMORY WARNING/i.test(raw || "")) return { error: json({ error: "Daily translation limit reached." }, 429) };
  if (status !== 200 || !raw) return { error: json({ error: "No translation found." }, 502) };

  const translation = decode(raw);
  const seen = new Set([translation.toLowerCase(), q.toLowerCase()]);
  const alternatives = [];
  for (const m of Array.isArray(data.matches) ? data.matches : []) {
    const t = decode(m && m.translation);
    if (t && t.length <= 60 && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); alternatives.push(t); }
    if (alternatives.length === 3) break;
  }
  return { result: { translation, alternatives, source: "MyMemory" } };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const from = LANGS[url.searchParams.get("from")];
  const to = LANGS[url.searchParams.get("to")];

  if (!q || q.length > MAX_CHARS) return json({ error: `Send a word or phrase up to ${MAX_CHARS} characters.` }, 400);
  if (!from || !to || from === to) return json({ error: "Unsupported language pair." }, 400);

  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(`https://kata.cache/translate/v3?q=${encodeURIComponent(q.toLowerCase())}&from=${from}&to=${to}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  let result = null;
  if (env && env.AI) {
    try { result = await viaLLM(env.AI, q, from, to); } catch { result = null; }
    if (!result) {
      try { result = await viaWorkersAI(env.AI, q, from, to); } catch { result = null; }
    }
  }
  if (!result) {
    const mm = await viaMyMemory(q, from, to, env);
    if (mm.error) return mm.error;
    result = mm.result;
  }

  const response = json(result, 200, { "Cache-Control": "public, max-age=86400" });
  if (cache) {
    const put = cache.put(cacheKey, response.clone());
    if (context.waitUntil) context.waitUntil(put); else await put;
  }
  return response;
}
