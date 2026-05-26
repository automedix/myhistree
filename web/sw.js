// myhistoree Service Worker v1.0
const CACHE_NAME = 'myhistoree-v0.3.8';
const STATIC_ASSETS = [
  '/',
  '/anamnese',
  '/index.html?v=0.3.8',
  '/css/app.css',
  '/js/app.js?v=0.3.8',
  '/js/nostr-tools.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).catch(() => {
      // Silent fail - app works offline anyway
    })
  );
  self.skipWaiting();
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Cache-first strategy for assets, network for API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: network only
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Refresh cache in background
        fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(request).then((response) => {
        if (response.ok && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        if (request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
