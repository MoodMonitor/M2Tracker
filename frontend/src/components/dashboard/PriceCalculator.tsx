import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Calculator, HelpCircle } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { getItemSuggestions, getItemPriceQ10LastUpdate } from "@/services/apiService";
import type { ItemOption, ServerCurrency } from "@/types/api";
import { BadgePriceCanvas } from "@/components/ui/PriceCanvas";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCurrency } from "@/lib/utils";

interface CalculatorItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
  total: number | null;
}

interface PriceCalculatorProps {
  serverId: string;
  serverName: string;
  currencies?: ServerCurrency[];
}

// Config constants
const DEBOUNCE_MS = 400;
const MIN_QUERY_LEN = 3;
const MAX_SUGGESTIONS = 50;
const BLUR_CLOSE_DELAY = 150;

// Safe ID generator for list keys
const generateId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as any).randomUUID() as string;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export function PriceCalculator({ serverId: _serverId, serverName, currencies }: PriceCalculatorProps) {
  const [items, setItems] = useState<CalculatorItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ItemOption | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [openDropdown, setOpenDropdown] = useState(false);
  const [suggestions, setSuggestions] = useState<ItemOption[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingPrice, setLoadingPrice] = useState(false);

  // Debounced search query
  const debouncedSearchQuery = useDebounce(searchQuery.trim(), DEBOUNCE_MS);

  const getItemPrice = async (itemVid: number): Promise<number | null> => {
    try {
      return await getItemPriceQ10LastUpdate(serverName, itemVid);
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (debouncedSearchQuery.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    let alive = true;
    setLoadingSuggestions(true);

    const fetchSuggestions = async () => {
      try {
        const res = await getItemSuggestions(debouncedSearchQuery, serverName);
        if (alive) setSuggestions(res);
      } catch {
        if (alive) setSuggestions([]);
      } finally {
        if (alive) setLoadingSuggestions(false);
      }
    };

    fetchSuggestions();
    return () => {
      alive = false;
    };
  }, [debouncedSearchQuery, serverName]);

  const addItem = async () => {
    const chosenItem = selectedItem;
    if (!chosenItem) return;

    setLoadingPrice(true);
    try {
      const unitPrice = await getItemPrice(chosenItem.vid);
      const newItem: CalculatorItem = {
        id: generateId(),
        name: chosenItem.label,
        quantity: 1,
        unitPrice,
        total: unitPrice == null ? null : unitPrice,
      };

      setItems((prev) => [...prev, newItem]);
      setSelectedItem(null);
      setSearchQuery("");
      setOpenDropdown(false);
    } finally {
      setLoadingPrice(false);
    }
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const clearItems = () => {
    setItems([]);
  };

  const updateQuantity = (id: string, newQuantity: number) => {
    if (newQuantity <= 0) return;

    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              quantity: newQuantity,
              total: item.unitPrice == null ? null : item.unitPrice * newQuantity,
            }
          : item
      )
    );
  };

  const grandTotal = useMemo(() => items.reduce((sum, item) => sum + (item.total ?? 0), 0), [items]);

  return (
    <Card className="max-w-xl w-full mx-auto bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in xl:h-full min-h-0 overflow-hidden flex flex-col">
      <CardHeader className="shrink-0 flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-[hsl(45,70%,56%)] text-lg md:text-xl font-semibold tracking-tight">
          Kalkulator cen przedmiotów
        </CardTitle>
        <HoverCard openDelay={200} closeDelay={150}>
          <HoverCardTrigger asChild>
            <Button variant="ghost" size="sm" title="Pomoc o kalkulatorze">
              <HelpCircle className="h-4 w-4" />
            </Button>
          </HoverCardTrigger>
          <HoverCardContent side="bottom" align="end" className="w-80 max-w-[85vw] border-[#141B24] bg-[#0B1119]/95 text-foreground">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pomoc</div>
            <div className="h-px bg-[#141B24] my-2" />
            <ul className="text-sm space-y-1 text-muted-foreground/90">
              <li>Wpisz lub wybierz nazwę przedmiotu, a następnie kliknij <b>Dodaj</b>.</li>
              <li>Ilość możesz edytować w kolumnie; wartości sumują się automatycznie.</li>
              <li>Format liczb: k/kk/kkk (tysiące/miliony/miliardy).</li>
              <li>Przycisk <b>Wyczyść</b> usuwa wszystkie pozycje.</li>
            </ul>
          </HoverCardContent>
        </HoverCard>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Scroll container — header is sticky, list scrolls below */}
        <div className="flex-1 min-h-0 h-full overflow-y-auto custom-scrollbar" style={{ WebkitOverflowScrolling: "touch" }}>
          {/* Sticky: Add Item + Heading */}
          <div className="sticky top-0 z-20 bg-[#0B1119]/95 backdrop-blur supports-[backdrop-filter]:backdrop-blur border-b border-[#141B24]">
            <div className="space-y-4 p-4">
              <h3 className="font-semibold text-slate-100">Dodaj przedmiot</h3>
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-9 relative">
                  <Input
                    type="text"
                    placeholder="Wpisz nazwę przedmiotu..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSelectedItem(null);
                      setOpenDropdown(true);
                    }}
                    onFocus={() => setOpenDropdown(true)}
                    onBlur={() => setTimeout(() => setOpenDropdown(false), BLUR_CLOSE_DELAY)}
                    aria-expanded={openDropdown}
                    className="h-11 bg-[#0B1119]/85 border-[#141B24] text-slate-200"
                  />
                  {openDropdown && searchQuery.length > 0 && (
                    <div
                      className="absolute left-0 right-0 mt-1 max-h-60 overflow-auto rounded-md border border-[#141B24] bg-[#0B1119]/95 backdrop-blur shadow-lg z-30"
                      role="listbox"
                    >
                      {loadingSuggestions && <div className="px-3 py-2 text-sm text-muted-foreground">Szukam…</div>}
                      {!loadingSuggestions && suggestions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Brak wyników</div>
                      )}
                      {!loadingSuggestions &&
                        suggestions.length > 0 &&
                        suggestions.slice(0, MAX_SUGGESTIONS).map((opt, i) => (
                          <button
                            type="button"
                            key={`${opt.vid}-${opt.label}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedItem(opt);
                              setSearchQuery(opt.label);
                              setOpenDropdown(false);
                            }}
                            role="option"
                            aria-selected={selectedItem?.vid === opt.vid}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-[#141B24] hover:text-slate-100"
                          >
                            {opt.label}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div className="md:col-span-2">
                  <Button onClick={addItem} disabled={!selectedItem || loadingPrice} className="h-10 w-full min-w-[105px] whitespace-nowrap text-sm px-3">
                    <Plus className="h-4 w-4 mr-1" />
                    {loadingPrice ? "Ładowanie..." : "Dodaj"}
                  </Button>
                </div>
              </div>
            </div>
            <div className="px-4 pb-4 flex items-center justify-between">
              <h3 className="font-semibold text-slate-100">Lista przedmiotów</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearItems}
                disabled={items.length === 0}
                className="text-slate-300 hover:text-red-400"
                title="Wyczyść listę"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Wyczyść
              </Button>
            </div>
          </div>

          <div className="px-4 pb-2 mt-3">
            {items.length > 0 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-[#0B1119]/60 border border-[#141B24]">
                      <div className="flex-1">
                        <p className="font-medium hover:text-[hsl(45_70%_60%)] transition-colors">{item.name}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) =>
                              updateQuantity(item.id, Math.max(1, parseInt(e.target.value, 10) || 1))
                            }
                            min={1}
                            className="h-9 w-20 text-center bg-[#0B1119]/85 border-[#141B24] text-slate-200 px-2"
                          />
                        </div>
                        <Badge variant="secondary" className="justify-center border border-[#141B24] bg-[#0B1119]/50 px-2">
                          {item.total == null ? (
                            <span className="text-sm text-muted-foreground">brak</span>
                          ) : (
                            <BadgePriceCanvas
                              value={item.total}
                              formatValue={(v) => formatCurrency(v, currencies)}
                              style={{
                                color: "#ffd166",
                                fontSize: 14,
                                padding: { x: 6, y: 4 },
                              }}
                            />
                          )}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => removeItem(item.id)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {items.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Calculator className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Dodaj przedmioty, aby rozpocząć kalkulację</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>

      {/* Grand total footer */}
      <div className="shrink-0 border-t border-[#141B24] bg-[#0B1119]/90 backdrop-blur supports-[backdrop-filter]:backdrop-blur px-4 py-3">
        <div className="flex justify-between items-center">
          <span className="text-lg font-semibold">Łączna wartość:</span>
          <Badge variant="secondary" className="text-lg px-4 py-2 bg-[#0B1119]/80 border border-[hsl(45_70%_60%)]">
            <BadgePriceCanvas
              value={grandTotal}
              formatValue={(v) => formatCurrency(v, currencies)}
              style={{
                color: "#ffd166",
                fontSize: 16,
                padding: { x: 8, y: 4 },
              }}
            />
          </Badge>
        </div>
      </div>
    </Card>
  );
}