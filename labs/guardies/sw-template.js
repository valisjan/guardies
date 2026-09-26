/* Service worker de Guàrdies. Es genera a cada build: BUILD_ID i PRECACHE
   els omple vite.config.js. Només gestiona peticions GET del mateix origen;
   Firebase, Google Fonts i qualsevol altre domini van sempre per la xarxa. */
const BUILD_ID = __BUILD_ID__;
const PRECACHE = __PRECACHE__;
const CACHE = `guardies-${BUILD_ID}`;
// La pàgina es demana a la xarxa: una correcció desplegada arriba de seguida.
// Només si no hi ha xarxa o tarda massa es fa servir la còpia.
const NAVIGATION_TIMEOUT = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Es conserva la versió anterior: una pestanya encara oberta amb l'app vella
    // pot demanar mòduls que el desplegament nou ja no serveix.
    const older = (await caches.keys())
      .filter((name) => name.startsWith('guardies-') && name !== CACHE)
      .sort();
    await Promise.all(older.slice(0, -1).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function navigationKey(url) {
  return url.pathname === '/diagnostics.html' ? '/diagnostics.html' : '/';
}

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT, null));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch {
    // Sense xarxa: es fa servir la còpia.
  }
  const cached = await caches.match(key);
  return cached || network;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, navigationKey(url)));
    return;
  }
  // Fitxers amb hash al nom: no canvien mai.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
