import { useEffect, useState } from 'react';

/** Debounces a value — delays updating until input stops changing for `delay` ms. */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

/** Debounces a callback function rather than a value. */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const [debouncedCallback, setDebouncedCallback] = useState<T>(() => callback);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedCallback(() => callback), delay);
    return () => clearTimeout(handler);
  }, [callback, delay]);

  return debouncedCallback;
}

/**
 * Debounces a value with an optional immediate-first-call mode.
 * When `immediate` is true, the first call resolves instantly; subsequent ones are debounced.
 */
export function useAdvancedDebounce<T>(value: T, delay: number, immediate: boolean = false): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const [isFirstCall, setIsFirstCall] = useState<boolean>(true);

  useEffect(() => {
    if (immediate && isFirstCall) {
      setDebouncedValue(value);
      setIsFirstCall(false);
      return;
    }
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay, immediate, isFirstCall]);

  // Reset first-call flag when value is cleared (e.g. search input reset)
  useEffect(() => {
    if (!value) setIsFirstCall(true);
  }, [value]);

  return debouncedValue;
}
