// Minimal passthrough service worker for the AITC DevTools Launcher PWA.
// Its only job is to satisfy the installability criteria (manifest + SW + HTTPS)
// on Android Chrome — it does no caching, since the framed content is a live,
// ephemeral dev tunnel.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Passthrough: let the network handle every request.
});
