import type {
  AICalculatorPriceOut,
  AICalculatorRequest,
  BonusItemSearchRequest,
  BonusItemSearchResponse,
  DashboardInitResponse,
  HomepageInitResponse,
  HomepageVoteServerEntry,
  ItemStatistic,
  ServerDailyWindowResponse,
  ShopWindowResponse,
  Top10Item,
  Top10Response,
} from '@/types/api';

type FixtureServerName = 'ServerHard' | 'ServerMedium';

const LEGACY_SERVER_ALIASES: Record<string, FixtureServerName> = {
  ServerHard: 'ServerHard',
  ServerMedium: 'ServerMedium',
};

interface CatalogItem {
  vid: number;
  name: string;
  bonusTypes: string[];
  basePrice: number;
}

interface ServerMeta {
  type: string;
  createdAt: string;
  lastUpdateHuman: string;
  lastDataUpdate: string;
  currencies: Array<{ name: string; symbol: string; threshold: number }>;
}

const SERVER_META: Record<FixtureServerName, ServerMeta> = {
  ServerHard: {
    type: 'Medium',
    createdAt: '2024-02-18',
    lastUpdateHuman: '3 min temu',
    lastDataUpdate: '2026-04-11 18:40',
    currencies: [
      { name: 'Yang', symbol: 'Y', threshold: 1000000 },
      { name: 'Won', symbol: 'W', threshold: 100 },
    ],
  },
  ServerMedium: {
    type: 'Hard',
    createdAt: '2023-11-04',
    lastUpdateHuman: '7 min temu',
    lastDataUpdate: '2026-04-11 18:36',
    currencies: [
      { name: 'Yang', symbol: 'Y', threshold: 1000000 },
      { name: 'Won', symbol: 'W', threshold: 100 },
      { name: 'Won (Top)', symbol: 'WT', threshold: 10000 },
    ],
  },
};

const CATALOG: Record<FixtureServerName, CatalogItem[]> = {
  ServerHard: [
    { vid: 1120, name: 'Miecz Smoka +9', bonusTypes: ['Silny przeciwko Potworom', 'Szansa na Cios Krytyczny'], basePrice: 3150000 },
    { vid: 1121, name: 'Miecz Smoka +9', bonusTypes: ['Silny przeciwko Metinom', 'Szybkość Ataku'], basePrice: 3050000 },
    { vid: 2120, name: 'Szata Pustki +9', bonusTypes: ['Odporność na Magię', 'Szansa na Blok Ciosu'], basePrice: 4720000 },
    { vid: 3120, name: 'Bransoleta Tygrysa +9', bonusTypes: ['Maks. PŻ', 'Szansa na Otrucie'], basePrice: 1980000 },
    { vid: 4120, name: 'Naszyjnik Feniksa +9', bonusTypes: ['Odporność na Ogień', 'Szansa na Przeszywkę'], basePrice: 2320000 },
    { vid: 5120, name: 'Buty Wiatru +9', bonusTypes: ['Szybkość Ruchu', 'Unik Strzał'], basePrice: 1640000 },
    { vid: 6120, name: 'Tarcza Smoka +9', bonusTypes: ['Odporność na Cios Krytyczny', 'Odporność na Miecze'], basePrice: 2840000 },
    { vid: 7120, name: 'Hełm Cieni +9', bonusTypes: ['Odporność na Szpony', 'Odporność na Dzwony'], basePrice: 2410000 },
  ],
  ServerMedium: [
    { vid: 1130, name: 'Miecz Burzy +9', bonusTypes: ['Silny przeciwko Potworom', 'Szybkość Ataku'], basePrice: 3540000 },
    { vid: 2130, name: 'Zbroja Burzy +9', bonusTypes: ['Odporność na Magię', 'Maks. PŻ'], basePrice: 5140000 },
    { vid: 3130, name: 'Bransoleta Smoczego Ognia +9', bonusTypes: ['Szansa na Cios Krytyczny', 'Szansa na Przeszywkę'], basePrice: 2750000 },
    { vid: 4130, name: 'Naszyjnik Burzy +9', bonusTypes: ['Odporność na Ogień', 'Odporność na Błyskawice'], basePrice: 2480000 },
    { vid: 5130, name: 'Buty Burzy +9', bonusTypes: ['Szybkość Ruchu', 'Unik Strzał'], basePrice: 1910000 },
    { vid: 6130, name: 'Tarcza Burzy +9', bonusTypes: ['Odporność na Miecze', 'Odporność na Dwuręczne'], basePrice: 3010000 },
    { vid: 7130, name: 'Hełm Burzy +9', bonusTypes: ['Odporność na Sztylety', 'Odporność na Strzały'], basePrice: 2630000 },
    { vid: 8130, name: 'Kolczyki Burzy +9', bonusTypes: ['Szansa na Otrucie', 'Szybkość Zaklęć'], basePrice: 2290000 },
  ],
};

const SERVER_NAMES: FixtureServerName[] = ['ServerHard', 'ServerMedium'];

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getLastNDates(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    out.push(toIsoDate(d));
  }
  return out;
}

function ensureServerName(serverName: string): FixtureServerName {
  const normalized = (LEGACY_SERVER_ALIASES[serverName] || serverName) as string;
  if ((SERVER_NAMES as string[]).includes(normalized)) {
    return normalized as FixtureServerName;
  }
  return 'ServerHard';
}

function makeTop10Item(item: CatalogItem, rank: number, direction: 1 | -1): Top10Item {
  const deltaPct = (4 + rank * 0.8) * direction;
  const prev = Math.round(item.basePrice * (1 - deltaPct / 100));
  const now = item.basePrice;
  const amountPrev = 100 + rank * 12;
  const amountNow = amountPrev + direction * (8 + rank);
  const shopsPrev = 20 + rank * 2;
  const shopsNow = Math.max(1, shopsPrev + direction * 2);

  return {
    rank,
    item_name: item.name,
    price_now: now,
    price_prev: prev,
    change_abs: now - prev,
    change_pct: deltaPct,
    amount_now: amountNow,
    amount_prev: amountPrev,
    shops_now: shopsNow,
    shops_prev: shopsPrev,
  };
}

function buildTop10(serverName: FixtureServerName): Top10Response {
  const base = CATALOG[serverName];
  const ups = base.slice(0, 5).map((item, idx) => makeTop10Item(item, idx + 1, 1));
  const downs = base.slice(3, 8).map((item, idx) => makeTop10Item(item, idx + 1, -1));

  const amountUp = ups.map((it) => ({ ...it, change_pct: Math.max(1, it.change_pct / 2) }));
  const amountDown = downs.map((it) => ({ ...it, change_pct: Math.min(-1, it.change_pct / 2) }));
  const shopUp = ups.map((it) => ({ ...it, change_pct: Math.max(1, it.change_pct / 3) }));
  const shopDown = downs.map((it) => ({ ...it, change_pct: Math.min(-1, it.change_pct / 3) }));

  return {
    price_up: ups,
    price_down: downs,
    amount_change_up: amountUp,
    amount_change_down: amountDown,
    shop_change_up: shopUp,
    shop_change_down: shopDown,
  };
}

function buildShopWindow(serverName: FixtureServerName, windowDay = 14): ShopWindowResponse {
  const dates = getLastNDates(windowDay);
  const baseShift = serverName === 'ServerHard' ? 0 : 12;

  const baseline_daily_stats = dates.map((date, i) => {
    const total = 182 + baseShift + i * 2 + (i % 3 === 0 ? 1 : 0);
    const newShops = 5 + (i % 4);
    const goneShops = 3 + (i % 2);
    const continuing = Math.max(0, total - newShops);

    return {
      date,
      new_shops: newShops,
      disappeared_shops: goneShops,
      continuing_shops: continuing,
      total_shops_count: total,
      median_unique_items_per_shop: Number((37 + baseShift * 0.1 + i * 0.35).toFixed(1)),
    };
  });

  const totals = baseline_daily_stats.map((d) => d.total_shops_count);
  const medians = baseline_daily_stats.map((d) => d.median_unique_items_per_shop);

  return {
    window_stats: {
      unique_shops: 420 + baseShift * 4,
      avg_presence_streak_days: Number((8.2 + baseShift * 0.03).toFixed(1)),
      total_shops_count_avg: totals.reduce((acc, val) => acc + val, 0) / totals.length,
      total_shops_count_min: Math.min(...totals),
      total_shops_count_max: Math.max(...totals),
      median_unique_items_per_shop_avg: medians.reduce((acc, val) => acc + val, 0) / medians.length,
      median_unique_items_per_shop_min: Math.min(...medians),
      median_unique_items_per_shop_max: Math.max(...medians),
    },
    baseline_daily_stats,
  };
}

function buildServerDailyWindow(serverName: FixtureServerName, windowDay = 14): ServerDailyWindowResponse {
  const dates = getLastNDates(windowDay);
  const baseShift = serverName === 'ServerHard' ? 0 : 150;

  return {
    stats: dates.map((date, idx) => ({
      date,
      total_simple_items_amount: 26000 + baseShift + idx * 420,
      unique_simple_items_amount: 3500 + Math.round(baseShift / 10) + idx * 28,
      total_bonus_items_amount: 8200 + Math.round(baseShift / 2) + idx * 130,
      unique_bonus_items_amount: 1450 + Math.round(baseShift / 18) + idx * 16,
    })),
  };
}

function buildItemDailyStats(serverName: FixtureServerName, itemVid: number, windowDay = 14): ItemStatistic[] {
  const dates = getLastNDates(windowDay);
  const item = CATALOG[serverName].find((entry) => entry.vid === itemVid) ?? CATALOG[serverName][0];

  return dates.map((date, idx) => ({
    date,
    price_q10: Number((item.basePrice * (0.88 + idx * 0.004)).toFixed(2)),
    price_median: Number((item.basePrice * (0.93 + idx * 0.005)).toFixed(2)),
    item_amount: 70 + idx * 2,
    shop_appearance_count: 13 + (idx % 5),
  }));
}

function searchCatalog(serverName: FixtureServerName, query: string, limit: number): CatalogItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return CATALOG[serverName].slice(0, limit);
  }

  return CATALOG[serverName]
    .filter((entry) => entry.name.toLowerCase().includes(normalized))
    .slice(0, limit);
}

export const fixtureServerNames: string[] = SERVER_NAMES;

export const fixtureHomepageInit: HomepageInitResponse = {
  servers: SERVER_NAMES.map((name) => ({
    name,
    status: true,
    type: SERVER_META[name].type,
    created_at: SERVER_META[name].createdAt,
    last_data_update_human: SERVER_META[name].lastUpdateHuman,
  })),
  updates: [
    {
      type: 'news',
      id: 1001,
      title: 'Aktualizacja cen i stabilizacja pobierania',
      created_at: '2026-04-10',
      description: 'Odświeżyliśmy dane o rynku i poprawiliśmy spójność agregacji ofert.',
    },
    {
      type: 'changelog',
      id: 1002,
      title: 'Nowe filtry bonusów i szybkie statystyki',
      created_at: '2026-04-09',
      content: 'Dodano precyzyjniejsze filtrowanie bonusów oraz zoptymalizowano endpointy statystyk 24h.',
    },
  ],
};

export const fixtureVoteServers: HomepageVoteServerEntry[] = [
  { name: 'ServerHard', total_votes: 482 },
  { name: 'ServerMedium', total_votes: 437 },
];

export function getFixtureDashboardInit(serverNameInput: string): DashboardInitResponse {
  const serverName = ensureServerName(serverNameInput);
  const meta = SERVER_META[serverName];

  return {
    server: {
      name: serverName,
      status: true,
      type: meta.type,
      currencies: meta.currencies,
      discord_url: `https://discord.gg/${serverName.toLowerCase()}`,
      forum_url: `https://forum.${serverName.toLowerCase()}.example.com`,
      website_url: `https://${serverName.toLowerCase()}.example.com`,
      description: `Fixture danych rynku dla serwera ${serverName}.`,
      created_at: meta.createdAt,
      last_data_update: meta.lastDataUpdate,
    },
    other_servers: SERVER_NAMES.filter((name) => name !== serverName),
  };
}

export function getFixtureTop10(serverNameInput: string): Top10Response {
  return buildTop10(ensureServerName(serverNameInput));
}

export function getFixtureShopWindow(serverNameInput: string, windowDay = 14): ShopWindowResponse {
  return buildShopWindow(ensureServerName(serverNameInput), windowDay);
}

export function getFixtureServerDailyWindow(serverNameInput: string, windowDay = 14): ServerDailyWindowResponse {
  return buildServerDailyWindow(ensureServerName(serverNameInput), windowDay);
}

export function getFixtureItemSuggestions(serverNameInput: string, query: string, limit = 10): { name: string; vid: number }[] {
  const serverName = ensureServerName(serverNameInput);
  return searchCatalog(serverName, query, limit).map((entry) => ({ name: entry.name, vid: entry.vid }));
}

export function getFixtureBonusItemSuggestions(serverNameInput: string, query: string, limit = 10): { name: string; vid: number }[] {
  return getFixtureItemSuggestions(serverNameInput, query, limit);
}

export function getFixtureBonusTypeSuggestions(serverNameInput: string, query: string, limit = 10): string[] {
  const serverName = ensureServerName(serverNameInput);
  const normalized = query.trim().toLowerCase();
  const allTypes = new Set<string>();

  for (const entry of CATALOG[serverName]) {
    entry.bonusTypes.forEach((bonus) => allTypes.add(bonus));
  }

  return Array.from(allTypes)
    .filter((bonus) => bonus.toLowerCase().includes(normalized))
    .slice(0, limit);
}

export function getFixtureBonusSearchResponse(request: BonusItemSearchRequest): BonusItemSearchResponse {
  const serverName = ensureServerName(request.server_name || 'ServerHard');
  const q = (request.q || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(50, request.limit || 20));
  const offset = Math.max(0, request.offset || 0);

  const rows = CATALOG[serverName]
    .filter((entry) => (q ? entry.name.toLowerCase().includes(q) : true))
    .map((entry, idx) => ({
      sighting_id: 10000 + idx,
      item_name: entry.name,
      price: entry.basePrice + idx * 12000,
      item_count: 1 + (idx % 5),
      last_seen: new Date(Date.now() - idx * 3600 * 1000).toISOString(),
      bonuses: entry.bonusTypes.map((name, bonusIdx) => ({
        name,
        value: 5 + bonusIdx * 2,
      })),
    }));

  const paged = rows.slice(offset, offset + limit);

  return {
    count: rows.length,
    results: paged,
    has_more: offset + limit < rows.length,
  };
}

export function getFixtureItemDailyStats(serverNameInput: string, itemVid: number, windowDay = 14): ItemStatistic[] {
  return buildItemDailyStats(ensureServerName(serverNameInput), itemVid, windowDay);
}

export function getFixtureItemPriceQ10(serverNameInput: string, itemVid: number): number | null {
  const serverName = ensureServerName(serverNameInput);
  const item = CATALOG[serverName].find((entry) => entry.vid === itemVid);
  if (!item) return null;
  return Number((item.basePrice * 0.91).toFixed(2));
}

export function getFixtureAiCalculatorPrices(request: AICalculatorRequest): AICalculatorPriceOut[] {
  const serverName = ensureServerName(request.server_name || 'ServerHard');

  return (request.items || []).map((item) => {
    const byVid = typeof item.vid === 'number' ? CATALOG[serverName].find((entry) => entry.vid === item.vid) : undefined;
    const byName = !byVid && item.name ? CATALOG[serverName].find((entry) => entry.name.toLowerCase() === item.name?.toLowerCase()) : undefined;
    const resolved = byVid || byName;

    return {
      vid: resolved?.vid ?? item.vid ?? null,
      name: resolved?.name ?? item.name ?? 'Nieznany przedmiot',
      price_q10: resolved ? Number((resolved.basePrice * 0.9).toFixed(2)) : null,
    };
  });
}
