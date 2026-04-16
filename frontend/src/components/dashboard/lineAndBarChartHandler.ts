import * as zrender from 'zrender';
// Ensure canvas renderer is registered in production builds (side-effect import)
import 'zrender/lib/canvas/canvas';
import { formatCurrency } from '@/lib/utils';

// ===== INTERFACES =====

/**
 * Single data point on the chart
 */
interface DataPoint {
    time: string;
    value: number;
}

/**
 * Statistics for a single data series
 */
interface SeriesStats {
    sum: number;
    min: number;
    max: number;
    last: DataPoint | null;
    first: DataPoint | null;
}

/**
 * Computed render positions for all chart elements
 */
interface RenderPositions {
    line1Points: [number, number][];
    line2Points: [number, number][];
    histogramBars: { x: number; y: number; height: number }[];
    shopsBubbles?: { x: number; y: number; r: number; label: string }[];
    dateLabels: string[];
}

/**
 * Holds only aggregated statistics and render positions (no raw data)
 */
interface SecureDataStats {
    count: number;
    line1Stats: SeriesStats;
    line2Stats: SeriesStats;
    histogramStats: SeriesStats;
    shopsStats?: SeriesStats;
    renderPositions: RenderPositions;
}

/**
 * Main chart context — all state and ZRender elements needed to render/update the chart
 */
export interface ChartContext {
    zr: zrender.ZRenderType;
    key: CryptoKey | null;
    secureStats: SecureDataStats;
    // Currency config for price formatting
    currencies: { name: string; symbol: string; threshold: number }[];

    activePointIndex: number | null;

    line1El: zrender.Polyline;
    line2El: zrender.Polyline;
    line1Points: zrender.Circle[];
    line2Points: zrender.Circle[];
    histogramEls: zrender.Rect[];
    shopsBubbleEls?: zrender.Element[];
    tooltipGroup: zrender.Group;
    highlightElements: zrender.Element[];
    statsGroup: zrender.Group;
    gridElements: zrender.Element[];

    width: number;
    height: number;

    isAnimating: boolean;
    animationQueue: { date: string; iv: string; encrypted_values: string; }[];
}

/**
 * Context for the stats panel below the main chart
 */
interface StatsContext {
    zr: zrender.ZRenderType;
    width: number;
    height: number;
    dataContext: ChartContext | null;
}

// ===== THEME =====

const THEME = {
    bg: {
        primary: 'transparent',
        card: 'rgba(11, 17, 25, 0.60)',
        tooltip: 'rgba(17, 24, 39, 0.95)'
    },
    text: {
        primary: '#E5E7EB',
        secondary: 'rgba(255,255,255,0.60)',
    },
    border: '#141B24',
    chart: {
        line1: {
            color: '#FF9900',
            glow: 'rgba(255, 100, 0, 0.9)'
        },
        line2: {
            color: 'rgba(16,185,129,0.9)',
            glow: 'rgba(10,150,100,0.5)'
        },
        histogram: {
            color: 'rgba(22, 70, 78, 0.9)',
            highlight: 'rgba(58, 158, 163, 0.9)'
        },
        shops: { color: '#3b82f6' },
        grid: 'rgba(255, 255, 255, 0.06)',
    },
    shadow: {
        color: 'rgba(0,0,0,0.5)',
        blur: 12
    },
    axes: {
        leftTick: 'rgba(255,255,255,1.0)',
        rightTick: 'rgba(255,255,255,1.0)'
    }
} as const;

const AXES_PADDING = {
    left: 69,
    right: 69,
    top: 35,
    bottom: 50
} as const;

const TOOLTIP_CONFIG = {
    padding: { x: 15, y: 12 },
    offset: { x: 20, y: 0 },
    borderRadius: 8,
    fontSize: { title: 14, content: 13 },
    lineHeight: { title: 24, content: 22 },
    iconRadius: 5,
    iconOffset: 10
} as const;

const CHART_CONFIG = {
    point: { radius: 4, highlightRadius: 8, strokeWidth: 2 },
    line: { smoothness: 0.4 },
    histogram: { widthRatio: 0.7, minWidth: 2, borderRadius: [7, 7, 0, 0] },
    grid: { lineWidth: 1, dashPattern: [4, 4], minTickSpacing: 25 }
} as const;

/**
 * Converts a base64url string to Uint8Array.
 */
function base64UrlToUint8Array(base64Url: string): Uint8Array {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const binaryString = atob(base64 + pad);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}

/**
 * Decrypts a single data point.
 */
async function decryptPoint(encryptedBase64: string, ivBase64: string, key: CryptoKey): Promise<any> {
    const iv = base64UrlToUint8Array(ivBase64);
    const ciphertext = base64UrlToUint8Array(encryptedBase64);
    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decryptedText);
}

function formatNumber(num: number, precision: number = 2): string {
    if (num == null || !isFinite(num)) {
        return '-';
    }

    if (Math.abs(num) < 1000) {
        return num.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: precision });
    }

    const suffixes = ['', 'k', 'kk', 'kkk', 'kkkk', 'kkkkk', 'kkkkkk', 'kkkkkkk'];
    const tier = Math.floor(Math.log10(Math.abs(num)) / 3);

    if (tier === 0) {
        return num.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: precision });
    }

    const suffix = suffixes[tier] || `e${tier * 3}`;
    const scale = Math.pow(1000, tier);
    const scaledValue = num / scale;

    return scaledValue.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: precision }) + suffix;
}

/**
 * Normalizes currencies: coerces threshold to number, sorts descending by threshold.
 */
function normalizeCurrencies(raw: Array<{ name: string; symbol: string; threshold: number | string }> | undefined): { name: string; symbol: string; threshold: number }[] {
    if (!raw || !Array.isArray(raw)) return [];
    return [...raw]
        .map(c => ({
            name: c.name,
            symbol: c.symbol,
            threshold: typeof c.threshold === 'string' ? Number(c.threshold) : c.threshold
        }))
        .filter(c => isFinite(c.threshold) && c.threshold > 0)
        .sort((a, b) => b.threshold - a.threshold);
}

function formatPolishDate(dateStr: string): string {
    if (dateStr === 'Brak danych') return dateStr;
    try {
        const parts = dateStr.split('-').map(p => parseInt(p, 10));
        const date = new Date(parts[0], parts[1] - 1, parts[2]);
        return date.toLocaleDateString('pl-PL', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

function shouldUseSquareRoot(min: number, max: number): boolean {
    if (max < 10 || min < 0) return false;
    const ratio = max / Math.max(min, 0.1);
    return ratio > 7 || max > 1000;
}

function generateAxisTicks(min: number, max: number, desiredTickCount: number = 5): number[] {
    if (max <= min) return [min];
    const useSquareRoot = shouldUseSquareRoot(min, max);
    if (!useSquareRoot) {
        return generateLinearTicks(min, max, desiredTickCount);
    } else {
        return generateSquareRootTicks(min, max, desiredTickCount);
    }
}

function generateLinearTicks(min: number, max: number, desiredTickCount: number): number[] {
    const range = max - min;
    const roughStep = range / (desiredTickCount - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalizedStep = roughStep / magnitude;
    let step: number;
    if (normalizedStep < 1.5) step = magnitude;
    else if (normalizedStep < 3) step = 2 * magnitude;
    else if (normalizedStep < 7) step = 5 * magnitude;
    else step = 10 * magnitude;
    const ticks: number[] = [];
    const firstTick = Math.floor(min / step) * step;
    const lastTick = Math.ceil(max / step) * step;
    for (let tick = firstTick; tick <= lastTick; tick += step) {
        if (tick >= min - step / 2 && tick <= max + step / 2) {
            ticks.push(tick);
        }
    }
    return ticks;
}

function generateSquareRootTicks(min: number, max: number, desiredTickCount: number): number[] {
    const minShift = min < 0 ? -min : 0;
    const inverseTransformValue = (transformedValue: number): number => {
        return (transformedValue * transformedValue) - minShift;
    };
    const transformedMin = Math.sqrt(min + minShift);
    const transformedMax = Math.sqrt(max + minShift);
    const transformedRange = transformedMax - transformedMin;
    const ticks: number[] = [];
    for (let i = 0; i <= desiredTickCount - 1; i++) {
        const ratio = i / (desiredTickCount - 1);
        const transformedValue = transformedMin + (ratio * transformedRange);
        const originalValue = inverseTransformValue(transformedValue);
        let roundedValue: number;
        if (originalValue < 1) roundedValue = Math.round(originalValue * 100) / 100;
        else if (originalValue < 10) roundedValue = Math.round(originalValue * 10) / 10;
        else if (originalValue < 100) roundedValue = Math.round(originalValue);
        else if (originalValue < 1000) roundedValue = Math.round(originalValue / 10) * 10;
        else if (originalValue < 10000) roundedValue = Math.round(originalValue / 100) * 100;
        else roundedValue = Math.round(originalValue / 1000) * 1000;
        ticks.push(roundedValue);
    }
    const uniqueTicks = [...new Set(ticks)].sort((a, b) => a - b);
    if (uniqueTicks.length > 0 && uniqueTicks[0] > min) uniqueTicks.unshift(min);
    if (uniqueTicks.length > 0 && uniqueTicks[uniqueTicks.length - 1] < max) uniqueTicks.push(max);
    return uniqueTicks;
}

function calculatePercentageChange(first: number, last: number): number {
    if (first === 0) return last === 0 ? 0 : Infinity;
    return ((last - first) / first) * 100;
}

function getX(index: number, totalPoints: number, chartWidth: number): number {
    const slotWidth = chartWidth / totalPoints;
    return AXES_PADDING.left + (index + 0.5) * slotWidth;
}

function getIndexFromX(mouseX: number, totalPoints: number, chartWidth: number): number {
    const relativeX = mouseX - AXES_PADDING.left;
    const slotWidth = chartWidth / totalPoints;
    const index = Math.floor(relativeX / slotWidth);
    return Math.max(0, Math.min(totalPoints - 1, index));
}

function getLeftY(value: number, min: number, max: number, chartHeight: number): number {
    if (max <= min) return AXES_PADDING.top + chartHeight / 2;
    let scaledValue: number;
    if (shouldUseSquareRoot(min, max)) {
        const minShift = min < 0 ? -min : 0;
        const shiftedValue = Math.sqrt(value + minShift);
        const shiftedMin = Math.sqrt(min + minShift);
        const shiftedMax = Math.sqrt(max + minShift);
        scaledValue = (shiftedValue - shiftedMin) / (shiftedMax - shiftedMin || 1);
    } else {
        scaledValue = (value - min) / (max - min || 1);
    }
    const clampedRatio = Math.max(0, Math.min(1, scaledValue));
    return AXES_PADDING.top + chartHeight - (clampedRatio * chartHeight);
}

function getRightY(value: number, min: number, max: number, chartHeight: number): number {
    return getLeftY(value, min, max, chartHeight);
}

function updateSecureStats(
    stats: SecureDataStats,
    line1Data: DataPoint | null,
    line2Data: DataPoint | null,
    histogramData: DataPoint | null,
    shopsData: DataPoint | null = null
): void {
    stats.count++;
    if (line1Data) updateSeriesStats(stats.line1Stats, line1Data);
    if (line2Data) updateSeriesStats(stats.line2Stats, line2Data);
    if (histogramData) updateSeriesStats(stats.histogramStats, histogramData);
    if (shopsData) {
        if (!stats.shopsStats) stats.shopsStats = { sum: 0, min: Infinity, max: -Infinity, last: null, first: null };
        updateSeriesStats(stats.shopsStats, shopsData);
    }
}

function updateSeriesStats(seriesStats: SeriesStats, dataPoint: DataPoint): void {
    if (seriesStats.first === null) {
        seriesStats.first = { ...dataPoint };
    }
    seriesStats.last = { ...dataPoint };
    seriesStats.sum += dataPoint.value;
    seriesStats.min = Math.min(seriesStats.min, dataPoint.value);
    seriesStats.max = Math.max(seriesStats.max, dataPoint.value);
}

function calculateScales(stats: SecureDataStats) {
    let allLineMin = Math.min(stats.line1Stats.min, stats.line2Stats.min);
    let allLineMax = Math.max(stats.line1Stats.max, stats.line2Stats.max);
    if (allLineMin === allLineMax) {
        const padding = isFinite(allLineMin) ? Math.abs(allLineMin * 0.1) || 10 : 10;
        allLineMin -= padding;
        allLineMax += padding;
    }
    const lineRange = allLineMax - allLineMin;
    const paddingMin = (lineRange * 0.10 || 1);
    const paddingMax = (lineRange * 0.15 || 1);
    let minLine = allLineMin - paddingMin;
    let maxLine = allLineMax + paddingMax;
    // If the series is entirely non-negative, anchor the left axis at 0
    // so the tick labeled "0" aligns with the bottom baseline.
    if (allLineMin >= 0) {
        minLine = 0;
    }
    let minHist = 0;
    let maxHist = stats.histogramStats.max;
    if (maxHist <= 0) {
        maxHist = 10;
    } else if (maxHist === stats.histogramStats.min) {
        maxHist *= 1.2;
    }
    maxHist *= 1.15;
    return { minLine, maxLine, minHist, maxHist };
}

async function recalculateAllRenderPositions(context: ChartContext): Promise<void> {
    if (context.animationQueue.length === 0) {
        context.secureStats = initializeSecureStats();
        context.secureStats.renderPositions = {
            line1Points: [], line2Points: [], histogramBars: [], shopsBubbles: [], dateLabels: []
        };
        return;
    }

    const { width, height, key, animationQueue } = context;

    if (!key) {
        console.error("Decryption key not available in chart context. Cannot recalculate positions.");
        return;
    }

    // Pass 1: Decrypt to calculate stats and scales
    context.secureStats = initializeSecureStats();
    for (const point of animationQueue) {
        try {
            const values = await decryptPoint(point.encrypted_values, point.iv, key);
            const line1Data: DataPoint = { time: point.date, value: values.price_median };
            const line2Data: DataPoint = { time: point.date, value: values.price_q10 };
            const histogramData: DataPoint = { time: point.date, value: values.item_amount };
            const shopsData: DataPoint = { time: point.date, value: values.shop_appearance_count };
            updateSecureStats(context.secureStats, line1Data, line2Data, histogramData, shopsData);
        } catch (error) {
            console.error('Error processing and decrypting point for stats:', error);
        }
    }

    // After pass 1, we have stats, so we can calculate scales
    const newScales = calculateScales(context.secureStats);

    const chartWidth = width - AXES_PADDING.left - AXES_PADDING.right;
    const chartHeight = height - AXES_PADDING.top - AXES_PADDING.bottom;
    const totalPoints = context.secureStats.count;
    const newRenderPositions: RenderPositions = {
        line1Points: [], line2Points: [], histogramBars: [], shopsBubbles: [], dateLabels: []
    };
    const slotWidth = chartWidth / totalPoints;
    const barWidth = Math.max(CHART_CONFIG.histogram.minWidth, slotWidth * CHART_CONFIG.histogram.widthRatio);
    const baseBubbleR = Math.max(8, Math.min(14, barWidth / 2 - 2));

    // Pass 2: Decrypt again to calculate render positions using the final scales
    for (let i = 0; i < animationQueue.length; i++) {
        const point = animationQueue[i];
        const x = getX(i, totalPoints, chartWidth);

        try {
            const values = await decryptPoint(point.encrypted_values, point.iv, key);

            // Line 1 (Median)
            if (values.price_median !== null && isFinite(values.price_median)) {
                const y = getLeftY(values.price_median, newScales.minLine, newScales.maxLine, chartHeight);
                newRenderPositions.line1Points.push([x, y]);
            }

            // Line 2 (Q10)
            if (values.price_q10 !== null && isFinite(values.price_q10)) {
                const y = getLeftY(values.price_q10, newScales.minLine, newScales.maxLine, chartHeight);
                newRenderPositions.line2Points.push([x, y]);
            }

            // Histogram (Amount)
            if (values.item_amount !== null && isFinite(values.item_amount)) {
                const y = getRightY(values.item_amount, newScales.minHist, newScales.maxHist, chartHeight);
                const y0 = getRightY(0, newScales.minHist, newScales.maxHist, chartHeight);
                const barHeight = y0 - y;
                newRenderPositions.histogramBars.push({ x, y, height: barHeight });
            }

            // Shops
            if (values.shop_appearance_count !== null && isFinite(values.shop_appearance_count)) {
                const bar = newRenderPositions.histogramBars.find(b => b.x === x);
                if (bar) {
                    const maxR = Math.max(6, Math.min(baseBubbleR + Math.min(8, Math.max(-4, (values.shop_appearance_count - 5) * 0.5)), (bar.height / 2) - 3));
                    const r = isFinite(maxR) && maxR > 0 ? maxR : baseBubbleR;
                    const cy = bar.y + bar.height / 2;
                    newRenderPositions.shopsBubbles!.push({ x, y: cy, r, label: String(Math.round(values.shop_appearance_count)) });
                }
            }

            newRenderPositions.dateLabels.push(point.date);
        } catch (error) {
            console.error('Error processing and decrypting point for render positions:', error);
        }
    }
    context.secureStats.renderPositions = newRenderPositions;
}

function drawAxesAndGrid(context: ChartContext): void {
    context.gridElements.forEach(el => context.zr.remove(el));
    context.gridElements = [];
    const stats = context.secureStats;
    if (stats.count === 0) return;
    const chartWidth = context.width - AXES_PADDING.left - AXES_PADDING.right;
    const chartHeight = context.height - AXES_PADDING.top - AXES_PADDING.bottom;
    const { minLine, maxLine, minHist, maxHist } = calculateScales(stats);
    const addGridElement = (el: zrender.Element) => {
        context.gridElements.push(el);
        context.zr.add(el);
    };
    drawMainAxes(context, addGridElement, chartWidth, chartHeight);
    drawLeftAxisTicks(context, addGridElement, minLine, maxLine, chartWidth, chartHeight);
    drawRightAxisTicks(context, addGridElement, minHist, maxHist, chartWidth, chartHeight);
    drawDateLabels(context, addGridElement, chartWidth, chartHeight);
    // drawAxisTitles(context, addGridElement, chartHeight);   Temporary not using
}

function drawMainAxes(context: ChartContext, addGridElement: (el: zrender.Element) => void, chartWidth: number, chartHeight: number): void {
    addGridElement(new zrender.Line({
        shape: {
            x1: AXES_PADDING.left,
            y1: context.height - AXES_PADDING.bottom,
            x2: context.width - AXES_PADDING.right,
            y2: context.height - AXES_PADDING.bottom
        },
        style: { stroke: THEME.text.secondary, lineWidth: CHART_CONFIG.grid.lineWidth },
        z: 0
    }));
    addGridElement(new zrender.Line({
        shape: { x1: AXES_PADDING.left, y1: AXES_PADDING.top, x2: AXES_PADDING.left, y2: AXES_PADDING.top + chartHeight },
        style: { stroke: THEME.text.secondary, lineWidth: CHART_CONFIG.grid.lineWidth },
        z: 0
    }));
    addGridElement(new zrender.Line({
        shape: {
            x1: context.width - AXES_PADDING.right,
            y1: AXES_PADDING.top,
            x2: context.width - AXES_PADDING.right,
            y2: AXES_PADDING.top + chartHeight
        },
        style: { stroke: THEME.text.secondary, lineWidth: CHART_CONFIG.grid.lineWidth },
        z: 0
    }));
}

function drawLeftAxisTicks(context: ChartContext, addGridElement: (el: zrender.Element) => void, minLine: number, maxLine: number, chartWidth: number, chartHeight: number): void {
    const topY = AXES_PADDING.top;
    const rawTicks = generateAxisTicks(minLine, maxLine, 6);
    // Build tick candidates with pixel positions
    type TickPos = { value: number; y: number; forcedTop?: boolean };
    const candidates: TickPos[] = rawTicks
        .map(v => ({ value: v, y: getLeftY(v, minLine, maxLine, chartHeight) }))
        .filter(tp => isFinite(tp.y));
    // Always include a synthetic top tick at exact topY to avoid float drift
    candidates.push({ value: maxLine, y: topY, forcedTop: true });
    // Sort by y ascending (top first)
    candidates.sort((a, b) => a.y - b.y);
    // Deduplicate by pixel spacing, preferring the forced top tick
    const spacing = CHART_CONFIG.grid.minTickSpacing;
    const deduped: TickPos[] = [];
    for (const t of candidates) {
        if (deduped.length === 0) {
            deduped.push(t);
            continue;
        }
        const last = deduped[deduped.length - 1];
        if (Math.abs(t.y - last.y) < spacing) {
            if (t.forcedTop && !last.forcedTop) {
                deduped[deduped.length - 1] = t;
            }
            continue;
        }
        deduped.push(t);
    }

    // Draw top grid line once and anchor spacing to it
    addGridElement(new zrender.Line({
        shape: { x1: AXES_PADDING.left, y1: topY, x2: context.width - AXES_PADDING.right, y2: topY },
        style: { stroke: THEME.chart.grid, lineWidth: CHART_CONFIG.grid.lineWidth },
        z: 0
    }));

    let topLabelDrawn = false;
    let lastY = topY;
    for (const { value: tickValue, y } of deduped) {
        const isTop = Math.abs(y - topY) < 0.5;
        const formatted = formatCurrency(tickValue, context.currencies, 2, true);
        if (isTop) {
            if (!topLabelDrawn) {
                addGridElement(new zrender.Text({
                    style: {
                        text: formatted,
                        x: AXES_PADDING.left - 12,
                        y: topY,
                        fill: THEME.axes.leftTick,
                        fontSize: 12,
                        align: 'right',
                        verticalAlign: 'middle'
                    },
                    z: 1
                }));
                topLabelDrawn = true;
            }
            lastY = topY;
            continue;
        }
        if (Math.abs(y - lastY) < spacing) continue;
        // Grid line
        addGridElement(new zrender.Line({
            shape: { x1: AXES_PADDING.left, y1: y, x2: context.width - AXES_PADDING.right, y2: y },
            style: { stroke: THEME.chart.grid, lineWidth: CHART_CONFIG.grid.lineWidth },
            z: 0
        }));
        // Tick label (neutral color)
        addGridElement(new zrender.Text({
            style: {
                text: formatted,
                x: AXES_PADDING.left - 12,
                y: y,
                fill: THEME.axes.leftTick,
                fontSize: 12,
                align: 'right',
                verticalAlign: 'middle'
            },
            z: 1
        }));
        lastY = y;
    }
}

function drawRightAxisTicks(context: ChartContext, addGridElement: (el: zrender.Element) => void, minHist: number, maxHist: number, chartWidth: number, chartHeight: number): void {
    const rightTicks = generateAxisTicks(minHist, maxHist, 5);
    let lastRightY = Infinity;
    rightTicks.forEach(tickValue => {
        const y = getRightY(tickValue, minHist, maxHist, chartHeight);
        if (!isFinite(y) || lastRightY - y < CHART_CONFIG.grid.minTickSpacing || tickValue < 0) return;
        addGridElement(new zrender.Text({
            style: {
                text: formatNumber(tickValue, 0),
                x: context.width - AXES_PADDING.right + 12,
                y: y,
                fill: THEME.axes.rightTick,
                fontSize: 12,
                align: 'left',
                verticalAlign: 'middle'
            }
        }));
        lastRightY = y;
    });
}

function drawDateLabels(context: ChartContext, addGridElement: (el: zrender.Element) => void, chartWidth: number, chartHeight: number): void {
    const dateLabels = context.secureStats.renderPositions.dateLabels;
    if (dateLabels.length === 0) return;
    const maxLabels = Math.floor(chartWidth / 80);
    const totalPoints = dateLabels.length;
    const step = Math.max(1, Math.ceil(totalPoints / maxLabels));
    // Helper: format to only day and month, locale-aware, without year
    const formatLabel = (raw: string): string => {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
            try {
                return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
            } catch {
                // fallback below
            }
        }
        // Fallbacks for preformatted strings like 'YYYY-MM-DD' or 'DD.MM.YYYY'
        const m1 = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (m1) {
            const dd = m1[3].padStart(2, '0');
            const mm = String(m1[2]).padStart(2, '0');
            return `${dd}.${mm}`;
        }
        const m2 = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/]\d{2,4}/);
        if (m2) {
            const dd = m2[1].padStart(2, '0');
            const mm = String(m2[2]).padStart(2, '0');
            return `${dd}.${mm}`;
        }
        return raw;
    };
    for (let i = 0; i < totalPoints; i += step) {
        const x = getX(i, totalPoints, chartWidth);
        addGridElement(new zrender.Text({
            style: {
                text: formatLabel(dateLabels[i]),
                x: x,
                y: context.height - AXES_PADDING.bottom + 25,
                fill: THEME.text.secondary,
                fontSize: 12,
                align: 'center'
            }
        }));
    }
}

function drawAxisTitles(context: ChartContext, addGridElement: (el: zrender.Element) => void, chartHeight: number): void {
    const yAxisTitleGroup = new zrender.Group({
        x: AXES_PADDING.left / 5, y: AXES_PADDING.top + chartHeight / 2, rotation: -Math.PI / 2
    });
    yAxisTitleGroup.add(new zrender.Text({
        style: { text: 'Wartość', fill: THEME.text.secondary, fontSize: 14, align: 'center', verticalAlign: 'middle' }
    }));
    addGridElement(yAxisTitleGroup);
    const yAxisTitleRightGroup = new zrender.Group({
        x: context.width - AXES_PADDING.right / 3, y: AXES_PADDING.top + chartHeight / 2, rotation: Math.PI / 2
    });
    yAxisTitleRightGroup.add(new zrender.Text({
        style: { text: 'Ilość', fill: THEME.text.secondary, fontSize: 14, align: 'center', verticalAlign: 'middle' }
    }));
    addGridElement(yAxisTitleRightGroup);
}

function updateChart(context: ChartContext): void {
    const stats = context.secureStats;
    if (stats.count === 0) return;
    const chartWidth = context.width - AXES_PADDING.left - AXES_PADDING.right;
    drawAxesAndGrid(context);
    drawHistogram(context, chartWidth);
    // Draw shop counts as plain numbers above bars
    drawShopsBubbles(context);
    drawLines(context);
}

function drawHistogram(context: ChartContext, chartWidth: number): void {
    context.histogramEls.forEach(el => context.zr.remove(el));
    context.histogramEls = [];
    const stats = context.secureStats;
    const slotWidth = chartWidth / stats.count;
    const barWidth = Math.max(CHART_CONFIG.histogram.minWidth, slotWidth * CHART_CONFIG.histogram.widthRatio);
    stats.renderPositions.histogramBars.forEach((bar) => {
        const rect = new zrender.Rect({
            shape: {
                x: bar.x - barWidth / 2,
                y: bar.y,
                width: barWidth,
                height: bar.height,
                r: CHART_CONFIG.histogram.borderRadius
            },
            style: { fill: THEME.chart.histogram.color }, z: 1
        });
        context.zr.add(rect);
        context.histogramEls.push(rect);
    });
}

function drawShopsBubbles(context: ChartContext): void {
    // Repurpose: draw only numeric labels above histogram bars (no bubbles)
    if (context.shopsBubbleEls) context.shopsBubbleEls.forEach(el => context.zr.remove(el));
    context.shopsBubbleEls = [];
    const stats = context.secureStats;
    const bars = stats.renderPositions.histogramBars;
    const shops = stats.renderPositions.shopsBubbles || [];
    if (!bars || bars.length === 0 || shops.length === 0) return;
    const padding = 6;
    for (let i = 0; i < Math.min(bars.length, shops.length); i++) {
        const bar = bars[i];
        const s = shops[i];
        if (!bar || !s || !s.label) continue;
        const x = bar.x;
        const y = Math.max(AXES_PADDING.top + 8, bar.y - padding);
        const text = new zrender.Text({
            style: {
                text: s.label,
                x: x,
                y: y,
                fill: THEME.text.secondary,
                fontSize: 11,
                fontWeight: 'bold',
                align: 'center',
                verticalAlign: 'bottom'
            },
            // Above histogram bars (z:1) and below line points (z:3). Order ensures it's below lines.
            z: 1,
            silent: true
        });
        context.zr.add(text);
        context.shopsBubbleEls!.push(text);
    }
}

function drawLines(context: ChartContext): void {
    const stats = context.secureStats;
    context.line1Points = updateLineAndPoints(stats.renderPositions.line1Points, context.line1El, context.line1Points, THEME.chart.line1.color, context);
    context.line2Points = updateLineAndPoints(stats.renderPositions.line2Points, context.line2El, context.line2Points, THEME.chart.line2.color, context);
}

function updateLineAndPoints(points: [number, number][], lineEl: zrender.Polyline, pointEls: zrender.Circle[], color: string, context: ChartContext): zrender.Circle[] {
    pointEls.forEach(p => context.zr.remove(p));
    const newPoints: zrender.Circle[] = [];
    lineEl.setShape({ points: points, smooth: CHART_CONFIG.line.smoothness });
    lineEl.dirty();
    points.forEach(([x, y]) => {
        const isMedian = color === THEME.chart.line1.color;
        const style: any = { fill: color, stroke: THEME.bg.card, lineWidth: CHART_CONFIG.point.strokeWidth };
        if (isMedian) {
            style.shadowBlur = 14;
            style.shadowColor = (THEME.chart as any).line1.glow || THEME.chart.line1.color;
        }
        const circle = new zrender.Circle({
            shape: { cx: x, cy: y, r: CHART_CONFIG.point.radius },
            style,
            z: 3, silent: true
        });
        context.zr.add(circle);
        newPoints.push(circle);
    });
    return newPoints;
}

async function getTooltipDataSecurely(context: ChartContext, pointIndex: number): Promise<{
    line1: DataPoint | null,
    line2: DataPoint | null,
    histogram: DataPoint | null,
    shops: DataPoint | null
}> {
    const encryptedPoint = context.animationQueue[pointIndex];
    if (!encryptedPoint || !context.key) {
        return { line1: null, line2: null, histogram: null, shops: null };
    }

    try {
        const values = await decryptPoint(encryptedPoint.encrypted_values, encryptedPoint.iv, context.key);
        const line1Data: DataPoint = { time: encryptedPoint.date, value: values.price_median };
        const line2Data: DataPoint = { time: encryptedPoint.date, value: values.price_q10 };
        const histogramData: DataPoint = { time: encryptedPoint.date, value: values.item_amount };
        const shopsData: DataPoint = { time: encryptedPoint.date, value: values.shop_appearance_count };
        return { line1: line1Data, line2: line2Data, histogram: histogramData, shops: shopsData };
    } catch (error) {
        console.error('Error decrypting tooltip data:', error);
        return { line1: null, line2: null, histogram: null, shops: null };
    }
}

async function redrawScene(context: ChartContext): Promise<void> {
    context.highlightElements.forEach(el => context.zr.remove(el));
    context.highlightElements = [];
    context.histogramEls.forEach(el => el.setStyle({ fill: THEME.chart.histogram.color }));
    if (context.activePointIndex === null) {
        context.tooltipGroup.hide();
        return;
    }
    const pointIndex = context.activePointIndex;
    const chartWidth = context.width - AXES_PADDING.left - AXES_PADDING.right;
    const chartHeight = context.height - AXES_PADDING.top - AXES_PADDING.bottom;
    const totalPoints = context.secureStats.count;
    if (pointIndex >= totalPoints) return;
    drawHighlightElements(context, pointIndex, chartWidth, chartHeight, totalPoints);
    await drawTooltip(context, pointIndex);
}

function drawHighlightElements(context: ChartContext, pointIndex: number, chartWidth: number, chartHeight: number, totalPoints: number): void {
    const pointX = getX(pointIndex, totalPoints, chartWidth);
    const verticalLine = new zrender.Line({
        shape: { x1: pointX, y1: AXES_PADDING.top, x2: pointX, y2: AXES_PADDING.top + chartHeight },
        style: { stroke: THEME.chart.grid, lineDash: CHART_CONFIG.grid.dashPattern }, z: 5
    });
    context.zr.add(verticalLine);
    context.highlightElements.push(verticalLine);
    if (context.histogramEls[pointIndex]) {
        context.histogramEls[pointIndex].setStyle({ fill: THEME.chart.histogram.highlight });
    }
    [context.line1Points[pointIndex], context.line2Points[pointIndex]].forEach(point => {
        if (!point) return;
        const highlightCircle = new zrender.Circle({
            shape: { cx: point.shape.cx, cy: point.shape.cy, r: CHART_CONFIG.point.highlightRadius },
            style: { fill: point.style.fill + '30', stroke: point.style.fill, lineWidth: 1 }, z: 2
        });
        context.zr.add(highlightCircle);
        context.highlightElements.push(highlightCircle);
    });
}

async function drawTooltip(context: ChartContext, pointIndex: number): Promise<void> {
    const pointX = getX(pointIndex, context.secureStats.count, context.width - AXES_PADDING.left - AXES_PADDING.right);
    context.tooltipGroup.removeAll();
    const tooltipData = await getTooltipDataSecurely(context, pointIndex);
    const dateStr = tooltipData.line1?.time || tooltipData.line2?.time || tooltipData.histogram?.time || tooltipData.shops?.time || 'Brak danych';
    const formattedDate = formatPolishDate(dateStr);
    const { elements, dimensions } = createTooltipElements(formattedDate, tooltipData, context.currencies);
    elements.forEach(el => context.tooltipGroup.add(el));
    const tooltipPosition = calculateTooltipPosition(pointX, context.width, context.height, dimensions.width, dimensions.height);
    context.tooltipGroup.attr({ x: tooltipPosition.x, y: tooltipPosition.y, z: 100 });
    context.tooltipGroup.show();
}

function createTooltipElements(
    formattedDate: string,
    tooltipData: {
        line1: DataPoint | null;
        line2: DataPoint | null;
        histogram: DataPoint | null;
        shops: DataPoint | null;
    },
    currencies: { name: string; symbol: string; threshold: number }[]
): { elements: zrender.Element[]; dimensions: { width: number; height: number } } {
    const elements: zrender.Element[] = [];
    const config = TOOLTIP_CONFIG;
    const titleText = new zrender.Text({
        style: {
            text: formattedDate,
            fill: THEME.text.primary,
            fontSize: config.fontSize.title,
            fontWeight: 'bold',
            lineHeight: config.lineHeight.title,
            align: 'left',
            verticalAlign: 'top'
        }, z: 102
    });
    const separator = new zrender.Line({
        shape: { x1: 0, y1: 0, x2: 0, y2: 0 },
        style: { stroke: THEME.border, lineWidth: 1 }, z: 102
    });
    const tooltipItems = [
        {
            label: 'Cena (mediana)',
            value: tooltipData.line1 ? formatCurrency(tooltipData.line1.value, currencies, 2) : '-',
            color: THEME.chart.line1.color
        },
        {
            label: 'Cena (q10)',
            value: tooltipData.line2 ? formatCurrency(tooltipData.line2.value, currencies, 2) : '-',
            color: THEME.chart.line2.color
        },
        {
            label: 'Ilość',
            value: tooltipData.histogram ? formatNumber(tooltipData.histogram.value, 0) : '-',
            color: THEME.chart.histogram.color
        },
        {
            label: 'Sklepy',
            value: tooltipData.shops ? String(Math.round(tooltipData.shops.value)) : '-',
            color: THEME.chart.shops.color
        }
    ];
    const titleRect = titleText.getBoundingRect();
    let maxItemWidth = 0;
    const itemElements: zrender.Element[] = [];
    tooltipItems.forEach(item => {
        const icon = new zrender.Circle({
            shape: { cx: 0, cy: 0, r: config.iconRadius },
            style: { fill: item.color }, z: 102
        });
        const itemText = new zrender.Text({
            style: {
                text: `${item.label}: ${item.value}`,
                fill: THEME.text.primary,
                fontSize: config.fontSize.content,
                align: 'left',
                verticalAlign: 'middle'
            }, z: 102
        });
        const itemWidth = config.iconRadius * 2 + config.iconOffset + itemText.getBoundingRect().width;
        if (itemWidth > maxItemWidth) maxItemWidth = itemWidth;
        itemElements.push(icon, itemText);
    });
    const tooltipWidth = Math.max(titleRect.width, maxItemWidth) + config.padding.x * 2;
    const separatorY = config.padding.y + titleRect.height + 8;
    const contentY = separatorY + 8;
    const tooltipHeight = contentY + tooltipItems.length * config.lineHeight.content;
    titleText.attr({ x: config.padding.x, y: config.padding.y });
    separator.setShape({ x1: config.padding.x, y1: separatorY, x2: tooltipWidth - config.padding.x, y2: separatorY });
    for (let i = 0; i < tooltipItems.length; i++) {
        (itemElements[i * 2] as zrender.Circle).setShape({
            cx: config.padding.x + config.iconRadius,
            cy: contentY + i * config.lineHeight.content + config.lineHeight.content / 2
        });
        (itemElements[i * 2 + 1] as zrender.Text).attr({
            x: config.padding.x + config.iconRadius * 2 + config.iconOffset,
            y: contentY + i * config.lineHeight.content + config.lineHeight.content / 2
        });
    }
    const backgroundEl = new zrender.Rect({
        shape: { x: 0, y: 0, width: tooltipWidth, height: tooltipHeight, r: config.borderRadius },
        style: {
            fill: THEME.bg.tooltip,
            stroke: THEME.border,
            lineWidth: 1,
            shadowBlur: THEME.shadow.blur,
            shadowColor: THEME.shadow.color
        }, z: 100
    });
    elements.push(backgroundEl, titleText, separator, ...itemElements);
    return { elements, dimensions: { width: tooltipWidth, height: tooltipHeight } };
}

function calculateTooltipPosition(pointX: number, canvasWidth: number, canvasHeight: number, tooltipWidth: number, tooltipHeight: number): {
    x: number;
    y: number
} {
    let tooltipX = pointX + TOOLTIP_CONFIG.offset.x;
    let tooltipY = canvasHeight / 4;
    if (tooltipX + tooltipWidth > canvasWidth) {
        tooltipX = pointX - tooltipWidth - TOOLTIP_CONFIG.offset.x;
    }
    if (tooltipY + tooltipHeight > canvasHeight) {
        tooltipY = canvasHeight - tooltipHeight - 10;
    }
    return { x: tooltipX, y: tooltipY };
}

function drawStatsCanvas(statsContext: StatsContext): void {
    const { zr, width, height, dataContext } = statsContext;

    if (!dataContext || dataContext.secureStats.count === 0) {
        zr.clear();
        return;
    }

    zr.clear();

    const stats = dataContext.secureStats;

    // Compute display values for the current hover point
    const currentStats = {
        median: stats.line1Stats.last?.value || 0,
        q10: stats.line2Stats.last?.value || 0,
        amount: stats.histogramStats.last?.value || 0,
        shops: stats.shopsStats?.last?.value || 0
    };

    const averages = {
        median: stats.count > 0 ? stats.line1Stats.sum / stats.count : 0,
        q10: stats.count > 0 ? stats.line2Stats.sum / stats.count : 0,
        amount: stats.count > 0 ? stats.histogramStats.sum / stats.count : 0,
        shops: stats.count > 0 && stats.shopsStats ? stats.shopsStats.sum / stats.count : 0
    };

    const changes = {
        median: calculatePercentageChange(stats.line1Stats.first?.value || 0, stats.line1Stats.last?.value || 0),
        q10: calculatePercentageChange(stats.line2Stats.first?.value || 0, stats.line2Stats.last?.value || 0),
        amount: calculatePercentageChange(stats.histogramStats.first?.value || 0, stats.histogramStats.last?.value || 0),
        shops: stats.shopsStats ? calculatePercentageChange(stats.shopsStats.first?.value || 0, stats.shopsStats.last?.value || 0) : NaN
    };

    const extremes = {
        median: { min: stats.line1Stats.min, max: stats.line1Stats.max },
        q10: { min: stats.line2Stats.min, max: stats.line2Stats.max },
        amount: { min: stats.histogramStats.min, max: stats.histogramStats.max },
        shops: stats.shopsStats ? { min: stats.shopsStats.min, max: stats.shopsStats.max } : { min: 0, max: 0 }
    };

    // Tile sizes — centered relative to the full canvas width
    const tileWidth = Math.max(130, Math.min(250, (width - 60) / 4.5));
    const tileHeight = 120;
    const tileSpacing = 16;
    const startY = height - tileHeight - 10;

    // Center the tile group horizontally
    const totalTilesWidth = (tileWidth * 4) + (tileSpacing * 3);
    const startX = (width - totalTilesWidth) / 2;

    const createTile = (x: number, y: number, width: number, height: number, data: {
        title: string,
        color: string,
        current: number,
        average: number,
        change: number,
        min: number,
        max: number,
        formatFn: (n: number) => string
    }) => {
        const tile = new zrender.Group();

        // Background card
        const bg = new zrender.Rect({
            shape: { x, y, width, height, r: 8 },
            style: {
                fill: THEME.bg.card,
                stroke: THEME.border,
                lineWidth: 1,
                shadowBlur: THEME.shadow.blur,
                shadowColor: THEME.shadow.color
            }
        });
        tile.add(bg);

        // Title (left-aligned)
        const titleText = new zrender.Text({
            style: {
                text: data.title,
                x: x + 12,
                y: y + 12,
                fill: THEME.text.primary,
                fontSize: 14,
                fontWeight: 'bold'
            }
        });
        tile.add(titleText);

        // Separator line below title
        const titleSeparator = new zrender.Line({
            shape: {
                x1: x + 12,
                y1: y + 30,
                x2: x + width - 12,
                y2: y + 30
            },
            style: {
                stroke: THEME.border,
                lineWidth: 1.5,
                opacity: 0.9
            }
        });
        tile.add(titleSeparator);

        // Current value (left-aligned)
        const currentValue = new zrender.Text({
            style: {
                text: data.formatFn(data.current),
                x: x + 12,
                y: y + 42,
                fill: data.color,
                fontSize: 17,
                fontWeight: 'bold'
            }
        });
        tile.add(currentValue);

        // Zmiana procentowa - prawostronnie jak w oryginale
        let changeText: string;
        if (!isFinite(data.change)) {
            changeText = 'N/A';
        } else {
            changeText = data.change.toFixed(1) + '%';
        }

        const change = new zrender.Text({
            style: {
                text: changeText,
                x: x + width - 12,
                y: y + 42,
                fill: data.change >= 0 ? '#22c55e' : '#ef4444',
                fontSize: 13,
                align: 'right',
                fontWeight: 'bold'
            }
        });
        tile.add(change);

        // Additional stats rows
        const stats = [
            { label: 'Średnia:', value: data.formatFn(data.average) },
            { label: 'Min:', value: data.formatFn(data.min) },
            { label: 'Max:', value: data.formatFn(data.max) }
        ];

        stats.forEach((stat, i) => {
            const label = new zrender.Text({
                style: {
                    text: stat.label,
                    x: x + 12,
                    y: y + 65 + i * 16,
                    fill: THEME.text.secondary,
                    fontSize: 11
                }
            });
            const value = new zrender.Text({
                style: {
                    text: stat.value,
                    x: x + width - 12,
                    y: y + 65 + i * 16,
                    fill: THEME.text.primary,
                    fontSize: 11,
                    align: 'right'
                }
            });
            tile.add(label);
            tile.add(value);
        });

        return tile;
    };

    // Median tile
    const medianTile = createTile(
        startX,
        startY,
        tileWidth,
        tileHeight,
        {
            title: 'Cena (mediana)',
            color: THEME.chart.line1.color,
            current: currentStats.median,
            average: averages.median,
            change: changes.median,
            min: extremes.median.min,
            max: extremes.median.max,
            formatFn: (n) => formatCurrency(n, statsContext.dataContext?.currencies || [], 2)
        }
    );
    zr.add(medianTile);

    // Q10 tile
    const q10Tile = createTile(
        startX + tileWidth + tileSpacing,
        startY,
        tileWidth,
        tileHeight,
        {
            title: 'Cena (q10)',
            color: THEME.chart.line2.color,
            current: currentStats.q10,
            average: averages.q10,
            change: changes.q10,
            min: extremes.q10.min,
            max: extremes.q10.max,
            formatFn: (n) => formatCurrency(n, statsContext.dataContext?.currencies || [], 2)
        }
    );
    zr.add(q10Tile);

    // Amount tile
    const amountTile = createTile(
        startX + (tileWidth + tileSpacing) * 2,
        startY,
        tileWidth,
        tileHeight,
        {
            title: 'Ilość',
            color: THEME.chart.histogram.color,
            current: currentStats.amount,
            average: averages.amount,
            change: changes.amount,
            min: extremes.amount.min,
            max: extremes.amount.max,
            formatFn: (n) => formatNumber(n, 0)
        }
    );
    zr.add(amountTile);

    // Shops tile
    const shopsTile = createTile(
        startX + (tileWidth + tileSpacing) * 3,
        startY,
        tileWidth,
        tileHeight,
        {
            title: 'Sklepy',
            color: THEME.chart.shops.color,
            current: currentStats.shops,
            average: averages.shops,
            change: changes.shops,
            min: extremes.shops.min,
            max: extremes.shops.max,
            formatFn: (n: number) => String(Math.round(n))
        }
    );
    zr.add(shopsTile);
}

/**
 * Returns an empty SecureDataStats object for a fresh chart context.
 */
function initializeSecureStats(): SecureDataStats {
    return {
        count: 0,
        line1Stats: { sum: 0, min: Infinity, max: -Infinity, last: null, first: null },
        line2Stats: { sum: 0, min: Infinity, max: -Infinity, last: null, first: null },
        histogramStats: { sum: 0, min: Infinity, max: -Infinity, last: null, first: null },
        shopsStats: { sum: 0, min: Infinity, max: -Infinity, last: null, first: null },
        renderPositions: { line1Points: [], line2Points: [], histogramBars: [], shopsBubbles: [], dateLabels: [] }
    };
}

// ===== MAIN EVENT HANDLER =====

/**
 * Entry point for all chart events dispatched from the web worker.
 */
export async function handleEvent(
    e: MessageEvent,
    chartContexts: Map<string, ChartContext>,
    statsContexts: Map<string, StatsContext>
): Promise<void> {
    const { type, chartId, chartType } = e.data;

    try {
        switch (type) {
            case 'init':
                await handleInit(e, chartContexts);
                break;
            case 'resize':
                await handleResize(e, chartContexts, statsContexts);
                break;
            case 'destroy':
                handleDestroy(e, chartContexts);
                break;
            case 'clear':
                await handleClear(e, chartContexts);
                break;
            case 'addEncryptedData':
                await handleAddEncryptedData(e, chartContexts, statsContexts);
                break;
            case 'mouseMove':
                await handleMouseMove(e, chartContexts);
                break;
            case 'mouseOut':
                await handleMouseOut(e, chartContexts);
                break;
            case 'initStats':
                await handleInitStats(e, statsContexts);
                break;
            case 'resizeStats':
                await handleResizeStats(e, statsContexts);
                break;
            case 'destroyStats':
                handleDestroyStats(e, statsContexts);
                break;
            case 'setCurrencies':
                await handleSetCurrencies(e, chartContexts, statsContexts);
                break;
            default:
                console.warn('Unknown event type:', type);
        }
    } catch (error) {
        console.error(`Error handling event ${type}:`, error);
    }
}

async function handleInit(e: MessageEvent, chartContexts: Map<string, ChartContext>): Promise<void> {
    const { chartId, chartType, canvas, key, width, height, dpr } = e.data;

    if (chartType !== 'line-and-bar') {
        console.warn('Unsupported chart type:', chartType);
        return;
    }

    const zr = zrender.init(canvas as any, { renderer: 'canvas', devicePixelRatio: dpr });

    const normalizedCurrencies = normalizeCurrencies((e.data && e.data.currencies) || []);

    const context: ChartContext = {
        zr,
        key: null, // Key will be set later by the webWorker after authentication
        secureStats: initializeSecureStats(),
        currencies: normalizedCurrencies,
        activePointIndex: null,
        line1El: new zrender.Polyline({
            shape: { points: [] },
            style: {
                stroke: THEME.chart.line1.color,
                lineWidth: 4,
                fill: 'none',
                lineCap: 'round',
                lineJoin: 'round',
                shadowBlur: 24,
                shadowColor: (THEME.chart as any).line1.glow || THEME.chart.line1.color
            },
            z: 2
        }),
        line2El: new zrender.Polyline({
            shape: { points: [] },
            style: { stroke: THEME.chart.line2.color, lineWidth: 3, fill: 'none' },
            z: 2
        }),
        line1Points: [],
        line2Points: [],
        histogramEls: [],
        shopsBubbleEls: [], // Initialize shopsBubbleEls
        tooltipGroup: new zrender.Group({ z: 100 }),
        highlightElements: [],
        statsGroup: new zrender.Group(),
        gridElements: [],
        width,
        height,
        isAnimating: false,
        animationQueue: [],
    };

    zr.add(context.line1El);
    zr.add(context.line2El);
    zr.add(context.tooltipGroup);
    context.tooltipGroup.hide();

    chartContexts.set(chartId + '|' + chartType, context);
}

async function handleResize(
    e: MessageEvent,
    chartContexts: Map<string, ChartContext>,
    statsContexts: Map<string, StatsContext>
): Promise<void> {
    const { chartId, chartType, width, height, dpr } = e.data;
    const context = chartContexts.get(chartId + '|' + chartType);

    if (!context) return;

    context.width = width;
    context.height = height;
    context.zr.resize({ width, height, devicePixelRatio: dpr });

    await recalculateAllRenderPositions(context);
    updateChart(context);
    await redrawScene(context);

    // After the main chart's data is recalculated, the stats panel must also be redrawn.
    const statsContext = statsContexts.get(chartId);
    if (statsContext) {
        statsContext.dataContext = context; // Ensure the link is fresh
        drawStatsCanvas(statsContext);
    }
}

function handleDestroy(e: MessageEvent, chartContexts: Map<string, ChartContext>): void {
    const { chartId, chartType } = e.data;
    const context = chartContexts.get(chartId + '|' + chartType);

    if (!context) return;

    context.zr.dispose();
    chartContexts.delete(chartId + '|' + chartType);
}

async function handleClear(e: MessageEvent, chartContexts: Map<string, ChartContext>): Promise<void> {
    const { chartId, chartType } = e.data;
    const context = chartContexts.get(chartId + '|' + chartType);

    if (!context) return;

    context.secureStats = initializeSecureStats();
    context.animationQueue = [];
    context.activePointIndex = null;

    context.line1Points.forEach(p => context.zr.remove(p));
    context.line2Points.forEach(p => context.zr.remove(p));
    context.histogramEls.forEach(el => context.zr.remove(el));
    if (context.shopsBubbleEls) context.shopsBubbleEls.forEach(el => context.zr.remove(el));
    context.highlightElements.forEach(el => context.zr.remove(el));
    context.gridElements.forEach(el => context.zr.remove(el));

    context.line1Points = [];
    context.line2Points = [];
    context.histogramEls = [];
    context.shopsBubbleEls = [];
    context.highlightElements = [];
    context.gridElements = [];

    context.tooltipGroup.hide();
}


async function handleAddEncryptedData(
    e: MessageEvent,
    chartContexts: Map<string, ChartContext>,
    statsContexts: Map<string, StatsContext>
): Promise<void> {
    const { chartId, chartType, encryptedPayload } = e.data;
    const context = chartContexts.get(chartId + '|' + chartType);

    if (!context || !context.key) {
        console.error("Cannot add encrypted data: context or decryption key is missing.");
        return;
    }

    context.animationQueue = encryptedPayload || [];

    await recalculateAllRenderPositions(context);
    updateChart(context);

    // Update the stats panel
    const statsContext = statsContexts.get(chartId);
    if (statsContext) {
        statsContext.dataContext = context;
        drawStatsCanvas(statsContext);
    }
}


async function handleMouseMove(e: MessageEvent, chartContexts: Map<string, ChartContext>): Promise<void> {
    const { chartId, chartType, x } = e.data;
    const context = chartContexts.get(chartId + '|' + chartType);

    if (!context || context.secureStats.count === 0) return;

    const chartWidth = context.width - AXES_PADDING.left - AXES_PADDING.right;
    const newIndex = getIndexFromX(x, context.secureStats.count, chartWidth);

    if (newIndex !== context.activePointIndex) {
        context.activePointIndex = newIndex;
        await redrawScene(context);
    }
}

async function handleMouseOut(e: MessageEvent, chartContexts: Map<string, ChartContext>): Promise<void> {
    const { chartId, chartType } = e.data;
    const context = chartContexts.get(chartId + '|' + chartType);

    if (!context) return;

    context.activePointIndex = null;
    await redrawScene(context);
}

async function handleInitStats(e: MessageEvent, statsContexts: Map<string, StatsContext>): Promise<void> {
    const { chartId, canvas, width, height, dpr } = e.data;

    const zr = zrender.init(canvas as any, { renderer: 'canvas', devicePixelRatio: dpr });

    const statsContext: StatsContext = {
        zr,
        width,
        height,
        dataContext: null
    };

    statsContexts.set(chartId, statsContext);
}

async function handleResizeStats(e: MessageEvent, statsContexts: Map<string, StatsContext>): Promise<void> {
    const { chartId, width, height, dpr } = e.data;
    const statsContext = statsContexts.get(chartId);

    if (!statsContext) return;

    statsContext.width = width;
    statsContext.height = height;
    statsContext.zr.resize({ width, height, devicePixelRatio: dpr });

    drawStatsCanvas(statsContext);
}

async function handleSetCurrencies(
    e: MessageEvent,
    chartContexts: Map<string, ChartContext>,
    statsContexts: Map<string, StatsContext>
): Promise<void> {
    const { chartId, chartType, currencies } = e.data;
    const context = chartContexts.get(chartId + '|' + chartType);
    if (!context) return;

    // Update currencies in context
    context.currencies = normalizeCurrencies(currencies || []);

    // Redraw axes and chart layer so axis labels and tooltip use the new format
    drawAxesAndGrid(context);
    updateChart(context);
    await redrawScene(context);

    // Refresh the stats panel (price tiles also use currencies)
    const statsContext = statsContexts.get(chartId);
    if (statsContext) {
        statsContext.dataContext = context;
        drawStatsCanvas(statsContext);
    }
}

function handleDestroyStats(e: MessageEvent, statsContexts: Map<string, StatsContext>): void {
    const { chartId } = e.data;
    const statsContext = statsContexts.get(chartId);

    if (!statsContext) return;

    statsContext.zr.dispose();
    statsContexts.delete(chartId);
}

// ===== EXPORTS =====

export {
    updateChart,
    redrawScene,
    drawStatsCanvas,
    recalculateAllRenderPositions,
    getIndexFromX,
    updateSecureStats,
    calculatePercentageChange,
    initializeSecureStats,
    formatNumber,
    THEME,
    AXES_PADDING,
    CHART_CONFIG,
    TOOLTIP_CONFIG
};