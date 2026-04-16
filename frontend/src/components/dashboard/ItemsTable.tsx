import { useEffect, useRef, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, HelpCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { sanitizeInput, formatCurrency } from "@/lib/utils";
import { getBonusItemNameSuggestions, getBonusTypeSuggestions, searchBonusItems } from "@/services/apiService";
import { BonusItemSightingOut, BonusFilterRequest, ItemOption, type ServerCurrency } from "@/types/api";
import { TablePriceCanvas } from "@/components/ui/PriceCanvas";
import { useDebounce } from "@/hooks/useDebounce";

interface ItemsTableProps {
  serverId: string;
  serverName: string;
  currencies?: ServerCurrency[];
}

// Table item type (API shape with optional fallback date)
type TableItem = BonusItemSightingOut & {
  date?: string;
};

// Config constants
const DEBOUNCE_MS = 400;
const MIN_QUERY_LEN = 3;
const MIN_BONUS_QUERY_LEN = 2;
const SUGGESTION_LIMIT = 10;
const ITEMS_PER_PAGE = 15;

export function ItemsTable({ serverId: _serverId, serverName, currencies }: ItemsTableProps) {
  const [selectedItem, setSelectedItem] = useState<ItemOption | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortByInput, setSortByInput] = useState<"price" | "amount" | "date">("price");
  const [sortOrderInput, setSortOrderInput] = useState<"asc" | "desc">("desc");
  const [bonusName, setBonusName] = useState("");
  const [bonusValue, setBonusValue] = useState<string>("");
  const [bonusOp, setBonusOp] = useState<">" | ">=" | "=" | "<=" | "<">("=");

  const [pendingBonusFilters, setPendingBonusFilters] = useState<Array<{ name: string; value?: number; op?: ">" | ">=" | "=" | "<=" | "<" }>>([]);

  const [itemSuggestions, setItemSuggestions] = useState<ItemOption[]>([]);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [loadingItemSuggestions, setLoadingItemSuggestions] = useState(false);

  const [bonusTypeSuggestions, setBonusTypeSuggestions] = useState<string[]>([]);
  const [loadingBonusTypeSuggestions, setLoadingBonusTypeSuggestions] = useState(false);
  const [selectedBonusType, setSelectedBonusType] = useState<string | null>(null);
  const [bonusTypeCommitted, setBonusTypeCommitted] = useState(false);

  const bonusNameInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const suppressBonusSuggestOnceRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRequestIdRef = useRef(0);

  const [scrollbarPad, setScrollbarPad] = useState(0);

  const debouncedSearchTerm = useDebounce(searchTerm.trim(), DEBOUNCE_MS);
  const debouncedBonusName = useDebounce(bonusName.trim(), DEBOUNCE_MS);

  const [appliedCriteria, setAppliedCriteria] = useState<{ q: string; item_vid: number | null }>({ q: "", item_vid: null });
  const [appliedSortBy, setAppliedSortBy] = useState<"price" | "amount" | "date">("price");
  const [appliedSortOrder, setAppliedSortOrder] = useState<"asc" | "desc">("desc");
  const [appliedBonusFilters, setAppliedBonusFilters] = useState<Array<{ name: string; value?: number; op?: ">" | ">=" | "=" | "<=" | "<" }>>([]);

  const [items, setItems] = useState<TableItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Normalize currencies: sort descending by threshold
  const normalizedCurrencies = useMemo(
    () =>
      (currencies ?? [])
        .map((c) => ({
          name: c.name,
          symbol: c.symbol,
          threshold: typeof c.threshold === "string" ? Number(c.threshold) : c.threshold,
        }))
        .filter((c) => Number.isFinite(c.threshold) && c.threshold > 0)
        .sort((a, b) => b.threshold - a.threshold),
    [currencies]
  );

  // Item name suggestions (debounced)
  useEffect(() => {
    if (debouncedSearchTerm.length < MIN_QUERY_LEN) {
      setItemSuggestions([]);
      setLoadingItemSuggestions(false);
      return;
    }

    let alive = true;
    setLoadingItemSuggestions(true);

    const fetchSuggestions = async () => {
      try {
        const res = await getBonusItemNameSuggestions(serverName, debouncedSearchTerm, SUGGESTION_LIMIT);
        if (alive) {
          setItemSuggestions(res);
          // Open suggestions only when the search input is focused
          if (document.activeElement === searchInputRef.current) {
            setIsSuggestionsOpen(true);
          }
        }
      } catch {
        if (alive) setItemSuggestions([]);
      } finally {
        if (alive) setLoadingItemSuggestions(false);
      }
    };

    fetchSuggestions();
    return () => {
      alive = false;
    };
  }, [debouncedSearchTerm, serverName]);

  // Bonus type suggestions (debounced)
  useEffect(() => {
    if (suppressBonusSuggestOnceRef.current) {
      // Skip one fetch cycle after committing a selection to prevent flicker
      suppressBonusSuggestOnceRef.current = false;
      setLoadingBonusTypeSuggestions(false);
      return;
    }

    if (debouncedBonusName.length < MIN_BONUS_QUERY_LEN) {
      setBonusTypeSuggestions([]);
      setLoadingBonusTypeSuggestions(false);
      return;
    }

    let alive = true;
    setLoadingBonusTypeSuggestions(true);

    const fetchBonusTypeSuggestions = async () => {
      try {
        const res = await getBonusTypeSuggestions(serverName, debouncedBonusName, SUGGESTION_LIMIT);
        if (alive) setBonusTypeSuggestions(res);
      } catch {
        if (alive) setBonusTypeSuggestions([]);
      } finally {
        if (alive) setLoadingBonusTypeSuggestions(false);
      }
    };

    fetchBonusTypeSuggestions();
    return () => {
      alive = false;
    };
  }, [debouncedBonusName, serverName, suppressBonusSuggestOnceRef]);

  // Keep selectedBonusType in sync when input matches a suggestion
  useEffect(() => {
    const q = bonusName.trim();
    if (!q) {
      setSelectedBonusType(null);
      return;
    }
    if (selectedBonusType && selectedBonusType.toLowerCase() === q.toLowerCase()) {
      return;
    }
    const match = bonusTypeSuggestions.find((s) => s.toLowerCase() === q.toLowerCase());
    setSelectedBonusType(match ?? null);
  }, [bonusName, bonusTypeSuggestions, selectedBonusType]);

  const filteredItems = items;

  // Keep header columns aligned with scrollable body by reserving scrollbar width
  useEffect(() => {
    const calc = () => {
      const el = scrollRef.current;
      if (!el) return;
      const sw = el.offsetWidth - el.clientWidth;
      setScrollbarPad(sw > 0 ? sw : 0);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [items, loading]);

  // Close suggestions when clicking outside the search container
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSuggestionsOpen(false);
      }
    };

    if (isSuggestionsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSuggestionsOpen]);

  const applyFilters = async () => {
    const newCriteria = { q: searchTerm.trim(), item_vid: selectedItem?.vid ?? null };
    const newSortBy = sortByInput;
    const newSortOrder = sortOrderInput;
    const newBonusFilters = pendingBonusFilters;

    setAppliedCriteria(newCriteria);
    setAppliedSortBy(newSortBy);
    setAppliedSortOrder(newSortOrder);
    setAppliedBonusFilters(newBonusFilters);
    setIsSuggestionsOpen(false);
    setCurrentPage(1);

    // Pass values directly to avoid reading stale state
    await performSearch(1, newCriteria, newSortBy, newSortOrder, newBonusFilters);
  };

  const performSearch = async (
    page: number = currentPage,
    searchCriteria?: { q: string; item_vid: number | null },
    sortBy?: "price" | "amount" | "date",
    sortOrder?: "asc" | "desc",
    bonusFilters?: Array<{ name: string; value?: number; op?: ">" | ">=" | "=" | "<=" | "<" }>
  ) => {
    const requestId = ++searchRequestIdRef.current;
    setLoading(true);
    try {
      const currentCriteria = searchCriteria || appliedCriteria;
      const currentSortBy = sortBy || appliedSortBy;
      const currentSortOrder = sortOrder || appliedSortOrder;
      const currentBonusFilters = bonusFilters || appliedBonusFilters;

      const opMap: Record<string, string> = { ">": "gt", ">=": "gte", "=": "eq", "<=": "lte", "<": "lt" };

      const filters: BonusFilterRequest[] = currentBonusFilters
        .filter((f) => Number.isFinite(f.value) && f.name)
        .map((f) => ({
          name: f.name,
          op: f.op ? opMap[f.op] || "gte" : "gte",
          value: f.value!,
        }));

      const request = {
        server_name: serverName,
        q: currentCriteria.q || undefined,
        item_vid: currentCriteria.item_vid,
        filters: filters.length > 0 ? filters : undefined,
        sort_by: currentSortBy === "date" ? "last_seen" : currentSortBy,
        sort_dir: currentSortOrder,
        window_days: 14,
        limit: ITEMS_PER_PAGE,
        offset: (page - 1) * ITEMS_PER_PAGE,
      };

      const response = await searchBonusItems(request);
      if (requestId !== searchRequestIdRef.current) return;
      setItems(response.results);
      setTotalCount(response.count);
      setHasMore(response.has_more);
    } catch {
      if (requestId !== searchRequestIdRef.current) return;
      setItems([]);
      setTotalCount(0);
      setHasMore(false);
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const handlePageChange = async (page: number) => {
    setCurrentPage(page);
    await performSearch(page);
  };

  // Reusable pagination controls
  const PaginationControls = () => {
    return (
      <div className="flex items-center justify-between my-3 px-3 py-2 bg-[#0B1119]/80 rounded-md shadow-sm">
        <div className="text-sm text-muted-foreground">Strona {Math.max(1, currentPage)} ({items.length} wyników)</div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1 || loading}
            className="bg-[#0B1119]/85 border-[#141B24] text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" />
            Poprzednia
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={!hasMore || loading}
            className="bg-[#0B1119]/85 border-[#141B24] text-slate-200"
          >
            Następna
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const addBonusFilter = () => {
    const nameKey = (selectedBonusType ?? "").trim();
    if (!nameKey) return;
    const name = nameKey;
    const valueRaw = bonusValue.trim();
    const value = valueRaw === "" ? undefined : Number(valueRaw);
    if (valueRaw !== "" && !Number.isFinite(value)) return;
    if (!name && typeof value !== "number") return;
    setPendingBonusFilters([...pendingBonusFilters, { name, value, op: value === undefined ? undefined : bonusOp }]);
    setBonusName("");
    setSelectedBonusType(null);
    setBonusValue("");
    setBonusOp("=");
    setBonusTypeCommitted(false);
  };

  const removeBonusFilter = (idx: number) => {
    setPendingBonusFilters(pendingBonusFilters.filter((_, i) => i !== idx));
  };

  const tableContent = (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        {/* Row 1: search with limited width */}
        <div ref={searchContainerRef} className="relative w-full max-w-[875px] md:max-w-[875px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Wyszukaj przedmiot z bonusem..."
            value={searchTerm}
            ref={searchInputRef}
            onFocus={() => setIsSuggestionsOpen(true)}
            onChange={(e) => {
              const newSearchTerm = sanitizeInput(e.target.value, 200, false);
              setSearchTerm(newSearchTerm);
              if (selectedItem && newSearchTerm !== selectedItem.label) {
                setSelectedItem(null);
              }
              setIsSuggestionsOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsSuggestionsOpen(false);
                e.currentTarget.blur();
              }
            }}
            aria-expanded={isSuggestionsOpen}
            className="pl-8 h-10 bg-[#0B1119]/85 border-[#141B24] text-slate-200 w-full"
          />
          {isSuggestionsOpen && (loadingItemSuggestions || itemSuggestions.length > 0) && (
            <div
              className="absolute z-20 mt-1 w-full rounded-md border border-[#141B24] bg-[#0B1119]/95 shadow-lg max-h-60 overflow-auto"
              role="listbox"
            >
              {loadingItemSuggestions && <div className="px-3 py-2 text-xs text-muted-foreground">Ładowanie...</div>}
              {!loadingItemSuggestions && itemSuggestions.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Brak sugestii</div>
              )}
              {!loadingItemSuggestions &&
                itemSuggestions.map((opt) => (
                  <button
                    key={`${opt.vid}-${opt.label}`}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-[#141B24]/60 text-sm"
                    onMouseDown={(e) => e.preventDefault()} // prevent blur before click registers
                    onClick={() => {
                      setSelectedItem(opt);
                      setSearchTerm(opt.label);
                      setIsSuggestionsOpen(false);
                    }}
                    role="option"
                    aria-selected={selectedItem?.vid === opt.vid}
                  >
                    {opt.label}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Row 2: bonus filter group */}
        <div className="space-y-2">
          <div className="text-xs text-slate-400">Filtruj bonusy</div>
          <div className="flex flex-wrap items-stretch gap-2">
            <div className="relative w-full sm:max-w-[420px] md:max-w-[520px]">
              <Input
                placeholder="Nazwa bonusa"
                value={bonusName}
                onChange={(e) => {
                  setBonusName(sanitizeInput(e.target.value, 120, false));
                  setBonusTypeCommitted(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setBonusTypeSuggestions([]);
                }}
                onBlur={() => {
                  setTimeout(() => setBonusTypeSuggestions([]), 120);
                }}
                className="h-10 bg-[#0B1119]/85 border-[#141B24] text-slate-200 w-full"
                ref={bonusNameInputRef}
                aria-expanded={bonusTypeSuggestions.length > 0 || loadingBonusTypeSuggestions}
              />
              {(loadingBonusTypeSuggestions || bonusTypeSuggestions.length > 0) && (
                <div className="absolute z-20 mt-1 w-full rounded-md border border-[#141B24] bg-[#0B1119]/95 shadow-lg max-h-60 overflow-auto" role="listbox">
                  {loadingBonusTypeSuggestions && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Ładowanie...</div>
                  )}
                  {!loadingBonusTypeSuggestions && bonusTypeSuggestions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Brak sugestii</div>
                  )}
                  {!loadingBonusTypeSuggestions &&
                    bonusTypeSuggestions.map((s, idx) => (
                      <button
                        key={`${s}-${idx}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-[#141B24]/60 text-sm"
                        onMouseDown={(e) => {
                          // Prevent blur so we can commit the selection first
                          e.preventDefault();
                          suppressBonusSuggestOnceRef.current = true;
                          setBonusName(s);
                          setSelectedBonusType(s);
                          setBonusTypeCommitted(true);
                          setBonusTypeSuggestions([]);
                          bonusNameInputRef.current?.blur();
                        }}
                        role="option"
                        aria-selected={selectedBonusType === s}
                      >
                        {s}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <Select value={bonusOp} onValueChange={(v: any) => setBonusOp(v)}>
              <SelectTrigger className="h-10 w-[96px] bg-[#0B1119]/85 border-[#141B24] text-slate-200">
                <SelectValue placeholder=">=" />
              </SelectTrigger>
              <SelectContent className="bg-[#0B1119]/95 border-[#141B24]">
                <SelectItem value=">">&gt;</SelectItem>
                <SelectItem value=">=">&gt;=</SelectItem>
                <SelectItem value="=">=</SelectItem>
                <SelectItem value="<=">&lt;=</SelectItem>
                <SelectItem value="<">&lt;</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Wartość"
              type="number"
              value={bonusValue}
              onChange={(e) => setBonusValue(e.target.value)}
              className="h-10 w-[120px] bg-[#0B1119]/85 border-[#141B24] text-slate-200"
            />
            <Button onClick={addBonusFilter} disabled={!bonusTypeCommitted || bonusValue.trim() === ""} className="h-10 whitespace-nowrap">
              Dodaj bonus
            </Button>
          </div>
        </div>

        {/* Row 3: badges */}
        {pendingBonusFilters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingBonusFilters.map((f, idx) => (
              <Badge key={`${f.name ?? ""}|${f.op ?? ""}|${f.value ?? ""}|${idx}`} variant="secondary" className="border border-[#141B24] bg-[#0B1119]/50">
                {f.name || "(dowolny)"}{typeof f.value === "number" ? `: ${f.op ?? "="} ${f.value}` : ""}
                <button className="ml-2 text-red-400 hover:text-red-300" onClick={() => removeBonusFilter(idx)}>
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Row 4: sorting section */}
        <div className="space-y-2">
          <div className="text-xs text-slate-400">Sortowanie</div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Select value={sortByInput} onValueChange={(v: any) => setSortByInput(v)}>
                <SelectTrigger className="h-10 w-[160px] bg-[#0B1119]/85 border-[#141B24] text-slate-200">
                  <SelectValue placeholder="Sortuj" />
                </SelectTrigger>
                <SelectContent className="bg-[#0B1119]/95 border-[#141B24]">
                  <SelectItem value="price">Cena</SelectItem>
                  <SelectItem value="amount">Ilość wystąpień</SelectItem>
                  <SelectItem value="date">Data</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortOrderInput} onValueChange={(v: any) => setSortOrderInput(v)}>
                <SelectTrigger className="h-10 w-[150px] bg-[#0B1119]/85 border-[#141B24] text-slate-200">
                  <SelectValue placeholder="Kierunek" />
                </SelectTrigger>
                <SelectContent className="bg-[#0B1119]/95 border-[#141B24]">
                  <SelectItem value="desc">Malejąco</SelectItem>
                  <SelectItem value="asc">Rosnąco</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={applyFilters} disabled={loading} className="h-10">
                {loading ? "Szukanie..." : "Szukaj"}
              </Button>
              <Button
                variant="ghost"
                className="h-10 text-slate-300"
                onClick={() => {
                  searchRequestIdRef.current += 1;
                  setPendingBonusFilters([]);
                  setAppliedBonusFilters([]);
                  setBonusName("");
                  setBonusValue("");
                  setSearchTerm("");
                  setSelectedItem(null);
                  setAppliedCriteria({ q: "", item_vid: null });
                  setAppliedSortBy("price");
                  setAppliedSortOrder("desc");
                  setSortByInput("price");
                  setSortOrderInput("desc");
                  setItems([]);
                  setTotalCount(0);
                  setHasMore(false);
                  setIsSuggestionsOpen(false);
                  setItemSuggestions([]);
                  setLoading(false);
                  setCurrentPage(1);
                }}
              >
                Wyczyść
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[#141B24] bg-[#0B1119]/60 overflow-hidden">
        {/* Fixed header */}
        <div style={{ paddingRight: scrollbarPad }}>
          <Table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: "40%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <TableHeader>
              <TableRow className="divide-x divide-[#141B24]">
                <TableHead className="bg-[#0B1119]/95 border-b border-[#141B24] text-center">Nazwa przedmiotu</TableHead>
                <TableHead className="bg-[#0B1119]/95 border-b border-[#141B24] text-center">Cena</TableHead>
                <TableHead className="bg-[#0B1119]/95 border-b border-[#141B24] text-center">Bonusy</TableHead>
                <TableHead className="bg-[#0B1119]/95 border-b border-[#141B24] text-center">Ilość wystąpień</TableHead>
                <TableHead className="bg-[#0B1119]/95 border-b border-[#141B24] text-center">Ostatnio widziany</TableHead>
              </TableRow>
            </TableHeader>
          </Table>
        </div>

        {/* Scrollable body */}
        <div ref={scrollRef} className="overflow-y-auto max-h-[440px] min-h-[440px] custom-scrollbar" style={{ scrollbarGutter: "stable" }}>
          <Table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: "40%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "15%" }} />
            </colgroup>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Ładowanie...
                  </TableCell>
                </TableRow>
              ) : filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Brak wyników. Spróbuj zmienić kryteria wyszukiwania.
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map((item, rowIdx) => (
                  <TableRow
                    key={`${item.sighting_id ?? `${item.item_name}|${(item as any).last_seen ?? (item as any).date ?? ""}|${item.price}|${item.item_count}`}|i:${rowIdx}`}
                    className="hover:bg-[#141B24]/50 transition-colors divide-x divide-[#141B24]"
                  >
                    <TableCell className="font-medium whitespace-normal break-words text-center align-middle">{item.item_name}</TableCell>
                    <TableCell className="text-center align-middle">
                      <TablePriceCanvas value={item.price} formatValue={(v) => formatCurrency(v, normalizedCurrencies)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 items-start">
                        {item.bonuses.map((bonus, index) => (
                          <Badge key={`${bonus.name}|${bonus.value}|${index}`} variant="secondary" className="w-fit text-xs border border-[#141B24] bg-[#0B1119]/50">
                            {bonus.name}: {bonus.value}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-center align-middle">
                      <Badge variant="secondary" className="border border-[#141B24] bg-[#0B1119]/50 min-w-[2.5rem] justify-center">
                        {item.item_count}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-center align-middle">
                      {(() => {
                        const d = (item as any).last_seen || (item as any).date;
                        return d ? new Date(d).toLocaleDateString("pl-PL") : "N/A";
                      })()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Bottom Pagination */}
        <div className="mt-4 border-t border-[#141B24] pt-3">
          <PaginationControls />
        </div>
      </div>
    </div>
  );

  return (
    <Card className="bg-[#0B1119]/60 border border-[#141B24] backdrop-blur-sm animate-fade-in transition-colors overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between border-b border-[#141B24]">
        <CardTitle className="text-[hsl(45_70%_60%)]">Tabela z przedmiotami</CardTitle>
        <div className="flex items-center gap-1">
          <HoverCard openDelay={200} closeDelay={150}>
            <HoverCardTrigger asChild>
              <Button variant="ghost" size="sm" title="Pomoc o tabeli">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </HoverCardTrigger>
            <HoverCardContent side="bottom" align="end" className="w-80 max-w-[85vw] border-[#141B24] bg-[#0B1119]/95 text-foreground">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pomoc</div>
              <div className="h-px bg-[#141B24] my-2" />
              <ul className="text-sm space-y-1 text-muted-foreground/90">
                <li>
                  <b>Wyszukiwanie przedmiotów</b>: możesz wpisać <i>dowolną frazę</i> — nie musisz wybierać z podpowiedzi. Podpowiedzi pojawiają się po wpisaniu min. 3
                  znaków; klawisz <b>Esc</b> zamyka listę.
                </li>
                <li>
                  <b>Bonusy</b>: wybierz <i>nazwę bonusa z listy</i> (wymagane), dobierz znak <b>=, &gt;, &lt;, &gt;=, &lt;=</b> i wartość, a następnie kliknij <b>Dodaj
                    bonus</b>. Możesz dodać kilka filtrów bonusów.
                </li>
                <li>
                  <b>Sortowanie</b>: ustaw pole i kierunek w sekcji <i>Sortowanie</i>, aby zmienić kolejność wyników.
                </li>
                <li>
                  <b>Uruchomienie wyszukiwania</b>: po ustawieniu wszystkiego kliknij <b>Szukaj</b>. Przycisk <b>Wyczyść </b> resetuje kryteria.
                </li>
                <li>
                  <b>Wskazówka</b>: możesz łączyć wyszukiwanie tekstowe z wieloma filtrami bonusów; wyniki są stronicowane poniżej.
                </li>
              </ul>
            </HoverCardContent>
          </HoverCard>
        </div>
      </CardHeader>
      <CardContent className="pt-4">{tableContent}</CardContent>
    </Card>
  );
}