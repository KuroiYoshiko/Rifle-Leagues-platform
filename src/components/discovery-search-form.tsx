"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  DISCOVERY_SEARCH_DEBOUNCE_MS,
  normaliseDiscoverySearchTerm,
} from "@/lib/discovery-search";

export function DiscoverySearchForm({
  inputId,
  label,
  placeholder,
  initialQuery,
  hint,
}: {
  inputId: string;
  label: string;
  placeholder: string;
  initialQuery: string;
  hint: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestedQuery = useRef(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  const replaceQuery = useCallback(
    (nextQuery: string) => {
      const normalisedQuery = normaliseDiscoverySearchTerm(nextQuery);

      if (normalisedQuery === lastRequestedQuery.current) return;

      const params = new URLSearchParams();
      if (normalisedQuery) params.set("q", normalisedQuery);

      lastRequestedQuery.current = normalisedQuery;
      const queryString = params.toString();

      startTransition(() => {
        router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router],
  );

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setQuery(initialQuery);
      lastRequestedQuery.current = initialQuery;
    }
  }, [initialQuery]);

  useEffect(() => {
    const normalisedQuery = normaliseDiscoverySearchTerm(query);

    if (normalisedQuery === lastRequestedQuery.current) return;

    timeoutRef.current = setTimeout(() => {
      replaceQuery(normalisedQuery);
    }, DISCOVERY_SEARCH_DEBOUNCE_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query, replaceQuery]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    replaceQuery(query);
  }

  function clearSearch() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setQuery("");
    replaceQuery("");
    inputRef.current?.focus();
  }

  return (
    <form action={pathname} method="get" role="search" onSubmit={submitSearch}>
      <label htmlFor={inputId} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={100}
          autoComplete="off"
          placeholder={placeholder}
          aria-describedby={`${inputId}-status`}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-brand focus:ring-4 focus:ring-brand/10"
        />
        <button
          type="submit"
          className="min-h-12 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep"
        >
          Search
        </button>
        {query || initialQuery ? (
          <button
            type="button"
            onClick={clearSearch}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div
        id={`${inputId}-status`}
        className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs leading-5 text-muted-foreground"
      >
        <span>{hint}</span>
        <span aria-live="polite" aria-atomic="true">
          {isPending ? "Updating results…" : ""}
        </span>
      </div>
    </form>
  );
}
