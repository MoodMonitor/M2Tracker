import React, { useState, useEffect, useMemo } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebounce } from '@/hooks/useDebounce';
import { getItemSuggestions } from '@/services/apiService';
import type { ItemOption } from '@/types/api';

interface ItemComboboxProps {
  value: string;
  // Returns either a selected ItemOption or a raw string typed by the user
  onChange: (value: ItemOption | string) => void;
  initialSuggestions?: string[];
  serverName: string;
}

const MIN_SEARCH_LEN = 3;
const DEBOUNCE_MS = 400;

export function ItemCombobox({ value, onChange, initialSuggestions = [], serverName }: ItemComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [apiSuggestions, setApiSuggestions] = useState<ItemOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const debouncedSearchQuery = useDebounce(searchQuery, DEBOUNCE_MS);

  useEffect(() => {
    if (debouncedSearchQuery.length < MIN_SEARCH_LEN) {
      setApiSuggestions([]);
      return;
    }

    let alive = true;
    const fetchApiSuggestions = async () => {
      setIsLoading(true);
      try {
        const res = await getItemSuggestions(debouncedSearchQuery, serverName);
        if (alive) setApiSuggestions(res);
      } catch {
        if (alive) setApiSuggestions([]);
      } finally {
        if (alive) setIsLoading(false);
      }
    };

    fetchApiSuggestions();
    return () => {
      alive = false;
    };
  }, [debouncedSearchQuery, serverName]);

  const combinedSuggestions = useMemo(
    () => [
      ...initialSuggestions.map((s) => ({ label: s, value: s, vid: undefined })),
      ...apiSuggestions.filter((apiSugg) => !initialSuggestions.includes(apiSugg.label)),
    ],
    [initialSuggestions, apiSuggestions]
  );

  // Highlight when there are multiple initial suggestions — the user needs to pick one
  const needsAttention = initialSuggestions.length > 1;
  const displayValue = value || 'Wpisz nazwę...';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`w-full justify-between h-9 bg-[#0B1119]/85 border-[#141B24] hover:bg-[#141B24] ${
            needsAttention ? 'text-amber-400 border-amber-400/50' : ''
          }`}
        >
          <span className="truncate">{displayValue}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 border-[#141B24] bg-[#0B1119]/95">
        <Command>
          <CommandInput placeholder="Szukaj przedmiotu..." onValueChange={setSearchQuery} />
          <CommandList>
            {isLoading && <div className="p-2 text-sm text-center text-muted-foreground">Ładowanie...</div>}
            <CommandEmpty>Nie znaleziono przedmiotu.</CommandEmpty>
            <CommandGroup>
              {combinedSuggestions.map((suggestion) => (
                <CommandItem
                  key={suggestion.label}
                  value={suggestion.label}
                  onSelect={(currentValue) => {
                    const selectedSuggestion = combinedSuggestions.find(
                      (s) => s.label.toLowerCase() === currentValue.toLowerCase()
                    ) as ItemOption | undefined;
                    onChange(selectedSuggestion ?? currentValue);
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${value === suggestion.label ? 'opacity-100' : 'opacity-0'}`} />
                  {suggestion.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}