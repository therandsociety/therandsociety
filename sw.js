/* Offline support for the Rand Society app.
   The app shell is cached on install. data.json (dates) and learn.json (the reading programme) are fetched fresh
   whenever the network allows and fall back to the last good copy, so an edit with a typo never blanks the app. */
var VERSION = 'b520dd23a9';
var SHELL = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "fonts/fonts.css", "fonts/newsreader.woff2", "fonts/plex-sans-400.woff2", "fonts/plex-sans-500.woff2", "fonts/plex-sans-600.woff2", "fonts/plex-sans-700.woff2", "fonts/michroma.woff2", "fonts/fraunces-soft.woff2", "vendor/preact.min.js", "vendor/hooks.umd.js", "vendor/htm.umd.js", "icons/favicon.svg", "icons/favicon-32.png", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
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

function freshData(request, name) {
  return caches.open(DATA_CACHE).then(function (cache) {
    var lastGood = function () {
      return cache.match(name).then(function (hit) {
        if (!hit) return hit;
        var h = new Headers(hit.headers); h.set('x-trs-source', 'cache');
        return hit.blob().then(function (b) { return new Response(b, { status: 200, headers: h }); });
      });
    };
    // Ask the server whether the file changed (an unchanged file costs almost no data); a broken file never replaces
    // the last good copy.
    var net = fetch(request.url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.clone().text().then(function (text) {
        try { JSON.parse(text); } catch (e) { return lastGood().then(function (hit) { return hit || res; }); }
        return cache.put(name, res.clone()).then(function () { return res; });
      });
    });
    // On a slow connection the saved copy shows after 3 seconds and the fresh one is saved for next time; with no saved
    // copy yet, keep waiting for the network rather than failing.
    return timeout(3000, net).catch(function () {
      return lastGood().then(function (hit) { if (hit) { net.catch(function () {}); return hit; } return net; });
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
  var json = /\/(data|learn)\.json$/.exec(url.pathname);
  if (json) { event.respondWith(freshData(req, json[1] + '.json')); return; }
  if (/\/check\.html$/.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html', { cacheName: SHELL_CACHE }).then(function (hit) {
      return hit || fetch(req);
    }).catch(function () { return fetch(req); }));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); }));
});
