/* Safar Salah service worker: offline use + notifications. (c) 2026 Safar Salah */
const CACHE = 'safar-2026-10-02a';
const CORE = ['./', 'index.html', 'terms.html', 'privacy.html', 'manifest.webmanifest', 'favicon-192.png', 'icon-512.png', 'app-icon-1024.png'];
const OPTIONAL = [];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE).catch(() => {});
    for(const f of OPTIONAL){ try{ const r = await fetch(f); if(r.ok) await c.put(f, r); }catch(err){} }
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(k !== CACHE && k.startsWith('safar-')) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === location.origin){
    if(req.mode === 'navigate'){
      // newest page when online, saved page when offline (e.g. on the plane)
      e.respondWith((async () => {
        try{ const r = await fetch(req); const c = await caches.open(CACHE); c.put('index.html', r.clone()); return r; }
        catch(err){ return (await caches.match(req)) || (await caches.match('index.html')) || (await caches.match('./')); }
      })());
      return;
    }
    if(req.headers.get('range')) return;          // let audio seeking go to the network
    e.respondWith((async () => {
      const cached = await caches.match(req);
      const net = fetch(req).then(async r => { if(r.ok){ const c = await caches.open(CACHE); c.put(req, r.clone()); } return r; }).catch(() => null);
      return cached || (await net) || new Response('', {status: 504});
    })());
    return;
  }
  if(FONT_HOSTS.includes(url.hostname)){
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if(cached) return cached;
      try{ const r = await fetch(req); const c = await caches.open(CACHE); c.put(req, r.clone()); return r; }
      catch(err){ return new Response('', {status: 504}); }
    })());
  }
});
self.addEventListener('push', e => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(err){ d = {title: 'Safar Salah', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Safar Salah', {
    body: d.body || '', icon: 'favicon-192.png', badge: 'favicon-192.png', tag: d.tag || 'safar', renotify: true, vibrate: [200, 100, 200]
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for(const c of all){ if('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  })());
});
