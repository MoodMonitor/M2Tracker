import { endpoints } from '@/config/api.ts';
import { HttpError } from '../services/httpError.ts';
import { workerService } from './workerService.ts';
import { eventBus } from '@/lib/eventBus.ts';

// --- Self-contained Type Definitions for Web Worker Communication ---

// Base interfaces
interface WWMessage {
  type: string;
}
interface WWResponse {
  type: string;
}

// --- Request Messages to Web Worker ---

// Auth flow
interface GetPublicKeyMessage extends WWMessage {
  type: 'GET_PUBLIC_KEY';
}
interface VerifyAndAuthMessage extends WWMessage {
  type: 'VERIFY_AND_AUTH';
  token: string;
  client_pubkey: string;
  authUrl: string;
}
interface CheckSessionStatusMessage extends WWMessage {
  type: 'CHECK_SESSION_STATUS';
  statusUrl: string;
}

// API delegation
export interface FetchApiMessage extends WWMessage {
  type: 'FETCH_API';
  url: string;
  // We only pass serializable parts of RequestInit
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string; // Body is always stringified JSON
    credentials?: RequestCredentials;
  };
}

type WebWorkerRequest = GetPublicKeyMessage | VerifyAndAuthMessage | CheckSessionStatusMessage | FetchApiMessage;

// --- Response Messages from Web Worker ---

// Auth flow
interface PublicKeyResponseMessage extends WWResponse {
  type: 'PUBLIC_KEY_RESPONSE';
  publicKey: string;
}
interface AuthSuccessMessage extends WWResponse {
  type: 'AUTH_SUCCESS';
}
interface SessionValidMessage extends WWResponse {
  type: 'SESSION_VALID';
}

// API delegation
export interface FetchApiSuccessResponse extends WWResponse {
  type: 'FETCH_API_SUCCESS';
  data: any;
}

export interface FetchApiErrorResponse extends WWResponse {
  type: 'FETCH_API_ERROR';
  status: number;
  statusText: string;
  body: any;
}

// Generic error
interface ErrorMessage extends WWResponse {
  type: 'ERROR';
  message: string;
}


export type FetchApiResponse = FetchApiSuccessResponse | FetchApiErrorResponse;
type WebWorkerResponse = PublicKeyResponseMessage | AuthSuccessMessage | SessionValidMessage | FetchApiResponse | ErrorMessage;

class WebWorkerManager {
  private worker: Worker;

  constructor() {
    // Get the singleton webWorker instance
    this.worker = workerService.worker;
    this.setupGlobalListeners();
  }

  /**
   * Sets up a global listener for messages that are broadcast from the worker,
   * not sent via MessageChannel. This is for events like session expiration.
   */
  private setupGlobalListeners(): void {
    this.worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'SESSION_EXPIRED') {
        eventBus.emit('session:expired', undefined);
      }
    });
  }

  public sendMessage<T extends WebWorkerResponse>(message: WebWorkerRequest, transfer?: Transferable[], timeoutMs = 15000): Promise<T> {
    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();

      const timeout = window.setTimeout(() => {
        messageChannel.port1.close();
        reject(new Error(`Web Worker message timeout for type: ${message.type}`));
      }, timeoutMs);

      messageChannel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        const data = event.data as WebWorkerResponse;
        if (data?.type === 'ERROR') {
          reject(new Error((data as ErrorMessage).message));
        } else {
          resolve(data as T);
        }
      };
      messageChannel.port1.onerror = (error) => {
        window.clearTimeout(timeout);
        reject(error);
      };

      this.worker.postMessage(message, transfer ? [...transfer, messageChannel.port2] : [messageChannel.port2]);
    });
  }

  async getPublicKey(): Promise<string | null> {
    try {
      const response = await this.sendMessage<PublicKeyResponseMessage>({ type: 'GET_PUBLIC_KEY' });
      return response.publicKey;
    } catch (error) {
      console.error('[WW Manager] Failed to get public key:', error);
      return null;
    }
  }

  async verifyAndAuthenticate(token: string, client_pubkey: string): Promise<boolean> {
    try {
      const response = await this.sendMessage<AuthSuccessMessage>({
        type: 'VERIFY_AND_AUTH',
        token,
        client_pubkey,
        authUrl: endpoints.authDashboard(), // Pass the auth URL to the webWorker
      });
      return response?.type === 'AUTH_SUCCESS';
    } catch (error) {
      console.error('[WW Manager] Authentication via WW failed:', error);
      return false;
    }
  }

  async checkSessionStatus(): Promise<boolean> {
    try {
      const response = await this.sendMessage<SessionValidMessage>({
        type: 'CHECK_SESSION_STATUS',
        statusUrl: endpoints.authStatus(),
      });
      // If the worker returns SESSION_VALID, it means the session is active.
      return response?.type === 'SESSION_VALID';
    } catch (error) {
      return false;
    }
  }

  /**
   * Delegates a fetch request to the Web Worker for signing and execution.
   * @throws {HttpError} If the API returns an error status.
   */
  async fetchApi<T>(url: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    const transferables: Transferable[] = [];
    // @ts-expect-error: read our custom FormData config from options
    const formDataConfig = options.formDataConfig as {
      blob: Blob;
      fileName: string;
      mimeType: string;
      fileFieldName: string;
      jsonFieldName: string;
    } | undefined;

    const serializableOptions = {
      method: options.method,
      headers: Object.fromEntries(headers.entries()),
      body: options.body as string | undefined,
      credentials: options.credentials,
    };

    const message: FetchApiMessage = {
      type: 'FETCH_API',
      url,
      options: serializableOptions,
      ...(formDataConfig && { formDataConfig })
    };

    if (formDataConfig?.blob) {
      const arrayBuffer = await formDataConfig.blob.arrayBuffer();
      // @ts-expect-error: attach buffer to message for transfer
      message.attachedArrayBuffer = arrayBuffer;
      transferables.push(arrayBuffer);
    }
    
    const response = await this.sendMessage<FetchApiResponse>(message, transferables);

    if (response.type === 'FETCH_API_SUCCESS') {
      return (response as FetchApiSuccessResponse).data as T;
    } else if (response.type === 'FETCH_API_ERROR') {
      const errorData = response as FetchApiErrorResponse;
      // Reconstruct HttpError to maintain consistent error handling across the app
      throw new HttpError(new Response(JSON.stringify(errorData.body), { status: errorData.status, statusText: errorData.statusText }), errorData.body);
    } else {
      throw new Error('Received an unexpected response type from Web Worker for API fetch.');
    }
  }

}

export const webWorkerManager = Object.freeze(new WebWorkerManager());