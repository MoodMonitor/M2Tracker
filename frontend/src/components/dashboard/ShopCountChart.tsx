import { useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpCircle, Loader2, AlertCircle } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useShopStats } from "@/hooks/useShopStats";
import { ShopCountChartTheme, defaultShopCountChartTheme } from "@/components/dashboard/chartTheme";
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from "chart.js";

// Register Chart.js components once
Chart.register(BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, ChartTooltip, Legend, Filler);

// Locale for formatting
const LOCALE = "pl-PL";

// Helper: format number (PL locale), trimming unnecessary zeros
const format2 = (n: number) => {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

// Custom plugin: horizontal zero line at y=0
const zeroLinePlugin = {
  id: "zeroLine",
  afterDatasetsDraw: (chart: any, _args: any, pluginOptions: any) => {
    const yScale = chart.scales?.y;
    if (!yScale) return;
    const yZero = yScale.getPixelForValue(0);
    const { left, right, top, bottom } = chart.chartArea || {};
    if (yZero < top || yZero > bottom) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = pluginOptions?.color || "rgba(255,255,255,0.35)";
    ctx.lineWidth = pluginOptions?.lineWidth ?? 1;
    const dash = pluginOptions?.dash ?? [4, 4];
    if (dash && dash.length) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(left, yZero);
    ctx.lineTo(right, yZero);
    ctx.stroke();
    ctx.restore();
  },
};

Chart.register(zeroLinePlugin);

interface ShopCountChartProps {
  serverId: string;
  serverName: string;
  theme?: ShopCountChartTheme;
  enabled?: boolean;
}

export function ShopCountChart({ serverId, serverName, theme: themeOverride, enabled = true }: ShopCountChartProps) {
  // Fetch regular (unencrypted) stats only
  const { data: chartData, loading, error } = useShopStats(serverName, 14, enabled);

  // Use provided full theme or fallback to the default
  const theme = useMemo(() => themeOverride ?? defaultShopCountChartTheme, [themeOverride]);

  // Loading state
  if (loading) {
    return (
      <Card className="bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in">
        <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="text-[hsl(45_70%_60%)] font-semibold flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Liczba sklepów
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="h-64 flex items-center justify-center">
            <div className="text-sm text-muted-foreground">Ładowanie danych sklepów...</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-md border border-[#141B24] bg-[#0B1119]/60 p-3">
                <div className="h-4 bg-muted/20 rounded animate-pulse mb-2" />
                <div className="h-px bg-[#141B24] my-2" />
                <div className="space-y-2">
                  <div className="h-3 bg-muted/20 rounded animate-pulse" />
                  <div className="h-3 bg-muted/20 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="bg-[#0B1119]/60 border border-red-500/50 backdrop-blur-sm animate-fade-in">
        <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="text-red-400 font-semibold flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Błąd ładowania
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <p className="text-sm text-muted-foreground">Nie udało się załadować danych o sklepach.</p>
          <p className="text-xs text-red-400 mt-2">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!chartData) {
    return (
      <Card className="bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in">
        <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="text-[hsl(45_70%_60%)] font-semibold">Liczba sklepów</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <p className="text-sm text-muted-foreground text-center py-8">Brak danych o sklepach dla serwera {serverName}</p>
        </CardContent>
      </Card>
    );
  }

  const shopsStats = chartData.stats.shops;
  const medianStats = chartData.stats.medianUnique;
  const generalStats = chartData.stats.general;

  // Canvas-based Chart.js component (theme-driven)
  function ShopsCanvas({ height = theme.layout.cardHeight }: { height?: number }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const chartRef = useRef<Chart | null>(null);

    useEffect(() => {
      if (!canvasRef.current) return;

      const labels = chartData.labels.map((d) => new Date(d).toLocaleDateString(LOCALE, { month: "short", day: "numeric" }));
      const oldVals = chartData.oldBars;
      const newVals = chartData.newBars;
      const goneVals = chartData.goneBars;
      const medVals = chartData.medians;
      // Avoid rendering 0-height bars (visual artifact)
      const newValsForBars = newVals.map((v) => (v === 0 ? null : v));

      const niceStep = (range: number, desiredTicks = 6) => {
        const raw = range / Math.max(desiredTicks, 1);
        if (!isFinite(raw) || raw <= 0) return 1;
        const pow10 = Math.pow(10, Math.floor(Math.log10(raw)));
        const candidates = [1, 2, 5, 10].map((m) => m * pow10);
        return candidates.find((c) => c >= raw) ?? candidates[candidates.length - 1];
      };

      const posTotals = oldVals.map((v, i) => v + newVals[i]);
      const yMinRaw = Math.min(0, ...goneVals);
      const yMinWithMargin = yMinRaw < 0 ? yMinRaw * 1.15 : 0;
      const yMaxRaw = Math.max(...posTotals) * 1.1;
      const yRangeRaw = yMaxRaw - yMinWithMargin;
      const yStep = niceStep(yRangeRaw, 6);
      const absNeg = Math.abs(Math.min(0, yMinWithMargin));
      const yMinRoundStep = absNeg <= 25 ? 5 : absNeg <= 60 ? 10 : yStep;
      const yMin = Math.floor(yMinWithMargin / yMinRoundStep) * yMinRoundStep;
      const yMax = Math.max(10, Math.ceil(yMaxRaw / 10) * 10);
      const a = (0 - yMin) / Math.max(1e-6, yMax - yMin);

      const maxMed = Math.max(0, ...medVals);
      const y1MaxRaw = maxMed * 1.15;
      const y1Step = niceStep(y1MaxRaw || 1, 5);
      const y1Max = Math.max(y1Step, Math.ceil(y1MaxRaw / y1Step) * y1Step);
      // Align right axis 0 with left axis 0:
      // a = (0 - yMin) / (yMax - yMin) => y1Min = -(a/(1-a)) * y1Max
      const y1Min = -(a / Math.max(1e-6, 1 - a)) * y1Max;

      // Reusable: force line datasets to render on top
      const ensureLineOnTop = {
        id: "ensureLineOnTop",
        afterDatasetsDraw(c: any) {
          const ds = c.data?.datasets || [];
          const indices = ds
            .map((d: any, i: number) => ({ d, i }))
            .filter((x: any) => x.d?.type === "line")
            .map((x: any) => x.i);
          indices.forEach((i: number) => {
            const meta = c.getDatasetMeta(i);
            if (!meta.hidden && meta.controller?.draw) meta.controller.draw();
          });
        },
      } as const;

      if (chartRef.current) {
        const chart = chartRef.current;
        chart.data.labels = labels as any;
        chart.data.datasets[0].data = oldVals as any;
        chart.data.datasets[1].data = newValsForBars as any;
        chart.data.datasets[2].data = goneVals as any;
        chart.data.datasets[3].data = medVals as any;

        (chart.options.scales as any).y.min = yMin;
        (chart.options.scales as any).y.max = yMax;
        (chart.options.scales as any).y.ticks = {
          ...(chart.options.scales as any).y.ticks,
          stepSize: yStep,
          color: "#E5E7EB",
          callback: (val: any) => {
            const v = typeof val === "string" ? parseFloat(val) : val;
            if (!Number.isFinite(v)) return "";
            const isMax = Math.round(v) === Math.round(yMax);
            return isMax ? "" : `${Math.round(v)}`;
          },
        };

        (chart.options.scales as any).y1.max = y1Max;
        (chart.options.scales as any).y1.min = y1Min;
        (chart.options.scales as any).y1.ticks = {
          ...(chart.options.scales as any).y1.ticks,
          stepSize: y1Step,
          color: "#E5E7EB",
          callback: (val: any) => {
            const v = typeof val === "string" ? parseFloat(val) : val;
            if (v < 0) return "";
            return format2(v);
          },
        };

        // Keep plugin during updates
        chart.config.plugins = [ensureLineOnTop];
        chart.update();
      } else {
        const ctx = canvasRef.current.getContext("2d");
        if (!ctx) return;

        chartRef.current = new Chart(ctx, {
          type: "bar",
          data: {
            labels: labels as any,
            datasets: [
              {
                type: "bar" as const,
                label: "Istniejące",
                data: oldVals as any,
                stack: "shops",
                order: 0,
                z: 0,
                backgroundColor: theme.datasets.bars.old.bg,
                hoverBackgroundColor: theme.datasets.bars.old.hoverBg,
                barThickness: theme.datasets.bars.thickness,
                maxBarThickness: theme.datasets.bars.maxThickness,
                barPercentage: theme.datasets.bars.barPercentage,
                categoryPercentage: theme.datasets.bars.categoryPercentage,
                borderSkipped: "bottom",
                borderWidth: 0,
                borderRadius: (ctx: any) => {
                  const i = ctx.dataIndex ?? 0;
                  return newVals[i] > 0
                    ? { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 }
                    : { topLeft: theme.datasets.bars.radiusSmall, topRight: theme.datasets.bars.radiusSmall, bottomLeft: 0, bottomRight: 0 };
                },
              },
              {
                type: "bar" as const,
                label: "Nowe",
                data: newValsForBars as any,
                stack: "shops",
                order: 0,
                z: 0,
                backgroundColor: theme.datasets.bars.newer.bg,
                hoverBackgroundColor: theme.datasets.bars.newer.hoverBg,
                barThickness: theme.datasets.bars.thickness,
                maxBarThickness: theme.datasets.bars.maxThickness,
                barPercentage: theme.datasets.bars.barPercentage,
                categoryPercentage: theme.datasets.bars.categoryPercentage,
                borderSkipped: "bottom",
                borderWidth: 0,
                borderRadius: (ctx: any) => {
                  const i = ctx.dataIndex ?? 0;
                  return newVals[i] > 0
                    ? { topLeft: theme.datasets.bars.radiusLarge, topRight: theme.datasets.bars.radiusLarge, bottomLeft: 0, bottomRight: 0 }
                    : { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
                },
              },
              {
                type: "bar" as const,
                label: "Usunięte",
                data: goneVals as any,
                stack: "shops",
                order: 0,
                z: 0,
                backgroundColor: theme.datasets.bars.gone.bg,
                hoverBackgroundColor: theme.datasets.bars.gone.hoverBg,
                barThickness: theme.datasets.bars.thickness,
                maxBarThickness: theme.datasets.bars.maxThickness,
                barPercentage: theme.datasets.bars.barPercentage,
                categoryPercentage: theme.datasets.bars.categoryPercentage,
                borderSkipped: "top",
                borderWidth: 0,
                borderRadius: { topLeft: 0, topRight: 0, bottomLeft: theme.datasets.bars.radiusSmall, bottomRight: theme.datasets.bars.radiusSmall },
              },
              {
                type: "line" as const,
                label: "Średni rozmiar sklepu",
                data: medVals as any,
                yAxisID: "y1",
                order: 10,
                z: 100,
                borderColor: theme.datasets.line.median.color,
                backgroundColor: theme.datasets.line.median.background,
                pointRadius: theme.datasets.line.median.pointRadius,
                pointHoverRadius: theme.datasets.line.median.pointHoverRadius,
                borderWidth: theme.datasets.line.median.width,
                tension: theme.datasets.line.median.tension,
                fill: theme.datasets.line.median.fill,
                borderCapStyle: theme.datasets.line.median.capStyle ?? "round",
                borderJoinStyle: theme.datasets.line.median.joinStyle ?? "round",
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: theme.layout.paddingTop, bottom: theme.layout.paddingBottom } },
            interaction: { mode: "index" as const, intersect: false },
            animation: { duration: 600, easing: "easeOutQuart" },
            scales: {
              x: {
                stacked: true,
                grid: { display: false },
                ticks: { color: "#E5E7EB", font: { size: theme.axes.x.tickSize } },
                title: { display: false },
              },
              y: {
                stacked: true,
                beginAtZero: false,
                min: yMin,
                max: yMax,
                grid: { color: theme.axes.y.gridColor, lineWidth: 1 },
                border: { color: theme.axes.y.borderColor, display: true, width: theme.axes.y.borderWidth },
                ticks: {
                  color: "#E5E7EB",
                  stepSize: yStep,
                  callback: (val: any) => {
                    const v = typeof val === "string" ? parseFloat(val) : val;
                    if (!Number.isFinite(v)) return "";
                    const isMax = Math.round(v) === Math.round(yMax);
                    return isMax ? "" : `${Math.round(v)}`;
                  },
                },
                title: { display: false },
              },
              y1: {
                position: "right",
                grid: { drawOnChartArea: theme.axes.y1.gridOnChartArea },
                border: { color: theme.axes.y1.borderColor, display: true, width: theme.axes.y1.borderWidth },
                min: y1Min,
                max: y1Max,
                beginAtZero: true,
                ticks: {
                  color: "#E5E7EB",
                  stepSize: y1Step,
                  callback: (val: any) => {
                    const v = typeof val === "string" ? parseFloat(val) : val;
                    if (v < 0) return "";
                    return format2(v);
                  },
                },
                title: { display: false, text: "Mediana unikalnych/sklep" },
              },
            },
            plugins: {
              legend: {
                display: theme.plugins.legend.display,
                labels: { color: "#E5E7EB" },
              },
              zeroLine: {
                color: theme.plugins.zeroLine.color,
                lineWidth: theme.plugins.zeroLine.lineWidth,
                dash: theme.plugins.zeroLine.dash,
              },
              tooltip: {
                animation: {
                  duration: 200, // fade-in duration
                  delay: 150, // delay before the tooltip appears
                },
                usePointStyle: true,
                boxWidth: 8,
                boxHeight: 8,
                displayColors: true,
                padding: 10,
                callbacks: {
                  labelPointStyle: () => ({ pointStyle: "circle", rotation: 0 } as any),
                  title: (items) => {
                    const idx = items?.[0]?.dataIndex;
                    if (idx == null) return "";
                    const d = new Date(chartData.labels[idx]);
                    const full = d.toLocaleDateString(LOCALE, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
                    const cap = full.charAt(0).toUpperCase() + full.slice(1);
                    return cap;
                  },
                  beforeBody: (items) => {
                    const idx = items[0]?.dataIndex;
                    if (idx == null) return [];

                    const oldVal = chartData.oldBars[idx] ?? 0;
                    const newVal = chartData.newBars[idx] ?? 0;
                    const total = oldVal + newVal;

                    const totalStr = `Łącznie sklepów: ${total.toLocaleString(LOCALE)}`;

                    return [totalStr]; // "" adds a space
                  },
                  // Hide raw labels and render a single combined virtual label.
                  label: (ctx) => {
                    // Handle the synthetic split-label row.
                    if (ctx.label === "Podział sklepów") {
                      const oldVal = chartData.oldBars[ctx.dataIndex] ?? 0;
                      const newVal = chartData.newBars[ctx.dataIndex] ?? 0;
                      return `  (Istniejące: ${oldVal.toLocaleString(LOCALE)}, Nowe: ${newVal.toLocaleString(LOCALE)})`;
                    }

                    const name = ctx.dataset?.label || "";
                    const raw = ctx.parsed.y as number;

                    if (ctx.dataset.type === "line") {
                      return `${name}: ${format2(raw)}`;
                    }

                    if (name === "Usunięte") {
                      const v = Math.round(raw);
                      const vStr = Number.isFinite(v) ? Math.abs(v).toLocaleString(LOCALE) : "";
                      return `${name}: -${vStr} sklepów`;
                    }

                    // Fallback for other bar datasets
                    const v = Math.round(raw);
                    const vStr = Number.isFinite(v) ? v.toLocaleString(LOCALE) : "";
                    return `${name}: ${vStr} sklepów`;
                  },
                  labelColor: (ctx) => {
                    // Custom color swatches for the virtual label
                    if (ctx.label === "Podział sklepów") {
                      return [
                        {
                          borderColor: "transparent",
                          backgroundColor: theme.datasets.bars.old.bg,
                        },
                        {
                          borderColor: "transparent",
                          backgroundColor: theme.datasets.bars.newer.bg,
                        },
                      ] as any;
                    }

                    // Default colors for everything else
                    return {
                      borderColor: (ctx.dataset?.borderColor as string) || "rgba(255,255,255,0.5)",
                      backgroundColor: (ctx.dataset?.backgroundColor as any) ?? "rgba(255,255,255,0.25)",
                      borderWidth: 1,
                    };
                  },
                },
                backgroundColor: theme.plugins.tooltip.backgroundColor,
                borderColor: theme.plugins.tooltip.borderColor,
                borderWidth: theme.plugins.tooltip.borderWidth,
                titleColor: theme.plugins.tooltip.titleColor,
                bodyColor: "rgba(229, 231, 235, 0.95)",
                titleFont: { weight: "600" },
                bodyFont: { weight: "500" },
              },
            },
            elements: { bar: { borderWidth: 0 } },
          },
          plugins: [ensureLineOnTop],
        });
      }
    }, [chartData.labels, chartData.oldBars, chartData.newBars, chartData.goneBars, chartData.medians, height, theme]);

    useEffect(() => {
      return () => {
        if (chartRef.current) {
          chartRef.current.destroy();
          chartRef.current = null;
        }
      };
    }, []);

    // Hide tooltip on mouse leave
    useEffect(() => {
      const canvas = canvasRef.current;

      const handleMouseLeave = () => {
        const activeChart = chartRef.current;
        if (activeChart?.tooltip) {
          activeChart.tooltip.setActiveElements([], { x: 0, y: 0 });
          activeChart.update();
        }
      };

      canvas?.addEventListener('mouseleave', handleMouseLeave);

      return () => {
        canvas?.removeEventListener('mouseleave', handleMouseLeave);
      };
    }, []);

    return (
      <div style={{ height }} className="relative w-full">
        <canvas ref={canvasRef} />
      </div>
    );
  }

  return (
    <Card className="bg-[#0B1119]/60 hover:bg-[#0D141F]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in transition-colors relative">
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
        <CardTitle className="text-[hsl(45_70%_60%)] font-semibold">Liczba sklepów</CardTitle>
        <div className="flex items-center gap-1">
          <HoverCard openDelay={200} closeDelay={150}>
            <HoverCardTrigger asChild>
              <Button variant="ghost" size="sm" title="Pomoc o wykresie">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </HoverCardTrigger>
            <HoverCardContent side="bottom" align="end" className="w-96 max-w-[90vw] border-[#141B24] bg-[#0B1119]/95 text-foreground">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pomoc do wykresu</div>
              <div className="h-px bg-[#141B24] my-2" />
              <div className="text-sm space-y-3 text-muted-foreground/90">
                <div>
                  <div className="font-medium text-[#E5E7EB]">Słupki (zmiana względem dnia poprzedniego):</div>
                  <ul className="mt-1 list-disc pl-4 space-y-1">
                    <li>Istniejące sklepy (niebieski) – sklepy, które były obecne w dniu poprzednim i nadal są dostępne</li>
                    <li>Nowe sklepy (zielony) – sklepy, które pojawiły się i nie były obecne dnia poprzedniego</li>
                    <li>Usunięte sklepy (czerwony) – sklepy, które zniknęły, tzn. były dnia poprzedniego, ale już ich nie ma</li>
                  </ul>
                </div>
                <div>
                  <div className="font-medium text-[#E5E7EB]">Linia (żółta):</div>
                  <ul className="mt-1 list-disc pl-4 space-y-1">
                    <li>Pokazuje średni rozmiar sklepu danego dnia, liczony w unikalnych przedmiotach</li>
                  </ul>
                </div>
                <div className="space-y-1">
                  <div>Oś lewa: Łączna liczba sklepów (słupki sumują się do całkowitej liczby sklepów danego dnia)</div>
                  <div>Oś prawa: Skala dla średniego rozmiaru sklepu (linia)</div>
                </div>
                <div>
                  <div className="font-medium text-[#E5E7EB]">Ogólne:</div>
                  <ul className="mt-1 list-disc pl-4 space-y-1">
                    <li>
                      <span className="font-medium text-[#E5E7EB]">Unikalne sklepy</span> – Liczba wszystkich unikalnych sklepów, które pojawiły się w analizowanym przedziale czasowym.
                    </li>
                    <li>
                      <span className="font-medium text-[#E5E7EB]">Średnia obecność sklepu</span> – Średni czas istnienia sklepu w danym przedziale czasowym.
                    </li>
                  </ul>
                </div>
                <div>Interakcja: Najedź kursorem na wykres, aby zobaczyć pełną datę i szczegółowe wartości</div>
              </div>
            </HoverCardContent>
          </HoverCard>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        {/* Date range fixed at 14 days – selector hidden */}
        <ShopsCanvas height={Math.round(theme.layout.cardHeight / 1.15)} />

        {/* Compact tiles with key metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Tile: median unique per shop */}
          <div className="rounded-md border border-[#141B24] bg-[#0B1119]/60 p-3">
            <h3 className="text-xs uppercase tracking-wider text-[#E5E7EB]/80">Średni rozmiar sklepu</h3>
            <div className="h-px bg-[#141B24] my-2" />
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[#E5E7EB] font-semibold">
                {format2(typeof medianStats.current === "string" ? Number(medianStats.current) : (medianStats.current as any))}
              </span>
              <span className={medianStats.changePct >= 0 ? "text-emerald-400 font-medium" : "text-rose-400 font-medium"}>
                {medianStats.changePct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between text-[#E5E7EB]/80">
                <span>Średnia:</span>
                <span className="text-[hsl(45_70%_60%)]/90 text-xs">
                  {format2(typeof medianStats.avg === "string" ? Number(medianStats.avg) : (medianStats.avg as any))}
                </span>
              </div>
              <div className="flex justify-between text-[#E5E7EB]/80">
                <span>Min:</span>
                <span className="text-[hsl(45_70%_60%)]/90 text-xs">
                  {format2(typeof medianStats.min === "string" ? Number(medianStats.min) : (medianStats.min as any))}
                </span>
              </div>
              <div className="flex justify-between text-[#E5E7EB]/80">
                <span>Max:</span>
                <span className="text-[hsl(45_70%_60%)]/90 text-xs">
                  {format2(typeof medianStats.max === "string" ? Number(medianStats.max) : (medianStats.max as any))}
                </span>
              </div>
            </div>
          </div>

          {/* Tile: shops count */}
          <div className="rounded-md border border-[#141B24] bg-[#0B1119]/60 p-3">
            <h3 className="text-xs uppercase tracking-wider text-[#E5E7EB]/80">Liczba sklepów</h3>
            <div className="h-px bg-[#141B24] my-2" />
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[#E5E7EB] font-semibold">{shopsStats.current}</span>
              <span className={shopsStats.changePct >= 0 ? "text-emerald-400 font-medium" : "text-rose-400 font-medium"}>
                {shopsStats.changePct.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between text-[#E5E7EB]/80">
                <span>Średnia:</span>
                <span className="text-[hsl(45_70%_60%)]/90 text-xs">{shopsStats.avg}</span>
              </div>
              <div className="flex justify-between text-[#E5E7EB]/80">
                <span>Min:</span>
                <span className="text-[hsl(45_70%_60%)]/90 text-xs">{shopsStats.min}</span>
              </div>
              <div className="flex justify-between text-[#E5E7EB]/80">
                <span>Max:</span>
                <span className="text-[hsl(45_70%_60%)]/90 text-xs">{shopsStats.max}</span>
              </div>
            </div>
          </div>

          {/* Tile: general */}
          <div className="rounded-md border border-[#141B24] bg-[#0B1119]/60 p-3">
            <h3 className="text-xs uppercase tracking-wider text-[#E5E7EB]/80">Ogólne</h3>
            <div className="h-px bg-[#141B24] my-2" />
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between text-[#E5E7EB]/80">
                <span>Unikalne sklepy:</span>
                <span className="text-[hsl(45_70%_60%)]/90 text-xs">{generalStats.uniqueShops14d}</span>
              </div>
              <div className="flex justify-between text-[#E5E7EB]/80">
                <span>Śr. obecność sklepu:</span>
                <span className="text-[hsl(45_70%_60%)]/90 text-xs">{format2(generalStats.avgDurationDays)} dni</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
