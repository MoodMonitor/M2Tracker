import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onError?: (error: string) => void;
  cData?: string;
  action?: string;
  theme?: 'light' | 'dark' | 'auto';
  appearance?: 'always' | 'execute' | 'interaction-only';
  size?: 'normal';
  variant?: 'visible' | 'invisible';
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, params: any) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
      execute: (widgetId: string) => void;
    };
    onloadTurnstileCallback?: () => void;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

const loadTurnstileScript = () => {
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="challenges.cloudflare.com"]')) {
        if (window.turnstile) {
          resolve();
        } else {
          // Script exists but turnstile not on window yet — poll for it
          const interval = setInterval(() => {
            if (window.turnstile) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        }
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback';
      script.async = true;
      script.defer = true;

      window.onloadTurnstileCallback = () => {
        resolve();
      };

      script.onerror = () => {
        reject(new Error('Failed to load Turnstile script.'));
        turnstileScriptPromise = null;
      };

      document.head.appendChild(script);
    });
  }
  return turnstileScriptPromise;
};

export interface TurnstileWidgetHandle {
  execute: () => void;
  reset: () => void;
  isReady: boolean;
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(({ onVerify, onError, cData, action, theme = 'dark', appearance = 'always', size = 'normal', variant = 'visible'}: TurnstileWidgetProps, ref) => {
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const lastOptionsRef = useRef<{ cData?: string; action?: string; theme?: string; appearance?: string; size?: string; } | null>(null);
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  useEffect(() => { onVerifyRef.current = onVerify; }, [onVerify]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    let isMounted = true;

    const renderWidget = () => {
      if (!widgetContainerRef.current || !window.turnstile) return;

      try {
        const opts = { cData, action, theme, appearance, size };
        const optsChanged = JSON.stringify(opts) !== JSON.stringify(lastOptionsRef.current);

        // Remove and recreate widget when options change
        if (widgetIdRef.current && optsChanged) {
          try { window.turnstile?.remove(widgetIdRef.current); } catch {}
          widgetIdRef.current = null;
        }

        // Widget already exists and options unchanged — just reset it
        if (widgetIdRef.current) {
          try { window.turnstile.reset(widgetIdRef.current); } catch {}
          return;
        }
        const isInvisible = variant === 'invisible';
        const siteKey = isInvisible
          ? import.meta.env.VITE_TURNSTILE_INVISIBLE_SITE_KEY
          : import.meta.env.VITE_TURNSTILE_SITE_KEY;

        if (!siteKey) {
          const missingKeyName = isInvisible
            ? 'VITE_TURNSTILE_INVISIBLE_SITE_KEY'
            : 'VITE_TURNSTILE_SITE_KEY';
          const errorMsg = `Missing required Turnstile site key: ${missingKeyName}`;
          if (isMounted) {
            setLoadError(errorMsg);
            setIsReady(false);
          }
          onErrorRef.current?.(errorMsg);
          return;
        }

        if (import.meta.env.DEV) {
          console.log('[Turnstile] Rendering widget. Have site key:', Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY));
        }

        widgetIdRef.current = window.turnstile.render(widgetContainerRef.current, {
          sitekey: siteKey,
          theme,
          cData,
          action,
          appearance,
          size,
          callback: (token: string) => {
            if (isMounted) onVerifyRef.current?.(token);
          },
          'error-callback': (errorCode: string) => {
            const errorMsg = `Turnstile error: ${errorCode}`;
            console.error('[Turnstile]', errorMsg);

            // Retry logic for transient errors
            if (isMounted && retryCountRef.current < maxRetries && (errorCode === 'timeout' || errorCode === 'network')) {
              retryCountRef.current += 1;
              const delay = 2000 * retryCountRef.current; // exponential backoff
              setTimeout(() => {
                try {
                  if (widgetIdRef.current && window.turnstile) {
                    window.turnstile.reset(widgetIdRef.current);
                  }
                } catch (e) {
                  console.warn('[Turnstile] Reset failed during retry:', e);
                }
              }, delay);
              return;
            }

            if (isMounted) onErrorRef.current?.(errorMsg);
          },
          'expired-callback': () => {
            if (widgetIdRef.current && window.turnstile) {
              try { window.turnstile.reset(widgetIdRef.current); } catch {}
            }
          },
        });


        if (isMounted) setIsReady(true);
        lastOptionsRef.current = opts;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Failed to initialize Turnstile widget';
        if (isMounted) onErrorRef.current?.(errorMsg);
        if (isMounted) setIsReady(false);
      }
    };

    const setup = async () => {
      try {
        await loadTurnstileScript();
        if (!isMounted) return;
        setIsLoading(false);
        setLoadError(null);
        renderWidget();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred.';
        if (isMounted) {
          setLoadError(errorMsg);
          onErrorRef.current?.(errorMsg);
          setIsLoading(false);
        }
      }
    };

    setup();

    return () => {
      isMounted = false;
      // Remove widget on unmount to prevent leaks on route changes
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
        widgetIdRef.current = null;
      }
      setIsReady(false);
    };
  }, [cData, action, theme, appearance, size, variant]);

  useImperativeHandle(ref, () => ({
    execute: () => {
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
          window.turnstile.execute(widgetIdRef.current);
        }
      } catch {}
    },
    reset: () => {
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      } catch {}
    },
    isReady
  }), [widgetIdRef, isReady]);

  return (
    <div className="flex w-full flex-col items-center justify-center">
      {loadError && <div className="text-sm text-red-400 mb-4">{loadError}</div>}
      <div
        ref={widgetContainerRef}
        className="flex items-center justify-center"
        data-size={size}
      >
        {isLoading && !loadError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Ładowanie weryfikacji...</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default TurnstileWidget;
