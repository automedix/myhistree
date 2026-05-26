const CACHE_NAME = "myhistoree-v0.4.0";

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { self.clients.claim(); });
self.addEventListener("fetch", (e) => { /* Pass-through, no caching */ });
