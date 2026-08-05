const CACHE_NAME = "shinypic-shell-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./hdr-core.js",
  "./demo-catalog.js",
  "./image-guard.js",
  "./arcade.html",
  "./arcade.css",
  "./arcade.js",
  "./arcade/rng.js",
  "./arcade/png-icc.js",
  "./arcade/photometry.js",
  "./arcade/hdr-image.js",
  "./arcade/limiter.js",
  "./arcade/ui.js",
  "./arcade/foolsgold-board.js",
  "./arcade/foolsgold.js",
  "./arcade/lamplighter-code.js",
  "./arcade/lamplighter.js",
  "./arcade/ceiling-staircase.js",
  "./arcade/ceiling.js",
  "./arcade/keyhole.js",
  "./arcade/overwhite-code.js",
  "./overwhite.html",
  "./overwhite.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/demos/neon-rain.jpg",
  "./assets/demos/crystal-light.jpg",
  "./assets/demos/iris-after-rain.jpg",
  "./assets/demos/chainlink-case-study-sdr.jpg",
  "./assets/demos/chainlink-original-hdr.jpg",
  "./assets/rec2100-pq.icc",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    // Offline, serve the page that was actually asked for; the studio is only
    // the fallback for routes that were never cached.
    event.respondWith(
      fetch(event.request).catch(async () =>
        (await caches.match(event.request, { ignoreSearch: true }))
        || (await caches.match("./index.html"))),
    );
    return;
  }

  // Code and styles go to the network first, falling back to the cache offline.
  //
  // They used to be cache-first, which meant a returning visitor kept an old
  // stylesheet forever while navigations fetched new markup: the site rendered
  // as new HTML against stale CSS, and no amount of correct deployment fixed it
  // because the request never left the device. Bumping CACHE_NAME alone would
  // only paper over it until the next release.
  //
  // Images and the ICC profile stay cache-first. They are large, they change
  // rarely, and _headers already gives them a long max-age.
  const isCode = /\.(?:css|js|webmanifest)$/.test(url.pathname);

  if (isCode) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })),
  );
});
