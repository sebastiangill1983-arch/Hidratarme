const CACHE_NAME = "hidratapp-v1";
const ASSETS = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ---------- Push notifications reales (llegan aunque la app esté cerrada) ----------
self.addEventListener("push", (event) => {
  let data = { title: "💧 Hora de hidratarte", body: "No te olvides de tomar agua." };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // si no viene como JSON, usamos el default
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
    })
  );
});
