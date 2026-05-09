// CrossLang Service Worker - Basic offline caching
const CACHE_NAME = 'crosslang-v1';
const ASSETS = [
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/js/audio-devices.js',
    '/js/speech-service.js',
    '/manifest.json'
];

// Install - cache assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate - clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', event => {
    // Skip non-GET and cross-origin requests
    if (event.request.method !== 'GET') return;

    // For Azure SDK and API calls, always use network
    if (event.request.url.includes('aka.ms') ||
        event.request.url.includes('microsoft') ||
        event.request.url.includes('speech.')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
