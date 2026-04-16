import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, AlertCircle, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuickStats24h } from "@/hooks/useQuickStats24h";
import type { StatEntry, ServerCurrency } from "@/types/api";
import { formatCurrency } from "@/lib/utils";
import { memo, useState, useRef } from "react";

const MAX_ROWS = 10;

interface ListProps {
  title: string;
  entries: StatEntry[];
  showPercent?: boolean;
  precision?: number;
  currencies?: ServerCurrency[];
}

const StatList = memo(function StatList({ title, entries, showPercent = true, precision = 0, currencies }: ListProps) {
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleRef = (el: HTMLDivElement | null) => {
    contentRef.current = el;
    if (el) {
      setHasOverflow(el.scrollHeight > el.clientHeight);
    }
  };

  const handleScroll = () => {
    setIsScrolling(true);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 400);
  };

  return (
    <Card className="bg-[#0B1119]/60 hover:bg-[#0D141F]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in transition-colors">
      <CardHeader>
        <CardTitle className="text-[hsl(45_70%_60%)] text-base font-semibold tracking-tight">{title}</CardTitle>
      </CardHeader>
      <CardContent className="relative">
        <TooltipProvider delayDuration={300} skipDelayDuration={0} disableHoverableContent={isScrolling}>
          <div
            ref={handleRef}
            onScroll={handleScroll}
            className="max-h-[200px] pr-1 overflow-y-auto custom-scrollbar scrollbar-gutter-stable divide-y divide-[rgba(20,27,36,0.6)]"
          >
            {entries.slice(0, MAX_ROWS).map((e, idx) => {
              const isUp = e.changeAbs >= 0;
              const color = isUp ? "text-emerald-500" : "text-rose-500";
              const Icon = isUp ? ArrowUp : ArrowDown;
              const valueStr = formatCurrency(e.currentValue, currencies, precision);
              const absDeltaStr = formatCurrency(Math.abs(e.changeAbs), currencies, precision);
              const percentStr = (((e.changePct as number) ?? 0) * 100).toFixed(2);
              const deltaSigned = `${isUp ? "+" : "-"}${absDeltaStr}`;

              return (
                <div key={idx} className="px-2 py-2 hover:bg-muted/30 transition-colors">
                  <div
                    className={`grid grid-cols-[auto,1fr,auto] ${
                      showPercent ? "grid-rows-2" : "grid-rows-1"
                    } gap-x-2 ${showPercent ? "gap-y-0.5" : "gap-y-0"} min-w-0 items-center`}
                  >
                    <span
                      className={`${
                        showPercent ? "row-span-2" : "row-span-1"
                      } w-5 flex-shrink-0 text-muted-foreground tabular-nums text-right`}
                    >
                      {e.rank || idx + 1}.
                    </span>

                    <div className={`${showPercent ? "row-span-2" : "row-span-1"} min-w-0 self-center overflow-hidden`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="font-medium truncate cursor-help block">{e.name}</span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          sideOffset={6}
                          className="z-50 max-w-[18rem] break-words bg-[#0B1119]/95 backdrop-blur border border-[#141B24]"
                        >
                          {e.name}
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    {showPercent ? (
                      <>
                        <div className={`col-[3] row-[1] flex items-center gap-1 font-semibold leading-none ${color}`}>
                          <Icon className="h-4 w-4" />
                          <span className="tabular-nums">{percentStr}%</span>
                        </div>
                        <div className="col-[3] row-[2] text-xs tabular-nums text-right text-slate-300 leading-none">
                          <span>{valueStr}</span>
                          <span className={`ml-1 ${color}`}>({isUp ? "+" : "-"}{absDeltaStr})</span>
                        </div>
                      </>
                    ) : (
                      <div className={`col-[3] row-[1] flex items-center justify-end gap-1 leading-none ${color} whitespace-nowrap`}>
                        <Icon className="h-4 w-4" />
                        <span className="text-sm md:text-base font-semibold tabular-nums text-slate-200 whitespace-nowrap">{valueStr}</span>
                        <span className={`ml-1 ${color} text-sm md:text-base whitespace-nowrap`}>({deltaSigned})</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
        {hasOverflow && (
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#0B1119]/80 to-transparent pointer-events-none" />
        )}
      </CardContent>
    </Card>
  );
});


type UnitsConfig = { price?: string; quantity?: string; shops?: string };

interface QuickStats24hProps {
  units?: UnitsConfig;
  serverName: string;
  currencies?: ServerCurrency[];
  enabled?: boolean;
}

export function QuickStats24h({ serverName, currencies, enabled = true }: QuickStats24hProps) {
  const { data, loading, error } = useQuickStats24h(serverName, enabled);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in-up">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-[hsl(45_70%_60%)] text-base font-semibold tracking-tight flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Ładowanie...
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="h-8 bg-muted/20 rounded animate-pulse" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in-up">
        <Card className="bg-[#0B1119]/60 border border-red-500/50 backdrop-blur-sm col-span-full">
          <CardHeader>
            <CardTitle className="text-red-400 text-base font-semibold tracking-tight flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Błąd ładowania danych
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Nie udało się załadować statystyk 24h. Sprawdź połączenie z API.
            </p>
            <p className="text-xs text-red-400 mt-2">{error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in-up">
        <Card className="bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm col-span-full">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              Brak danych statystyk 24h dla serwera {serverName}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in-up">
      <StatList title="Największy wzrost ceny" entries={data.priceUp} currencies={currencies} precision={2} />
      <StatList title="Największy spadek ceny" entries={data.priceDown} currencies={currencies} precision={2} />
      <StatList title="Największy wzrost ilości" entries={data.amountUp} currencies={currencies} precision={0} />
      <StatList title="Największy spadek ilości" entries={data.amountDown} currencies={currencies} precision={0} />
      <StatList title="Największy wzrost liczby sklepów" entries={data.shopsUp} showPercent={false} currencies={currencies} precision={0} />
      <StatList title="Największy spadek liczby sklepów" entries={data.shopsDown} showPercent={false} currencies={currencies} precision={0} />
    </div>
  );
}
