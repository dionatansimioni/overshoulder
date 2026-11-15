// Service worker mínimo: deixa o Overshoulder instalável e mostra uma página própria sem internet.
// Só a página "sem conexão" fica guardada; as páginas, a API e a mídia sempre vêm do servidor.
const CACHE = 'overshoulder-offline-v1';
const OFFLINE = '/static/offline.html';
const OFFLINE_FILES = [OFFLINE, '/static/offline.js', '/static/i18n.js', '/static/style.css', '/static/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }
  // Arquivos da página sem conexão: da rede quando há internet, guardados quando não há
  if (OFFLINE_FILES.includes(new URL(request.url).pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
  }
});
