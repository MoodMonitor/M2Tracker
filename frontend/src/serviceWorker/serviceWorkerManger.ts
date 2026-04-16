/**
 * Service Worker Management Service
 * Handles registration, communication, and lifecycle of the service worker.
 */

import { swConfig, type ServiceWorkerConfig } from '@/config/api.ts';

// --- Strict Message Type Definitions ---

// Base interfaces
interface SWMessage {
  type: string;
}
interface SWResponse {
  type: string;
}

// Request Messages
export interface TestReadinessMessage extends SWMessage {
  type: 'TEST_READINESS';
}
export interface SetConfigMessage extends SWMessage {
  type: 'SET_CONFIG';
  config: ServiceWorkerConfig;
}


// Union of all possible request messages
export type ServiceWorkerRequest = TestReadinessMessage | SetConfigMessage;

// Response Messages
export interface ReadinessConfirmedMessage extends SWResponse {
  type: 'READINESS_CONFIRMED';
}
export interface ConfigAppliedMessage extends SWResponse {
  type: 'CONFIG_APPLIED';
}
export interface ErrorMessage extends SWResponse {
  type: 'ERROR';
  message: string;
}

// Union of all possible response messages
export type ServiceWorkerResponse =
  | ReadinessConfirmedMessage
  | ConfigAppliedMessage
  | ErrorMessage;

// Module-level state to avoid mutation on a frozen instance
let registration: ServiceWorkerRegistration | null = null;
let isFullyReady = false;

class ServiceWorkerManager {
  private readyPromise: Promise<void>;
  private resolveReadyPromise!: () => void; // Non-null assertion, as it's set in constructor
  private isSupported: boolean;

  constructor() {
    this.isSupported = 'serviceWorker' in navigator;
    // Create a promise that acts as a gate. It will be resolved when the SW is ready.
    this.readyPromise = new Promise((resolve) => (this.resolveReadyPromise = resolve));
  }

  /**
   * Register SW and apply runtime configuration once ready.
   */
  async register(): Promise<boolean> {
    if (!this.isSupported) {
      console.warn('[SW Manager] Service Worker not supported in this browser');
      return false;
    }
    try {
      // Use the source file in development and the built file in production
      const swUrl = import.meta.env.DEV ? '/src/serviceWorker/worker.ts' : '/sw.js';
      registration = await navigator.serviceWorker.register(swUrl, { scope: '/', type: 'module' });      

      // Listen for control claim messages
      const onSwMessage = (event: MessageEvent) => {
        if (event.data?.type === 'SW_CLAIMED_CONTROL') {
          // Trigger readiness check when SW claims control
          if (!isFullyReady) {
            setTimeout(() => this.ensureControllerIsActive(), 100);
          }
        }
      };
      navigator.serviceWorker.addEventListener('message', onSwMessage, { once: true });

      // Start checking for readiness
      this.ensureControllerIsActive();

      this.applyRuntimeConfig(swConfig).catch((err) => console.warn('[SW Manager] Config apply failed:', err));

      return true;
    } catch (error) {
      console.error('[SW Manager] Service worker registration failed:', error);
      return false;
    }
  }

  /**
   * Awaits the readiness of the Service Worker controller.
   */
  public ready(): Promise<void> {
    return this.readyPromise;
  }

  private ensureControllerIsActive() {
    const testServiceWorkerReadiness = async (): Promise<boolean> => {
      // Try controller first, fall back to active registration
      const serviceWorker = navigator.serviceWorker.controller || registration?.active;
      if (!serviceWorker) return false;

      try {
        // First test: check if SW responds to messages
        const messageTest = new Promise<boolean>((resolve) => {
          const messageChannel = new MessageChannel();
          const timeout = setTimeout(() => resolve(false), 2000);

          messageChannel.port1.onmessage = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          messageChannel.port1.onerror = () => {
            clearTimeout(timeout);
            resolve(false);
          };

          serviceWorker.postMessage({ type: 'TEST_READINESS' }, [messageChannel.port2]);
        });

        const canRespondToMessages = await messageTest;
        if (!canRespondToMessages) return false;

        // Second test: check if SW is controlling this client
        const hasController = !!navigator.serviceWorker.controller;
        const activeWorker = registration?.active;
        const isActive = activeWorker?.state === 'activated';
                
        // If SW is active but not controlling, reload to let it take control
        if (isActive && !hasController) {
          // Prevent infinite reload loop by using sessionStorage
          const reloadAttempts = parseInt(sessionStorage.getItem('sw-reload-attempts') || '0');
          if (reloadAttempts < 2) {
            console.log('[SW Manager] SW is active but not controlling. Reloading page... (attempt ' + (reloadAttempts + 1) + ')');
            sessionStorage.setItem('sw-reload-attempts', String(reloadAttempts + 1));
            // Small delay to let logs show
            setTimeout(() => {
              window.location.reload();
            }, 100);
            return false; // Don't proceed until after reload
          } else {
            console.warn('[SW Manager] Max reload attempts reached. Proceeding without controller.');
            sessionStorage.removeItem('sw-reload-attempts');
          }
        }
        
        // If we have controller, clear reload attempts for next time
        if (hasController) {
          sessionStorage.removeItem('sw-reload-attempts');
        }
        
        return hasController;

      } catch {
        return false;
      }
    };

    let attempts = 0;
    const maxAttempts = 20;

    const checkReadiness = async () => {
      if (isFullyReady) {
        this.resolveReadyPromise();
        return;
      }

      const isReady = await testServiceWorkerReadiness();
      attempts++;
      
      if (isReady) {
        isFullyReady = true;
        this.resolveReadyPromise();
      } else if (attempts >= maxAttempts) {
        console.warn('[SW Manager] Service Worker readiness timeout');
        this.resolveReadyPromise(); // Don't hang forever
      } else {
        setTimeout(checkReadiness, 300 + (attempts * 150));
      }
    };

    checkReadiness();
  }

  /**
   * Generic message sender with MessageChannel and basic error handling.
   */
  async sendMessage<T extends ServiceWorkerResponse>(message: ServiceWorkerRequest): Promise<T> {
    // This is the key change: wait for the readiness signal before proceeding.
    await this.ready();

    return new Promise((resolve, reject) => {
      const messageChannel = new MessageChannel();
      const timeout = window.setTimeout(() => {
        messageChannel.port1.close();
        reject(new Error('Service Worker message timeout'));
      }, 10000);

      messageChannel.port1.onmessage = (event) => {
        window.clearTimeout(timeout);
        const data = event.data as ServiceWorkerResponse;
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
      // Use controller if available, otherwise use active registration
      const serviceWorker = navigator.serviceWorker.controller || registration?.active;
      if (!serviceWorker) {
        reject(new Error('No Service Worker available for messaging'));
        return;
      }
      serviceWorker.postMessage(message, [messageChannel.port2]);
    });
  }

  /** Apply runtime config in the SW to keep it aligned with app settings. */
  async applyRuntimeConfig(config: ServiceWorkerConfig): Promise<void> {
    try {
      const res = await this.sendMessage<ConfigAppliedMessage>({ type: 'SET_CONFIG', config: swConfig });
      const ok = res?.type === 'CONFIG_APPLIED';
      return ok;
    } catch (error) {
      console.warn('[SW Manager] Failed to apply runtime config:', error);
      return false;
    }
  }
}

export const serviceWorkerManager = Object.freeze(new ServiceWorkerManager());
