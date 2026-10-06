/**
 * Cloudflare Pages Function: GET /api/translate?q=hello&from=en-US&to=ms-MY
 *
 * Proxies the free MyMemory translation API (https://mymemory.translated.net/doc/spec.php)
 * so the browser never talks to it directly. That lets us:
 *   - validate input and only allow the 16 languages Kata supports
 *   - cache answers at Cloudflare's edge for a day (saves the free quota)
 *   - add the optional MYMEMORY_EMAIL secret, which raises MyMemory's free daily limit,
 *     without exposing it in the page
 */

export const LANGS = {
  "en-US": "en", "ms-MY": "ms", "id-ID": "id", "es-ES": "es", "fr-FR": "fr", "de-DE": "de",
  "it-IT": "it", "pt-BR": "pt-BR", "ja-JP": "ja", "ko-KR": "ko", "zh-CN": "zh-CN", "ar-SA": "ar",
  "hi-IN": "hi", "ta-IN": "ta", "th-TH": "th", "vi-VN": "vi"
};
export const MAX_CHARS = 200;

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

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const from = LANGS[url.searchParams.get("from")];
  const to = LANGS[url.searchParams.get("to")];

  if (!q || q.length > MAX_CHARS) return json({ error: `Send a word or phrase up to ${MAX_CHARS} characters.` }, 400);
  if (!from || !to || from === to) return json({ error: "Unsupported language pair." }, 400);

  // Edge cache, keyed on the normalised request.
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(`https://kata.cache/translate?q=${encodeURIComponent(q.toLowerCase())}&from=${from}&to=${to}`);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const upstream = new URL("https://api.mymemory.translated.net/get");
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("langpair", `${from}|${to}`);
  if (env && env.MYMEMORY_EMAIL) upstream.searchParams.set("de", env.MYMEMORY_EMAIL);

  let data;
  try {
    const res = await fetch(upstream.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) return json({ error: "Translation service unavailable." }, 502);
    data = await res.json();
  } catch {
    return json({ error: "Translation service unreachable." }, 502);
  }

  const status = Number(data && data.responseStatus);
  const raw = data && data.responseData && data.responseData.translatedText;
  if (status === 429 || /MYMEMORY WARNING/i.test(raw || "")) return json({ error: "Daily translation limit reached." }, 429);
  if (status !== 200 || !raw) return json({ error: "No translation found." }, 502);

  const translation = decode(raw);
  const seen = new Set([translation.toLowerCase()]);
  const alternatives = [];
  for (const m of Array.isArray(data.matches) ? data.matches : []) {
    const t = decode(m && m.translation);
    if (t && t.length <= 60 && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); alternatives.push(t); }
    if (alternatives.length === 3) break;
  }

  const response = json({ translation, alternatives, source: "MyMemory" }, 200, { "Cache-Control": "public, max-age=86400" });
  if (cache) {
    const put = cache.put(cacheKey, response.clone());
    if (context.waitUntil) context.waitUntil(put); else await put;
  }
  return response;
}
