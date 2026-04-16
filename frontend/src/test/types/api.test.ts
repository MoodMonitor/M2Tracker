import { describe, it, expect } from 'vitest';
import { normalizeItemStatistic, toLegacyHistoryPoint } from '@/types/api';

// ---------------------------------------------------------------------------
// normalizeItemStatistic
// ---------------------------------------------------------------------------

describe('normalizeItemStatistic', () => {
  it('uses API-format fields when present', () => {
    const result = normalizeItemStatistic({
      date: '2025-01-01',
      price_q10: 100,
      price_median: 200,
      item_amount: 5,
      shop_appearance_count: 3,
    });
    expect(result).toEqual({
      date: '2025-01-01',
      price_q10: 100,
      price_median: 200,
      item_amount: 5,
      shop_appearance_count: 3,
    });
  });

  it('falls back to legacy field names', () => {
    const result = normalizeItemStatistic({
      collected_at: '2025-06-15T10:00:00Z',
      q10_price: 50,
      median_price: 75,
      amount: 10,
      shops_count: 2,
    });
    expect(result.price_q10).toBe(50);
    expect(result.price_median).toBe(75);
    expect(result.item_amount).toBe(10);
    expect(result.shop_appearance_count).toBe(2);
    // collected_at should be stripped to date only
    expect(result.date).toBe('2025-06-15');
  });

  it('API fields take precedence over legacy fields', () => {
    const result = normalizeItemStatistic({
      date: '2025-01-01',
      price_q10: 999,
      q10_price: 1,   // should be ignored
    });
    expect(result.price_q10).toBe(999);
  });

  it('defaults missing numeric fields to 0', () => {
    const result = normalizeItemStatistic({});
    expect(result.price_q10).toBe(0);
    expect(result.price_median).toBe(0);
    expect(result.item_amount).toBe(0);
    expect(result.shop_appearance_count).toBe(0);
  });

  it('returns empty string for date when both date fields are absent', () => {
    const result = normalizeItemStatistic({});
    expect(result.date).toBe('');
  });

  it('handles price_q10 = 0 correctly (not treated as missing)', () => {
    const result = normalizeItemStatistic({ price_q10: 0 });
    expect(result.price_q10).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toLegacyHistoryPoint
// ---------------------------------------------------------------------------

describe('toLegacyHistoryPoint', () => {
  it('converts API-format stat to legacy format', () => {
    const result = toLegacyHistoryPoint({
      date: '2025-03-10',
      price_q10: 123,
      price_median: 456,
      item_amount: 7,
      shop_appearance_count: 4,
    });
    expect(result.collected_at).toBe('2025-03-10T00:00:00.000Z');
    expect(result.q10_price).toBe(123);
    expect(result.median_price).toBe(456);
    expect(result.amount).toBe(7);
    expect(result.shops_count).toBe(4);
  });

  it('converts legacy-format stat to legacy format', () => {
    const result = toLegacyHistoryPoint({
      collected_at: '2025-03-10T12:00:00Z',
      q10_price: 50,
      median_price: 80,
      amount: 3,
      shops_count: 1,
    });
    expect(result.q10_price).toBe(50);
    expect(result.median_price).toBe(80);
    expect(result.collected_at).toBe('2025-03-10T00:00:00.000Z');
  });

  it('uses current ISO string when date is missing', () => {
    const before = Date.now();
    const result = toLegacyHistoryPoint({});
    const after = Date.now();
    const ts = new Date(result.collected_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('defaults missing numeric fields to 0', () => {
    const result = toLegacyHistoryPoint({});
    expect(result.q10_price).toBe(0);
    expect(result.median_price).toBe(0);
    expect(result.amount).toBe(0);
  });
});

