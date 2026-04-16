import { createRoot } from 'react-dom/client'
import './index.css'
import { GlobalErrorProvider } from './context/GlobalErrorContext.tsx'
import { serviceWorkerManager } from './serviceWorker/serviceWorkerManger.ts'
import { errorReporter } from './lib/errorReporter'

const mswFlag = import.meta.env.VITE_MSW_ENABLED;
const isMswEnabled = mswFlag ? mswFlag === 'true' : import.meta.env.DEV;
const isFixtureRecorderEnabled = import.meta.env.DEV && import.meta.env.VITE_MSW_RECORD_FIXTURES === 'true';
const FORCED_DESKTOP_VIEWPORT_WIDTH = 1280;

// Keep a single runtime source-of-truth that other modules (hooks) can read.
if (typeof window !== 'undefined') {
  (window as Window & { __M2_MSW_ENABLED__?: boolean }).__M2_MSW_ENABLED__ = isMswEnabled;
}

function forceDesktopViewportOnPhone(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const isPhone = /Android|iPhone|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (!isPhone) return;

  const viewportScale = Math.max(0.25, Math.min(1, window.screen.width / FORCED_DESKTOP_VIEWPORT_WIDTH));
  const viewportContent = `width=${FORCED_DESKTOP_VIEWPORT_WIDTH}, initial-scale=${viewportScale}`;

  let viewportMeta = document.querySelector('meta[name="viewport"]');
  if (!viewportMeta) {
    viewportMeta = document.createElement('meta');
    viewportMeta.setAttribute('name', 'viewport');
    document.head.appendChild(viewportMeta);
  }

  viewportMeta.setAttribute('content', viewportContent);
}

forceDesktopViewportOnPhone();

async function unregisterAppServiceWorkerForMsw(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const appRegistrations = registrations.filter((registration) => {
      const scriptUrls = [
        registration.active?.scriptURL,
        registration.waiting?.scriptURL,
        registration.installing?.scriptURL,
      ].filter((url): url is string => typeof url === 'string');

      return scriptUrls.some((url) => url.endsWith('/sw.js') || url.includes('/sw.js?'));
    });

    await Promise.all(appRegistrations.map((registration) => registration.unregister()));
  } catch (error) {
    console.warn('[main] Failed to unregister app service worker before MSW start', error);
  }
}

// Enforce HTTPS in production (except localhost)
if (import.meta.env.PROD) {
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(window.location.host);
  if (window.location.protocol !== 'https:' && !isLocal) {
    window.location.replace('https://' + window.location.host + window.location.pathname + window.location.search);
  }
}

try {
  errorReporter.initGlobalErrorCapture();
} catch (e) {
  console.warn('[main] Failed to init error reporter', e);
}

// Injects scrollbar styles matching the app theme
const GlobalScrollbarStyle = () => (
  <style>{`
    html::-webkit-scrollbar,
    .custom-scrollbar::-webkit-scrollbar {
      width: 12px;
    }

    html::-webkit-scrollbar-track,
    .custom-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }

    html::-webkit-scrollbar-thumb,
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background-color: hsl(45 70% 60% / 0.5);
      border-radius: 20px;
      border: 3px solid transparent;
      background-clip: content-box;
    }

    html::-webkit-scrollbar-thumb:hover,
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background-color: hsl(45 70% 60% / 0.8);
    }

    html {
      scrollbar-width: thin;
      scrollbar-color: hsl(45 70% 60% / 0.7) transparent;
    }
  `}</style>
);

async function renderApp(): Promise<void> {
  const { default: App } = await import('./App.tsx');

  createRoot(document.getElementById('root')!).render(
    <GlobalErrorProvider>
      <GlobalScrollbarStyle />
      <App />
    </GlobalErrorProvider>
  );
}

async function bootstrap(): Promise<void> {
  try {
    if (isMswEnabled && typeof document !== 'undefined' && !document.title.includes('DEMO')) {
      document.title = `${document.title} [DEMO]`;
    }

    if (isFixtureRecorderEnabled) {
      const { installFixtureRecorderBridge } = await import('./mocks/fixtureRecorder');
      installFixtureRecorderBridge();
    }

    if (isMswEnabled) {
      await unregisterAppServiceWorkerForMsw();
      const { worker } = await import('./mocks/browser');
      await worker.start({
        onUnhandledRequest: 'bypass',
        serviceWorker: { url: '/mockServiceWorker.js' },
      });
      console.info('[main] MSW enabled: skipping app service worker registration.');
    } else {
      serviceWorkerManager.register().then((success) => {
        if (!success) console.warn('Service worker registration failed');
      }).catch((error) => {
        console.error('Service worker registration error:', error);
      });
    }
  } catch (error) {
    console.error('[main] Failed to initialize runtime mocks:', error);
  } finally {
    await renderApp();
  }
}

bootstrap();
