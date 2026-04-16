import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { FAQ } from '@/types/content';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const faqs: FAQ[] = [
  {
    id: 'update-frequency',
    question: 'Jak często aktualizowane są dane?',
    answer: 'Dane aktualizujemy raz dziennie. W przyszłości planujemy częstsze odświeżanie.',
  },
  {
    id: 'what-is-q10',
    question: 'Czym jest Q10?',
    answer:
      'Q10 to 10. percentyl ceny - oznacza, że ok. 10% najtańszych ofert znajduje się poniżej tego poziomu. Q10 jest bardziej stabilnym wskaźnikiem niż absolutne minimum, które bywa przypadkową anomalią. Podobnie działa mediana (50. percentyl), pokazując środek rynku bez wpływu skrajnych wartości. Dlatego Q10 i mediana lepiej oddają realne ceny niż minimum, maksimum czy średnia - szczególnie na niestabilnych rynkach.',
  },
  {
    id: 'report',
    question: 'Jak mogę zgłosić błąd lub sugestię?',
    answer:
      'Najprościej skorzystać z formularza kontaktowego, który znajduje się w stopce lub odezwać się na Discordzie. Każda uwaga i pomysł pomagają rozwijać serwis - dzięki!',
  },
  {
    id: 'bonus-split',
    question: 'Czym jest podział na przedmioty „z bonusami” i „bez bonusów”?',
    answer:
      '„Bez bonusów” to przedmioty, które nie mają bonusów lub nie można ich dodać. Dzielimy je w ten sposób, ponieważ na razie nie rozpoznajemy konkretnych typów i rolli przedmiotów. Obie grupy mają inne zachowania cenowe, więc taki podział pozwala na dokładniejszą analizę.',
  },
  {
    id: 'roadmap',
    question: 'Plany rozwoju (Roadmapa)',
    answer:
      'Na początku chcemy sprawdzić, czy portal spotka się z zainteresowaniem. W najbliższym czasie planujemy dodać kolejne serwery. Jeśli projekt się przyjmie, planujemy migrację na lepszy hosting oraz rozwój najpopularniejszych serwerów (np. indeksy i typy przedmiotów). Na razie to wersja wstępna/beta – zbieramy dane o tym, co Was interesuje najbardziej.',
  },
  {
    id: 'support',
    question: 'Jak można wesprzeć projekt?',
    answer:
      'Najlepsze wsparcie to korzystanie ze strony i polecanie jej innym. Podziel się linkiem, opinią i sugestiami. Wsparcie finansowe nie jest na razie potrzebne - dziękujemy za każdą formę pomocy!',
  },
  {
    id: 'tech-stack',
    question: 'Jakie technologie zostały użyte do budowy serwisu?',
    answer:
      'Strona została zbudowana przy użyciu nowoczesnych technologii, w tym: React, TypeScript, Tailwind CSS oraz shadcn/ui do stylizacji. Wykresy są tworzone głównie przy pomocy Chart.js. Korzystamy również z biblioteki ZRender (silnik renderujący Apache ECharts), która jest udostępniona na licencji BSD 3-Clause.',
  },
];

export function safeExternalUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? url : '#';
  } catch {
    return '#';
  }
}

// Basic input sanitization: trim and strip control characters
export function sanitizeInput(value: string, maxLen = 5000, trimEdges: boolean = true): string {
  const sliced = (value ?? "").slice(0, maxLen);
  const safe = trimEdges ? sliced.trim() : sliced;
  // Remove non-printable control characters except tab/newline/carriage return
  return safe.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

type Currency = {
  name: string;
  symbol: string;
  threshold: number;
};

/**
 * Formats a numeric value using currency config:
 * 1. Picks the currency with the largest threshold ≤ |value|.
 * 2. Divides value by that threshold to get currency units.
 * 3. Formats the result with k/kk/kkk suffixes.
 * 4. Appends the currency symbol without a space (e.g. 500kW).
 * Falls back to plain k/kk/kkk if no currency matches.
 */
/**
 * Rounds a number to a visually clean value for axis tick display.
 * E.g. 1.06 → 1, 339.2 → 350, 3.7 → 4, 0.83 → 0.8
 */
function roundToNiceAxisValue(num: number): number {
  if (num === 0) return 0;
  const abs = Math.abs(num);
  const sign = num < 0 ? -1 : 1;
  // Shift to [1, 10) range
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)));
  const normalized = abs / magnitude; // in [1, 10)
  // Standard "nice" steps in [1, 10): pick the nearest one
  const niceSteps = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 7.5, 8, 9, 10];
  let bestStep = niceSteps[0];
  let bestDist = Math.abs(normalized - bestStep);
  for (const s of niceSteps) {
    const d = Math.abs(normalized - s);
    if (d < bestDist) { bestDist = d; bestStep = s; }
  }
  return sign * bestStep * magnitude;
}

export function formatCurrency(value: number | null | undefined, currencies: Currency[] = [], precision = 2, axisMode = false): string {
  if (value === null || value === undefined || !isFinite(value)) return 'B/D';
  if (value === 0) return '0';

  const abs = Math.abs(value);

  // Find currency with the largest threshold ≤ |value|
  let best: Currency | null = null;
  if (Array.isArray(currencies)) {
    for (const c of currencies) {
      if (abs >= c.threshold && (best === null || c.threshold > best.threshold)) {
        best = c;
      }
    }
  }

  const formatWithKSuffix = (num: number, effectivePrecision: number): string => {
    const a = Math.abs(num);
    if (a < 1000) {
      return num.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: effectivePrecision, useGrouping: false });
    }
    const suffixes = ['', 'k', 'kk', 'kkk', 'kkkk', 'kkkkk', 'kkkkkk'];
    const tier = Math.floor(Math.log10(a) / 3);
    const scale = Math.pow(1000, tier);
    const scaled = num / scale;
    const suffix = suffixes[tier] || `e${tier * 3}`;
    // In axis mode: snap the scaled value to a nice number before display
    const displayScaled = axisMode ? roundToNiceAxisValue(scaled) : scaled;
    const displayPrecision = axisMode ? 0 : effectivePrecision;
    return displayScaled.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: displayPrecision, useGrouping: false }) + suffix;
  };

  if (best) {
    const inUnit = value / best.threshold;
    // In axis mode: snap the value-in-currency-units to a nice number
    const displayInUnit = axisMode ? roundToNiceAxisValue(inUnit) : inUnit;
    return formatWithKSuffix(displayInUnit, precision) + best.symbol;
  }

  return formatWithKSuffix(value, precision);
}
