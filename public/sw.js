// Knowmesh Service Worker - App Shell & Attachment Offline Support
const CACHE_NAME = 'knowmesh-app-shell-v4';
const ATTACHMENT_CACHE_NAME = 'knowmesh-attachments-v1';

const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/Knowmesh_icon32.png',
  '/Knowmesh_icon64.png',
  '/Knowmesh_icon128.png',
  '/Knowmesh_icon256.png',
  '/knowmesh_icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. Cache core shell assets gracefully (never let one 404 abort installation)
      await Promise.allSettled(
        APP_SHELL_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => console.warn('[Knowmesh SW] Pre-cache asset warning:', asset, err))
        )
      );

      // 2. Proactively parse index.html for hashed JS & CSS build bundles
      try {
        const response = await fetch('/index.html');
        if (response.ok) {
          const html = await response.text();
          const dynamicAssets = new Set();

          const scriptMatches = html.matchAll(/src=["'](\/assets\/[^"']+)["']/g);
          for (const m of scriptMatches) {
            dynamicAssets.add(m[1]);
          }

          const styleMatches = html.matchAll(/href=["'](\/assets\/[^"']+)["']/g);
          for (const m of styleMatches) {
            dynamicAssets.add(m[1]);
          }

          if (dynamicAssets.size > 0) {
            await Promise.allSettled(
              Array.from(dynamicAssets).map((asset) =>
                cache.add(asset).catch((err) => console.warn('[Knowmesh SW] Pre-cache bundle warning:', asset, err))
              )
            );
          }
        }
      } catch (err) {
        console.warn('[Knowmesh SW] Could not pre-cache dynamically discovered build assets:', err);
      }
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

  // Handle binary attachments: Cache-first with network fallback and background cache update
  if (url.pathname === '/api/vault/attachment') {
    event.respondWith(
      caches.open(ATTACHMENT_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          // Fetch update in background if online
          fetch(event.request)
            .then((res) => {
              if (res.status === 200) cache.put(event.request, res);
            })
            .catch(() => {});
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

  // Other /api endpoints are NOT cached in Service Worker (handled by IndexedDB sync engine)
  if (url.pathname.startsWith('/api')) {
    return;
  }

  // Navigation requests (HTML document): Network-first with instant cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
              cache.put('/index.html', clone.clone());
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = (await caches.match('/index.html')) || (await caches.match('/'));
          if (cached) return cached;
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match('/index.html')) || (await cache.match('/'));
        })
    );
    return;
  }

  // Static assets (JS, CSS, SVGs, PNGs, fonts): Cache-first with network fallback & cache update
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          return cachedResponse;
        });
    })
  );
});
