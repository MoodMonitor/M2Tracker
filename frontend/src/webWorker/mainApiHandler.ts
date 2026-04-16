
import { signRequest, createSignatureHeaders, type SecureSession } from '@/lib/crypto-module';
import { getMainSecureSession, invalidateMainSession, updateMainSessionExpiry } from './session.ts';
import { apiConfig, securityConfig } from '@/config/api.ts';

/**
 * Converts a base64url encoded string to a Uint8Array.
 * @param base64Url The base64url encoded string.
 * @returns The corresponding Uint8Array.
 */
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const binaryString = atob(base64 + pad);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

/**
 * Decrypts an API response if it has the X-Enc=1 header.
 * Otherwise, it parses it as plain JSON.
 * @param response The fetch Response object.
 * @param session The active secure session containing the decryption key.
 * @returns The parsed JSON data from the response body.
 */
async function getResponseData(response: Response, session: SecureSession | null): Promise<any> {
  const contentLength = response.headers.get('Content-Length');
  const isEmptyBody = contentLength === '0' || response.status === 204 || response.status === 202;

  if (isEmptyBody) {
    return {};
  }

  // If the response is not encrypted, parse it as JSON directly.
  if (response.headers.get('X-Enc') !== '1') {
    return response.json();
  }

  // From here, we handle an encrypted response.
  if (!session) {
    throw new Error('Cannot decrypt response: No active session available.');
  }

  const ivHeader = response.headers.get('X-IV');
  if (!ivHeader) {
    throw new Error('Encrypted response is missing the X-IV header.');
  }

  try {
    const iv = base64UrlToUint8Array(ivHeader);
    const ciphertext = await response.arrayBuffer();

    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, session.keyEnc, ciphertext);

    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decryptedText);
  } catch (e) {
    console.error('[Worker/API] Decryption or parsing failed:', e);
    throw new Error('Failed to decrypt or parse the API response.');
  }
}

/**
 * Handles a request to check if the current main session is still valid.
 * It makes a signed request to the /auth/status endpoint.
 *
 * @param port The MessagePort to send the response back on.
 * @param data The message data containing the status URL.
 */
export async function handleCheckSessionStatus(port: MessagePort, data: { statusUrl: string }) {
  const { statusUrl } = data;
  const mainSession = getMainSecureSession();

  // If there's no session locally in the worker, it's definitely not valid.
  if (!mainSession) {
    port.postMessage({ type: 'ERROR', message: 'No active session in worker.' });
    return;
  }

  try {
    const request = new Request(statusUrl);
    // This request MUST be signed to be validated by the backend middleware.
    const signedRequest = await signRequest(request, mainSession, [], 'sw');

    const response = await fetch(signedRequest);

    // The backend returns 204 if the session is valid.
    if (response.status === 204) {
      port.postMessage({ type: 'SESSION_VALID' });
    } else {
      // Any other status (like 401) means the session is invalid.
      invalidateMainSession(); // Clean up the invalid session
      port.postMessage({ type: 'ERROR', message: `Session invalid. Status: ${response.status}` });
    }
  } catch (error) {
    port.postMessage({ type: 'ERROR', message: error instanceof Error ? error.message : 'Failed to check session status.' });
  }
}

/**
 * Handles generic API fetch requests delegated from the main application thread.
 * It signs the request using the main dashboard session and executes the fetch.
 * The response is then sent back to the main thread via the provided MessagePort.
 *
 * @param port The MessagePort to send the response back on.
 * @param data The message data containing URL and request options.
 */
export async function handleFetchApi(port: MessagePort, data: { url: string; options: RequestInit }) {
  const { url, options, attachedArrayBuffer, formDataConfig } = data as any;

  // Only allow requests to same origin or configured API origin
  const requestOrigin = new URL(url).origin;
  const allowedOrigins = [self.location.origin, new URL(apiConfig.baseUrl).origin];

  if (!allowedOrigins.includes(requestOrigin)) {
    console.error(`[Worker/API] Request to disallowed origin blocked: ${requestOrigin}`);
    port.postMessage({ type: 'FETCH_API_ERROR', status: 403, statusText: 'Forbidden', body: { detail: 'Request to a disallowed origin was blocked.' } });
    return;
  }

  try {
    const mainSession = getMainSecureSession();
    const isPublic = securityConfig.publicApiPaths.some((path) => new URL(url).pathname.includes(path));
    const isFormDataRequest = !!attachedArrayBuffer && !!formDataConfig;

    const request = new Request(url, { ...options });
    let finalRequest = request;

    if (isFormDataRequest && mainSession) {
      const newFile = new File([attachedArrayBuffer], formDataConfig.fileName, { type: formDataConfig.mimeType });
      const formData = new FormData();
      formData.append(formDataConfig.jsonFieldName, options.body as string);
      formData.append(formDataConfig.fileFieldName, newFile, formDataConfig.fileName);
      const signedHeaders = await createSignatureHeaders(request, mainSession, [], 'ai-feedback');
      signedHeaders.delete('Content-Type');
      finalRequest = new Request(url, { method: 'POST', headers: signedHeaders, body: formData });
    } else if (!isPublic && mainSession) {
      const signedHeaders = await createSignatureHeaders(request, mainSession, [], 'sw');
      finalRequest = new Request(request, { headers: signedHeaders });
    }

    const response = await fetch(finalRequest);

    if (response.status === 401) {
      invalidateMainSession();
      self.postMessage({ type: 'SESSION_EXPIRED' });
      const body = await response.json().catch(() => ({ detail: 'Session expired' }));
      port.postMessage({ type: 'FETCH_API_ERROR', status: 401, statusText: 'Unauthorized', body });
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      port.postMessage({ type: 'FETCH_API_ERROR', status: response.status, statusText: response.statusText, body });
      return;
    }

    // Update session TTL on successful response (sliding sessions)
    const newExpiryHeader = response.headers.get('X-Session-Expires-At');
    if (newExpiryHeader) {
      const newExpiry = Number(newExpiryHeader);
      if (!isNaN(newExpiry) && newExpiry > Date.now()) updateMainSessionExpiry(newExpiry);
    }

    const responseData = await getResponseData(response, mainSession);
    port.postMessage({ type: 'FETCH_API_SUCCESS', data: responseData });
  } catch (error) {
    port.postMessage({
      type: 'FETCH_API_ERROR',
      status: 500,
      statusText: 'Worker execution error',
      body: { detail: error instanceof Error ? error.message : 'An unknown error occurred in the webWorker.' },
    });
  }
}