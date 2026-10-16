// Basalt Service Worker - App Shell & Attachment Offline Support
const CACHE_NAME = 'basalt-app-shell-v1';
const ATTACHMENT_CACHE_NAME = 'basalt-attachments-v1';
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/basalt-logo.svg',
  '/favicon.svg',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== ATTACHMENT_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept /ws or cross-origin requests
  if (url.pathname.startsWith('/ws') || url.origin !== self.location.origin) {
    return;
  }

  // Handle binary attachments: Cache-first with network fallback and cache update
  if (url.pathname === '/api/vault/attachment') {
    event.respondWith(
      caches.open(ATTACHMENT_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          // Fetch update in background if online
          fetch(event.request).then((res) => {
            if (res.status === 200) cache.put(event.request, res);
          }).catch(() => {});
          return cached;
        }

        try {
          const networkRes = await fetch(event.request);
          if (networkRes.status === 200) {
            cache.put(event.request, networkRes.clone());
          }
          return networkRes;
        } catch (err) {
          return cached || new Response('Offline Anhang nicht im Cache', { status: 503 });
        }
      })
    );
    return;
  }

  // Other /api endpoints are NOT cached in Service Worker (they are handled by IndexedDB sync engine)
  if (url.pathname.startsWith('/api')) {
    return;
  }

  // Navigation requests (HTML document): Network-first with cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  // Static assets (JS, CSS, SVGs): Cache-first with network fallback and cache update
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      });
    })
  );
});
