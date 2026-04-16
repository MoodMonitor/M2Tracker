import { describe, it, expect } from 'vitest';
import { formatCurrency, sanitizeInput, safeExternalUrl } from '@/lib/utils';

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

const YANG: { name: string; symbol: string; threshold: number } = { name: 'Yang', symbol: 'W', threshold: 1 };
const WU:   { name: string; symbol: string; threshold: number } = { name: 'Wu',   symbol: 'WU', threshold: 1_000_000 };

describe('formatCurrency', () => {
  describe('edge cases — no currency config', () => {
    it('returns B/D for null', () => {
      expect(formatCurrency(null)).toBe('B/D');
    });

    it('returns B/D for undefined', () => {
      expect(formatCurrency(undefined)).toBe('B/D');
    });

    it('returns B/D for NaN', () => {
      expect(formatCurrency(NaN)).toBe('B/D');
    });

    it('returns B/D for Infinity', () => {
      expect(formatCurrency(Infinity)).toBe('B/D');
    });

    it('returns 0 for zero', () => {
      expect(formatCurrency(0)).toBe('0');
    });
  });

  describe('plain k/kk/kkk suffixes (no currencies)', () => {
    it('formats values below 1000 as plain number', () => {
      expect(formatCurrency(999)).toBe('999');
      expect(formatCurrency(1)).toBe('1');
    });

    it('formats 1000 as 1k', () => {
      expect(formatCurrency(1000)).toBe('1k');
    });

    it('formats 1500 as 1,5k', () => {
      // pl-PL locale uses comma as decimal separator
      expect(formatCurrency(1500)).toBe('1,5k');
    });

    it('formats 1_000_000 as 1kk', () => {
      expect(formatCurrency(1_000_000)).toBe('1kk');
    });

    it('formats 1_500_000 as 1,5kk', () => {
      expect(formatCurrency(1_500_000)).toBe('1,5kk');
    });

    it('formats 1_000_000_000 as 1kkk', () => {
      expect(formatCurrency(1_000_000_000)).toBe('1kkk');
    });

    it('handles negative values', () => {
      expect(formatCurrency(-1000)).toBe('-1k');
      expect(formatCurrency(-1_500_000)).toBe('-1,5kk');
    });
  });

  describe('with currency config', () => {
    it('appends symbol when value meets threshold', () => {
      expect(formatCurrency(500, [YANG])).toBe('500W');
    });

    it('appends k-suffix and symbol together', () => {
      expect(formatCurrency(1500, [YANG])).toBe('1,5kW');
    });

    it('picks the highest applicable threshold', () => {
      // 2_000_000 >= 1_000_000 (WU) — should use WU, not YANG
      expect(formatCurrency(2_000_000, [YANG, WU])).toBe('2WU');
    });

    it('falls back to lower-threshold currency when value is below higher one', () => {
      // 500_000 < 1_000_000 (WU threshold), so falls to YANG
      expect(formatCurrency(500_000, [YANG, WU])).toBe('500kW');
    });

    it('ignores currencies whose threshold is above the value', () => {
      // value=1 with WU threshold=1_000_000 — no match, plain number
      expect(formatCurrency(1, [WU])).toBe('1');
    });

    it('works with threshold equal to value', () => {
      const C = { name: 'X', symbol: 'X', threshold: 100 };
      expect(formatCurrency(100, [C])).toBe('1X');
    });

    it('handles negative values with currency', () => {
      expect(formatCurrency(-1_000_000, [WU])).toBe('-1WU');
    });
  });

  describe('precision parameter', () => {
    it('respects custom precision', () => {
      // 1111 / 1000 = 1.111 → with precision=0 → "1k"
      expect(formatCurrency(1111, [], 0)).toBe('1k');
    });

    it('default precision is 2 decimal places', () => {
      expect(formatCurrency(1234, [])).toBe('1,23k');
    });
  });
});

// ---------------------------------------------------------------------------
// sanitizeInput
// ---------------------------------------------------------------------------

describe('sanitizeInput', () => {
  it('trims whitespace by default', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
  });

  it('does not trim when trimEdges=false', () => {
    expect(sanitizeInput('  hello  ', 5000, false)).toBe('  hello  ');
  });

  it('truncates to maxLen', () => {
    const long = 'a'.repeat(6000);
    expect(sanitizeInput(long, 5000)).toHaveLength(5000);
  });

  it('removes control characters (null byte)', () => {
    expect(sanitizeInput('hello\x00world')).toBe('helloworld');
  });

  it('removes control characters (0x01–0x08)', () => {
    expect(sanitizeInput('\x01\x02\x08text')).toBe('text');
  });

  it('removes vertical tab (0x0B) and form feed (0x0C)', () => {
    expect(sanitizeInput('a\x0Bb\x0Cc')).toBe('abc');
  });

  it('removes DEL character (0x7F)', () => {
    expect(sanitizeInput('te\x7Fxt')).toBe('text');
  });

  it('preserves tab (0x09), newline (0x0A) and carriage return (0x0D) when trimEdges=false', () => {
    expect(sanitizeInput('\t\n\rtext', 5000, false)).toBe('\t\n\rtext');
  });

  it('trims leading tab/newline when trimEdges=true (default)', () => {
    // trim() removes all leading/trailing whitespace including \t, \n, \r
    expect(sanitizeInput('\t\n\rtext')).toBe('text');
  });

  it('handles null/undefined value gracefully', () => {
    // @ts-expect-error: testing runtime behaviour with bad input
    expect(sanitizeInput(null)).toBe('');
    // @ts-expect-error
    expect(sanitizeInput(undefined)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeInput('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// safeExternalUrl
// ---------------------------------------------------------------------------

describe('safeExternalUrl', () => {
  it('allows https URLs', () => {
    expect(safeExternalUrl('https://example.com')).toBe('https://example.com');
  });

  it('blocks http URLs', () => {
    expect(safeExternalUrl('http://example.com')).toBe('#');
  });

  it('blocks javascript: protocol', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBe('#');
  });

  it('blocks data: URLs', () => {
    expect(safeExternalUrl('data:text/html,<h1>XSS</h1>')).toBe('#');
  });

  it('returns # for invalid URLs', () => {
    expect(safeExternalUrl('not-a-url')).toBe('#');
  });

  it('returns # for empty string', () => {
    expect(safeExternalUrl('')).toBe('#');
  });
});


