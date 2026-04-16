import { delay, http, HttpResponse } from 'msw';
import type {
  BonusFilterRequest,
  BonusItemSearchResponse,
  BonusItemSearchRequest,
  ItemStatistic,
  Top10Item,
  Top10Response,
} from '@/types/api';
import {
  fixtureHomepageInit,
  fixtureVoteServers,
  getFixtureBonusTypeSuggestions,
  getFixtureDashboardInit,
  getFixtureItemDailyStats,
  getFixtureServerDailyWindow,
  getFixtureShopWindow,
  getFixtureTop10,
} from './fixtures';

interface DemoItem {
  name: string;
  vid: number;
  basePrice: number;
}

interface MockSession {
  sid: string;
  expiresAt: number;
  keyEncMain?: CryptoKey;
  keyEncChart?: CryptoKey;
}

const DEFAULT_DELAY_MS = 120;
const MAIN_TTL_SECONDS = 60 * 60;
const CHART_TTL_SECONDS = 30 * 60;
const SUPPORTED_SERVERS = new Set(['ServerHard', 'ServerMedium']);
const LEGACY_SERVER_ALIASES: Record<string, string> = {
  ServerHard: 'ServerHard',
  ServerMedium: 'ServerMedium',
};
const FIXED_AI_MODEL_KEY_B64URL = 'ROpVg9CZTcoyy0WIlQLDNSdy5ynjVOxXCARsW1-4JYo=';
const FIXED_AI_MODEL_KEY_BYTES = fromBase64Url(FIXED_AI_MODEL_KEY_B64URL);
const FIXED_AI_MODEL_KEY_VIEW = new Uint8Array(FIXED_AI_MODEL_KEY_BYTES);

const AI_CALCULATOR_SERVER_MEDIUM_PRICES: Array<{ vid: number; name: string; price_q10: number }> = [
  { vid: 39008, name: 'Zwój Egzorcyzmu', price_q10: 399999999.0 },
  { vid: 39030, name: 'Rada Pustelnika', price_q10: 399999999.0 },
  { vid: 50544, name: 'Kamień Zwierzaka', price_q10: 300000000.0 },
  { vid: 50512, name: 'Diament Duchowy', price_q10: 1500000000.0 },
  { vid: 50513, name: 'Kamień Duchowy', price_q10: 400000000.0 },
  { vid: 30502, name: 'Rubinowa Ozdoba', price_q10: 166500000000.0 },
  { vid: 32016, name: 'Szara Ozdoba', price_q10: 166500000000.0 },
  { vid: 32017, name: 'Szafirowa Ozdoba', price_q10: 175000000000.0 },
  { vid: 50256, name: 'Cor Draconis (szlif.)', price_q10: 200000000.0 },
  { vid: 50257, name: 'Cor Draconis (rzadkie)', price_q10: 400000000.0 },
  { vid: 27994, name: 'Krwawa Perła', price_q10: 450000000.0 },
  { vid: 27992, name: 'Biała Perła', price_q10: 450000000.0 },
  { vid: 27993, name: 'Niebieska Perła', price_q10: 450000000.0 },
  { vid: 35002, name: 'Czerwona Smocza Stal', price_q10: 599500000000.0 },
  { vid: 50255, name: 'Cor Draconis (surowe)', price_q10: 199999999.0 },
  { vid: 25041, name: 'Magiczny Kamień', price_q10: 500000000.0 },
  { vid: 70039, name: 'Podręcznik Kowala', price_q10: 1250000000.0 },
  { vid: 39022, name: 'Zwój Boga Smoków', price_q10: 500000000.0 },
  { vid: 71053, name: 'Zaczarowanie Amuletu', price_q10: 7500000000.0 },
  { vid: 70103, name: 'Skrzynia z Marmurami', price_q10: 500000000.0 },
  { vid: 39018, name: 'Atak Boga Smoków', price_q10: 60000000.0 },
  { vid: 39017, name: 'Życie Boga Smoków', price_q10: 50000000.0 },
  { vid: 39020, name: 'Obrona Boga Smoków', price_q10: 60000000.0 },
  { vid: 39045, name: 'Szkatułka Zaczarowań', price_q10: 3000000000.0 },
  { vid: 32046, name: 'Księga Prawdy', price_q10: 4500000000.0 },
  { vid: 25040, name: 'Zwój Błogosławieństwa', price_q10: 200000000.0 },
  { vid: 30168, name: 'Notatka Przywódcy', price_q10: 500000000.0 },
  { vid: 39047, name: 'Szkat. Zaczarowań (Pas)', price_q10: 3000000000.0 },
  { vid: 36000, name: 'Zwój Przeznaczenia', price_q10: 2500000000.0 },
  { vid: 39023, name: 'Eliksir Poszukiwacza', price_q10: 80000000.0 },
  { vid: 70008, name: 'Biała Flaga', price_q10: 500000000.0 },
  { vid: 39030, name: 'Rada Pustelnika', price_q10: 399999999.0 },
  { vid: 39008, name: 'Zwój Egzorcyzmu', price_q10: 399999999.0 },
  { vid: 50512, name: 'Diament Duchowy', price_q10: 1500000000.0 },
  { vid: 50513, name: 'Kamień Duchowy', price_q10: 400000000.0 },
  { vid: 50544, name: 'Kamień Zwierzaka', price_q10: 300000000.0 },
  { vid: 39030, name: 'Rada Pustelnika', price_q10: 399999999.0 },
  { vid: 27993, name: 'Niebieska Perła', price_q10: 450000000.0 },
  { vid: 27992, name: 'Biała Perła', price_q10: 450000000.0 },
  { vid: 27994, name: 'Krwawa Perła', price_q10: 450000000.0 },
  { vid: 32001, name: 'Szary Barwnik', price_q10: 100000000000.0 },
  { vid: 50256, name: 'Cor Draconis (szlif.)', price_q10: 200000000.0 },
  { vid: 50255, name: 'Cor Draconis (surowe)', price_q10: 199999999.0 },
  { vid: 50257, name: 'Cor Draconis (rzadkie)', price_q10: 400000000.0 },
  { vid: 50255, name: 'Cor Draconis (surowe)', price_q10: 199999999.0 },
];

const AI_CALCULATOR_SERVER_HARD_PRICES: Array<{ vid: number; name: string; price_q10: number }> = [
  { vid: 50608, name: 'Ruda Ebonitu', price_q10: 475000.0 },
  { vid: 50608, name: 'Ruda Ebonitu', price_q10: 475000.0 },
  { vid: 50608, name: 'Ruda Ebonitu', price_q10: 475000.0 },
  { vid: 50628, name: 'Przetop Ebonitu', price_q10: 53571429.0 },
  { vid: 50615, name: 'Ruda Rubinu', price_q10: 650000.0 },
  { vid: 50613, name: 'Ruda Niebiań. Łez', price_q10: 400000.0 },
  { vid: 50613, name: 'Ruda Niebiań. Łez', price_q10: 400000.0 },
  { vid: 50613, name: 'Ruda Niebiań. Łez', price_q10: 400000.0 },
  { vid: 50628, name: 'Przetop Ebonitu', price_q10: 53571429.0 },
  { vid: 50615, name: 'Ruda Rubinu', price_q10: 650000.0 },
  { vid: 50607, name: 'Ruda Jadeitu', price_q10: 750000.0 },
  { vid: 50607, name: 'Ruda Jadeitu', price_q10: 750000.0 },
  { vid: 50607, name: 'Ruda Jadeitu', price_q10: 750000.0 },
  { vid: 30193, name: 'Kość Palca', price_q10: 44000000.0 },
  { vid: 50615, name: 'Ruda Rubinu', price_q10: 650000.0 },
  { vid: 50605, name: 'Ruda Srebra', price_q10: 750000.0 },
  { vid: 50605, name: 'Ruda Srebra', price_q10: 750000.0 },
  { vid: 50605, name: 'Ruda Srebra', price_q10: 750000.0 },
  { vid: 30193, name: 'Kość Palca', price_q10: 44000000.0 },
  { vid: 50614, name: 'Ruda Kryształu Duszy', price_q10: 800000.0 },
  { vid: 50606, name: 'Ruda Złota', price_q10: 750000.0 },
  { vid: 50606, name: 'Ruda Złota', price_q10: 750000.0 },
  { vid: 50606, name: 'Ruda Złota', price_q10: 750000.0 },
  { vid: 30193, name: 'Kość Palca', price_q10: 44000000.0 },
  { vid: 50614, name: 'Ruda Kryształu Duszy', price_q10: 800000.0 },
  { vid: 50604, name: 'Ruda Miedzi', price_q10: 750000.0 },
  { vid: 50604, name: 'Ruda Miedzi', price_q10: 750000.0 },
  { vid: 50604, name: 'Ruda Miedzi', price_q10: 750000.0 },
  { vid: 30193, name: 'Kość Palca', price_q10: 44000000.0 },
  { vid: 50614, name: 'Ruda Kryształu Duszy', price_q10: 800000.0 },
  { vid: 70038, name: 'Peleryna Męstwa', price_q10: 20000.0 },
  { vid: 70038, name: 'Peleryna Męstwa', price_q10: 20000.0 },
  { vid: 70038, name: 'Peleryna Męstwa', price_q10: 20000.0 },
  { vid: 70038, name: 'Peleryna Męstwa', price_q10: 20000.0 },
  { vid: 70038, name: 'Peleryna Męstwa', price_q10: 20000.0 },
  { vid: 50605, name: 'Ruda Srebra', price_q10: 750000.0 },
  { vid: 50606, name: 'Ruda Złota', price_q10: 750000.0 },
  { vid: 50604, name: 'Ruda Miedzi', price_q10: 750000.0 },
  { vid: 50609, name: 'Kawałek Perły', price_q10: 500000.0 },
  { vid: 50609, name: 'Kawałek Perły', price_q10: 500000.0 },
  { vid: 50605, name: 'Ruda Srebra', price_q10: 750000.0 },
  { vid: 50606, name: 'Ruda Złota', price_q10: 750000.0 },
  { vid: 50609, name: 'Kawałek Perły', price_q10: 500000.0 },
];

const SESSION_STORE = new Map<string, MockSession>();
const RUNTIME_FIXTURE_CACHE = new Map<string, unknown>();
const SIMPLE_ITEMS_CACHE = new Map<string, DemoItem[]>();
const BONUS_ITEMS_CACHE = new Map<string, Array<{ name: string; vid: number }>>();

function normalizeServerName(raw: string | null): string {
  const candidate = (raw || '').trim();
  const normalized = LEGACY_SERVER_ALIASES[candidate] || candidate;
  return SUPPORTED_SERVERS.has(normalized) ? normalized : 'ServerHard';
}

function toSafeFileFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function cacheKey(parts: string[]): string {
  return parts.join('/');
}

async function loadFixtureJson<T>(parts: string[]): Promise<T | null> {
  const key = cacheKey(parts);
  if (RUNTIME_FIXTURE_CACHE.has(key)) {
    return RUNTIME_FIXTURE_CACHE.get(key) as T;
  }

  try {
    const response = await fetch(`/mocks/${key}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const parsed = (await response.json()) as T;
    RUNTIME_FIXTURE_CACHE.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function loadCommonFixture<T>(fileName: string): Promise<T | null> {
  return loadFixtureJson<T>(['_common', fileName]);
}

async function loadServerFixture<T>(serverName: string, ...parts: string[]): Promise<T | null> {
  return loadFixtureJson<T>([serverName, ...parts]);
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const binaryString = atob(base64 + pad);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

function stableVid(serverName: string, itemName: string): number {
  const input = `${serverName}|${itemName}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return 100000 + Math.abs(hash % 800000);
}

function getBearerSid(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

function getClientType(request: Request): string {
  return request.headers.get('X-Client-Type') || '';
}

function topRowsFromStats(stats: Top10Response): Top10Item[] {
  return [...(stats.price_up || []), ...(stats.price_down || [])];
}

function basePriceFromTopItem(row: Top10Item): number {
  const candidates = [row.price_now, row.price_prev]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : 1000;
}

async function getSimpleDemoItems(serverName: string): Promise<DemoItem[]> {
  const safeServer = normalizeServerName(serverName);
  if (SIMPLE_ITEMS_CACHE.has(safeServer)) {
    return SIMPLE_ITEMS_CACHE.get(safeServer) as DemoItem[];
  }

  const explicitList = await loadServerFixture<Array<Partial<DemoItem>>>(safeServer, 'simple_items', 'demo_items.json');
  if (Array.isArray(explicitList) && explicitList.length > 0) {
    const cleaned = explicitList
      .filter((it) => typeof it.name === 'string' && typeof it.vid === 'number')
      .map((it) => ({ name: normalizeText(it.name as string), vid: it.vid as number, basePrice: Number(it.basePrice) || 1000 }))
      .slice(0, 5);

    if (cleaned.length > 0) {
      SIMPLE_ITEMS_CACHE.set(safeServer, cleaned);
      return cleaned;
    }
  }

  const runtimeStats = await loadServerFixture<Top10Response>(safeServer, 'stats_24h.json');
  const stats = runtimeStats || getFixtureTop10(safeServer);

  const topPairsRaw = await loadServerFixture<Array<{ name: string; vid: number }> | { name: string; vid: number }>(
    safeServer,
    'simple_items',
    'top_items.json'
  );
  const topPairs = Array.isArray(topPairsRaw) ? topPairsRaw : topPairsRaw ? [topPairsRaw] : [];

  const suggestPairs = (await loadServerFixture<Array<{ name: string; vid: number }>>(safeServer, 'suggest', 'simple_items.json')) || [];

  const vidByName = new Map<string, number>();
  for (const row of [...topPairs, ...suggestPairs]) {
    if (row?.name && typeof row.vid === 'number') {
      vidByName.set(normalizeForMatch(row.name), row.vid);
    }
  }

  const selected = topRowsFromStats(stats)
    .map((row) => ({
      name: normalizeText((row.item_name || '').trim()),
      basePrice: basePriceFromTopItem(row),
      score: Math.abs(Number(row.change_pct) || 0),
    }))
    .filter((row) => row.name.length > 0)
    .sort((a, b) => b.score - a.score || b.basePrice - a.basePrice);

  const used = new Set<string>();
  const out: DemoItem[] = [];
  for (const row of selected) {
    if (used.has(row.name)) continue;
    used.add(row.name);
    const vid = vidByName.get(normalizeForMatch(row.name)) ?? stableVid(safeServer, row.name);
    out.push({ name: row.name, vid, basePrice: row.basePrice });
    if (out.length >= 5) break;
  }

  if (out.length === 0) {
    const fallback = [
      { name: 'Demo Item A', vid: stableVid(safeServer, 'Demo Item A'), basePrice: 100000 },
      { name: 'Demo Item B', vid: stableVid(safeServer, 'Demo Item B'), basePrice: 150000 },
      { name: 'Demo Item C', vid: stableVid(safeServer, 'Demo Item C'), basePrice: 120000 },
      { name: 'Demo Item D', vid: stableVid(safeServer, 'Demo Item D'), basePrice: 90000 },
      { name: 'Demo Item E', vid: stableVid(safeServer, 'Demo Item E'), basePrice: 130000 },
    ];
    SIMPLE_ITEMS_CACHE.set(safeServer, fallback);
    return fallback;
  }

  SIMPLE_ITEMS_CACHE.set(safeServer, out);
  return out;
}

async function getBonusDemoItems(serverName: string): Promise<Array<{ name: string; vid: number }>> {
  const safeServer = normalizeServerName(serverName);
  if (BONUS_ITEMS_CACHE.has(safeServer)) {
    return BONUS_ITEMS_CACHE.get(safeServer) as Array<{ name: string; vid: number }>;
  }

  const explicitList = await loadServerFixture<Array<{ name: string; vid: number }>>(safeServer, 'bonus_items', 'demo_items.json');
  const fromSuggest = await loadServerFixture<Array<{ name: string; vid: number }>>(safeServer, 'suggest', 'bonus_items.json');

  const base = Array.isArray(explicitList) && explicitList.length > 0
    ? explicitList
    : Array.isArray(fromSuggest) && fromSuggest.length > 0
      ? fromSuggest
      : [];

  const unique = new Map<string, { name: string; vid: number }>();
  for (const row of base) {
    if (!row?.name || typeof row.vid !== 'number') continue;
    const normalizedName = normalizeText(row.name);
    if (!unique.has(normalizedName)) {
      unique.set(normalizedName, { name: normalizedName, vid: row.vid });
    }
  }

  const out = Array.from(unique.values()).slice(0, 5);
  if (out.length === 0) {
    const fallback = [
      { name: 'Bonus Demo A', vid: stableVid(safeServer, 'Bonus Demo A') },
      { name: 'Bonus Demo B', vid: stableVid(safeServer, 'Bonus Demo B') },
      { name: 'Bonus Demo C', vid: stableVid(safeServer, 'Bonus Demo C') },
      { name: 'Bonus Demo D', vid: stableVid(safeServer, 'Bonus Demo D') },
      { name: 'Bonus Demo E', vid: stableVid(safeServer, 'Bonus Demo E') },
    ];
    BONUS_ITEMS_CACHE.set(safeServer, fallback);
    return fallback;
  }

  BONUS_ITEMS_CACHE.set(safeServer, out);
  return out;
}

function synthesizeDailyStats(basePrice: number, windowDay: number): ItemStatistic[] {
  const out: ItemStatistic[] = [];
  const now = new Date();
  for (let i = windowDay - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const phase = Math.sin((windowDay - i) / 2.7);
    const median = Math.max(1, basePrice * (0.92 + phase * 0.05));
    const q10 = Math.max(1, median * 0.85);

    out.push({
      date,
      price_median: Number(median.toFixed(2)),
      price_q10: Number(q10.toFixed(2)),
      item_amount: Math.max(1, 90 + Math.round(phase * 16) + (windowDay - i) * 2),
      shop_appearance_count: Math.max(1, 12 + Math.round(phase * 2) + ((windowDay - i) % 3)),
    });
  }
  return out;
}

async function loadDailyWindow(serverName: string, itemVid: number, windowDay: number): Promise<ItemStatistic[]> {
  const safeServer = normalizeServerName(serverName);
  const modernPath = await loadServerFixture<{ stats: ItemStatistic[] }>(
    safeServer,
    'simple_items',
    'daily_windows',
    `item_${itemVid}_${windowDay}d.json`
  );
  if (modernPath?.stats && Array.isArray(modernPath.stats) && modernPath.stats.length > 0) {
    return modernPath.stats;
  }

  const legacyPath = await loadServerFixture<{ stats: ItemStatistic[] }>(
    safeServer,
    'simple_items',
    'daily_windows',
    `item_daily_window_${safeServer}_${itemVid}.json`
  );
  if (legacyPath?.stats && Array.isArray(legacyPath.stats) && legacyPath.stats.length > 0) {
    return legacyPath.stats;
  }

  const simpleItems = await getSimpleDemoItems(safeServer);
  const selected = simpleItems.find((item) => item.vid === itemVid);
  if (selected) {
    return synthesizeDailyStats(selected.basePrice, windowDay);
  }

  return getFixtureItemDailyStats(safeServer, itemVid, windowDay);
}

function matchesBonusFilter(bonuses: Array<{ name: string; value: number }>, filter: BonusFilterRequest): boolean {
  const targetName = normalizeForMatch(filter.name);
  const target = bonuses.find((b) => normalizeForMatch(b.name) === targetName);
  if (!target) return false;

  const op = (filter.op || 'gte').toLowerCase();
  if (op === 'gt') return target.value > filter.value;
  if (op === 'gte') return target.value >= filter.value;
  if (op === 'lt') return target.value < filter.value;
  if (op === 'lte') return target.value <= filter.value;
  if (op === 'eq' || op === '=') return target.value === filter.value;
  return false;
}

function normalizeText(value: string): string {
  if (!value) return value;

  const replacements: Array<[string, string]> = [
    ['Ä', 'ą'], ['Ä', 'ć'], ['Ä', 'ę'], ['Å', 'ł'], ['Å', 'ń'], ['Ã³', 'ó'], ['Å', 'ś'], ['Å¼', 'ż'], ['Åº', 'ź'],
    ['Ä', 'Ą'], ['Ä', 'Ć'], ['Ä', 'Ę'], ['Å', 'Ł'], ['Å', 'Ń'], ['Ã', 'Ó'], ['Å', 'Ś'], ['Å»', 'Ż'], ['Å¹', 'Ź'],
    ['Ĺ‚', 'ł'], ['Ĺ', 'Ł'], ['Ăł', 'ó'], ['â', '–'], ['â', '—'],

    ['Zlote Plyty', 'Złote Płyty'],
    ['Krwawa Perla', 'Krwawa Perła'],
    ['Kamien Duchowy', 'Kamień Duchowy'],
    ['Zwoj Egzorcyzmu', 'Zwój Egzorcyzmu'],
    ['Ogon Weza', 'Ogon Węża'],
    ['Ampulka Ukojenia', 'Ampułka Ukojenia'],
    ['Miecz Pelni Ksiezyca+9', 'Miecz Pełni Księżyca+9'],
    ['Miecz Zalu+9', 'Miecz Żalu+9'],
    ['Luk Z Rogu Jelenia+9', 'Łuk Z Rogu Jelenia+9'],
    ['Jotunskie Ostrze+9', 'Jotuńskie Ostrze+9'],
    ['Jotunski Luk+9', 'Jotuński Łuk+9'],
    ['Jotunski Dzwon+9', 'Jotuński Dzwon+9'],
  ];

  let directFixed = value;
  for (const [bad, good] of replacements) {
    directFixed = directFixed.split(bad).join(good);
  }
  if (directFixed !== value) {
    return directFixed;
  }

  // Typical mojibake markers from UTF-8 interpreted as ANSI/Latin-1.
  if (!/[ÃÅÄĹ]|[\u0080-\u00BF]/.test(value)) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(Array.from(value), (char) => char.charCodeAt(0) & 0xff);
    const repaired = new TextDecoder('utf-8').decode(bytes).replace(/\u0000/g, '').trim();
    let repairedOut = repaired || value;
    for (const [bad, good] of replacements) {
      repairedOut = repairedOut.split(bad).join(good);
    }
    return repairedOut;
  } catch {
    return value;
  }
}

function deepNormalizeStrings<T>(input: T): T {
  if (typeof input === 'string') {
    return normalizeText(input) as T;
  }

  if (Array.isArray(input)) {
    return input.map((entry) => deepNormalizeStrings(entry)) as T;
  }

  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = deepNormalizeStrings(value);
    }
    return out as T;
  }

  return input;
}

function normalizeForMatch(value: string): string {
  return normalizeText(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeBonusRows(
  rows: Array<{
    sighting_id?: number;
    item_name?: string;
    price?: number;
    item_count?: number;
    last_seen?: string;
    bonuses?: Array<{ name?: string; value?: number }>;
    vid?: number;
  }>,
  fallbackVid?: number
) {
  return rows.map((row, idx) => ({
    sighting_id: typeof row.sighting_id === 'number' ? row.sighting_id : 90000 + idx,
    item_name: normalizeText(String(row.item_name || 'Nieznany przedmiot')),
    price: typeof row.price === 'number' ? row.price : 0,
    item_count: typeof row.item_count === 'number' ? row.item_count : 1,
    last_seen: row.last_seen || new Date().toISOString(),
    bonuses: Array.isArray(row.bonuses)
      ? row.bonuses
          .filter((bonus) => bonus && typeof bonus.name === 'string')
          .map((bonus) => ({
            name: normalizeText(String(bonus.name)),
            value: typeof bonus.value === 'number' ? bonus.value : 0,
          }))
      : [],
    vid: typeof row.vid === 'number' ? row.vid : fallbackVid,
  }));
}

async function loadBonusRowsFromFixtures(serverName: string, requestedItemVid?: number): Promise<ReturnType<typeof normalizeBonusRows>> {
  const safeServer = normalizeServerName(serverName);

  if (typeof requestedItemVid === 'number') {
    const itemFixture = await loadServerFixture<BonusItemSearchResponse>(
      safeServer,
      'bonus_items',
      'search',
      `item_${requestedItemVid}.json`
    );
    if (itemFixture?.results && Array.isArray(itemFixture.results) && itemFixture.results.length > 0) {
      return normalizeBonusRows(itemFixture.results as any[], requestedItemVid);
    }
  }

  const allFixture = await loadServerFixture<BonusItemSearchResponse>(safeServer, 'bonus_items', 'search', 'all.json');
  if (allFixture?.results && Array.isArray(allFixture.results) && allFixture.results.length > 0) {
    return normalizeBonusRows(allFixture.results as any[]);
  }

  const demoItems = await getBonusDemoItems(safeServer);
  const merged: ReturnType<typeof normalizeBonusRows> = [];
  for (const item of demoItems) {
    const itemFixture = await loadServerFixture<BonusItemSearchResponse>(
      safeServer,
      'bonus_items',
      'search',
      `item_${item.vid}.json`
    );
    if (itemFixture?.results && Array.isArray(itemFixture.results) && itemFixture.results.length > 0) {
      merged.push(...normalizeBonusRows(itemFixture.results as any[], item.vid));
    }
  }

  return merged;
}

async function deriveBonusTypePool(serverName: string): Promise<string[]> {
  const safeServer = normalizeServerName(serverName);
  const runtime = await loadServerFixture<Array<string> | { suggestions: string[] }>(safeServer, 'suggest', 'bonus_types.json');
  if (Array.isArray(runtime) && runtime.length > 0) return runtime.map((it) => normalizeText(String(it)));
  if (runtime && typeof runtime === 'object' && Array.isArray((runtime as any).suggestions)) {
    return (runtime as any).suggestions.map((it: string) => normalizeText(String(it)));
  }

  return getFixtureBonusTypeSuggestions(safeServer, '', 20).map((it) => normalizeText(String(it)));
}

async function deriveBonusSearchRows(serverName: string) {
  const items = await getBonusDemoItems(serverName);
  const bonusTypes = await deriveBonusTypePool(serverName);

  return items.map((item, idx) => {
    const first = bonusTypes[idx % Math.max(1, bonusTypes.length)] || 'Maks. PŻ';
    const second = bonusTypes[(idx + 3) % Math.max(1, bonusTypes.length)] || 'Silny przeciwko Potworom';

    return {
      sighting_id: 90000 + idx,
      item_name: item.name,
      price: 150000 + idx * 17500,
      item_count: 1 + (idx % 4),
      last_seen: new Date(Date.now() - idx * 3600 * 1000).toISOString(),
      bonuses: [
        { name: first, value: 8 + idx },
        { name: second, value: 5 + idx },
      ],
      vid: item.vid,
    };
  });
}

async function deriveSimplePriceForCalculator(serverName: string, item: { vid?: number | null; name?: string | null }): Promise<{ vid: number | null; name: string; price_q10: number | null }> {
  const demoItems = await getSimpleDemoItems(serverName);
  const byVid = typeof item.vid === 'number' ? demoItems.find((entry) => entry.vid === item.vid) : undefined;
  const byName = !byVid && item.name ? demoItems.find((entry) => entry.name.toLowerCase() === item.name?.toLowerCase()) : undefined;
  const match = byVid || byName;

  if (!match) {
    return {
      vid: item.vid ?? null,
      name: item.name || 'Nieznany przedmiot',
      price_q10: null,
    };
  }

  return {
    vid: match.vid,
    name: match.name,
    price_q10: Number((match.basePrice * 0.9).toFixed(2)),
  };
}

async function deriveSimplePriceQ10(serverName: string, itemVid: number): Promise<number | null> {
  const demoItems = await getSimpleDemoItems(serverName);
  const selected = demoItems.find((item) => item.vid === itemVid);
  if (!selected) return null;
  return Number((selected.basePrice * 0.9).toFixed(2));
}

async function deriveDashboardInit(serverName: string) {
  const safeServer = normalizeServerName(serverName);
  const runtime = await loadServerFixture(safeServer, 'dashboard_init.json');
  return deepNormalizeStrings(runtime || getFixtureDashboardInit(safeServer));
}

async function deriveStats24h(serverName: string): Promise<Top10Response> {
  const safeServer = normalizeServerName(serverName);
  const runtime = await loadServerFixture<Top10Response>(safeServer, 'stats_24h.json');
  return deepNormalizeStrings(runtime || getFixtureTop10(safeServer));
}

async function deriveShopsWindow(serverName: string, windowDay: number) {
  const safeServer = normalizeServerName(serverName);
  const runtime = await loadServerFixture(safeServer, `shops_${windowDay}d.json`);
  return runtime || getFixtureShopWindow(safeServer, windowDay);
}

async function deriveServersWindow(serverName: string, windowDay: number) {
  const safeServer = normalizeServerName(serverName);
  const runtime = await loadServerFixture(safeServer, `servers_${windowDay}d.json`);
  return runtime || getFixtureServerDailyWindow(safeServer, windowDay);
}

async function deriveHomepageInit() {
  const runtime = await loadCommonFixture('homepage_init.json');
  return deepNormalizeStrings(runtime || fixtureHomepageInit);
}

async function deriveVoteServers() {
  const runtime = await loadCommonFixture('homepage_vote_servers.json');
  return runtime || fixtureVoteServers;
}

async function deriveSimpleSuggest(serverName: string, limit: number) {
  const simple = await getSimpleDemoItems(serverName);
  return simple
    .slice(0, Math.max(1, limit))
    .map((item) => ({ name: normalizeText(item.name), vid: item.vid }));
}

async function deriveBonusSuggest(serverName: string, query: string, limit: number) {
  const bonus = await getBonusDemoItems(serverName);
  const q = normalizeForMatch(query || '');
  const filtered = q
    ? bonus.filter((item) => normalizeForMatch(item.name).includes(q))
    : bonus;
  return filtered.slice(0, Math.max(1, limit));
}

async function deriveBonusTypeSuggest(serverName: string, query: string, limit: number) {
  const pool = await deriveBonusTypePool(serverName);
  const q = normalizeForMatch(query || '');
  return pool.filter((name) => !q || normalizeForMatch(name).includes(q)).slice(0, Math.max(1, limit));
}

async function deriveBonusSearch(body: BonusItemSearchRequest) {
  const serverName = normalizeServerName(body.server_name || 'ServerHard');
  const requestedItemVid = typeof body.item_vid === 'number' ? body.item_vid : undefined;
  let rows = await loadBonusRowsFromFixtures(serverName, requestedItemVid);
  if (rows.length === 0) {
    rows = await deriveBonusSearchRows(serverName);
  }

  const q = normalizeForMatch(body.q || '');
  if (typeof body.item_vid === 'number') {
    rows = rows.filter((row) => row.vid === body.item_vid);
  } else if (q) {
    rows = rows.filter((row) => normalizeForMatch(row.item_name).includes(q));
  }

  if (Array.isArray(body.filters) && body.filters.length > 0) {
    rows = rows.filter((row) => body.filters!.every((filter) => matchesBonusFilter(row.bonuses, filter)));
  }

  const sortBy = (body.sort_by || 'date').toLowerCase();
  const sortDir = (body.sort_dir || 'desc').toLowerCase();
  rows.sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'price') return (a.price - b.price) * mul;
    if (sortBy === 'amount') return (a.item_count - b.item_count) * mul;
    return (new Date(a.last_seen).getTime() - new Date(b.last_seen).getTime()) * mul;
  });

  const offset = Math.max(0, body.offset || 0);
  const limit = Math.max(1, Math.min(50, body.limit || 20));
  const paged = rows.slice(offset, offset + limit);

  return {
    count: rows.length,
    results: paged.map((row) => ({
      sighting_id: row.sighting_id,
      item_name: row.item_name,
      price: row.price,
      item_count: row.item_count,
      last_seen: row.last_seen,
      bonuses: row.bonuses,
    })),
    has_more: offset + limit < rows.length,
  };
}

async function deriveAiCalculatorPrices(body: { server_name?: string; items?: Array<{ vid?: number | null; name?: string | null }> }) {
  const serverName = normalizeServerName(body.server_name || 'ServerHard');
  const prices = serverName === 'ServerMedium' ? AI_CALCULATOR_SERVER_MEDIUM_PRICES : AI_CALCULATOR_SERVER_HARD_PRICES;
  return prices.map((row) => ({ ...row }));
}

async function deriveItemPriceQ10(serverName: string, itemVid: number): Promise<number | null> {
  const runtime = await deriveSimplePriceQ10(serverName, itemVid);
  return runtime;
}

async function deriveItemDailyWindow(serverName: string, itemVid: number, windowDay: number): Promise<ItemStatistic[]> {
  return loadDailyWindow(serverName, itemVid, windowDay);
}

async function deriveEncryptedChartStats(request: Request, stats: ItemStatistic[]) {
  const sid = getBearerSid(request);
  if (!sid) {
    return HttpResponse.json({ detail: 'Missing Authorization token' }, { status: 401 });
  }

  const session = SESSION_STORE.get(sid);
  if (!session?.keyEncChart) {
    return HttpResponse.json({ detail: 'Missing chart key' }, { status: 401 });
  }

  const encryptedStats = await Promise.all(
    stats.map(async (point) => {
      const iv = randomBytes(12);
      const payload = new TextEncoder().encode(JSON.stringify({
        price_q10: point.price_q10,
        price_median: point.price_median,
        item_amount: point.item_amount,
        shop_appearance_count: point.shop_appearance_count,
      }));

      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.keyEncChart as CryptoKey, payload);

      return {
        date: point.date,
        encrypted_values: toBase64Url(encrypted),
        iv: toBase64Url(iv.buffer),
      };
    })
  );

  return HttpResponse.json({ stats: encryptedStats });
}

async function deriveAuthDashboard(body: { token?: string; client_pubkey?: string }) {
  if (!body.token || !body.client_pubkey) {
    return HttpResponse.json({ detail: 'Missing token or client_pubkey' }, { status: 400 });
  }

  const serverKeyPair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const serverPubRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);
  const salt = randomBytes(16);
  const sid = `msw-${crypto.randomUUID()}`;

  const clientPublicKey = await crypto.subtle.importKey('raw', fromBase64Url(body.client_pubkey), { name: 'X25519' }, true, []);
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'X25519', public: clientPublicKey }, serverKeyPair.privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveKey']);

  const keyEncMain = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt, info: new TextEncoder().encode('keyEnc'), hash: 'SHA-256' },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  SESSION_STORE.set(sid, {
    sid,
    keyEncMain,
    expiresAt: Date.now() + MAIN_TTL_SECONDS * 1000,
  });

  return HttpResponse.json({
    server_pubkey: toBase64Url(serverPubRaw),
    salt: toBase64Url(salt.buffer),
    sid,
    ttl: MAIN_TTL_SECONDS,
  });
}

async function deriveAuthChartWorker(request: Request, body: { token?: string; client_pubkey?: string }) {
  const sid = getBearerSid(request);
  if (!sid) {
    return HttpResponse.json({ detail: 'Missing Authorization token' }, { status: 401 });
  }

  const session = SESSION_STORE.get(sid);
  if (!session || session.expiresAt <= Date.now()) {
    return HttpResponse.json({ detail: 'Session expired' }, { status: 401 });
  }

  if (!body.client_pubkey || !body.token) {
    return HttpResponse.json({ detail: 'Missing token or client_pubkey' }, { status: 400 });
  }

  const serverKeyPair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const serverPubRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);
  const salt = randomBytes(16);

  const clientPublicKey = await crypto.subtle.importKey('raw', fromBase64Url(body.client_pubkey), { name: 'X25519' }, true, []);
  const sharedSecret = await crypto.subtle.deriveBits({ name: 'X25519', public: clientPublicKey }, serverKeyPair.privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveKey']);

  session.keyEncChart = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt, info: new TextEncoder().encode('keyEnc_worker'), hash: 'SHA-256' },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return HttpResponse.json({
    server_pubkey: toBase64Url(serverPubRaw),
    salt: toBase64Url(salt.buffer),
    ttl: CHART_TTL_SECONDS,
  });
}

async function deriveAuthAi(request: Request) {
  const sid = getBearerSid(request);
  if (!sid) {
    return HttpResponse.json({ detail: 'Missing Authorization token' }, { status: 401 });
  }

  const session = SESSION_STORE.get(sid);
  if (!session?.keyEncMain) {
    return HttpResponse.json({ detail: 'No active secure session for AI key exchange' }, { status: 401 });
  }

  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    session.keyEncMain,
    FIXED_AI_MODEL_KEY_VIEW as unknown as BufferSource
  );

  const out = new Uint8Array(iv.length + encrypted.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(encrypted), iv.length);

  return HttpResponse.json({ encrypted_key: toBase64Url(out.buffer as ArrayBuffer) });
}

export const handlers = [
  http.get('*/api/v1/homepage/init', async () => {
    await delay(DEFAULT_DELAY_MS);
    return HttpResponse.json(await deriveHomepageInit());
  }),

  http.get('*/api/v1/homepage/vote-servers', async () => {
    await delay(DEFAULT_DELAY_MS);
    return HttpResponse.json(await deriveVoteServers());
  }),

  http.post('*/api/v1/homepage/vote', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const body = (await request.json().catch(() => ({}))) as { servers?: string[] };
    const votedCount = Array.isArray(body.servers) ? body.servers.length : 0;
    return HttpResponse.json({ allowed: true, voted_count: votedCount, retry_after_seconds: null });
  }),

  http.post('*/auth/dashboard', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const body = (await request.json().catch(() => ({}))) as { token?: string; client_pubkey?: string };
    return deriveAuthDashboard(body);
  }),

  http.get('*/auth/status', async ({ request }) => {
    await delay(40);
    const sid = getBearerSid(request);
    if (!sid) return new HttpResponse(null, { status: 401 });

    const session = SESSION_STORE.get(sid);
    if (!session || session.expiresAt <= Date.now()) return new HttpResponse(null, { status: 401 });
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('*/auth/chart-worker', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const body = (await request.json().catch(() => ({}))) as { token?: string; client_pubkey?: string };
    return deriveAuthChartWorker(request, body);
  }),

  http.get('*/auth/ai', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    return deriveAuthAi(request);
  }),

  http.get('*/api/v1/dashboard/init', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const serverName = normalizeServerName(new URL(request.url).searchParams.get('server_name'));
    return HttpResponse.json(await deriveDashboardInit(serverName));
  }),

  http.get('*/api/v1/dashboard/stats/24h', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const serverName = normalizeServerName(new URL(request.url).searchParams.get('server_name'));
    return HttpResponse.json(await deriveStats24h(serverName));
  }),

  http.get('*/api/v1/dashboard/stats/shops/daily-window', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const url = new URL(request.url);
    const serverName = normalizeServerName(url.searchParams.get('server_name'));
    const windowDay = Number(url.searchParams.get('window_day') || '14');
    return HttpResponse.json(await deriveShopsWindow(serverName, windowDay));
  }),

  http.get('*/api/v1/dashboard/stats/servers/daily-window', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const url = new URL(request.url);
    const serverName = normalizeServerName(url.searchParams.get('server_name'));
    const windowDay = Number(url.searchParams.get('window_day') || '14');
    return HttpResponse.json(await deriveServersWindow(serverName, windowDay));
  }),

  http.get('*/api/v1/dashboard/simple_items/suggest', async ({ request }) => {
    await delay(60);
    const url = new URL(request.url);
    const serverName = normalizeServerName(url.searchParams.get('server_name'));
    const limit = Number(url.searchParams.get('limit') || '10');
    const list = await deriveSimpleSuggest(serverName, limit);
    return HttpResponse.json(list);
  }),

  http.get('*/api/v1/dashboard/simple_items/daily-window', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const url = new URL(request.url);
    const serverName = normalizeServerName(url.searchParams.get('server_name'));
    const itemVid = Number(url.searchParams.get('item_vid') || '0');
    const windowDay = Number(url.searchParams.get('window_day') || '14');

    const stats = await deriveItemDailyWindow(serverName, itemVid, windowDay);
    if (getClientType(request) === 'worker-data') {
      return deriveEncryptedChartStats(request, stats);
    }

    return HttpResponse.json({ stats });
  }),

  http.get('*/api/v1/dashboard/simple_items/price-q10/last-update', async ({ request }) => {
    await delay(40);
    const url = new URL(request.url);
    const serverName = normalizeServerName(url.searchParams.get('server_name'));
    const itemVid = Number(url.searchParams.get('item_vid') || '0');
    return HttpResponse.json({ price_q10: await deriveItemPriceQ10(serverName, itemVid) });
  }),

  http.post('*/api/v1/dashboard/simple_items/ai-calculator/prices', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const body = (await request.json().catch(() => ({ server_name: 'ServerHard', items: [] }))) as {
      server_name?: string;
      items?: Array<{ vid?: number | null; name?: string | null }>;
    };
    return HttpResponse.json(await deriveAiCalculatorPrices(body));
  }),

  http.get('*/api/v1/dashboard/bonus_items/suggest', async ({ request }) => {
    await delay(60);
    const url = new URL(request.url);
    const serverName = normalizeServerName(url.searchParams.get('server_name'));
    const q = url.searchParams.get('q') || '';
    const limit = Number(url.searchParams.get('limit') || '10');
    return HttpResponse.json(await deriveBonusSuggest(serverName, q, limit));
  }),

  http.get('*/api/v1/dashboard/bonus_items/bonus-types/suggest', async ({ request }) => {
    await delay(60);
    const url = new URL(request.url);
    const serverName = normalizeServerName(url.searchParams.get('server_name'));
    const q = url.searchParams.get('q') || '';
    const limit = Number(url.searchParams.get('limit') || '10');
    return HttpResponse.json({ suggestions: await deriveBonusTypeSuggest(serverName, q, limit) });
  }),

  http.post('*/api/v1/dashboard/bonus_items/search', async ({ request }) => {
    await delay(DEFAULT_DELAY_MS);
    const body = (await request.json().catch(() => ({ server_name: 'ServerHard' }))) as BonusItemSearchRequest;
    return HttpResponse.json(await deriveBonusSearch(body));
  }),

  http.post('*/api/v1/dashboard/ping', async () => {
    await delay(20);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('*/api/v1/dashboard/feedback/ai-calculator', async () => {
    await delay(120);
    return HttpResponse.json({ allowed: true, voted_count: 1, retry_after_seconds: null });
  }),

  http.post('*/api/v1/feedback/submit', async () => {
    await delay(80);
    return HttpResponse.json({ ok: true }, { status: 200 });
  }),
];
