import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import AsyncSelect from 'react-select/async';
import { format, subDays } from 'date-fns';
import TurnstileWidget from '@/components/TurnstileWidget';
import debounce from 'lodash.debounce';
import type { ItemOption, ItemHistoryPoint, ServerCurrency } from '@/types/api';
import { workerService } from '@/webWorker/workerService.ts';

interface SecureChartProps {
  chartId: string;
  serverName: string;
  currencies?: ServerCurrency[];
  useMock?: boolean;
}

const SecureChart: React.FC<SecureChartProps> = ({ chartId, serverName, currencies = [], useMock = false }) => {
  const worker = workerService.worker;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartState = useRef({ isInitialized: false, statsInitialized: false });
  // Track webWorker readiness acknowledgements
  const readyRef = useRef<{ init: boolean; stats: boolean }>({ init: false, stats: false });
  const [readyTick, setReadyTick] = useState(0);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const chartType = 'line-and-bar'; // hardcoded, since other types are not supported yet
  const [dateRange] = useState(() => {
    const end = new Date();
    const start = subDays(end, 13); // Fixed last 14 days (including today)
    return { start, end };
  });
  const [selectedItem, setSelectedItem] = useState<ItemOption | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const requestIdRef = useRef(0);
  const [workerAuthState, setWorkerAuthState] = useState<'idle' | 'pending_turnstile' | 'authenticating' | 'authenticated'>('idle');
  const workerPublicKeyRef = useRef<string | null>(null);
  // --- Worker Message Handlers ---
  useEffect(() => {
    if (!worker) return;

    const handleWorkerMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.chartId !== chartId) return;

      if (data.type === 'itemSearchResult') {
        setIsSearching(false);
        if (data.success) {
          const callback = pendingSearchCallbacks.current.get(data.requestId);
          if (callback) {
            callback(data.items);
            pendingSearchCallbacks.current.delete(data.requestId);
          }
        } else {
          const callback = pendingSearchCallbacks.current.get(data.requestId);
          if (callback) {
            callback([]);
            pendingSearchCallbacks.current.delete(data.requestId);
          }
        }
      } else if (data.type === 'itemHistoryResult') {
        setIsLoading(false);
      } else if (data.type === 'REQUEST_TURNSTILE_CHALLENGE') {
        workerPublicKeyRef.current = data.workerPublicKey;
        setWorkerAuthState('pending_turnstile');
      } else if (data.type === 'WORKER_AUTH_SUCCESS') {
        setWorkerAuthState('authenticated');
      } else if (data.type === 'WORKER_AUTH_FAILURE') {
        console.error('[Chart] Worker authentication failed:', data.error);
        setWorkerAuthState('idle'); // reset to allow retry
      }
    };

    worker.addEventListener('message', handleWorkerMessage);
    return () => worker.removeEventListener('message', handleWorkerMessage);
  }, [worker, chartId]);

  const handleWorkerTurnstileVerify = (token: string) => {
    if (!worker) return;
    setWorkerAuthState('authenticating');
    worker.postMessage({
      type: 'TURNSTILE_TOKEN_RESPONSE',
      chartId,
      token,
      chartType,
    });

  };

  const pendingSearchCallbacks = useRef(new Map<number, (items: ItemOption[]) => void>());

  // --- UI Controls ---
  const fetchItemSuggestions = useCallback(async (query: string): Promise<ItemOption[]> => {
    if (!worker || query.trim().length < 3) {
      setIsSearching(false);
      return [];
    }
    
    return new Promise((resolve) => {
      const requestId = ++requestIdRef.current;
      setIsSearching(true);
      
      // Store callback for this request
      pendingSearchCallbacks.current.set(requestId, resolve);
      
      // Send search request to webWorker
      worker.postMessage({
        type: 'searchItems',
        chartType,
        chartId,
        requestId,
        query,
        serverName,
        useMock
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (pendingSearchCallbacks.current.has(requestId)) {
          pendingSearchCallbacks.current.delete(requestId);
          setIsSearching(false);
          resolve([]);
        }
      }, 10000);
    });
  }, [worker, chartId, chartType, serverName, useMock]);

  const loadOptions = useMemo(() => debounce((query: string, callback: (items: ItemOption[]) => void) => {
    fetchItemSuggestions(query).then(callback);
  }, 400), [fetchItemSuggestions]);

  useEffect(() => {
    const pendingCallbacks = pendingSearchCallbacks.current;
    return () => {
      loadOptions.cancel();
      pendingCallbacks.forEach((resolve) => resolve([]));
      pendingCallbacks.clear();
    };
  }, [loadOptions]);

  // --- Chart Initialization ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const statsCanvas = statsCanvasRef.current;
    if (!canvas || !statsCanvas || !worker || !chartId) return;

    const onMsg = (e: MessageEvent) => {
      const data: any = (e as any).data;
      if (!data || data.chartId !== chartId) return;
      if (data.type === 'ready') {
        if (data.scope === 'init') readyRef.current.init = true;
        if (data.scope === 'initStats') readyRef.current.stats = true;
        setReadyTick(t => t + 1);
      }
    };
    (worker as any).addEventListener?.('message', onMsg as any);

    const resizeObserver = new ResizeObserver(entries => {
      if (!chartState.current.isInitialized) return;
      const entry = entries[0];
      let { width } = entry.contentRect;
      if (width <= 0) return;
      // clamp and round sizes
      const clampedWidth = Math.min(8192, Math.max(100, Math.round(width)));
      const clampedHeight = 400; // fixed for main chart
      const dprRaw = window.devicePixelRatio || 1;
      const dpr = Math.min(3, Math.max(1, Math.round(dprRaw * 100) / 100));

      worker.postMessage({
        type: 'resize',
        chartId,
        chartType: chartType,
        width: clampedWidth,
        height: clampedHeight,
        dpr,
      });

      // Also resize the stats canvas
      if (chartState.current.statsInitialized) {
        worker.postMessage({
          type: 'resizeStats',
          chartType: chartType,
          chartId,
          width: clampedWidth,
          height: 140,
          dpr,
        });
      }
    });

    if (!chartState.current.isInitialized && canvas) {
        const { width: rawWidth } = canvas.getBoundingClientRect();
        const initWidth = Math.min(8192, Math.max(100, Math.round(rawWidth)));
        const dprRaw = window.devicePixelRatio || 1;
        const dpr = Math.min(3, Math.max(1, Math.round(dprRaw * 100) / 100));
        const offscreenCanvas = canvas.transferControlToOffscreen();
        worker.postMessage(
          {
            type: 'init',
            chartId,
            chartType: chartType,
            canvas: offscreenCanvas,
            width: initWidth,
            height: 400,
            dpr,
            currencies,
          },
          [offscreenCanvas]
        );

        chartState.current.isInitialized = true;

        if (!chartState.current.statsInitialized && statsCanvas) {
          const offscreenStatsCanvas = statsCanvas.transferControlToOffscreen();
          worker.postMessage(
            {
              type: 'initStats',
              chartId,
              chartType: chartType,
              canvas: offscreenStatsCanvas,
              width: initWidth,
              height: 140,
              dpr,
            },
            [offscreenStatsCanvas]
          );
          chartState.current.statsInitialized = true;
        }

        resizeObserver.observe(canvas);
    }

    return () => {
      resizeObserver.disconnect();
      if (worker) {
        // Destroy stats context before the main chart
        worker.postMessage({ type: 'destroyStats', chartId, chartType: chartType });
        worker.postMessage({ type: 'destroy', chartId, chartType: chartType });
      }
      (worker as any).removeEventListener?.('message', onMsg as any);
    };
  }, [worker, chartId, chartType]);

  // Push updated currency config to the worker whenever it changes
  useEffect(() => {
    if (!worker || !chartState.current.isInitialized) return;
    worker.postMessage({
      type: 'setCurrencies',
      chartId,
      chartType,
      currencies: currencies || [],
    });
  }, [worker, chartId, chartType, currencies]);

  // --- Data Loading ---
  useEffect(() => {
    // Skip if no item is selected — prevents auto-fetch on first render or after reset
    if (!selectedItem) return;

    if (!worker || !chartState.current.isInitialized) return;
    if (!readyRef.current.init) return;

    const loadData = () => {
      setIsLoading(true);
      worker.postMessage({ type: 'clear', chartId, chartType: chartType });

      const requestId = ++requestIdRef.current;

      worker.postMessage({
        type: 'getItemHistory',
        chartType,
        chartId,
        requestId,
        serverName,
        itemVid: selectedItem.vid,
        startDate: dateRange.start.toISOString(),
        endDate: dateRange.end.toISOString(),
        useMock,
      });
    };

    loadData();
    // readyTick ensures re-fetch if the worker became ready after selectedItem was set
  }, [selectedItem, dateRange, worker, chartId, chartType, serverName, useMock, readyTick]);

  // --- Mouse Event Handlers ---
  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!worker || !chartState.current.isInitialized) return;
    if (!event.isTrusted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    pendingMoveRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    if (rafIdRef.current == null) {
      rafIdRef.current = requestAnimationFrame(() => {
        const payload = pendingMoveRef.current;
        rafIdRef.current = null;
        if (!payload) return;
        // clamp coords to reasonable range
        const x = Math.max(-100000, Math.min(100000, payload.x));
        const y = Math.max(-100000, Math.min(100000, payload.y));
        worker.postMessage({ type: 'mouseMove', chartId, chartType: chartType, x, y });
      });
    }
  }, [worker, chartId, chartType]);

  const handleMouseOut = useCallback((event?: React.MouseEvent<HTMLCanvasElement>) => {
    if (!worker || !chartState.current.isInitialized) return;
    if (event && !event.isTrusted) return;
    worker.postMessage({ type: 'mouseOut', chartId, chartType: chartType, });
  }, [worker, chartId, chartType]);

  return (
    <div className="rounded-lg border border-[#141B24] bg-[#0B1119]/60 text-slate-200">
        <div className="border-b border-[#141B24] p-4 rounded-t-lg bg-transparent">
            <div className="flex flex-col gap-3 items-start">
                <div className="flex items-center justify-between gap-2 w-full">
                    <h3 className="text-lg md:text-xl font-semibold tracking-tight text-[hsl(45,70%,56%)]">
                        Historia cen przedmiotów
                    </h3>
                    <HoverCard openDelay={200} closeDelay={150}>
                      <HoverCardTrigger asChild>
                        <Button variant="ghost" size="sm" title="Pomoc o wykresie">
                          <HelpCircle className="h-4 w-4" />
                        </Button>
                      </HoverCardTrigger>
                      <HoverCardContent side="bottom" align="end" className="w-[44rem] max-w-[95vw] border-[#141B24] bg-[#0B1119]/95 text-foreground">
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pomoc</div>
                        <div className="h-px bg-[#141B24] my-2" />
                        <div className="text-sm text-muted-foreground/90">
                          <div className="mb-2">Ten wykres pokazuje zmiany cen, ilości oraz dostępności wybranego przedmiotu w czasie.</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <div className="font-medium text-[#E5E7EB]">Serie:</div>
                                <ul className="list-disc pl-4 space-y-1">
                                  <li>
                                    <span className="font-medium text-[#FF9900]">Cena (mediana)</span> – pomarańczowa linia. Wartość środkowa cen danego dnia (Q50): połowa ofert była droższa, połowa tańsza.
                                  </li>
                                  <li>
                                    <span className="font-medium text-emerald-400">Cena (q10)</span> – zielona linia. 10. percentyl: cena, poniżej której mieści się 10% najtańszych ofert (dolna granica rynku).
                                  </li>
                                  <li>
                                    <span className="font-medium text-[#3A9EA3]">Ilość</span> – turkusowe słupki. Łączna liczba sztuk dostępna we wszystkich sklepach danego dnia.
                                  </li>
                                  <li>
                                    <span className="font-medium text-[#3b82f6]">Sklepy</span> – Białe wartości nad słupkami przedstawia liczbe sklepow z danym przedmiotem.
                                  </li>
                                </ul>
                              </div>
                              <div className="space-y-1">
                                <div className="font-medium text-[#E5E7EB]">Osie:</div>
                                <div>Oś lewa – ceny (linia mediana i q10). Oś prawa – ilość oraz liczba sklepów.</div>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <div className="font-medium text-[#E5E7EB]">Interakcja:</div>
                                <div>Najedź kursorem, aby zobaczyć dokładną datę i wartości. Przewiń, aby podejrzeć panel statystyk pod wykresem.</div>
                              </div>
                              <div className="space-y-1">
                                <div className="font-medium text-[#E5E7EB]">Jak interpretować:</div>
                                <ul className="list-disc pl-4 space-y-1">
                                  <li><span className="font-medium">Luka mediana–q10</span>: duża luka = duża rozpiętość cen/okazje; mała luka = stabilny rynek.</li>
                                  <li><span className="font-medium">Podaż vs cena</span>: rosnąca ilość/sklepy przy spadku cen → nadpodaż; malejąca ilość/sklepy przy wzroście cen → niedobór.</li>
                                  <li><span className="font-medium">Skoki punktowe</span>: nagłe zmiany ilości/sklepów przy stabilnej cenie mogą wynikać z dostaw, promocji lub sezonowości.</li>
                                  <li><span className="font-medium">Braki danych</span>: puste dni oznaczają brak obserwacji – linie łączą tylko dostępne punkty.</li>
                                </ul>
                              </div>
                            </div>
                          </div>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                </div>
                <div className="w-full">
                    <AsyncSelect
                        value={selectedItem}
                        onChange={setSelectedItem as any}
                        loadOptions={loadOptions}
                        isLoading={isSearching || isLoading}
                        placeholder="Wyszukaj przedmiot..."
                        styles={{
                            container: base => ({ ...base, width: '100%' }),
                            control: base => ({
                                ...base,
                                background: 'rgba(11,17,25,0.85)',
                                border: '1px solid #141B24',
                                color: '#E5E7EB',
                                minHeight: 48,
                                boxShadow: 'none',
                                borderRadius: 8,
                            }),
                            input: base => ({...base, color: '#E5E7EB', fontSize: 15}),
                            placeholder: base => ({...base, color: 'rgba(229,231,235,0.65)', fontSize: 15}),
                            singleValue: base => ({...base, color: '#E5E7EB', fontSize: 15}),
                            menu: base => ({...base, background: 'rgba(11,17,25,0.95)', border: '1px solid #141B24' as any}),
                            option: (base, {isFocused}) => ({
                                ...base,
                                background: isFocused ? 'rgba(20,27,36,0.9)' : 'transparent',
                                color: '#E5E7EB',
                                fontSize: 15
                            })
                        }}
                    />
                </div>
            </div>
        </div>

        <div style={{ position: 'relative', width: '100%' }}>
            <canvas
                ref={canvasRef}
                onMouseMove={handleMouseMove}
                onMouseOut={handleMouseOut}
                style={{ width: '100%', height: '400px', display: 'block', background: 'transparent', borderRadius: '0' }}
            />
            <canvas
                ref={statsCanvasRef}
                style={{ width: '100%', height: '140px', display: 'block', background: 'transparent', borderRadius: '0', marginTop: '0' }}
            />
            {isLoading && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(11,17,25,0.7)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                borderRadius: 8
              }}>
                Ładowanie danych...
              </div>
            )}
            {workerAuthState === 'pending_turnstile' && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(11,17,25,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
                <TurnstileWidget onVerify={handleWorkerTurnstileVerify} cData={workerPublicKeyRef.current ?? undefined}
                                 appearance='interaction-only' size='normal'/>
              </div>
            )}
        </div>
    </div>
  );
};
export default SecureChart;
