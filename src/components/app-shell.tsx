"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

type NavigationItem = {
  label: string;
  href: string;
  mark: string;
};

const sections: { label?: string; items: NavigationItem[] }[] = [
  {
    items: [{ label: "Overview", href: "/dashboard", mark: "O" }],
  },
  {
    label: "My shooting",
    items: [
      { label: "Competitions", href: "/dashboard#competitions", mark: "C" },
      { label: "Results", href: "/dashboard#results", mark: "R" },
      { label: "Statistics", href: "/dashboard#statistics", mark: "S" },
    ],
  },
  {
    label: "My club",
    items: [
      { label: "Members", href: "/club#members", mark: "M" },
      { label: "Entries", href: "/club#entries", mark: "E" },
      { label: "Scores", href: "/club#scores", mark: "S" },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "League administration", href: "/club", mark: "L" },
    ],
  },
  {
    items: [{ label: "Settings", href: "/dashboard#settings", mark: "S" }],
  },
];

const pageDetails: Record<string, { eyebrow: string; title: string }> = {
  "/dashboard": { eyebrow: "Shooter profile", title: "My dashboard" },
  "/club": { eyebrow: "Northbridge Rifle Club", title: "Club administration" },
};

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 font-semibold tracking-[-0.025em]"
      aria-label="RifleLeagues home"
    >
      <span className="grid size-9 place-items-center rounded-full border border-white/15 bg-white/[.08]">
        <span className="size-2.5 rounded-full bg-[#e5ff72] shadow-[0_0_0_5px_rgba(229,255,114,.12)]" />
      </span>
      <span className="text-[17px]">RifleLeagues</span>
    </Link>
  );
}

function Navigation({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="mt-9 flex-1 overflow-y-auto px-3 pb-5" aria-label="Application navigation">
      {sections.map((section, sectionIndex) => (
        <div
          key={section.label ?? sectionIndex}
          className={sectionIndex === 0 ? "" : "mt-7"}
        >
          {section.label ? (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-white/35">
              {section.label}
            </p>
          ) : null}
          <div className="space-y-1">
            {section.items.map((item) => {
              const itemPath = item.href.split("#")[0];
              const isActive =
                pathname === itemPath &&
                ((pathname === "/dashboard" && item.label === "Overview") ||
                  (pathname === "/club" &&
                    item.label === "League administration"));

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={onNavigate}
                  className={`group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm transition ${isActive ? "bg-white text-[#173e2c] shadow-sm" : "text-white/62 hover:bg-white/[.07] hover:text-white"}`}
                >
                  <span
                    className={`grid size-6 place-items-center rounded-md border text-[9px] font-semibold ${isActive ? "border-[#dfe5df] bg-[#f2f5f1] text-[#174f36]" : "border-white/12 text-white/45 group-hover:border-white/20"}`}
                    aria-hidden="true"
                  >
                    {item.mark}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="px-5 pt-6">
        <Brand />
      </div>
      <Navigation pathname={pathname} onNavigate={onNavigate} />
      <div className="m-3 border-t border-white/10 pt-4">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-[#e5ff72] text-xs font-bold text-[#173e2c]">
            MB
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">
              Maya Bennett
            </span>
            <span className="block truncate text-xs text-white/42">
              Northbridge RC
            </span>
          </span>
          <span className="text-white/40" aria-hidden="true">•••</span>
        </div>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const details = pageDetails[pathname] ?? pageDetails["/dashboard"];

  return (
    <div className="min-h-screen bg-[#f4f6f2] lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-[#123e2b] text-white lg:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[#0d2117]/55 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="relative flex h-full w-[min(86vw,320px)] flex-col bg-[#123e2b] text-white shadow-2xl">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="absolute right-4 top-5 grid size-10 place-items-center rounded-full bg-white/10 text-lg"
              aria-label="Close navigation"
            >
              ×
            </button>
            <SidebarContent pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="min-w-0 lg:col-start-2">
        <header className="sticky top-0 z-20 border-b border-[#dfe5df] bg-[#f4f6f2]/92 backdrop-blur-xl">
          <div className="flex h-[72px] items-center gap-4 px-4 sm:px-7 lg:h-20 lg:px-10 xl:px-12">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-[#d7ded8] bg-white lg:hidden"
              aria-label="Open navigation"
              aria-expanded={menuOpen}
            >
              <span className="flex w-4 flex-col gap-1">
                <span className="h-px w-full bg-[#173e2c]" />
                <span className="h-px w-full bg-[#173e2c]" />
                <span className="h-px w-full bg-[#173e2c]" />
              </span>
            </button>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-[#7b877f]">
                {details.eyebrow}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold tracking-[-0.015em] text-[#17231d] sm:text-base">
                {details.title}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                className="relative grid size-10 place-items-center rounded-xl border border-[#d7ded8] bg-white text-sm text-[#617068]"
                aria-label="Notifications"
              >
                <span aria-hidden="true">•</span>
                <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-[#d7802d]" />
              </button>
              <Link
                href="/"
                className="hidden rounded-xl border border-[#d7ded8] bg-white px-4 py-2.5 text-xs font-semibold text-[#536159] sm:block"
              >
                Public site
              </Link>
              <span className="grid size-10 place-items-center rounded-full bg-[#174f36] text-[11px] font-bold text-white sm:hidden">
                MB
              </span>
            </div>
          </div>
        </header>
        <main className="px-4 py-7 sm:px-7 sm:py-9 lg:px-10 lg:py-10 xl:px-12">
          <div className="mx-auto max-w-[1420px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
