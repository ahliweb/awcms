import { useState, useEffect, useCallback } from "react";

interface UseSearchOptions {
  minLength?: number;
  initialQuery?: string;
  debounceTime?: number;
}

interface UseSearchResult {
  query: string;
  setQuery: (query: string) => void;
  debouncedQuery: string;
  isValid: boolean;
  message: string;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  clearSearch: () => void;
  minLength: number;
}

export function useSearch({
  minLength = 5,
  initialQuery = "",
  debounceTime = 500,
}: UseSearchOptions = {}): UseSearchResult {
  const [query, setQuery] = useState<string>(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQuery);
  const [loading, setLoading] = useState<boolean>(false);

  // Determine if the query is valid for searching
  const isValid = query.length === 0 || query.length >= minLength;

  let message = "";
  if (!isValid) {
    const remaining = minLength - query.length;
    message = `Please enter ${remaining} more character${remaining > 1 ? "s" : ""} to search`;
  }

  // Debounce logic
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isValid) {
        setDebouncedQuery(query);
      }
    }, debounceTime);

    return () => clearTimeout(timer);
  }, [query, debounceTime, isValid]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
  }, []);

  return {
    query,
    setQuery,
    debouncedQuery,
    isValid,
    message,
    loading,
    setLoading,
    clearSearch,
    minLength,
  };
}
