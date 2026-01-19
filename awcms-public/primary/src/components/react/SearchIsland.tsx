import React, { useEffect } from "react";
import MinCharSearch from "./MinCharSearch";
import { useSearch } from "../../hooks/useSearch";

interface SearchIslandProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
  minLength?: number;
  className?: string;
  initialQuery?: string;
}

/**
 * SearchIsland
 * A self-contained search component for Astro pages.
 * Handles search state, validation, and debouncing internally.
 * triggers onSearch callback only with valid, debounced queries.
 */
export default function SearchIsland({
  onSearch,
  placeholder = "Search...",
  minLength = 5,
  className = "",
  initialQuery = "",
}: SearchIslandProps) {
  const {
    query,
    setQuery,
    debouncedQuery,
    isValid,
    message,
    loading,
    clearSearch,
    minLength: actualMinLength,
  } = useSearch({
    minLength,
    initialQuery,
  });

  // Trigger onSearch callback when debouncedQuery changes
  useEffect(() => {
    if (onSearch) {
      onSearch(debouncedQuery);
    }
  }, [debouncedQuery, onSearch]);

  return (
    <MinCharSearch
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onClear={clearSearch}
      loading={loading}
      isValid={isValid}
      message={message}
      minLength={actualMinLength}
      placeholder={placeholder}
      className={className}
    />
  );
}
