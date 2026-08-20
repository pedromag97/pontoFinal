// Service worker (só ativo em produção):
// - cache do shell estático (cache-first, ficheiros com hash);
// - navegações: rede primeiro; sem rede, serve a última versão em cache da
//   página (permite abrir a app offline e registar para a fila local),
//   com offline.html como último recurso.
// v6: os icones mudaram de nome de ficheiro. O Chrome compara os icones
// do manifest pelo URL e nao pelo conteudo, por isso manter o mesmo nome
// deixava o atalho ja instalado com o icone antigo para sempre.
const CACHE = "ponto-v6";
const PRECACHE = [
  "/offline.html",
  "/manifest.json",
  "/icons/ponto-192.png",
  "/icons/ponto-512.png",
  "/simbolo-ponto.svg",
  "/simbolo-ponto-pequeno.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Lembretes push (ex.: esquecimento da saída).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // payload não-JSON — usa defaults
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Registo de Ponto", {
      body: data.body || "",
      icon: "/icons/ponto-192.png",
      badge: "/icons/ponto-192.png",
      data: { url: data.url || "/registo" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/registo";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) return client.focus();
        }
        return clients.openWindow(url);
      })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Nunca intercetar chamadas externas (Supabase, mapas…).
  if (url.origin !== self.location.origin) return;

  // Navegações: rede primeiro; offline → última versão em cache → offline.html.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          return cached || caches.match("/offline.html");
        }
      })()
    );
    return;
  }

  // Assets estáticos: cache-first (em produção têm hash no nome).
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
  }
});
