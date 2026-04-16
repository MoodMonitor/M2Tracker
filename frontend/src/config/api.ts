/**
 * API Configuration
 * Centralized configuration for all API endpoints with environment-based URLs.
 */

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
  enableLogging: boolean;
}

/**
 * Security-related configuration, used primarily by the Web Worker.
 */
export interface SecurityConfig {
  publicApiPaths: string[];
}

/**
 * Service Worker runtime configuration
 * This allows the SW to share the same base URL and caching policy as the app.
 */
export interface ServiceWorkerConfig {
  apiBaseUrl: string;
  cacheName: string;
  cacheTtlMs: number;
  cacheableApiPaths: string[];
}

/**
 * Get API base URL from environment variables with fallbacks.
 */
function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  // Prefer same-origin API when explicit env URL is not provided.
  const origin = (globalThis as { location?: Location }).location?.origin;
  if (origin) {
    return `${origin.replace(/\/$/, '')}/api/v1`;
  }

  // Final fallback for environments without location (e.g. some tests).
  return 'http://localhost:8080/api/v1';
}

/**
 * Get API timeout from environment or use default
 */
function getApiTimeout(): number {
  const envTimeout = import.meta.env.VITE_API_TIMEOUT;
  const timeout = envTimeout ? parseInt(envTimeout, 10) : 10000;
  return isNaN(timeout) ? 10000 : timeout;
}

/**
 * API Configuration object
 */
export const apiConfig: ApiConfig = {
  baseUrl: getApiBaseUrl(),
  timeout: getApiTimeout(),
  retries: parseInt(import.meta.env.VITE_API_RETRIES || '2', 10),
  retryDelay: parseInt(import.meta.env.VITE_API_RETRY_DELAY || '1000', 10),
  enableLogging: import.meta.env.DEV,
};

/**
 * Specific endpoint builders for type safety
 */
export const endpoints = {
  // Auth endpoint
  authDashboard: () => `${new URL(apiConfig.baseUrl).origin}/auth/dashboard`,
  authStatus: () => `${new URL(apiConfig.baseUrl).origin}/auth/status`,
  authChartWorker: () => `${new URL(apiConfig.baseUrl).origin}/auth/chart-worker`,
  aiAssetsKey: () => `${new URL(apiConfig.baseUrl).origin}/auth/ai`,

  // Homepage endpoint
  homepageInit: () => `${apiConfig.baseUrl}/homepage/init`,

  // Voting servers endpoint
  voteServers: () => `${apiConfig.baseUrl}/homepage/vote-servers`,

  // Dashboard endpoints
  dashboardInit: (serverName: string) =>
    `${apiConfig.baseUrl}/dashboard/init?server_name=${encodeURIComponent(serverName)}`,

  // Stats endpoints
  quickStats24h: (serverName: string) =>
    `${apiConfig.baseUrl}/dashboard/stats/24h?server_name=${encodeURIComponent(serverName)}`,

  shopStats: (serverName: string, windowDay: number = 14) =>
    `${apiConfig.baseUrl}/dashboard/stats/shops/daily-window?server_name=${encodeURIComponent(
      serverName
    )}&window_day=${windowDay}`,

  serverStats: (serverName: string, windowDay: number = 14) =>
    `${apiConfig.baseUrl}/dashboard/stats/servers/daily-window?server_name=${encodeURIComponent(
      serverName
    )}&window_day=${windowDay}`,

  // Item endpoints
  itemSuggestions: (serverName: string, query: string, limit: number = 10) =>
    `${apiConfig.baseUrl}/dashboard/simple_items/suggest?server_name=${encodeURIComponent(
      serverName
    )}&q=${encodeURIComponent(query)}&limit=${limit}`,

  itemDailyWindow: (serverName: string, itemVid: number, windowDay: number) =>
    `${apiConfig.baseUrl}/dashboard/simple_items/daily-window?server_name=${encodeURIComponent(
      serverName
    )}&item_vid=${itemVid}&window_day=${windowDay}`,

  itemPriceQ10: (serverName: string, itemVid: number) =>
    `${apiConfig.baseUrl}/dashboard/simple_items/price-q10/last-update?server_name=${encodeURIComponent(
      serverName
    )}&item_vid=${itemVid}`,

  // AI Calculator batch price endpoint
  aiCalculatorPrices: () => `${apiConfig.baseUrl}/dashboard/simple_items/ai-calculator/prices`,

  // AI Calculator feedback endpoint
  feedbackAiCalculator: () => `${apiConfig.baseUrl}/dashboard/feedback/ai-calculator`,

  // Bonus item endpoints
  bonusItemSuggestions: (serverName: string, query: string, limit: number = 10) =>
    `${apiConfig.baseUrl}/dashboard/bonus_items/suggest?server_name=${encodeURIComponent(
      serverName
    )}&q=${encodeURIComponent(query)}&limit=${limit}`,

  bonusTypeSuggestions: (serverName: string, query: string, limit: number = 10) =>
    `${apiConfig.baseUrl}/dashboard/bonus_items/bonus-types/suggest?server_name=${encodeURIComponent(
      serverName
    )}&q=${encodeURIComponent(query)}&limit=${limit}`,

  bonusItemSearch: () => `${apiConfig.baseUrl}/dashboard/bonus_items/search`,

  // Voting endpoint
  vote: () => `${apiConfig.baseUrl}/homepage/vote`,

  // Dashboard ping endpoint
  pingDashboard: (serverName: string) => `${apiConfig.baseUrl}/dashboard/ping?server_name=${encodeURIComponent(serverName)}`,

  // Bug report endpoint
  submitBugReport: () => `${apiConfig.baseUrl}/bug-reports/submit`,

  // Feedback endpoint
  submitFeedback: () => `${apiConfig.baseUrl}/feedback/submit`,
} as const;

/**
 * Security configuration object.
 * Defines paths that do not require a session signature.
 */
export const securityConfig: SecurityConfig = {
  publicApiPaths: ['/homepage/init', '/homepage/vote'],
};

/**
 * Service Worker runtime configuration derived from the main API config.
 */
export const swConfig: ServiceWorkerConfig = {
  apiBaseUrl: apiConfig.baseUrl,
  cacheName: 'm2tracker-secure-api-cache-v3',
  cacheTtlMs: 10 * 60 * 1000,
  cacheableApiPaths: [
    '/dashboard/init',
    '/stats/24h',
    '/stats/servers/daily-window',
    '/simple_items/suggest',
    '/bonus_items/suggest',
    '/homepage/init'
  ],
};
