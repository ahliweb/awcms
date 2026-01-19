import React from "react";

interface MinCharSearchProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  loading?: boolean;
  isValid: boolean;
  message: string;
  minLength: number;
  placeholder?: string;
  className?: string;
}

export default function MinCharSearch({
  value,
  onChange,
  onClear,
  loading = false,
  isValid,
  message,
  minLength,
  placeholder = "Search...",
  className = "",
}: MinCharSearchProps) {
  return (
    <div className={`relative w-full ${className}`}>
      {/* Search Icon */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </div>

      {/* Input Field */}
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={`${placeholder} (${minLength}+ chars)`}
        className={`flex h-10 w-full rounded-md border bg-white dark:bg-slate-950 px-3 py-2 text-sm ring-offset-2 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 pl-9 pr-24 transition-colors
          ${
            !isValid && value.length > 0
              ? "border-red-500 focus-visible:ring-red-500/30"
              : "border-slate-200 dark:border-slate-800 focus-visible:ring-blue-500/30"
          }`}
      />

      {/* Right Actions: Loading, Clear, Counter */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
        {loading && (
          <span className="animate-spin text-gray-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
            </svg>
          </span>
        )}

        {value.length > 0 && (
          <button
            onClick={onClear}
            className="text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            type="button"
            aria-label="Clear search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18"></path>
              <path d="m6 6 12 12"></path>
            </svg>
          </button>
        )}

        {/* Character Counter */}
        <span
          className={`text-xs font-mono font-medium ${
            value.length > 0 && !isValid ? "text-red-500" : "text-gray-400"
          }`}
        >
          {value.length}/{minLength}
        </span>
      </div>

      {/* Validation Message */}
      {!isValid && value.length > 0 && (
        <div className="absolute top-full left-0 mt-1 text-xs text-red-500 font-medium animate-in fade-in slide-in-from-top-1 px-1">
          {message}
        </div>
      )}
    </div>
  );
}
