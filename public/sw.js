// Cache only the public offline guide. Never cache the app, API, login,
// tokens, note bodies, request signatures or device keys.
const CACHE = 'byte-back-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/offline.html', { cache: 'no-store' });
    if (!response.ok) throw new Error('offline_guide_unavailable');
    const cache = await caches.open(CACHE);
    await cache.put('/offline.html', response);
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate'
      || url.origin !== self.location.origin || url.pathname !== '/' || url.search) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(async () => {
    const guide = await (await caches.open(CACHE)).match('/offline.html');
    return guide ?? new Response('오프라인입니다. 인터넷 연결 후 다시 열어 주세요.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }));
});
