// The live view's player used to need the dashboard to be cross-origin isolated for its threads, and
// this service worker added the headers for that, which GitHub Pages can't send. The player has no
// threads now, so this version removes itself from the browsers that installed it (live_view.js no
// longer registers it).
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.registration.unregister()); });
