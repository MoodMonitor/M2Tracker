/**
 * API Service - Centralized API handling with service webWorker integration
 * This service replaces direct API calls and leverages the service webWorker for caching and request enhancement
 * It also handles data transformation to prepare it for UI components like charts.
 */

import {
  ItemNameSuggestionResponse,
  ItemDailyWindowResponse,
  ItemOption, 
  ItemHistoryPoint,
  ItemStatistic,
  toLegacyHistoryPoint,
  SimpleItemPriceQ10LastUpdateResponse,
  BonusTypeSuggestionResponse,
  BonusItemSearchRequest,
  BonusItemSearchResponse,
  Top10Response,
  ShopWindowResponse,
  ShopChartData,
  ServerItemsChartData,
  ServerDailyWindowResponse,
  DashboardInitResponse,
  HomepageInitResponse,
  AICalculatorRequest,
  AICalculatorPriceOut,
  AIFeedbackData, 
  HomepageVoteServerEntry,
  GeneralFeedbackPayload
} from '@/types/api';
import type { VoteRequest, VoteResponse } from '@/types/api'; 
import { eventBus } from '@/lib/eventBus';
import { apiConfig, endpoints } from '@/config/api';
import { webWorkerManager } from '../webWorker/webWorkerManager.ts';
import { HttpError } from './httpError';

/**
 * Enhanced fetch that delegates API calls to the Web Worker for signing and execution.
 * The webWorker handles the actual `fetch`, which is then intercepted by the Service Worker for caching.
 * This function also includes retry logic with exponential backoff for failed requests.
 */
async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  suppressGlobalErrors: boolean = false
): Promise<T> {
  const maxRetries = apiConfig.retries;
  const baseDelay = apiConfig.retryDelay;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Delegate the actual fetch call to the Web Worker via the manager.
      // The webWorker will sign the request and perform the fetch.
      // The webWorkerManager.fetchApi will throw an HttpError on failure, which we catch below.
      const data = await webWorkerManager.fetchApi<T>(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (attempt > 0 && apiConfig.enableLogging) {
        console.info(`[API] Retry successful for ${url} on attempt ${attempt + 1}`);
      }

      return data;

    } catch (error) {
      if (error instanceof HttpError) {
        const isRetryable = isRetryableError(error.response.status);
        const isLastAttempt = attempt === maxRetries;

        // Dispatch global event for specific errors like 429 (Rate Limit)
        if (error.response.status === 429 && !suppressGlobalErrors) {
          eventBus.emit('api:error', { status: 429, message: error.message });
        }

        if (isLastAttempt || !isRetryable) {
          if (apiConfig.enableLogging) {
            console.error(`[API] Final attempt failed for ${url}:`, error);
          }
          throw error;
        }

        if (apiConfig.enableLogging) {
          console.warn(`[API] Attempt ${attempt + 1}/${maxRetries + 1} failed for ${url} (${error.response.status}). Retrying...`);
        }

        lastError = error;
        await sleep(calculateRetryDelay(attempt, baseDelay));
        continue;
      }

      // Handle non-HttpError cases (e.g., webWorker communication timeout)
      const isLastAttempt = attempt === maxRetries;
      lastError = error as Error;

      if (isLastAttempt) {
        if (apiConfig.enableLogging) {
          console.error(`[API] Final attempt failed for ${url} with non-HTTP error:`, error);
        }
        throw error;
      }

      if (apiConfig.enableLogging) {
        console.warn(`[API] Non-HTTP error on attempt ${attempt + 1}/${maxRetries + 1} for ${url}. Retrying...`, error);
      }

      await sleep(calculateRetryDelay(attempt, baseDelay));
    }
  }

  throw lastError || new Error(`Failed to complete request to ${url} after ${maxRetries + 1} attempts`);
}

function isRetryableError(status: number): boolean {
  return status >= 500 || status === 408; // Do not retry on 429 (Rate Limit)
}

function calculateRetryDelay(attempt: number, baseDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(exponentialDelay + jitter, 30000);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Exported only for unit tests
export const _test = { isRetryableError, calculateRetryDelay };

// --- Transformation logic moved from serverStats.ts and shopStats.ts ---

/**
 * Transform API response to chart data format for TotalItemsChart
 * @internal
 */
function transformServerStatsToChartData(response: ServerDailyWindowResponse): ServerItemsChartData {
  const { stats } = response;
  
  // Sort stats by date to ensure proper order
  const sortedStats = [...stats].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const labels = sortedStats.map(stat => stat.date);
  
  const data = sortedStats.map(stat => ({
    date: stat.date,
    uniqueWithBonus: stat.unique_bonus_items_amount,
    uniqueWithoutBonus: stat.unique_simple_items_amount,
    itemsWithBonus: stat.total_bonus_items_amount,
    itemsWithoutBonus: stat.total_simple_items_amount,
  }));

  return { labels, data };
}

/**
 * Transform API response to chart data format for Shop Stats
 * @internal
 */
function transformShopStatsToChartData(response: ShopWindowResponse): ShopChartData {
  const { window_stats, baseline_daily_stats } = response;
  
  const sortedStats = [...baseline_daily_stats].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const labels = sortedStats.map(stat => stat.date);
  const totals = sortedStats.map(stat => stat.total_shops_count);
  const medians = sortedStats.map(stat => stat.median_unique_items_per_shop);
  const oldBars = sortedStats.map(stat => stat.continuing_shops);
  const newBars = sortedStats.map(stat => stat.new_shops);
  const goneBars = sortedStats.map(stat => -stat.disappeared_shops);

  const currentShops = totals[totals.length - 1] || 0;
  const startShops = totals[0] || 0;
  const shopsChangePct = startShops > 0 ? ((currentShops - startShops) / startShops) * 100 : 0;

  const currentMedian = medians[medians.length - 1] || 0;
  const startMedian = medians[0] || 0;
  const medianChangePct = startMedian > 0 ? ((currentMedian - startMedian) / startMedian) * 100 : 0;

  return {
    labels, totals, medians, oldBars, newBars, goneBars,
    stats: {
      shops: { current: currentShops, changePct: shopsChangePct, avg: Math.round(window_stats.total_shops_count_avg), max: window_stats.total_shops_count_max, min: window_stats.total_shops_count_min, start: startShops },
      medianUnique: { current: Math.round(currentMedian * 10) / 10, changePct: medianChangePct, avg: Math.round(window_stats.median_unique_items_per_shop_avg * 10) / 10, max: Math.round(window_stats.median_unique_items_per_shop_max * 10) / 10, min: Math.round(window_stats.median_unique_items_per_shop_min * 10) / 10, start: Math.round(startMedian * 10) / 10 },
      general: { uniqueShops14d: window_stats.unique_shops, avgDurationDays: Math.round(window_stats.avg_presence_streak_days * 10) / 10 },
    },
  };
}

// --- API Functions ---

export async function getItemSuggestions(query: string, serverName: string, limit: number = 10): Promise<ItemOption[]> {
  if (!query || query.length < 3) return [];
  try {
    const suggestionsArray = await apiFetch<{ name: string; vid: number }[]>(endpoints.itemSuggestions(serverName, query, limit));

    // Append VID to the label when names are duplicated
    const nameCounts = suggestionsArray.reduce((acc, curr) => {
      acc[curr.name] = (acc[curr.name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return suggestionsArray.map(suggestion => ({
      value: suggestion.name,
      label: nameCounts[suggestion.name] > 1 ? `${suggestion.name} (ID: ${suggestion.vid})` : suggestion.name,
      vid: suggestion.vid,
    }));
  } catch (error) {
    console.warn('API unavailable for item suggestions:', error);
    throw error;
  }
}

/**
 * Submits general user feedback. Uses a direct unsigned fetch — the endpoint
 * is public and protected by Turnstile. keepalive allows sending from beforeunload.
 */
export async function sendFeedback(payload: GeneralFeedbackPayload): Promise<{ success: boolean }> {
  try {
    const response = await fetch(endpoints.submitFeedback(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return { success: response.ok };
  } catch (error) {
    console.warn('[API] Feedback submission failed:', error);
    return { success: false };
  }
}

/**
 * Sends a ping to signal an active dashboard visit. Fire-and-forget.
 * 429 responses are silently ignored — rate limiting is expected here.
 */
export async function pingDashboard(serverName: string): Promise<void> {
  try {
    await apiFetch<void>(endpoints.pingDashboard(serverName), { method: 'POST' }, true);
    if (apiConfig.enableLogging) {
      console.log(`[API] Ping sent successfully for dashboard: ${serverName}`);
    }
  } catch (error) {
    if (!(error instanceof HttpError && error.response.status === 429)) {
      console.warn(`[API] Ping failed for dashboard ${serverName}:`, error);
    }
  }
}

export async function getAiCalculatorPrices(request: AICalculatorRequest): Promise<AICalculatorPriceOut[]> {
  try {
    return await apiFetch<AICalculatorPriceOut[]>(endpoints.aiCalculatorPrices(), {
      method: 'POST',
      body: JSON.stringify(request),
    });
  } catch (error) {
    console.warn('API unavailable for AI calculator batch price lookup:', error);
    throw error;
  }
}

export async function getDashboardInit(serverName: string): Promise<DashboardInitResponse> {
  try {
    return await apiFetch<DashboardInitResponse>(endpoints.dashboardInit(serverName));
  } catch (error) {
    console.warn('API unavailable for dashboard init:', error);
    throw error;
  }
}

export async function getHomepageInit(): Promise<HomepageInitResponse> {
  try {
    return await apiFetch<HomepageInitResponse>(endpoints.homepageInit());
  } catch (error) {
    console.warn('API unavailable for homepage init:', error);
    throw error;
  }
}

export async function getVoteServers(): Promise<HomepageVoteServerEntry[]> {
  try {
    return await apiFetch<HomepageVoteServerEntry[]>(endpoints.voteServers());
  } catch (error) {
    console.warn('API unavailable for vote servers:', error);
    throw error;
  }
}

export async function getBonusItemNameSuggestions(serverName: string, query: string, limit: number = 10): Promise<ItemOption[]> {
  const q = (query || '').trim();
  if (q.length < 3) return [];
  try {
    const suggestionsArray = await apiFetch<{ name: string; vid: number }[]>(endpoints.bonusItemSuggestions(serverName, q, limit));

    // Append VID to the label when names are duplicated
    const nameCounts = suggestionsArray.reduce((acc, curr) => {
      acc[curr.name] = (acc[curr.name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return suggestionsArray.map(suggestion => ({
      value: suggestion.name,
      label: nameCounts[suggestion.name] > 1 ? `${suggestion.name} (ID: ${suggestion.vid})` : suggestion.name,
      vid: suggestion.vid,
    }));

  } catch (error) {
    console.warn('API unavailable for bonus item suggest:', error);
    throw error;
  }
}

export async function getBonusTypeSuggestions(serverName: string, query: string, limit: number = 10): Promise<string[]> {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  try {
    const data = await apiFetch<BonusTypeSuggestionResponse>(endpoints.bonusTypeSuggestions(serverName, q, limit));
    return data.suggestions;
  } catch (error) {
    console.warn('API unavailable for bonus type suggest:', error);
    throw error;
  }
}

export async function getItemDailyWindow(params: { serverName: string; itemVid: number; windowDay: number; }): Promise<ItemHistoryPoint[]> {
  try {
    const data = await apiFetch<ItemDailyWindowResponse>(endpoints.itemDailyWindow(params.serverName, params.itemVid, params.windowDay));
    return data.stats.map(stat => toLegacyHistoryPoint(stat));
  } catch (error) {
    console.warn('API unavailable for item daily window:', error);
    throw error;
  }
}

export async function searchBonusItems(request: BonusItemSearchRequest): Promise<BonusItemSearchResponse> {
  try {
    return await apiFetch<BonusItemSearchResponse>(endpoints.bonusItemSearch(), { method: 'POST', body: JSON.stringify(request) });
  } catch (error) {
    console.warn('API unavailable for bonus item search:', error);
    return { count: 0, results: [], has_more: false };
  }
}

export async function getItemPriceQ10LastUpdate(serverName: string, itemVid: number): Promise<number | null> {
  try {
    const data = await apiFetch<SimpleItemPriceQ10LastUpdateResponse>(endpoints.itemPriceQ10(serverName, itemVid));
    return data.price_q10 == null ? null : Math.round(data.price_q10 * 100) / 100;
  } catch (error) {
    console.warn('API unavailable for price lookup, returning null:', error);
    return null;
  }
}

export async function getQuickStats24h(serverName: string): Promise<Top10Response> {
  try {
    return await apiFetch<Top10Response>(endpoints.quickStats24h(serverName));
  } catch (error) {
    console.warn('API unavailable for 24h stats:', error);
    throw error;
  }
}

/**
 * Fetch and transform shop window stats for a server.
 */
export async function getShopWindowStats(serverName: string, windowDay: number = 14): Promise<ShopChartData> {
  try {
    const response = await apiFetch<ShopWindowResponse>(endpoints.shopStats(serverName, windowDay));
    return transformShopStatsToChartData(response);
  } catch (error) {
    console.warn('API unavailable for shop stats:', error);
    throw error;
  }
}

export async function getServerDailyStats(serverName: string, windowDay: number = 14): Promise<ServerItemsChartData> {
  try {
    const response = await apiFetch<ServerDailyWindowResponse>(endpoints.serverStats(serverName, windowDay));
    return transformServerStatsToChartData(response);
  } catch (error) {
    console.warn('API unavailable for server daily stats:', error);
    throw error;
  }
}

export async function voteServers(payload: VoteRequest): Promise<VoteResponse> {
  try {
    return await apiFetch<VoteResponse>(endpoints.vote(), { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) {
    console.warn('API unavailable for vote submission:', error);
    throw error;
  }
}

export async function sendAIFeedback(data: { feedbackData: AIFeedbackData; imageBlob: Blob }) {
  const { feedbackData, imageBlob } = data;
  try {
    return await apiFetch<VoteResponse>(endpoints.feedbackAiCalculator(), {
      method: 'POST',
      body: JSON.stringify(feedbackData),
      // @ts-expect-error: custom field consumed by fetchApi to build multipart form data
      formDataConfig: {
        blob: imageBlob,
        fileName: 'screenshot.png',
        mimeType: 'image/png',
        fileFieldName: 'image',
        jsonFieldName: 'feedback_data',
      }
    });
  } catch (error) {
    console.warn('API unavailable for sendAIFeedback submission:', error);
    throw error;
  }
}
