
import type { AuthChartWorkerResponse } from '@/types/api';
import { endpoints } from '@/config/api'; 
import { establishSession, exportPublicKeyAsBase64Url, signRequest, type SecureSession } from '@/lib/crypto-module';

// --- Main Dashboard Session State ---
let mainEcdhKeyPair: CryptoKeyPair | null = null;
let mainSecureSession: SecureSession | null = null;

// --- Chart-specific Session State ---
let chartEcdhKeyPair: CryptoKeyPair | null = null;
let chartSecureSession: SecureSession | null = null;

// --- Chart Authentication Flow State ---
let chartAuthPromise: Promise<void> | null = null;
let resolveChartAuthPromise: (() => void) | null = null;
let rejectChartAuthPromise: ((reason?: any) => void) | null = null;

/**
 * Returns the current main secure session.
 * CRITICAL: This function must only be called from within the webWorker.
 */
export function getMainSecureSession(): SecureSession | null {
  if (mainSecureSession && mainSecureSession.expiry > Date.now()) {
    return mainSecureSession;
  }
  return null;
}

/**
 * Invalidates the main dashboard session, forcing re-authentication on the next secure request.
 * This is typically called after receiving a 401 Unauthorized response.
 */
export function invalidateMainSession(): void {
  mainSecureSession = null;
  mainEcdhKeyPair = null;
}

export function updateMainSessionExpiry(newExpiry: number): void {
  if (mainSecureSession) {
    mainSecureSession.expiry = newExpiry;
  }
}

/**
 * Returns the current chart secure session.
 * CRITICAL: This function must only be called from within the webWorker.
 */
export function getChartSecureSession(): SecureSession | null {
  if (chartSecureSession && chartSecureSession.expiry > Date.now()) {
    return chartSecureSession;
  }
  return null;
}

/**
 * Invalidates the chart session, forcing re-authentication on the next secure request.
 */
export function invalidateChartSession(): void {
  chartSecureSession = null;
  chartEcdhKeyPair = null;
}

// --- Main Session Handlers ---

export async function handleGetPublicKey(port: MessagePort) {
  try {
    if (!mainEcdhKeyPair) {
      mainEcdhKeyPair = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    }
    const publicKey = await exportPublicKeyAsBase64Url(mainEcdhKeyPair);
    port.postMessage({ type: 'PUBLIC_KEY_RESPONSE', publicKey });
  } catch (err) {
    port.postMessage({ type: 'ERROR', message: (err as Error)?.message || 'Failed to get public key' });
  }
}

export async function handleVerifyAndAuth(port: MessagePort, data: any) {
  const { token, client_pubkey, authUrl } = data;
  try {
    if (!token || !client_pubkey || !authUrl) {
      throw new Error('Missing token, client_pubkey, or authUrl for VERIFY_AND_AUTH');
    }
    if (!mainEcdhKeyPair) {
      throw new Error('Worker key pair not generated before auth attempt.');
    }
    mainSecureSession = await establishSession(authUrl, token, mainEcdhKeyPair, client_pubkey);
    port.postMessage({ type: 'AUTH_SUCCESS' });
  } catch (err) {
    mainSecureSession = null;
    mainEcdhKeyPair = null; // Important: Clear old key pair on error
    port.postMessage({ type: 'ERROR', message: (err as Error)?.message || 'Auth failed' });
  }
}

// --- Chart Session Handlers ---

/**
 * Finishes the handshake process after receiving data from the backend.
 * Uses webWorker-specific info for HKDF to maintain key separation.
 */
async function finishChartHandshake(sessionData: AuthChartWorkerResponse, keyPair: CryptoKeyPair): Promise<SecureSession> {
  const { server_pubkey, salt, ttl } = sessionData;
  const mainSession = getMainSecureSession();

  if (!mainSession || !mainSession.sid) {
    throw new Error('Cannot finalize chart handshake: main session SID is missing.');
  }

  if (!server_pubkey || !salt || typeof ttl !== 'number' || !keyPair) {
    throw new Error('Invalid cryptographic data received to finalize chart handshake');
  }

  const serverPublicKey = await crypto.subtle.importKey('raw', base64UrlToUint8Array(server_pubkey), { name: 'X25519' }, true, []);
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'X25519', public: serverPublicKey }, keyPair.privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveKey']);

  // Worker-specific info ensures separation from other clients
  const keyEnc = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt: base64UrlToUint8Array(salt), info: new TextEncoder().encode('keyEnc_worker'), hash: 'SHA-256' },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  const keySig = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt: base64UrlToUint8Array(salt), info: new TextEncoder().encode('keySig_worker'), hash: 'SHA-256' },
    hkdfKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  );

  return { keyEnc, keySig, sid: mainSession.sid, expiry: Date.now() + ttl * 1000 };
}

/**
 * Handles the Turnstile token response from the main thread to authenticate the chart webWorker.
 */
export async function handleTurnstileResponse(data: any) {
  const { token, chartId } = data;

  if (!chartEcdhKeyPair || !resolveChartAuthPromise || !rejectChartAuthPromise) {
    console.error('[Worker/Session] Received Turnstile token but no auth process was pending.');
    return;
  }

  try {
    const mainSession = getMainSecureSession();
    if (!mainSession) {
      throw new Error("Cannot authenticate chart webWorker: main dashboard session not established.");
    }

    const workerPublicKey = await exportPublicKeyAsBase64Url(chartEcdhKeyPair);

    const request = new Request(endpoints.authChartWorker(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, client_pubkey: workerPublicKey })
    });

    // Sign the chart-auth request using the main dashboard session
    const signedRequest = await signRequest(request, mainSession, [], 'worker-auth');
    const response = await fetch(signedRequest);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(errorBody.detail || `Authentication failed with status: ${response.status}`);
    }
    const sessionData: AuthChartWorkerResponse = await response.json();

    chartSecureSession = await finishChartHandshake(sessionData, chartEcdhKeyPair);
    (self as any).postMessage({ type: 'WORKER_AUTH_SUCCESS', chartId });
    resolveChartAuthPromise();
  } catch (err) {
    (self as any).postMessage({
      type: 'WORKER_AUTH_FAILURE',
      chartId,
      error: (err as Error).message
    });
    rejectChartAuthPromise(err);
  }
}


/**
 * Gate function to ensure the webWorker has an active session before performing a secure operation.
 * If no session is active, it initiates the authentication flow by requesting a Turnstile challenge.
 */
export function ensureChartAuthenticated(chartId: string): Promise<void> {
  // If session is already active, we're good.
  if (getChartSecureSession()) {
    return Promise.resolve();
  }

  // If an authentication process is already in progress, join it.
  if (chartAuthPromise) {
    return chartAuthPromise;
  }

  // Start a new authentication process.
  chartAuthPromise = new Promise(async (resolve, reject) => {
    resolveChartAuthPromise = resolve;
    rejectChartAuthPromise = reject;


    if (!chartEcdhKeyPair) {
      chartEcdhKeyPair = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    }
    const workerPublicKey = await exportPublicKeyAsBase64Url(chartEcdhKeyPair);

    (self as any).postMessage({
      type: 'REQUEST_TURNSTILE_CHALLENGE',
      chartId,
      workerPublicKey
    });
  }).finally(() => {
    // Clean up state after completion (success or failure).
    chartAuthPromise = null;
    resolveChartAuthPromise = null;
    rejectChartAuthPromise = null;
  });

  return chartAuthPromise;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const binaryString = atob(base64 + pad);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}