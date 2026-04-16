// API response types for the M2Tracker backend

export interface Top10Item {
  rank: number;
  item_name: string;
  price_now: number;
  price_prev: number;
  change_abs: number;
  change_pct: number;
  amount_now: number;
  amount_prev: number;
  shops_now: number;
  shops_prev: number;
}

export interface Top10Response {
  price_up: Top10Item[];
  price_down: Top10Item[];
  amount_change_up: Top10Item[];
  amount_change_down: Top10Item[];
  shop_change_up: Top10Item[];
  shop_change_down: Top10Item[];
}

// Transformed data for UI components
export interface StatEntry {
  name: string;
  changePct: number;
  changeAbs: number;
  currentValue: number;
  previousValue: number;
  rank: number;
}

export interface QuickStats24hData {
  priceUp: StatEntry[];
  priceDown: StatEntry[];
  amountUp: StatEntry[];
  amountDown: StatEntry[];
  shopsUp: StatEntry[];
  shopsDown: StatEntry[];
}

// Shop Window API types
export interface WindowStats {
  unique_shops: number;
  avg_presence_streak_days: number;
  total_shops_count_avg: number;
  total_shops_count_min: number;
  total_shops_count_max: number;
  median_unique_items_per_shop_avg: number;
  median_unique_items_per_shop_min: number;
  median_unique_items_per_shop_max: number;
}

export interface BaselineDailyStat {
  date: string;
  new_shops: number;
  disappeared_shops: number;
  continuing_shops: number;
  total_shops_count: number;
  median_unique_items_per_shop: number;
}

export interface ShopWindowResponse {
  window_stats: WindowStats;
  baseline_daily_stats: BaselineDailyStat[];
}

// Transformed data for ShopCountChart component
export interface ShopChartData {
  labels: string[];
  totals: number[];
  medians: number[];
  oldBars: number[];
  newBars: number[];
  goneBars: number[];
  stats: {
    shops: {
      current: number;
      changePct: number;
      avg: number;
      max: number;
      min: number;
      start: number;
    };
    medianUnique: {
      current: number;
      changePct: number;
      avg: number;
      max: number;
      min: number;
      start: number;
    };
    general: {
      uniqueShops14d: number;
      avgDurationDays: number;
    };
  };
}

// Server daily window stats types
export interface ServerDailyStat {
  date: string;
  total_simple_items_amount: number;
  unique_simple_items_amount: number;
  total_bonus_items_amount: number;
  unique_bonus_items_amount: number;
}

export interface ServerDailyWindowResponse {
  stats: ServerDailyStat[];
}

// Transformed data for TotalItemsChart UI
export interface ServerItemsChartData {
  labels: string[];
  data: Array<{
    date: string;
    uniqueWithBonus: number;
    uniqueWithoutBonus: number;
    itemsWithBonus: number;
    itemsWithoutBonus: number;
  }>;
}

// Item suggestions API types
export interface ItemNameSuggestionResponse {
  suggestions: { name: string; vid: number }[];
}

// Bonus types suggestions API type
export interface BonusTypeSuggestionResponse {
  suggestions: string[];
}

export interface ItemOption {
  value: string;
  label: string;
  vid: number;
}

// Unified item statistics type (replaces ItemDailyWindowStat and ItemHistoryPoint)
export interface ItemStatistic {
  date?: string;
  collected_at?: string;
  price_q10?: number;
  q10_price?: number;
  price_median?: number;
  median_price?: number;
  item_amount?: number;
  amount?: number;
  shop_appearance_count?: number;
  shops_count?: number;
}

// Helper function to normalize ItemStatistic to consistent format
export function normalizeItemStatistic(stat: ItemStatistic): Required<Pick<ItemStatistic, 'date' | 'price_q10' | 'price_median' | 'item_amount' | 'shop_appearance_count'>> {
  return {
    date: stat.date || (stat.collected_at ? stat.collected_at.split('T')[0] : ''),
    price_q10: stat.price_q10 ?? stat.q10_price ?? 0,
    price_median: stat.price_median ?? stat.median_price ?? 0,
    item_amount: stat.item_amount ?? stat.amount ?? 0,
    shop_appearance_count: stat.shop_appearance_count ?? stat.shops_count ?? 0,
  };
}

// Helper function to convert to legacy format for backward compatibility
export function toLegacyHistoryPoint(stat: ItemStatistic): ItemHistoryPoint {
  const normalized = normalizeItemStatistic(stat);
  return {
    collected_at: normalized.date ? `${normalized.date}T00:00:00.000Z` : new Date().toISOString(),
    q10_price: normalized.price_q10,
    median_price: normalized.price_median,
    amount: normalized.item_amount,
    shops_count: normalized.shop_appearance_count,
  };
}

// API response types using unified ItemStatistic
export interface ItemDailyWindowResponse {
  stats: ItemStatistic[];
}

// Price Q10 last update API types
export interface SimpleItemPriceQ10LastUpdateResponse {
  price_q10: number | null; // Float with 2 decimals or null when unknown
}

// Legacy types for backward compatibility - now using unified type
export interface ItemHistoryPoint {
  collected_at: string; // ISO date string
  q10_price: number; // Float with 2 decimal places
  median_price: number; // Float with 2 decimal places
  amount: number;
  shops_count?: number;
}

export interface ItemHistoryResponse {
  history: ItemHistoryPoint[];
}

// Encrypted versions for secure webWorker communication
export interface EncryptedItemHistoryPoint {
  encryptedData: ArrayBuffer;
}

export interface EncryptedItemHistoryResponse {
  encryptedHistory: EncryptedItemHistoryPoint[];
}

// Bonus item search API types
export interface BonusValueOut {
  name: string;
  value: number;
}

export interface BonusItemSightingOut {
  sighting_id: number;
  item_name: string;
  price: number;
  item_count: number;
  last_seen: string;
  bonuses: BonusValueOut[];
}

export interface BonusItemSearchResponse {
  count: number;
  results: BonusItemSightingOut[];
  has_more: boolean;
}

export interface BonusFilterRequest {
  name: string;
  op?: string; // gt, gte, lt, lte, eq (=)
  value: number;
}

export interface BonusItemSearchRequest {
  server_name: string;
  q?: string; // item name substring
  item_vid?: number | null;
  filters?: BonusFilterRequest[];
  sort_by?: string; // price, amount, date
  sort_dir?: string; // asc, desc
  window_days?: number;
  limit?: number;
  offset?: number;
}

 export interface ServerCurrency {
   name: string;
   symbol: string;
   threshold: number | string; // API may return a string; normalized to number on the client
 }

// Dashboard init endpoint types
export interface DashboardServerInfo {
  name: string;
  status: boolean;
  type: string;
  currencies: ServerCurrency[];
  discord_url?: string;
  forum_url?: string;
  website_url?: string;
  description?: string;
  created_at: string; // YYYY-MM-DD
  last_data_update: string; // e.g. "2025-08-01 19:00"
}

export interface DashboardInitResponse {
  server: DashboardServerInfo;
  other_servers: string[];
}

// Homepage init endpoint types
export interface HomepageServerInfo {
  name: string;
  status: boolean;
  type: string; // e.g. "Medium"
  created_at: string; // YYYY-MM-DD
  last_data_update_human: string | null; // e.g. "22 dni temu"
}

export type HomepageUpdateType = 'changelog' | 'news';

export interface HomepageUpdateEntry {
  type: HomepageUpdateType;
  id: number;
  title: string;
  created_at: string; // YYYY-MM-DD
  description?: string;
  content?: string;
}

export interface HomepageVoteServerEntry {
  name: string;
  total_votes: number;
}

export interface HomepageInitResponse {
  servers: HomepageServerInfo[];
  updates: HomepageUpdateEntry[];
}

// Voting endpoint types
export interface VoteRequest {
  // List of server names to vote for (IDs correspond to names on homepage)
  servers: string[];
  // Turnstile token for verification
  turnstile_token: string;
}

export interface VoteResponse {
  // Whether the vote was accepted (not rate-limited)
  allowed: boolean;
  // How many servers were successfully voted for
  voted_count: number;
  // If not allowed due to cooldown, seconds to wait until next allowed vote
  retry_after_seconds: number | null;
}

// --- Secure Authentication Flow Types ---

/**
 * Request payload for the /auth/dashboard endpoint.
 * This is sent from the client to the backend to verify the Turnstile token.
 */
export interface AuthDashboardRequest {
  token: string;
  client_pubkey: string;
}

/**
 * Response from the /auth/dashboard endpoint upon successful verification.
 * Contains the necessary data for the client (Service Worker) to establish a secure session.
 */
export interface AuthDashboardResponse {
  server_pubkey: string;
  salt: string;
  sid: string; // Session ID
  ttl: number; // Time-to-live in seconds
}

/**
 * Request payload for the /auth/chart-webWorker endpoint.
 * Sent from the Web Worker (via Service Worker) to the backend.
 */
export interface AuthChartWorkerRequest {
  token: string;
  client_pubkey: string;
}

/**
 * Response from the /auth/chart-webWorker endpoint.
 */
export interface AuthChartWorkerResponse {
  server_pubkey: string;
  salt: string;
  ttl: number;
}

// --- AI Calculator Batch Price Endpoint ---

export interface AICalculatorItemIn {
  vid: number | null;
  name: string | null;
}

export interface AICalculatorRequest {
  server_name: string;
  items: AICalculatorItemIn[];
}

export interface AICalculatorPriceOut {
  vid: number | null;
  name: string;
  price_q10: number | null;
}

// Re-export AI feedback type for API context
export type { AIFeedbackData } from './ai';

// --- General Feedback Endpoint ---

/**
 * Categories for the general feedback form.
 * 'unexpected_problem_comment' is a special category used internally by the ErrorBoundary.
 */
export type FeedbackCategory = 'ux' | 'content' | 'suggestion' | 'other' | 'unexpected_problem_comment';

/**
 * Payload for the POST /feedback/submit endpoint.
 */
export interface GeneralFeedbackPayload {
  category: FeedbackCategory;
  comment: string;
  turnstileToken: string;
  // Optional context for better diagnostics
  context?: {
    parentReportId?: string | null;
  }
}
