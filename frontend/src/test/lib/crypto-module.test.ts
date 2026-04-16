import { describe, it, expect, beforeAll } from 'vitest';
import { base64UrlToUint8Array, createSignatureHeaders, exportPublicKeyAsBase64Url } from '@/lib/crypto-module';
import type { SecureSession } from '@/lib/crypto-module';

// ---------------------------------------------------------------------------
// base64UrlToUint8Array
// ---------------------------------------------------------------------------

describe('base64UrlToUint8Array', () => {
  const toBase64Url = (bytes: Uint8Array): string => {
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const encoded = toBase64Url(original);
    const decoded = base64UrlToUint8Array(encoded);
    expect(decoded).toEqual(original);
  });

  it('handles length % 4 === 0 (no padding needed)', () => {
    // "AAAA" decodes to 3 zero bytes
    const decoded = base64UrlToUint8Array('AAAA');
    expect(decoded).toEqual(new Uint8Array([0, 0, 0]));
  });

  it('handles length % 4 === 2 (needs 2 padding chars)', () => {
    // Base64url of [0] is "AA"
    const decoded = base64UrlToUint8Array('AA');
    expect(decoded[0]).toBe(0);
  });

  it('handles length % 4 === 3 (needs 1 padding char)', () => {
    // Base64url of [0, 0] is "AAA"
    const decoded = base64UrlToUint8Array('AAA');
    expect(decoded).toEqual(new Uint8Array([0, 0]));
  });

  it('converts - and _ back to + and /', () => {
    // Create a known base64url with - and _
    const original = new Uint8Array([251, 255]); // encodes to +/8= in standard base64 → -_8 in base64url
    const encoded = toBase64Url(original);
    const decoded = base64UrlToUint8Array(encoded);
    expect(decoded).toEqual(original);
  });

  it('decodes a 32-byte (256-bit) key-sized value', () => {
    const original = new Uint8Array(32).fill(0xAB);
    const encoded = toBase64Url(original);
    const decoded = base64UrlToUint8Array(encoded);
    expect(decoded).toEqual(original);
    expect(decoded.byteLength).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// createSignatureHeaders
// ---------------------------------------------------------------------------

describe('createSignatureHeaders', () => {
  let session: SecureSession;

  beforeAll(async () => {
    // Generate a real HMAC key for signing tests
    const keySig = await crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify']
    );
    const keyEnc = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    session = {
      keyEnc,
      keySig,
      sid: 'test-session-id',
      expiry: Date.now() + 60_000, // valid for 1 minute
    };
  });

  it('always sets X-Client-Type header', async () => {
    const request = new Request('https://api.example.com/api/v1/test');
    const headers = await createSignatureHeaders(request, session, [], 'sw');
    expect(headers.get('X-Client-Type')).toBe('sw');
  });

  it('always sets Authorization header with Bearer + sid', async () => {
    const request = new Request('https://api.example.com/api/v1/test');
    const headers = await createSignatureHeaders(request, session, [], 'sw');
    expect(headers.get('Authorization')).toBe(`Bearer ${session.sid}`);
  });

  it('sets X-TS, X-Nonce, X-Sig for non-public paths with active session', async () => {
    const request = new Request('https://api.example.com/api/v1/items');
    const headers = await createSignatureHeaders(request, session, [], 'sw');
    expect(headers.get('X-TS')).toBeTruthy();
    expect(headers.get('X-Nonce')).toBeTruthy();
    expect(headers.get('X-Sig')).toBeTruthy();
  });

  it('does NOT set X-Sig for public paths', async () => {
    const request = new Request('https://api.example.com/api/v1/public/resource');
    const headers = await createSignatureHeaders(request, session, ['/public/'], 'sw');
    expect(headers.get('X-Sig')).toBeNull();
    expect(headers.get('X-TS')).toBeNull();
    expect(headers.get('X-Nonce')).toBeNull();
  });

  it('does NOT set X-Sig when session is expired', async () => {
    const expiredSession: SecureSession = { ...session, expiry: Date.now() - 1000 };
    const request = new Request('https://api.example.com/api/v1/items');
    const headers = await createSignatureHeaders(request, expiredSession, [], 'sw');
    expect(headers.get('X-Sig')).toBeNull();
  });

  it('X-TS is a recent Unix timestamp (ms)', async () => {
    const before = Date.now();
    const request = new Request('https://api.example.com/api/v1/items');
    const headers = await createSignatureHeaders(request, session, [], 'sw');
    const after = Date.now();
    const ts = Number(headers.get('X-TS'));
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('X-Nonce is a UUID-like string (unique per call)', async () => {
    const request = new Request('https://api.example.com/api/v1/items');
    const h1 = await createSignatureHeaders(request, session, [], 'sw');
    const h2 = await createSignatureHeaders(request, session, [], 'sw');
    expect(h1.get('X-Nonce')).not.toBe(h2.get('X-Nonce'));
  });

  it('skips body hash for ai-feedback client type', async () => {
    const request = new Request('https://api.example.com/api/v1/feedback', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
    });
    // Should not throw even though body might be consumed
    const headers = await createSignatureHeaders(request, session, [], 'ai-feedback');
    expect(headers.get('X-Sig')).toBeTruthy();
  });

  it('includes body hash in signature for POST requests', async () => {
    const body = JSON.stringify({ item: 'sword' });
    const req1 = new Request('https://api.example.com/api/v1/items', { method: 'POST', body });
    const req2 = new Request('https://api.example.com/api/v1/items', { method: 'POST', body: JSON.stringify({ item: 'shield' }) });

    const h1 = await createSignatureHeaders(req1, session, [], 'sw');
    const h2 = await createSignatureHeaders(req2, session, [], 'sw');

    // Same endpoint, different body → different signatures
    expect(h1.get('X-Sig')).not.toBe(h2.get('X-Sig'));
  });
});

// ---------------------------------------------------------------------------
// exportPublicKeyAsBase64Url
// ---------------------------------------------------------------------------

describe('exportPublicKeyAsBase64Url', () => {
  it('returns a non-empty base64url string', async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'X25519' },
      false,
      ['deriveBits']
    );
    const exported = await exportPublicKeyAsBase64Url(keyPair);
    expect(typeof exported).toBe('string');
    expect(exported.length).toBeGreaterThan(0);
    // Base64url must not contain +, /, or =
    expect(exported).not.toMatch(/[+/=]/);
  });

  it('returns same value on multiple calls for the same key', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    const a = await exportPublicKeyAsBase64Url(keyPair);
    const b = await exportPublicKeyAsBase64Url(keyPair);
    expect(a).toBe(b);
  });

  it('returns different values for different key pairs', async () => {
    const kp1 = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    const kp2 = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    const a = await exportPublicKeyAsBase64Url(kp1);
    const b = await exportPublicKeyAsBase64Url(kp2);
    expect(a).not.toBe(b);
  });
});

