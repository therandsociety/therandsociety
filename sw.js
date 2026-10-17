/* Offline support for the Rand Society app.
   The app shell is cached on install. data.json is fetched fresh whenever the network allows and falls back to the
   last good copy, so an edit with a typo never blanks the dashboard. */
var VERSION = '239a423cfe';
var SHELL = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "fonts/fonts.css", "fonts/newsreader.woff2", "fonts/plex-sans-400.woff2", "fonts/plex-sans-500.woff2", "fonts/plex-sans-600.woff2", "fonts/plex-sans-700.woff2", "vendor/preact.min.js", "vendor/hooks.umd.js", "vendor/htm.umd.js", "icons/favicon.svg", "icons/favicon-32.png", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
var SHELL_CACHE = 'trs-shell-' + VERSION;
var DATA_CACHE = 'trs-data';
var MEDIA_CACHE = 'trs-media';

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('trs-shell-') === 0 && k !== SHELL_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function timeout(ms, p) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

function freshData(request) {
  return caches.open(DATA_CACHE).then(function (cache) {
    var lastGood = function () { return cache.match('data.json'); };
    return timeout(3000, fetch(request.url, { cache: 'no-store' })).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.clone().text().then(function (text) {
        try { JSON.parse(text); } catch (e) { return lastGood().then(function (hit) { return hit || res; }); }
        return cache.put('data.json', res.clone()).then(function () { return res; });
      });
    }).catch(function (err) {
      return lastGood().then(function (hit) { if (hit) return hit; throw err; });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('fresh')) return; // the data checker always reads the file as published
  if (/\/cal\//.test(url.pathname)) return;  // calendar feeds go straight to the network
  if (/\/(img|splash)\//.test(url.pathname)) {   // a member's photo is saved the first time it is shown
    event.respondWith(caches.open(MEDIA_CACHE).then(function (cache) {
      return cache.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res.ok) cache.put(req, res.clone()); return res; });
      });
    }));
    return;
  }
  if (/\/data\.json$/.test(url.pathname)) { event.respondWith(freshData(req)); return; }
  if (/\/check\.html$/.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html', { cacheName: SHELL_CACHE }).then(function (hit) {
      return hit || fetch(req);
    }).catch(function () { return fetch(req); }));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); }));
});
