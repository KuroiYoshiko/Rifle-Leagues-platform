"use client";

export function PrintResultsButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-4">
        <path d="M7 8V4h10v4M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7v-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Print results
    </button>
  );
}
