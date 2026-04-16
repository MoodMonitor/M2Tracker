import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError } from '@/services/httpError';
import { _test } from '@/services/apiService';

// Mock workerService so `new Worker()` is never called in the test environment.
// webWorkerManager is a singleton that instantiates Worker on module import.
vi.mock('@/webWorker/webWorkerManager.ts', () => ({
  webWorkerManager: { fetchApi: vi.fn() },
}));

vi.mock('@/lib/eventBus', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn() },
}));

const { isRetryableError, calculateRetryDelay } = _test;

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe('isRetryableError', () => {
  it('returns true for 500', () => expect(isRetryableError(500)).toBe(true));
  it('returns true for 502', () => expect(isRetryableError(502)).toBe(true));
  it('returns true for 503', () => expect(isRetryableError(503)).toBe(true));
  it('returns true for 408', () => expect(isRetryableError(408)).toBe(true));
  it('returns false for 429', () => expect(isRetryableError(429)).toBe(false));
  it('returns false for 401', () => expect(isRetryableError(401)).toBe(false));
  it('returns false for 403', () => expect(isRetryableError(403)).toBe(false));
  it('returns false for 404', () => expect(isRetryableError(404)).toBe(false));
  it('returns false for 400', () => expect(isRetryableError(400)).toBe(false));
});

// ---------------------------------------------------------------------------
// calculateRetryDelay
// ---------------------------------------------------------------------------

describe('calculateRetryDelay', () => {
  it('never exceeds 30000 ms', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(calculateRetryDelay(attempt, 1000)).toBeLessThanOrEqual(30000);
    }
  });

  it('grows exponentially (median increases per attempt)', () => {
    const samples = 200;
    const median = (attempt: number) => {
      const delays = Array.from({ length: samples }, () => calculateRetryDelay(attempt, 100));
      delays.sort((a, b) => a - b);
      return delays[Math.floor(samples / 2)];
    };
    expect(median(1)).toBeGreaterThan(median(0));
    expect(median(2)).toBeGreaterThan(median(1));
  });

  it('always returns a positive number', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(calculateRetryDelay(attempt, 500)).toBeGreaterThan(0);
    }
  });

  it('stays within ±25% jitter range of the base exponential', () => {
    const attempt = 0;
    const baseDelay = 1000;
    const exponential = baseDelay * Math.pow(2, attempt);
    for (let i = 0; i < 100; i++) {
      const delay = calculateRetryDelay(attempt, baseDelay);
      expect(delay).toBeGreaterThanOrEqual(exponential * 0.75);
      expect(delay).toBeLessThanOrEqual(exponential * 1.25);
    }
  });
});

// ---------------------------------------------------------------------------
// apiFetch retry logic via getItemSuggestions
// ---------------------------------------------------------------------------

describe('apiFetch retry behaviour', () => {
  let fetchApiMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { webWorkerManager } = await import('@/webWorker/webWorkerManager.ts');
    fetchApiMock = webWorkerManager.fetchApi as ReturnType<typeof vi.fn>;
    fetchApiMock.mockReset();
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    fetchApiMock
      .mockRejectedValueOnce(new HttpError(new Response(null, { status: 500, statusText: 'Server Error' }), null))
      .mockResolvedValueOnce([]);

    const { getItemSuggestions } = await import('@/services/apiService');
    const result = await getItemSuggestions('sword', 'TestServer');
    expect(result).toEqual([]);
    expect(fetchApiMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 429 — throws immediately', async () => {
    fetchApiMock.mockRejectedValue(
      new HttpError(new Response(null, { status: 429, statusText: 'Too Many Requests' }), null)
    );

    const { getItemSuggestions } = await import('@/services/apiService');
    await expect(getItemSuggestions('sword', 'TestServer')).rejects.toThrow();
    expect(fetchApiMock).toHaveBeenCalledTimes(1);
  });

  it('throws HttpError after exhausting all retries', async () => {
    fetchApiMock.mockRejectedValue(
      new HttpError(new Response(null, { status: 500, statusText: 'Error' }), null)
    );

    const { getItemSuggestions } = await import('@/services/apiService');
    await expect(getItemSuggestions('sword', 'TestServer')).rejects.toBeInstanceOf(HttpError);
  });
});

// ---------------------------------------------------------------------------
// getItemSuggestions — label deduplication logic
// ---------------------------------------------------------------------------

describe('getItemSuggestions — deduplication', () => {
  let fetchApiMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { webWorkerManager } = await import('@/webWorker/webWorkerManager.ts');
    fetchApiMock = webWorkerManager.fetchApi as ReturnType<typeof vi.fn>;
    fetchApiMock.mockReset();
  });

  it('returns empty array for query shorter than 3 chars', async () => {
    const { getItemSuggestions } = await import('@/services/apiService');
    expect(await getItemSuggestions('ab', 'Server')).toEqual([]);
    expect(await getItemSuggestions('', 'Server')).toEqual([]);
    expect(fetchApiMock).not.toHaveBeenCalled();
  });

  it('appends (ID: vid) to label when names are duplicated', async () => {
    fetchApiMock.mockResolvedValue([
      { name: 'Dragon Sword', vid: 1 },
      { name: 'Dragon Sword', vid: 2 },
    ]);

    const { getItemSuggestions } = await import('@/services/apiService');
    const result = await getItemSuggestions('drag', 'Server');
    expect(result[0].label).toBe('Dragon Sword (ID: 1)');
    expect(result[1].label).toBe('Dragon Sword (ID: 2)');
  });

  it('does not append ID when names are unique', async () => {
    fetchApiMock.mockResolvedValue([
      { name: 'Dragon Sword', vid: 1 },
      { name: 'Iron Shield', vid: 2 },
    ]);

    const { getItemSuggestions } = await import('@/services/apiService');
    const result = await getItemSuggestions('drag', 'Server');
    expect(result[0].label).toBe('Dragon Sword');
    expect(result[1].label).toBe('Iron Shield');
  });

  it('sets value to item name and preserves vid', async () => {
    fetchApiMock.mockResolvedValue([{ name: 'Test Item', vid: 99 }]);

    const { getItemSuggestions } = await import('@/services/apiService');
    const result = await getItemSuggestions('test', 'Server');
    expect(result[0].value).toBe('Test Item');
    expect(result[0].vid).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// getBonusItemNameSuggestions — min length guard
// ---------------------------------------------------------------------------

describe('getBonusItemNameSuggestions — min length guard', () => {
  let fetchApiMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { webWorkerManager } = await import('@/webWorker/webWorkerManager.ts');
    fetchApiMock = webWorkerManager.fetchApi as ReturnType<typeof vi.fn>;
    fetchApiMock.mockReset();
  });

  it('returns empty array when trimmed query < 3 chars', async () => {
    const { getBonusItemNameSuggestions } = await import('@/services/apiService');
    expect(await getBonusItemNameSuggestions('Server', '  a  ')).toEqual([]);
    expect(fetchApiMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendFeedback — native fetch mock
// ---------------------------------------------------------------------------

describe('sendFeedback', () => {
  it('returns success:true when fetch responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const { sendFeedback } = await import('@/services/apiService');
    const result = await sendFeedback({ category: 'ux', comment: 'Good', turnstileToken: 'tok' });
    expect(result.success).toBe(true);
    vi.unstubAllGlobals();
  });

  it('returns success:false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const { sendFeedback } = await import('@/services/apiService');
    const result = await sendFeedback({ category: 'other', comment: 'test', turnstileToken: 'tok' });
    expect(result.success).toBe(false);
    vi.unstubAllGlobals();
  });

  it('returns success:false when fetch responds not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { sendFeedback } = await import('@/services/apiService');
    const result = await sendFeedback({ category: 'suggestion', comment: 'More servers', turnstileToken: 'tok' });
    expect(result.success).toBe(false);
    vi.unstubAllGlobals();
  });
});

