"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  ApplicationSidebarBrand,
  ApplicationSidebarLink,
} from "@/components/application-sidebar-primitives";
import { SavedPublicResultsNavigation } from "@/components/saved-public-results";

function getPublicPageDetails(pathname: string) {
  const routeParts = pathname.split("/").filter(Boolean);

  if (pathname === "/organisations") {
    return { eyebrow: "Public results", title: "Browse results" };
  }

  if (routeParts[0] === "clubs" && routeParts[1]) {
    const titles: Record<string, string> = {
      competitions: "Competitions",
      information: "Information",
    };
    return {
      eyebrow: "Public club",
      title: titles[routeParts[2]] ?? "Overview",
    };
  }

  if (routeParts[0] === "organisations" && routeParts[1]) {
    if (routeParts.includes("competitions")) {
      return { eyebrow: "Public competition", title: "Competition results" };
    }
    if (routeParts.includes("seasons") || routeParts.includes("leagues")) {
      return { eyebrow: "Public organisation", title: "Seasons" };
    }
    const titles: Record<string, string> = {
      results: "Results",
      information: "Information",
      contact: "Contact",
    };
    return {
      eyebrow: "Public organisation",
      title: titles[routeParts[2]] ?? "Overview",
    };
  }

  return { eyebrow: "Public results", title: "Browse results" };
}

function PublicSidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="px-5 pt-6">
        <ApplicationSidebarBrand />
      </div>
      <nav
        className="sidebar-scrollbar mt-9 flex-1 overflow-y-auto px-3 pb-5"
        aria-label="Public results navigation"
      >
        <ApplicationSidebarLink
          href="/organisations"
          label="Browse results"
          mark="R"
          active={pathname === "/organisations"}
          onNavigate={onNavigate}
        />

        <SavedPublicResultsNavigation
          pathname={pathname}
          onNavigate={onNavigate}
        />

        <div className="mt-7 border-t border-white/10 pt-4">
          <Link
            href="/organisations#club-directory-heading"
            onClick={onNavigate}
            className="flex min-h-9 items-center rounded-lg px-3 text-xs font-semibold text-brand transition hover:bg-white/[.07] hover:text-white"
          >
            Browse clubs
            <span className="ml-auto" aria-hidden="true">→</span>
          </Link>
          <Link
            href="/organisations#organisation-directory-heading"
            onClick={onNavigate}
            className="flex min-h-9 items-center rounded-lg px-3 text-xs font-semibold text-brand transition hover:bg-white/[.07] hover:text-white"
          >
            Browse organisations
            <span className="ml-auto" aria-hidden="true">→</span>
          </Link>
        </div>
      </nav>
      <div className="m-3 space-y-2 border-t border-white/10 pt-4">
        <Link
          href="/login"
          onClick={onNavigate}
          className="flex min-h-10 items-center justify-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-white/72 transition hover:bg-white/[.07] hover:text-white"
        >
          Login
        </Link>
        <Link
          href="/register"
          onClick={onNavigate}
          className="flex min-h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-[var(--brand-deep)] transition hover:bg-brand-subtle"
        >
          Create account
        </Link>
      </div>
    </>
  );
}

export function PublicResultsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const details = getPublicPageDetails(pathname);

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-navigation text-white lg:flex">
        <PublicSidebarContent pathname={pathname} />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-hero-background/60 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative flex h-full w-[min(86vw,320px)] flex-col bg-navigation text-white shadow-2xl">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="absolute right-4 top-5 grid size-10 place-items-center rounded-full bg-white/10 text-lg"
              aria-label="Close navigation"
            >
              ×
            </button>
            <PublicSidebarContent
              pathname={pathname}
              onNavigate={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-screen min-w-0 flex-col lg:col-start-2">
        <header className="sticky top-0 z-20 border-b border-border bg-background/92 backdrop-blur-xl">
          <div className="flex h-[72px] items-center gap-4 px-4 sm:px-7 lg:h-20 lg:px-10 xl:px-12">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface lg:hidden"
              aria-label="Open navigation"
              aria-expanded={menuOpen}
            >
              <span className="flex w-4 flex-col gap-1">
                <span className="h-px w-full bg-brand-deep" />
                <span className="h-px w-full bg-brand-deep" />
                <span className="h-px w-full bg-brand-deep" />
              </span>
            </button>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {details.eyebrow}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold tracking-[-0.015em] text-foreground sm:text-base">
                {details.title}
              </p>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-7 sm:px-7 sm:py-9 lg:px-10 lg:py-10 xl:px-12">
          <div className="mx-auto max-w-[1420px]">{children}</div>
        </main>
        <footer className="border-t border-border px-5 py-8 text-center text-xs text-muted-foreground">
          Public competition results from RifleLeagues
        </footer>
      </div>
    </div>
  );
}
