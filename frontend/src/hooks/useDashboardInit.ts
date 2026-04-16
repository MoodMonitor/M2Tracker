import { useEffect, useState, useCallback, useRef } from 'react';
import { serviceWorkerManager } from '../serviceWorker/serviceWorkerManger.ts';
import { webWorkerManager } from '../webWorker/webWorkerManager.ts';
import { eventBus } from '@/lib/eventBus.ts';

export interface DashboardInitState {
  isInitializing: boolean;
  isCheckingSession: boolean;
  error: string | null;
  isTurnstileVerified: boolean;
  publicKey: string | null;
  isServiceWorkerReady: boolean;
  showTurnstileTip: boolean;
}

const TURNSTILE_TOKEN_REGEX = /^[0-9a-zA-Z_.-]{1,4096}$/;

function validateTurnstileToken(token: string): boolean {
  if (!token || token.length < 20 || token.length > 4096) return false;
  if (token.includes('..') || token.startsWith('.') || token.endsWith('.')) return false;
  return TURNSTILE_TOKEN_REGEX.test(token);
}

/**
 * Handles dashboard initialization with the Service Worker-centric auth flow.
 */
export function useDashboardInit() {
  const isMswMode = (() => {
    if (typeof window !== 'undefined') {
      const runtimeFlag = (window as Window & { __M2_MSW_ENABLED__?: boolean }).__M2_MSW_ENABLED__;
      if (typeof runtimeFlag === 'boolean') return runtimeFlag;
    }
    return import.meta.env.VITE_MSW_ENABLED === 'true';
  })();

  const [state, setState] = useState<DashboardInitState>({
    isInitializing: true,
    isCheckingSession: true,
    error: null,
    isTurnstileVerified: false,
    publicKey: null,
    isServiceWorkerReady: false,
    showTurnstileTip: false,
  });

  // Prevent setState after unmount
  const isMountedRef = useRef(true);
  // Prevent re-entry during initialization
  const isInitializingRef = useRef(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const initialize = useCallback(async () => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;

    setState({
      isInitializing: true,
      isCheckingSession: true,
      error: null,
      isTurnstileVerified: false,
      publicKey: null,
      isServiceWorkerReady: false,
      showTurnstileTip: false,
    });

    try {
      // STEP 1: Wait for SW/WW to be ready
      if (!isMswMode) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Initialization timeout')), 15000);
        });
        await Promise.race([serviceWorkerManager.ready(), timeoutPromise]);
      }
      if (!isMountedRef.current) return;
      setState((prev) => ({ ...prev, isServiceWorkerReady: true }));

      // STEP 2: Check for an existing valid session
      const isSessionValid = await webWorkerManager.checkSessionStatus();
      if (!isMountedRef.current) return;

      if (isSessionValid) {
        setState((prev) => ({
          ...prev,
          isInitializing: false,
          isCheckingSession: false,
          isTurnstileVerified: true,
        }));
        return;
      }

      // STEP 3: No valid session — proceed with Turnstile flow
      setState((prev) => ({ ...prev, isCheckingSession: false, showTurnstileTip: true }));

      const pubKey = await webWorkerManager.getPublicKey();
      if (!pubKey) throw new Error('Could not retrieve public key from Web Worker.');

      if (isMountedRef.current) {
        setState((prev) => ({ ...prev, publicKey: pubKey, isInitializing: false }));
      }
    } catch (error) {
      console.error('[AUTH_FLOW] Initialization failed:', error);
      if (isMountedRef.current) {
        const errorMessage = error instanceof Error ? error.message : 'Initialization failed';
        setState((prev) => ({
          ...prev,
          isInitializing: false,
          isCheckingSession: false,
          isServiceWorkerReady: false,
          error: errorMessage,
        }));
      }
    } finally {
      isInitializingRef.current = false;
    }
  }, [isMswMode]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Re-run the full auth flow when the session expires
  useEffect(() => {
    const unsubscribe = eventBus.on('session:expired', () => initialize());
    return () => unsubscribe();
  }, [initialize]);

  const handleTurnstileVerify = useCallback(
    async (token: string) => {
      if (!validateTurnstileToken(token)) {
        const errMsg = 'Invalid Turnstile token received from widget.';
        console.error(`[AUTH_FLOW] ${errMsg}`);
        setState((prev) => ({ ...prev, error: errMsg }));
        return;
      }

      if (!state.publicKey) {
        const errMsg = 'Public key not available. Cannot process Turnstile token.';
        console.error(`[AUTH_FLOW] ${errMsg}`);
        setState((prev) => ({ ...prev, error: errMsg }));
        return;
      }

      setState((prev) => ({ ...prev, error: null }));

      try {
        const isAuthenticated = await webWorkerManager.verifyAndAuthenticate(token, state.publicKey);
        if (isAuthenticated) {
          setState((prev) => ({ ...prev, isTurnstileVerified: true }));
        } else {
          throw new Error('Failed to authenticate the session.');
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Authentication failed';
        console.error('[AUTH_FLOW] Authentication failed:', error);
        setState((prev) => ({ ...prev, error: errMsg }));
      }
    },
    [state.publicKey]
  );

  const handleTurnstileError = useCallback((errorCode: string) => {
    console.error(`[AUTH_FLOW] Turnstile widget error: ${errorCode}`);
    setState((prev) => ({ ...prev, error: `Turnstile widget error: ${errorCode}` }));
  }, []);

  const retry = useCallback(() => initialize(), [initialize]);

  return {
    ...state,
    // true only when Turnstile passed AND Service Worker is ready
    canAccessDashboard: state.isTurnstileVerified && state.isServiceWorkerReady,
    handleTurnstileVerify,
    handleTurnstileError,
    retry,
  };
}
