
import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for managing search state with validation and debouncing
 * @param {Object} options
 * @param {number} options.minLength - Minimum characters required for search (default: 5)
 * @param {string} options.context - Context of search (admin/public)
 * @param {string} options.initialQuery - Initial search term
 * @param {number} options.debounceTime - Debounce delay in ms
 */
export function useSearch({ 
    minLength = 5, 
    _context = 'public', 
    initialQuery = '',
    debounceTime = 500 
} = {}) {
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);

  // Determine if the query is valid for searching
  // Empty query is valid (means "show all")
  // Query >= minLength is valid
  // Query between 0 and minLength is INVALID
  const isValid = query.length === 0 || query.length >= minLength;

  let message = '';
  if (!isValid) {
      const remaining = minLength - query.length;
      message = `Please enter ${remaining} more character${remaining > 1 ? 's' : ''} to search`;
  }

  // Debounce logic
  useEffect(() => {
    const timer = setTimeout(() => {
      // Only update debounced query if it's valid or empty
      // This prevents triggering fetches for invalid intermediate states
      if (isValid) {
          setDebouncedQuery(query);
      }
    }, debounceTime);

    return () => clearTimeout(timer);
  }, [query, debounceTime, isValid]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
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
    minLength
  };
}
