/// <reference lib="webworker" />

// M2Tracker Service Worker
// Handles API caching (Cache-First with TTL) and runtime configuration.
// Accepts SET_CONFIG from the app to align with src/config/api.ts (swConfig).
// Falls back to sensible defaults if no config is provided.

// --- Runtime Config (mutable) ---
const CURRENT_ORIGIN = self.location.origin;
let API_BASE_URL = `${CURRENT_ORIGIN}/api/v1`;
let API_ORIGIN = new URL(API_BASE_URL).origin;
let CACHE_NAME = 'm2tracker-secure-api-cache-v3';
let CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let CACHEABLE_API_PATHS = [
  '/dashboard/init',
  '/stats/24h',
  '/stats/shops/daily-window',
  '/stats/servers/daily-window',
  '/simple_items/suggest',
  '/bonus_items/suggest',
  '/homepage/init'
];

// Allowlist of origins that SET_CONFIG is permitted to point the SW to.
// This prevents a compromised same-origin page (e.g. via XSS) from
// redirecting the SW cache to an attacker-controlled host.
const DEV_API_ORIGINS = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const ALLOWED_API_ORIGINS: ReadonlySet<string> = new Set([
  CURRENT_ORIGIN,
  ...(import.meta.env.DEV ? DEV_API_ORIGINS : []),
]);

// --- Static Versioning ---
const SW_VERSION = '1.1.0';

// --- Logging helpers ---
const LOG_PREFIX = '[SW]';
const log = (...args) => console.log(LOG_PREFIX, ...args);
const warn = (...args) => console.warn(LOG_PREFIX, ...args);
const error = (...args) => console.error(LOG_PREFIX, ...args);
// Security: ensure the SW is loaded from the expected path to prevent unauthorized registration.
const SCRIPT_PATH = new URL(self.location.href).pathname.replace(/\/@fs\//, '/');
const EXPECTED_PATH = import.meta.env.DEV ? '/src/serviceWorker/worker.ts' : '/sw.js';

if (SCRIPT_PATH !== EXPECTED_PATH) {
  error(`Service Worker loaded from an unexpected path: "${SCRIPT_PATH}". Expected: "${EXPECTED_PATH}".`);
  error('This could be a security risk. The service worker will unregister itself and will not proceed.');

  // Prevent the SW from installing and taking control.
  self.addEventListener('install', (event) => {
    event.waitUntil(self.registration.unregister());
    self.skipWaiting();
  });

  // Throw an error to stop the rest of the script from executing.
  // This prevents any other event listeners (fetch, message, etc.) from being attached.
  throw new Error('Service Worker at invalid location. Halting execution.');
}

// --- Message Handlers ---
const messageHandlers = {
  /** Test readiness of the Service Worker */
  async TEST_READINESS(event: ExtendableMessageEvent) {
    event.ports[0].postMessage({ type: 'READINESS_CONFIRMED' });
  },

  /** Apply runtime configuration from the app */
  async SET_CONFIG(event: ExtendableMessageEvent) {
    try {
      const cfg = event.data?.config || {};
      if (cfg.apiBaseUrl && typeof cfg.apiBaseUrl === 'string') {
        // Validate the URL against the allowlist before applying it.
        // This prevents a compromised page from redirecting SW caching to
        // a third-party origin.
        let parsedOrigin: string;
        try {
          parsedOrigin = new URL(cfg.apiBaseUrl).origin;
        } catch {
          warn('SET_CONFIG: invalid apiBaseUrl, ignoring.', cfg.apiBaseUrl);
          parsedOrigin = '';
        }
        if (parsedOrigin && ALLOWED_API_ORIGINS.has(parsedOrigin)) {
          API_BASE_URL = cfg.apiBaseUrl;
          API_ORIGIN = parsedOrigin;
        } else if (parsedOrigin) {
          warn(`SET_CONFIG: apiBaseUrl origin "${parsedOrigin}" is not in the allowed list. Ignoring.`);
        }
      }
      if (cfg.cacheName) CACHE_NAME = cfg.cacheName;
      if (typeof cfg.cacheTtlMs === 'number') CACHE_TTL = cfg.cacheTtlMs;
      if (Array.isArray(cfg.cacheableApiPaths)) CACHEABLE_API_PATHS = cfg.cacheableApiPaths.slice();

      event.ports[0].postMessage({ type: 'CONFIG_APPLIED' });
    } catch (err) {
      event.ports[0].postMessage({ type: 'ERROR', message: (err as Error)?.message || 'Failed to apply config' });
    }
  },
};

// --- Message Security Helpers ---
function toUtf8Bytes(str) {
  return new TextEncoder().encode(str);
}

function constantTimeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const aView = a instanceof Uint8Array ? a : new Uint8Array(a);
  const bView = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (aView.byteLength !== bView.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aView.length; i++) diff |= aView[i] ^ bView[i];
  return diff === 0;
}

async function getClientOriginFromEvent(event: ExtendableMessageEvent): Promise<string | null> {
  try {
    const src = event.source;
    if (src && 'id' in src) {
      const client = await self.clients.get(src.id);
      if (client?.url) return new URL(client.url).origin;
    }
  } catch {}
  return null;
}

async function isTrustedMessageEvent(event: ExtendableMessageEvent): Promise<boolean> {
  // Prefer explicit origin when browser provides it
  if (typeof event.origin === 'string' && event.origin) {
    const expected = self.location.origin;
    return constantTimeEqual(toUtf8Bytes(event.origin), toUtf8Bytes(expected));
  }
  // Fallback: resolve origin from client URL
  const clientOrigin = await getClientOriginFromEvent(event);
  if (clientOrigin) {
    const expected = self.location.origin;
    return constantTimeEqual(toUtf8Bytes(clientOrigin), toUtf8Bytes(expected));
  }
  return false; // reject if we cannot establish origin
}

self.addEventListener('message', async (event: ExtendableMessageEvent) => {
  const port = event.ports && event.ports[0];
  try {
    const trusted = await isTrustedMessageEvent(event);
    if (!trusted) {
      if (port) port.postMessage({ type: 'ERROR', message: 'Untrusted message origin' });
      return;
    }

    const type = event.data?.type;
    const handler = messageHandlers[type];
    if (handler) await handler(event);
  } catch (err) {
    if (port) port.postMessage({ type: 'ERROR', message: (err as Error)?.message || 'Message handling error' });
  }
});

// --- Lifecycle & Fetch ---
self.addEventListener('install', (e: ExtendableEvent) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e: ExtendableEvent) => {
  e.waitUntil(
    (async () => {
      // Clean up old caches
      const cacheNames = await self.caches.keys();
      await Promise.all(cacheNames.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null)));

      // Claim all clients to ensure immediate control after activation
      await self.clients.claim();

      // Broadcast that we've claimed control
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_CLAIMED_CONTROL' });
      });
    })()
  );
});

self.addEventListener('fetch', (e: FetchEvent) => {
  const url = new URL(e.request.url);

  // Only handle cacheable GET requests to the API origin; skip navigation and auth paths
  const isCacheableApiGetRequest = e.request.method === 'GET' && url.origin === API_ORIGIN && !url.pathname.startsWith('/auth/');

  if (e.request.mode === 'navigate' || !isCacheableApiGetRequest) {
    return;
  }
  
  e.respondWith(handleApiRequest(e));
});

/**
 * Cache-first (with TTL) strategy for API requests.
 * Session-agnostic: signing is done by the Web Worker; this SW just caches and proxies.
 */
async function handleApiRequest(event: FetchEvent): Promise<Response> {
  const { request, clientId } = event;
  const url = new URL(request.url);
  const isCacheable = CACHEABLE_API_PATHS.some((path) => url.pathname.includes(path));

  if (isCacheable) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      const cachedTimestamp = Number(cachedResponse.headers.get('X-SW-Cached-At') || 0);
      const isFresh = Date.now() - cachedTimestamp < CACHE_TTL;

      if (isFresh) {
        const headers = new Headers(cachedResponse.headers);
        headers.set('X-SW-Version', SW_VERSION);
        headers.set('X-SW-Cache-Status', 'HIT');
        return new Response(cachedResponse.body, { status: cachedResponse.status, statusText: cachedResponse.statusText, headers });
      }
      await cache.delete(request);
    }
  }

  try {
    const newHeaders = new Headers(request.headers);
    newHeaders.set('X-SW-Version', SW_VERSION);
    if (clientId) newHeaders.set('X-Client-ID', clientId);
    newHeaders.set('X-SW-Cache-Status', 'MISS');

    const enhancedRequest = new Request(request, { headers: newHeaders });
    const networkResponse = await fetch(enhancedRequest);

    if (isCacheable && networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      const responseToCache = await addTimestampToResponse(networkResponse.clone());
      await cache.put(request, responseToCache);
    }

    return networkResponse;
  } catch (err) {
    error('Network request failed:', err);
    throw err;
  }
}

/** Add a SW-side timestamp header used for TTL-based cache freshness. */
async function addTimestampToResponse(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set('X-SW-Cached-At', Date.now().toString());
  const blob = await response.blob();
  return new Response(blob, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
