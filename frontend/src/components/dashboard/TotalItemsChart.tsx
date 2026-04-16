import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpCircle, Loader2, AlertCircle } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useServerStats } from "@/hooks/useServerStats";
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
} from "chart.js";

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, LinearScale, CategoryScale, ChartTooltip, Legend);

interface TotalItemsChartProps {
  serverId: string;
  serverName: string;
  enabled?: boolean;
}

// Locale for date formatting
const LOCALE = "pl-PL";

// Number compact formatter (k/kk/kkk)
const numberCompactPl = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1).replace(".", ",")}kkk`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(".", ",")}kk`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(".", ",")}k`;
  return n.toLocaleString("pl-PL");
};

export function TotalItemsChart({ serverId, serverName, enabled = true }: TotalItemsChartProps) {
  const { data: apiData, loading, error } = useServerStats(serverName, 14, enabled);

  const withCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const withoutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const withChartRef = useRef<Chart | null>(null);
  const withoutChartRef = useRef<Chart | null>(null);

  const [legendState, setLegendState] = useState({
    withUnique: true,
    withVol: true,
    withoutUnique: true,
    withoutVol: true,
  });

  // Labels from API or fallback to last 14 days
  const labels = useMemo(() => {
    if (apiData) return apiData.labels;
    const arr: string[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      arr.push(d.toISOString());
    }
    return arr;
  }, [apiData]);

  const data = useMemo(() => {
    if (apiData) return apiData.data;
    return labels.map((date) => ({
      date,
      uniqueWithBonus: 0,
      uniqueWithoutBonus: 0,
      itemsWithBonus: 0,
      itemsWithoutBonus: 0,
    }));
  }, [apiData, labels]);

  const formattedLabels = useMemo(
    () => labels.map((d) => new Date(d).toLocaleDateString(LOCALE, { month: "short", day: "numeric" })),
    [labels]
  );

  const uniqueWith = useMemo(() => data.map((d) => d.uniqueWithBonus), [data]);
  const uniqueWithout = useMemo(() => data.map((d) => d.uniqueWithoutBonus), [data]);
  const itemsWith = useMemo(() => data.map((d) => d.itemsWithBonus), [data]);
  const itemsWithout = useMemo(() => data.map((d) => d.itemsWithoutBonus), [data]);

  const colors = useMemo(
    () => ({
      lines: {
        with: "rgb(56, 189, 248)",
        without: "rgb(168, 85, 247)",
      },
      bars: {
        with: "rgba(56, 189, 248, 0.55)",
        withHover: "rgba(56, 189, 248, 0.75)",
        without: "rgba(168, 85, 247, 0.55)",
        withoutHover: "rgba(168, 85, 247, 0.75)",
      },
      axes: {
        tick: "#FFFFFF",
        grid: "rgba(255,255,255,0.06)",
        border: "rgba(255,255,255,0.12)",
      },
      tooltip: {
        bg: "rgba(17, 24, 39, 0.95)",
        border: "rgba(255, 255, 255, 0.1)",
      },
    }),
    []
  );

  const createMixedChart = (
    ctx: CanvasRenderingContext2D,
    cfg: {
      formattedLabels: string[];
      rawLabels: string[];
      barLabel: string;
      lineLabel: string;
      uniqueData: number[];
      itemsData: number[];
      barColor: string;
      barHover: string;
      lineColor: string;
      layoutPadding: { top: number; bottom: number };
      showXAxisTicks: boolean;
    }
  ) => {
    return new Chart(ctx, {
      type: "bar",
      data: {
        labels: cfg.formattedLabels as any,
        datasets: [
          {
            type: "bar" as const,
            label: cfg.barLabel,
            data: cfg.uniqueData as any,
            yAxisID: "yUnique",
            backgroundColor: cfg.barColor,
            hoverBackgroundColor: cfg.barHover,
            borderWidth: 0,
            borderSkipped: "bottom",
            barPercentage: 0.8,
            categoryPercentage: 0.7,
            order: 0,
            z: 0,
            borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
          },
          {
            type: "line" as const,
            label: cfg.lineLabel,
            data: cfg.itemsData as any,
            yAxisID: "yVol",
            borderColor: cfg.lineColor,
            backgroundColor: "transparent",
            tension: 0.35,
            borderWidth: 3,
            pointRadius: 0,
            pointHoverRadius: 3,
            order: 10,
            z: 100,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: cfg.layoutPadding },
        interaction: { mode: "index", intersect: false },
        animation: { duration: 500 },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: colors.axes.tick, display: cfg.showXAxisTicks },
            title: { display: false },
          },
          yUnique: {
            position: "right",
            beginAtZero: true,
            grid: { color: colors.axes.grid },
            border: { color: colors.axes.border },
            ticks: { color: colors.axes.tick, maxTicksLimit: 4 },
            title: { display: false },
          },
          yVol: {
            position: "left",
            beginAtZero: true,
            grid: { display: false },
            border: { color: colors.axes.border },
            ticks: {
              color: colors.axes.tick,
              maxTicksLimit: 4,
              callback: (val: any) => numberCompactPl(typeof val === "string" ? parseFloat(val) : val),
            },
            title: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.tooltip.bg,
            borderColor: colors.tooltip.border,
            borderWidth: 1,
            titleColor: "#E5E7EB",
            bodyColor: "#E5E7EB",
            callbacks: {
              title: (items) => {
                const idx = items?.[0]?.dataIndex ?? 0;
                const d = new Date(cfg.rawLabels[idx]);
                return d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
              },
              label: (ctx) => {
                const v = ctx.parsed.y as number;
                const isVol = ctx.dataset.yAxisID === "yVol";
                const val = isVol ? `${numberCompactPl(Math.round(v))} przedmiotów` : `${Math.round(v)}`;
                return `${ctx.dataset.label}: ${val}`;
              },
            },
          },
        },
        elements: { line: { tension: 0.35 } },
      },
    });
  };

  // Sync hover state between the two charts
  useEffect(() => {
    const syncAtIndex = (index: number | null) => {
      const apply = (chart: Chart | null) => {
        if (!chart) return;
        if (index == null || index < 0 || index >= (chart.data.labels?.length ?? 0)) {
          chart.setActiveElements([], { x: 0, y: 0 });
          chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
          chart.update();
          return;
        }
        const elements = chart.data.datasets.map((_, di) => ({ datasetIndex: di, index }));
        chart.setActiveElements(elements);
        const meta0 = chart.getDatasetMeta(0);
        const el = (meta0?.data?.[index] as any) || null;
        const pos = el?.getProps ? el.getProps(["x", "y"], true) : { x: el?.x ?? 0, y: el?.y ?? 0 };
        chart.tooltip?.setActiveElements(elements, { x: pos.x ?? 0, y: pos.y ?? 0 } as any);
        chart.update();
      };
      apply(withChartRef.current);
      apply(withoutChartRef.current);
    };

    const indexFromEvt = (chart: Chart | null, evt: MouseEvent) => {
      if (!chart) return null;
      const pts = chart.getElementsAtEventForMode(evt as any, "nearest", { intersect: false, axis: "x" }, true);
      return pts?.[0]?.index ?? null;
    };

    const onMoveWith = (evt: MouseEvent) => syncAtIndex(indexFromEvt(withChartRef.current, evt));
    const onMoveWithout = (evt: MouseEvent) => syncAtIndex(indexFromEvt(withoutChartRef.current, evt));
    const clear = () => syncAtIndex(null);

    const wc = withCanvasRef.current;
    const woc = withoutCanvasRef.current;
    wc?.addEventListener("mousemove", onMoveWith);
    woc?.addEventListener("mousemove", onMoveWithout);
    wc?.addEventListener("mouseleave", clear);
    woc?.addEventListener("mouseleave", clear);
    return () => {
      wc?.removeEventListener("mousemove", onMoveWith);
      woc?.removeEventListener("mousemove", onMoveWithout);
      wc?.removeEventListener("mouseleave", clear);
      woc?.removeEventListener("mouseleave", clear);
    };
  }, [labels]);

  // (Re)build charts when data changes; destroy previous instances to avoid leaks
  useEffect(() => {
    if (withChartRef.current) {
      withChartRef.current.destroy();
      withChartRef.current = null;
    }
    if (withoutChartRef.current) {
      withoutChartRef.current.destroy();
      withoutChartRef.current = null;
    }

    if (!withCanvasRef.current || !withoutCanvasRef.current) return;

    const withCtx = withCanvasRef.current.getContext("2d");
    const withoutCtx = withoutCanvasRef.current.getContext("2d");
    if (!withCtx || !withoutCtx) return;

    withChartRef.current = createMixedChart(withCtx, {
      formattedLabels,
      rawLabels: labels,
      barLabel: "Unikalne (z bonusami)",
      lineLabel: "Wolumen (z bonusami)",
      uniqueData: uniqueWith,
      itemsData: itemsWith,
      barColor: colors.bars.with,
      barHover: colors.bars.withHover,
      lineColor: colors.lines.with,
      layoutPadding: { top: 8, bottom: 0 },
      showXAxisTicks: false,
    });

    withoutChartRef.current = createMixedChart(withoutCtx, {
      formattedLabels,
      rawLabels: labels,
      barLabel: "Unikalne (bez bonusów)",
      lineLabel: "Wolumen (bez bonusów)",
      uniqueData: uniqueWithout,
      itemsData: itemsWithout,
      barColor: colors.bars.without,
      barHover: colors.bars.withoutHover,
      lineColor: colors.lines.without,
      layoutPadding: { top: 0, bottom: 8 },
      showXAxisTicks: true,
    });

    return () => {
      withChartRef.current?.destroy();
      withoutChartRef.current?.destroy();
      withChartRef.current = null;
      withoutChartRef.current = null;
    };
  }, [labels, formattedLabels, uniqueWith, uniqueWithout, itemsWith, itemsWithout, colors]);

  // Apply legend visibility state to both charts
  useEffect(() => {
    const apply = (chart: Chart | null) => {
      if (!chart) return;
      chart.data.datasets.forEach((ds: any) => {
        const key =
          ds.label.includes("z bonusami")
            ? ds.type === "line"
              ? "withVol"
              : "withUnique"
            : ds.type === "line"
            ? "withoutVol"
            : "withoutUnique";
        ds.hidden = !legendState[key as keyof typeof legendState];
      });
      chart.update();
    };
    apply(withChartRef.current);
    apply(withoutChartRef.current);
  }, [legendState]);

  // Loading state
  if (loading) {
    return (
      <Card className="bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in">
        <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="text-[hsl(45_70%_60%)] font-semibold flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Przedmioty na rynku
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            <p>Ładowanie danych o przedmiotach...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in">
        <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="text-[hsl(45_70%_60%)] font-semibold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400" />
            Przedmioty na rynku
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
            <p className="mb-2">Błąd podczas ładowania danych</p>
            <p className="text-sm text-red-400">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No data state
  if (!data || data.length === 0) {
    return (
      <Card className="bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in">
        <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
          <CardTitle className="text-[hsl(45_70%_60%)] font-semibold">Przedmioty na rynku</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <p>Brak danych do wyświetlenia</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[#0B1119]/60 hover:bg-[#0D141F]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in transition-colors">
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4">
        <CardTitle className="text-[hsl(45_70%_60%)] font-semibold">Przedmioty na rynku</CardTitle>
        <div className="flex items-center gap-1">
          <HoverCard openDelay={200} closeDelay={150}>
            <HoverCardTrigger asChild>
              <Button variant="ghost" size="sm" title="Pomoc o wykresie">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </HoverCardTrigger>
            <HoverCardContent side="bottom" align="end" className="w-80 max-w-[85vw] border-[#141B24] bg-[#0B1119]/95 text-foreground">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pomoc</div>
              <div className="h-px bg-[#141B24] my-2" />
              <ul className="text-sm space-y-1 text-muted-foreground/90">
                <li>Dwa panele: z bonusami (góra) oraz bez bonusów (dół).</li>
                <li>
                  <span className="text-[hsl(45_70%_60%)]">Słupki</span>: liczba <b>unikalnych</b> przedmiotów.
                </li>
                <li>
                  <span className="text-teal-400">Linia</span>: <b>całkowita ilość</b> wszystkich przedmiotów.
                </li>
                <li>Lewa/prawa oś dopasowana do serii. Najedź kursorem, aby zobaczyć pełną datę i wartości.</li>
              </ul>
            </HoverCardContent>
          </HoverCard>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Grouped legend */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] md:text-xs leading-tight">
          {/* WITH bonuses */}
          <div className="rounded-md border border-[#141B24] bg-[#0B1119]/50 p-2">
            <div className="mb-2 text-[10px] md:text-[11px] uppercase tracking-wide text-muted-foreground">Ilość przedmiotów z bonusami</div>
            <div className="flex flex-wrap gap-1">
              {[
                { key: "withUnique", label: "Unikalnych", color: colors.bars.with },
                { key: "withVol", label: "Całkowita ilość", color: colors.lines.with },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setLegendState((s) => ({ ...s, [item.key]: !s[item.key as keyof typeof s] }))}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] border transition-colors ${
                    legendState[item.key as keyof typeof legendState]
                      ? "border-[#2A3444] bg-[#0B1119] text-white"
                      : "border-[#2A3444] bg-transparent text-muted-foreground opacity-70"
                  }`}
                  title="Pokaż/ukryj serię"
                >
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: item.color }} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* WITHOUT bonuses */}
          <div className="rounded-md border border-[#141B24] bg-[#0B1119]/50 p-2">
            <div className="mb-2 text-[10px] md:text-[11px] uppercase tracking-wide text-muted-foreground">Ilość przedmiotów bez bonusów</div>
            <div className="flex flex-wrap gap-1">
              {[
                { key: "withoutUnique", label: "Unikalnych", color: colors.bars.without },
                { key: "withoutVol", label: "Całkowita ilość", color: colors.lines.without },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setLegendState((s) => ({ ...s, [item.key]: !s[item.key as keyof typeof s] }))}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] border transition-colors ${
                    legendState[item.key as keyof typeof legendState]
                      ? "border-[#2A3444] bg-[#0B1119] text-white"
                      : "border-[#2A3444] bg-transparent text-muted-foreground opacity-70"
                  }`}
                  title="Pokaż/ukryj serię"
                >
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: item.color }} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Two mixed charts: WITH bonus (top), WITHOUT bonus (bottom) */}
        <div className="space-y-4">
          <div className="h-[260px] relative w-full rounded-md border border-[#141B24] bg-[#0B1119]/60 p-2">
            <canvas ref={withCanvasRef} />
          </div>
          <div className="h-[260px] relative w-full rounded-md border border-[#141B24] bg-[#0B1119]/60 p-2">
            <canvas ref={withoutCanvasRef} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}