const CACHE_NAME = "myhistree-v0.6.6c";

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { self.clients.claim(); });
self.addEventListener("fetch", (e) => { /* Pass-through, no caching */ });
