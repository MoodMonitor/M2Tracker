/// <reference lib="webworker" />

/**
 * Shared module for cryptographic operations and session management.
 * Handles ECDH handshake, key derivation and request signing.
 */

export interface SecureSession {
  keyEnc: CryptoKey;
  keySig: CryptoKey;
  sid: string;
  expiry: number;
}

export function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const binaryString = atob(base64 + pad);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function base64urlEncode(buffer: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function exportPublicKeyAsBase64Url(keyPair: CryptoKeyPair): Promise<string> {
  const exportedPublicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  return base64urlEncode(exportedPublicKey);
}

/**
 * Establishes a secure session with the backend.
 * Performs an ECDH handshake and derives session keys.
 */
export async function establishSession(
  authUrl: string,
  authToken: string,
  ecdhKeyPair: CryptoKeyPair,
  clientPublicKeyB64: string,
  extraHeaders: Record<string, string> = {}
): Promise<SecureSession> {
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ token: authToken, client_pubkey: clientPublicKeyB64 }),
  });

  if (!response.ok) {
    let detail = 'API error during worker authentication';
    try {
      const body = await response.json();
      detail = body?.detail || detail;
    } catch { }
    throw new Error(detail);
  }

  const sessionData = await response.json();
  const { server_pubkey, salt, ttl, sid } = sessionData;

  if (!server_pubkey || !salt || typeof ttl !== 'number' || ttl <= 0 || !sid) {
    throw new Error('Invalid session data received from server');
  }

  const serverPublicKey = await crypto.subtle.importKey(
    'raw',
    base64UrlToUint8Array(server_pubkey),
    { name: 'X25519' },
    true,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'X25519', public: serverPublicKey },
    ecdhKeyPair.privateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveKey']);

  const keyEnc = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt: base64UrlToUint8Array(salt), info: new TextEncoder().encode('keyEnc'), hash: 'SHA-256' },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const keySig = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt: base64UrlToUint8Array(salt), info: new TextEncoder().encode('keySig'), hash: 'SHA-256' },
    hkdfKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  );

  return {
    keyEnc,
    keySig,
    sid,
    expiry: Date.now() + ttl * 1000,
  };
}



export async function createSignatureHeaders(
  request: Request,
  session: SecureSession,
  publicApiPaths: string[] = [],
  clientType: 'sw' | 'worker-auth' | 'worker-data' | 'ai-feedback'
): Promise<Headers> {
  const headers = new Headers(request.headers);
  headers.set('X-Client-Type', clientType);
  headers.set('Authorization', `Bearer ${session.sid}`);
  headers.set('Content-Type', 'application/json');

  const url = new URL(request.url);
  const isPublicPath = publicApiPaths.some((path) => url.pathname.includes(path));

  if (!isPublicPath && session.expiry > Date.now()) {
    const timestampMs = Date.now();
    const nonce = crypto.randomUUID();
    const method = request.method.toUpperCase();
    const path = url.pathname;

    let bodyHash = '';
    if (clientType != 'ai-feedback') {
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body;
      const bodyBuffer = hasBody ? await request.clone().arrayBuffer() : new Uint8Array();
      const bodyHashBuffer = await crypto.subtle.digest('SHA-256', bodyBuffer);
      bodyHash = base64urlEncode(bodyHashBuffer);
    }

    const canonicalString = [method, path, bodyHash, timestampMs.toString(), nonce].join('|');
    const signatureBuffer = await crypto.subtle.sign({ name: 'HMAC' }, session.keySig, new TextEncoder().encode(canonicalString));
    const signature = base64urlEncode(signatureBuffer);

    headers.set('X-TS', timestampMs.toString());
    headers.set('X-Nonce', nonce);
    headers.set('X-Sig', signature);

  }

  return headers
}


/**
 * Returns a new Request enriched with HMAC signature headers.
 */
export async function signRequest(
  request: Request,
  session: SecureSession,
  publicApiPaths: string[] = [],
  clientType: 'sw' | 'worker-auth' | 'worker-data' | 'ai-feedback'
): Promise<Request> {

  const headers = await createSignatureHeaders(request, session, publicApiPaths, clientType)

  const init: RequestInit = {
    headers,
    cache: 'no-store',
  };

  return new Request(request, init);
}