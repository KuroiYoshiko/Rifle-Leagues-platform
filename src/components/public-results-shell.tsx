import Link from "next/link";
import type { ReactNode } from "react";

export function PublicResultsShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/10 bg-hero-background text-white">
        <nav
          className="mx-auto flex h-20 max-w-[1440px] items-center gap-5 px-5 sm:px-8 lg:px-12"
          aria-label="Public results navigation"
        >
          <Link
            href="/"
            className="inline-flex items-baseline text-lg font-semibold tracking-[-0.035em]"
            aria-label="RifleLeagues home"
          >
            Rifle <span className="ml-1.5 font-medium text-brand">Leagues</span>
          </Link>
          <Link
            href="/organisations"
            className="ml-auto text-sm font-semibold text-white/72 transition hover:text-white"
          >
            Browse results
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-white/20 bg-white/[.07] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/14 sm:px-5"
          >
            Login
          </Link>
        </nav>
      </header>
      <main className="px-4 py-7 sm:px-7 sm:py-9 lg:px-10 lg:py-10 xl:px-12">
        <div className="mx-auto max-w-[1420px]">{children}</div>
      </main>
      <footer className="border-t border-border px-5 py-8 text-center text-xs text-muted-foreground">
        Public competition results from RifleLeagues
      </footer>
    </div>
  );
}
