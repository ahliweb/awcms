import { useState, useEffect } from "react";
import { createClientFromEnv } from "~/lib/supabase";
import { searchContent, type SearchResult } from "~/lib/search";
import { getPublicTenantId } from "~/lib/publicTenant";

interface SearchClientProps {
  locale: string;
  labels: {
    title: string;
    subtitle: string;
    placeholder: string;
    button: string;
    noResults: string;
    readMore: string;
  };
}

export default function SearchClient({ locale, labels }: SearchClientProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const tenantId = getPublicTenantId();
  const supabase = createClientFromEnv(import.meta.env);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) {
      setQuery(q);
      handleSearch(q);
    }
  }, []);

  const handleSearch = async (q: string) => {
    if (!q.trim() || !supabase) return;

    setLoading(true);
    setHasSearched(true);

    try {
      const res = await searchContent(supabase, q, tenantId, {
        types: ["page", "blog"],
        limit: 20,
        locale,
      });
      setResults(res);
    } catch (e) {
      console.error("Search error:", e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    // Update URL without refreshing
    const url = new URL(window.location.href);
    url.searchParams.set("q", query);
    window.history.pushState({}, "", url);
    handleSearch(query);
  };

  return (
    <section className="px-4 py-16 sm:px-6 mx-auto lg:px-8 lg:py-20 max-w-4xl">
      <div className="mb-8 md:mx-auto text-center max-w-3xl">
        <h1 className="text-4xl md:text-5xl font-bold leading-tighter tracking-tighter mb-4 font-heading text-gray-900 dark:text-gray-200">
          {labels.title}
        </h1>
        <p className="max-w-3xl mx-auto sm:text-center text-xl text-muted dark:text-slate-400">
          {query ? `${labels.subtitle} "${query}"` : labels.subtitle}
        </p>
      </div>

      <div className="max-w-2xl mx-auto mb-12">
        <form
          onSubmit={(event) => onSubmit(event.nativeEvent)}
          className="flex gap-2"
        >
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <svg
                className="w-5 h-5 text-gray-500 dark:text-gray-400"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                ></path>
              </svg>
            </div>
            <input
              type="text"
              name="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full pl-10 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
              placeholder={labels.placeholder}
              required
              minLength={2}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center py-2.5 px-4 text-sm font-medium text-white bg-blue-700 rounded-lg border border-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800 disabled:opacity-50"
          >
            {loading ? "..." : labels.button}
          </button>
        </form>
      </div>

      <div className="space-y-8 max-w-3xl mx-auto">
        {hasSearched && results.length === 0 && !loading && (
          <div className="text-center p-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <p className="text-gray-600 dark:text-gray-400">
              {labels.noResults.replace("{q}", query)}
            </p>
          </div>
        )}

        {results.map((result) => (
          <article
            key={result.id}
            className="p-6 bg-white rounded-lg border border-gray-200 shadow-md dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-xs font-medium mr-2 px-2.5 py-0.5 rounded ${
                  result.type === "page"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                    : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300"
                }`}
              >
                {result.type.toUpperCase()}
              </span>
            </div>
            <h2 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              <a href={result.url} className="hover:underline">
                {result.title}
              </a>
            </h2>
            {result.excerpt && (
              <p className="mb-3 font-normal text-gray-700 dark:text-gray-400 line-clamp-2">
                {result.excerpt}
              </p>
            )}
            <a
              href={result.url}
              className="inline-flex items-center text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {labels.readMore}
              <svg
                className="ml-1 w-4 h-4"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
