/// <reference lib="webworker" />

// --- Self-location integrity check ---
const LOG_PREFIX_WW = '[WebWorker]';
const errorWW = (...args: any[]) => console.error(LOG_PREFIX_WW, ...args);

const SCRIPT_PATH_WW = new URL(self.location.href).pathname.replace(/\/@fs\//, '/');
const isPathValid = (() => {
  if (import.meta.env.DEV) {
    // In development, the path is predictable and served by Vite's dev server.
    return SCRIPT_PATH_WW === '/src/webWorker/worker.ts';
  }
  // In production, Vite builds the worker with a hash for cache busting (e.g., /assets/worker-a1b2c3d4.js).
  // This check ensures it's loaded from the expected directory, allowing for the dynamic hash.
  return SCRIPT_PATH_WW.startsWith('/assets/') && SCRIPT_PATH_WW.endsWith('.js');
})();

if (!isPathValid) {
  const expectedPathDesc = import.meta.env.DEV ? '/src/webWorker/worker.ts' : '/assets/worker-*.js';
  errorWW(`Web Worker loaded from an unexpected path: "${SCRIPT_PATH_WW}". Expected a path like: "${expectedPathDesc}".`);
  errorWW('This could be a security risk. Halting execution.');
  // Throw an error to stop the rest of the script from executing.
  // This prevents any message handlers from being attached.
  throw new Error('Web Worker at invalid location. Halting execution.');
}
// --- End of integrity check ---

import { handleEvent as handleLineAndBarEvent, type ChartContext } from '../components/dashboard/lineAndBarChartHandler.ts';
import { handleGetPublicKey, handleVerifyAndAuth, handleTurnstileResponse } from '@/webWorker/session.ts';
import { handleFetchApi, handleCheckSessionStatus } from '@/webWorker/mainApiHandler.ts';
import { handleItemSearch, handleItemHistory } from '@/webWorker/apiHandlers.ts';
import { detectSlots, recognizeItems } from './aiProcessor.ts';

// Ensure canvas renderer is registered in production builds
import 'zrender/lib/canvas/canvas';

const chartContexts = new Map<string, ChartContext>();
const statsContexts = new Map<string, any>();

(globalThis as any).statsContexts = statsContexts;

// --- Main Message Handler ---

self.onmessage = async (e: MessageEvent) => {
  // MessageEvent.isTrusted is always `true` for postMessage — it only distinguishes
  // user-initiated DOM events from scripted ones, so checking it here provides
  // no security benefit and was removed to avoid misleading readers.
  //
  // Security note: this Worker is a *dedicated* (non-shared) Worker instantiated
  // exclusively by webWorkerManager.ts on the main thread. It cannot be reached
  // by cross-origin scripts. Incoming message types are additionally validated
  // against an explicit allowlist below before reaching any handler.

  const d = (e as any).data || {};
  const type: string | undefined = typeof d.type === 'string' ? d.type : undefined;

  // --- Main session management (uses MessageChannel for request/response) ---
  const port = e.ports && e.ports[0];
  if (port && type) {
    switch (type) {
      case 'GET_PUBLIC_KEY':
        await handleGetPublicKey(port);
        return;

      case 'VERIFY_AND_AUTH':
        await handleVerifyAndAuth(port, d);
        return;

      case 'CHECK_SESSION_STATUS':
        await handleCheckSessionStatus(port, d);
        return;

      case 'FETCH_API':
        await handleFetchApi(port, d);
        return;

      case 'AI_CALC_DETECT_SLOTS':
        try {
          const detections = await detectSlots(d.imageBitmap, d.serverName);
          port.postMessage({ type: 'AI_CALC_DETECTION_SUCCESS', detections });
        } catch (error) {
          port.postMessage({ 
            type: 'AI_CALC_DETECTION_ERROR', 
            message: error instanceof Error ? error.message : 'AI detection failed' 
          });
        }
        return;
      
      case 'AI_CALC_RECOGNIZE_ITEMS':
        try {
          const results = await recognizeItems(d.imageBitmap, d.detections, d.serverName);
          port.postMessage({ type: 'AI_CALC_RECOGNITION_SUCCESS', results });
        } catch (error) {
          port.postMessage({
            type: 'AI_CALC_RECOGNITION_ERROR',
            message: error instanceof Error ? error.message : 'AI recognition failed'
          });
        }
        return;

      case 'AI_CALC_ALL_IN_ONE':
        try {
          const detections = await detectSlots(d.imageBitmap, d.serverName);
          const results = await recognizeItems(d.imageBitmap, detections, d.serverName);
          port.postMessage({ type: 'AI_CALC_ALL_IN_ONE_SUCCESS', detections, results });
        } catch (error) {
          port.postMessage({
            type: 'AI_CALC_ALL_IN_ONE_ERROR',
            message: error instanceof Error ? error.message : 'AI all-in-one pipeline failed'
          });
        }
        return;
    }
  }

  // --- Chart-related messages (event-driven, no direct response port) ---
  const allowedChartTypes = new Set(['line-and-bar', 'histogram-with-line', 'line-and-histogram']);
  const allowedTypes = new Set([
    'init',
    'initStats',
    'resize',
    'resizeStats',
    'addEncryptedData',
    'searchItems',
    'getItemHistory',
    'mouseMove',
    'mouseOut',
    'wheel',
    'clear',
    'destroy',
    'destroyStats',
    'TURNSTILE_TOKEN_RESPONSE',
    'setCurrencies',
  ]);

  const chartType: string | undefined = typeof d.chartType === 'string' ? d.chartType : undefined;
  const chartId: string | undefined = typeof d.chartId === 'string' ? d.chartId : undefined;

  if (!type || !allowedTypes.has(type)) return;
  if (!chartId) return;
  if (chartType && !allowedChartTypes.has(chartType)) return;

  const isInit = type === 'init' || type === 'initStats';
  const isDestroy = type === 'destroy' || type === 'destroyStats';
  const isApiCall = type === 'searchItems' || type === 'getItemHistory';
  const hasContext = chartContexts.has(chartId + '|' + chartType) || statsContexts.has(chartId);

  if (isInit && hasContext && type === 'init') return;

  // Allow API calls and Turnstile responses without requiring chart canvas initialization
  if (!isInit && !isDestroy && !isApiCall && !hasContext && type !== 'TURNSTILE_TOKEN_RESPONSE') {
    if (['resize', 'resizeStats', 'mouseMove', 'mouseOut', 'wheel', 'clear'].includes(type)) return;
    return;
  }

  try {
    switch (type) {
      case 'TURNSTILE_TOKEN_RESPONSE':
        await handleTurnstileResponse(d);
        break;

      case 'searchItems':
        if (chartType === 'line-and-bar') await handleItemSearch(e, chartId);
        break;

      case 'getItemHistory':
        if (chartType === 'line-and-bar') await handleItemHistory(e, chartContexts, statsContexts);
        break;

      default:
        if (chartType === 'line-and-bar') await handleLineAndBarEvent(e, chartContexts, statsContexts);
        break;
    }

    if (type === 'init' || type === 'initStats') {
      (self as any).postMessage({ type: 'ready', scope: type, chartType, chartId });
    }
  } catch (err) {
    console.error('[Worker] Error in message handler for type', type, ':', (err as any)?.message || err);
  } finally {
    if (isDestroy) {
      chartContexts.delete(chartId + '|' + chartType);
      statsContexts.delete(chartId);
    }
  }
};
