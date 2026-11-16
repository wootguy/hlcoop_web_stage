// The player used to need a cross-origin isolated page for its threads, and this service worker added
// the headers for that on hosts that can't send them (GitHub Pages). It has no threads now, so this
// version removes itself from the browsers that installed it. index.html no longer registers it.
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.registration.unregister()); });
