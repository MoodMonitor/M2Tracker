// src/webWorker/apiHandlers.ts

import { endpoints } from '@/config/api';
import { securityConfig } from '@/config/api';
import { signRequest, type SecureSession } from '@/lib/crypto-module';
import { ensureChartAuthenticated, getChartSecureSession, getMainSecureSession, invalidateChartSession, invalidateMainSession } from './session';
import { handleEvent as handleLineAndBarEvent, type ChartContext } from '@/components/dashboard/lineAndBarChartHandler';

/**
 * Handle item search API calls. This is a public, non-secure operation.
 */
export async function handleItemSearch(e: MessageEvent, chartId: string) {
  const data = e.data;
  const { requestId, query, serverName } = data;

  try {

    const url = endpoints.itemSuggestions(serverName, query, 10);
    const request = new Request(url);
    let finalRequest = request;

    const mainSession = getMainSecureSession();
    const isPublic = securityConfig.publicApiPaths.some((path) => new URL(url).pathname.includes(path));

    if (!isPublic && mainSession) {
      finalRequest = await signRequest(request, mainSession, securityConfig.publicApiPaths, 'sw');
    }

    const response = await fetch(finalRequest);

    if (response.status === 401) {
      invalidateMainSession();
      self.postMessage({ type: 'SESSION_EXPIRED' });
      throw new Error('Session expired during item search.');
    }

    if (!response.ok) throw new Error(`Failed to fetch item suggestions: ${response.statusText}`);

    const suggestionsArray: { name: string, vid: number }[] = await response.json();

    // Append VID to label when names are duplicated
    const nameCounts = suggestionsArray.reduce((acc: Record<string, number>, curr: { name: string }) => {
      acc[curr.name] = (acc[curr.name] || 0) + 1;
      return acc;
    }, {});

    const items = suggestionsArray.map((suggestion: { name: string, vid: number }) => ({
      label: nameCounts[suggestion.name] > 1 ? `${suggestion.name} (ID: ${suggestion.vid})` : suggestion.name,
      value: suggestion.name,
      vid: suggestion.vid,
    }));

    (self as any).postMessage({ type: 'itemSearchResult', requestId, chartId, items, success: true });
  } catch (error) {
    console.error('[Worker/API] Failed to search items:', error);

    // Send error back to main thread
    (self as any).postMessage({
      type: 'itemSearchResult',
      requestId,
      chartId,
      items: [],
      error: error instanceof Error ? error.message : 'Search failed',
      success: false
    });
  }
}

/**
 * Handle item history API calls. This is a secure operation that requires the webWorker's own session.
 */
export async function handleItemHistory(e: MessageEvent, chartContexts: Map<string, ChartContext>, statsContexts: Map<string, any>) {
  const data = e.data;
  const { requestId, serverName, itemVid, chartId, chartType } = data;

  try {
    await ensureChartAuthenticated(chartId);
    
    let chartSession = getChartSecureSession();
    const context = chartContexts.get(chartId + '|' + chartType);

    if (!chartSession || !context) {
      throw new Error('Authentication flow completed, but no secure session was established.');
    }

    const windowDay = 14;

    const url = endpoints.itemDailyWindow(serverName, itemVid, windowDay);
    const request = new Request(url);

    let signedRequest = await signRequest(request, chartSession, [], 'worker-data');
    let response = await fetch(signedRequest);

    if (response.status === 401) {
      invalidateChartSession();
      await ensureChartAuthenticated(chartId);
      chartSession = getChartSecureSession();

      if (!chartSession) throw new Error('Re-authentication failed after session expired.');

      signedRequest = await signRequest(request, chartSession, [], 'worker-data');
      response = await fetch(signedRequest);
    }

    if (!response.ok) {
      throw new Error(`API error for item history: ${response.statusText}`);
    }

    const historyData = await response.json();

    context.key = chartSession.keyEnc;

    await handleLineAndBarEvent(
      { data: { type: 'clear', chartId, chartType } } as MessageEvent,
      chartContexts,
      statsContexts
    );
    await handleLineAndBarEvent(
      { data: { type: 'addEncryptedData', chartId, chartType, encryptedPayload: historyData.stats } } as MessageEvent,
      chartContexts,
      statsContexts
    );

    (self as any).postMessage({ type: 'itemHistoryResult', requestId, chartId, success: true });
  } catch (error) {
    console.error('[Worker/API] Failed to fetch item history:', error);

    // Send error back to main thread
    (self as any).postMessage({
      type: 'itemHistoryResult',
      requestId,
      chartId,
      history: [],
      error: error instanceof Error ? error.message : 'History fetch failed',
      success: false
    });
  }
}