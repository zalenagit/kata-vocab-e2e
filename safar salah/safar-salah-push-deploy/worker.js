/*
 * Safar Salah – Cloudflare Worker
 * Serves the app (static files in ./public) and sends prayer-time push notifications,
 * even when the app is closed. (c) 2026 Safar Salah. All rights reserved.
 *
 * Needs (see wrangler.jsonc):
 *   KV namespace binding  SUBS               – stores push subscriptions
 *   var                   VAPID_PUBLIC       – public key (also in the app)
 *   var                   VAPID_SUBJECT      – mailto: contact
 *   secret                VAPID_PRIVATE_JWK  – private key (Cloudflare dashboard → Settings → Variables and Secrets)
 * Cron trigger every minute sends notifications that are due.
 */

const KEY = 'subs-v1';
const MAX_SUBS = 5000;

/* ---------------- prayer times (same maths as the app) ---------------- */
const R = Math.PI / 180;
const METHODS = {
  MWL: {fajr: 18, isha: 17}, ISNA: {fajr: 15, isha: 15}, EGYPT: {fajr: 19.5, isha: 17.5},
  UQ: {fajr: 18.5, ishaMin: 90}, KARACHI: {fajr: 18, isha: 18}, JAKIM: {fajr: 20, isha: 18}
};
const NAMES = {fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha'};
function autoMethod(tz) {
  tz = tz || '';
  if (/^America\//.test(tz)) return 'ISNA';
  if (/^Asia\/(Kuala_Lumpur|Kuching|Brunei|Singapore|Jakarta|Makassar|Jayapura|Pontianak)$/.test(tz)) return 'JAKIM';
  if (/^Asia\/(Riyadh|Aden|Qatar|Dubai|Kuwait|Bahrain|Muscat)$/.test(tz)) return 'UQ';
  if (/^Asia\/(Karachi|Kolkata|Dhaka|Kabul|Colombo|Kathmandu)$/.test(tz) || tz === 'Indian/Maldives') return 'KARACHI';
  if (/^Africa\//.test(tz) || /^Asia\/(Amman|Beirut|Damascus|Baghdad)$/.test(tz)) return 'EGYPT';
  return 'MWL';
}
function sunAt(ms, lat, lon) {
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * R;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * R;
  const e = (23.439 - 0.00000036 * d) * R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  let H = 280.46061837 + 360.98564736629 * d + lon - ra / R;
  H = ((H % 360) + 540) % 360 - 180;
  const la = lat * R;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H * R)) / R;
  return {alt, H, dec: dec / R};
}
const asrAlt = (lat, dec, f) => Math.atan(1 / (f + Math.tan(Math.abs(lat - dec) * R))) / R;

/** Prayer start times (ms, rounded like the app) for a fixed place between start and end. */
function groundSchedule(lat, lon, method, asrF, start, end) {
  const m = METHODS[method] || METHODS.MWL, ev = [], step = 60000;
  let prev = null;
  const cross = (a, b, va, vb, thr) => a.ms + (b.ms - a.ms) * ((thr - va) / (vb - va));
  for (let ms = start; ms <= end; ms += step) {
    const s = sunAt(ms, lat, lon);
    const cur = {ms, alt: s.alt, H: s.H, d: s.alt + 0.833, a: s.alt - asrAlt(lat, s.dec, asrF)};
    if (prev) {
      if (prev.alt < -m.fajr && cur.alt >= -m.fajr) ev.push({key: 'fajr', ms: cross(prev, cur, prev.alt, cur.alt, -m.fajr)});
      if (prev.H < 0 && cur.H >= 0 && prev.H > -90) ev.push({key: 'dhuhr', ms: cross(prev, cur, prev.H, cur.H, 0)});
      if (prev.a > 0 && cur.a <= 0 && cur.H > 0) ev.push({key: 'asr', ms: cross(prev, cur, prev.a, cur.a, 0)});
      if (prev.d > 0 && cur.d <= 0) ev.push({key: 'maghrib', ms: cross(prev, cur, prev.d, cur.d, 0)});
      if (!m.ishaMin && prev.alt > -m.isha && cur.alt <= -m.isha) ev.push({key: 'isha', ms: cross(prev, cur, prev.alt, cur.alt, -m.isha)});
    }
    prev = cur;
  }
  if (m.ishaMin) ev.filter(e => e.key === 'maghrib').forEach(e => ev.push({key: 'isha', ms: e.ms + m.ishaMin * 60000}));
  const SAFETY = {dhuhr: 1, maghrib: 1};
  ev.forEach(e => { e.ms = Math.ceil(e.ms / 60000) * 60000 + (SAFETY[e.key] || 0) * 60000; });
  return ev.filter(e => e.ms <= end).sort((a, b) => a.ms - b.ms);
}
function fmtTime(ms, tz) {
  try { return new Intl.DateTimeFormat('en-US', {timeZone: tz, hour: 'numeric', minute: '2-digit'}).format(new Date(ms)); }
  catch (e) { return new Date(ms).toISOString().slice(11, 16) + ' UTC'; }
}

/* ---------------- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) ---------------- */
const enc = new TextEncoder();
const b64u = buf => { let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const concat = (...arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0), out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
/** Encrypts a payload for one subscription. Exported for tests. */
export async function encryptPayload(payload, p256dhB64, authB64, fixed = {}) {
  const uaPublic = unb64u(p256dhB64), authSecret = unb64u(authB64);
  const asKeys = fixed.asKeys || await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: uaKey}, asKeys.privateKey, 256));
  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, {name: 'AES-GCM'}, false, ['encrypt']);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce}, key, plain));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length; header.set(asPublic, 21);
  return concat(header, cipher);
}
let signKeyCache = null;
async function vapidAuth(endpoint, env) {
  if (!signKeyCache) signKeyCache = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({typ: 'JWT', alg: 'ES256'})));
  const body = b64u(enc.encode(JSON.stringify({aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:safarsalahapp@gmail.com'})));
  const sig = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, signKeyCache, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
/** Sends one push. Returns the HTTP status (404/410 means the subscription is gone). */
async function sendPush(sub, data, env, ttl = 900) {
  const body = await encryptPayload(JSON.stringify(data), sub.keys.p256dh, sub.keys.auth);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {Authorization: await vapidAuth(sub.endpoint, env), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'high'},
    body
  });
  return r.status;
}

/* ---------------- storage ---------------- */
async function loadAll(env) { return (await env.SUBS.get(KEY, 'json')) || {}; }
async function saveAll(env, all) { await env.SUBS.put(KEY, JSON.stringify(all)); }
async function idFor(endpoint) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(endpoint))); return b64u(h).slice(0, 22); }
function refreshSchedule(s, now) {
  const method = s.method === 'AUTO' || !METHODS[s.method] ? autoMethod(s.tz) : s.method;
  s.sched = groundSchedule(s.lat, s.lon, method, s.asrF || 1, now - 60000, now + 36 * 3600000).map(e => ({k: e.key, ms: e.ms}));
  s.until = now + 36 * 3600000;
}

/* ---------------- HTTP API ---------------- */
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
function validSub(sub) {
  return sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000 &&
    sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string' && sub.keys.p256dh.length < 200 && sub.keys.auth.length < 100;
}
async function handleApi(req, env, url) {
  if (url.pathname === '/api/vapid') return json({key: env.VAPID_PUBLIC || ''});
  if (req.method !== 'POST') return json({error: 'Use POST'}, 405);
  if (!env.SUBS || !env.VAPID_PRIVATE_JWK) return json({error: 'Push is not set up on the server yet.'}, 503);
  let b; try { b = await req.json(); } catch (e) { return json({error: 'Bad JSON'}, 400); }
  if (!b || !validSub(b.sub)) return json({error: 'Bad subscription'}, 400);
  const id = await idFor(b.sub.endpoint), now = Date.now();

  if (url.pathname === '/api/unsubscribe') {
    const all = await loadAll(env); delete all[id]; await saveAll(env, all); return json({ok: true});
  }
  if (url.pathname === '/api/subscribe') {
    const lat = +b.lat, lon = +b.lon;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return json({error: 'Bad location'}, 400);
    const all = await loadAll(env);
    if (!all[id] && Object.keys(all).length >= MAX_SUBS) return json({error: 'Too many subscriptions'}, 503);
    const s = {sub: {endpoint: b.sub.endpoint, keys: {p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth}},
      lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000,       // ~100 m is plenty for prayer times
      tz: String(b.tz || 'UTC').slice(0, 60), name: String(b.name || '').slice(0, 60),
      method: String(b.method || 'AUTO').slice(0, 10), asrF: b.asrF === 2 ? 2 : 1, updated: now};
    if (b.flight && Array.isArray(b.flight.events) && b.flight.dep && b.flight.arr) {
      s.flight = {dep: +b.flight.dep, arr: +b.flight.arr, route: String(b.flight.route || '').slice(0, 20),
        events: b.flight.events.slice(0, 40).map(e => ({ms: Math.ceil(+e.ms / 60000) * 60000, title: String(e.title).slice(0, 80), body: String(e.body || '').slice(0, 160)}))};
    }
    refreshSchedule(s, now);
    all[id] = s; await saveAll(env, all);
    return json({ok: true, next: s.sched.find(e => e.ms > now) || null});
  }
  if (url.pathname === '/api/test') {
    try { const st = await sendPush(b.sub, {title: 'Notifications are on', body: 'Safar Salah will notify you when each prayer time starts, even when the app is closed.', tag: 'safar-test'}, env, 300); return json({ok: st < 300, status: st}); }
    catch (e) { return json({ok: false, error: String(e)}, 500); }
  }
  return json({error: 'Not found'}, 404);
}

/* ---------------- every minute: send what is due ---------------- */
async function runCron(scheduledTime, env) {
  if (!env.SUBS || !env.VAPID_PRIVATE_JWK) return;
  const minute = Math.floor(scheduledTime / 60000) * 60000;
  const all = await loadAll(env);
  let dirty = false; const jobs = [];
  for (const [id, s] of Object.entries(all)) {
    const f = s.flight;
    const inFlight = f && minute >= f.dep - 2 * 3600000 && minute <= f.arr + 3600000;
    if (f && minute > f.arr + 6 * 3600000) { delete s.flight; dirty = true; }
    if (inFlight) {
      for (const e of f.events) if (e.ms === minute) jobs.push({id, s, data: {title: e.title, body: e.body, tag: 'safar-' + e.title}});
    } else {
      for (const e of s.sched || []) if (e.ms === minute) jobs.push({id, s, data: {title: `${NAMES[e.k]} time has started`, body: `${s.name ? s.name + ' · ' : ''}${fmtTime(e.ms, s.tz)}`, tag: 'safar-' + e.k}});
    }
    if (!s.until || s.until - minute < 6 * 3600000) { refreshSchedule(s, minute); dirty = true; }
    if (s.updated && minute - s.updated > 60 * 86400000) { delete all[id]; dirty = true; }   // unused for 60 days
  }
  const results = await Promise.allSettled(jobs.slice(0, 45).map(j => sendPush(j.s.sub, j.data, env)));
  results.forEach((r, i) => { if (r.status === 'fulfilled' && (r.value === 404 || r.value === 410)) { delete all[jobs[i].id]; dirty = true; } });
  if (dirty) await saveAll(env, all);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return handleApi(req, env, url);
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCron(event.scheduledTime, env)); }
};

export const _test = {groundSchedule, autoMethod, encryptPayload, vapidAuth, refreshSchedule, runCron, handleApi};
