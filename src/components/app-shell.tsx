"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

type NavigationItem = {
  label: string;
  href: string;
  mark: string;
  disabledReason?: string;
};

type AuthenticatedUser = {
  displayName: string;
  email: string;
  initials: string;
};

const sections: { label?: string; items: NavigationItem[] }[] = [
  {
    items: [
      { label: "Overview", href: "/dashboard", mark: "O" },
      { label: "Profile", href: "/profile", mark: "P" },
    ],
  },
  {
    label: "My shooting",
    items: [
      {
        label: "Competitions",
        href: "/dashboard#competitions",
        mark: "C",
        disabledReason: "Join a club to access competitions",
      },
      {
        label: "Results",
        href: "/dashboard#results",
        mark: "R",
        disabledReason: "Competition results are not available yet",
      },
      {
        label: "Statistics",
        href: "/dashboard#statistics",
        mark: "S",
        disabledReason: "Competition statistics are not available yet",
      },
    ],
  },
  {
    label: "My club",
    items: [
      {
        label: "Members",
        href: "/club#members",
        mark: "M",
        disabledReason: "Join a club to access members",
      },
      {
        label: "Entries",
        href: "/club#entries",
        mark: "E",
        disabledReason: "Join a club to access entries",
      },
      {
        label: "Scores",
        href: "/club#scores",
        mark: "S",
        disabledReason: "Join a club to access scores",
      },
    ],
  },
  {
    label: "Management",
    items: [
      {
        label: "League administration",
        href: "/club",
        mark: "L",
        disabledReason: "Club administration is not available yet",
      },
    ],
  },
  {
    items: [{ label: "Settings", href: "/dashboard#settings", mark: "S" }],
  },
];

const pageDetails: Record<string, { eyebrow: string; title: string }> = {
  "/dashboard": { eyebrow: "Shooter profile", title: "My dashboard" },
  "/profile": { eyebrow: "Account", title: "Your profile" },
  "/clubs": { eyebrow: "Membership", title: "Find a club" },
  "/club": { eyebrow: "Northbridge Rifle Club", title: "Club administration" },
};

function isNavigationItemActive(pathname: string, href: string) {
  if (href.includes("#")) return false;

  const itemPath = href.split("#")[0];
  return (
    pathname === itemPath ||
    (itemPath !== "/dashboard" && pathname.startsWith(`${itemPath}/`))
  );
}

function Brand() {
  return (
    <Link
      href="/"
      className="inline-flex items-baseline text-lg font-semibold tracking-[-0.035em] text-white"
      aria-label="RifleLeagues home"
    >
      Rifle <span className="ml-1.5 font-medium text-brand">Leagues</span>
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
              const isActive =
                !item.disabledReason &&
                isNavigationItemActive(pathname, item.href);

              if (item.disabledReason) {
                return (
                  <span
                    key={item.label}
                    aria-disabled="true"
                    title={item.disabledReason}
                    className="group flex min-h-10 cursor-not-allowed items-center gap-3 rounded-xl px-3 text-sm text-white/32"
                  >
                    <span
                      className="grid size-6 place-items-center rounded-md border border-white/[.08] text-[9px] font-semibold text-white/28"
                      aria-hidden="true"
                    >
                      {item.mark}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="text-[9px] font-medium text-white/25" aria-hidden="true">
                      Locked
                    </span>
                    <span className="sr-only">{item.disabledReason}</span>
                  </span>
                );
              }

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={`group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm transition ${
                    isActive
                      ? "bg-white text-[var(--brand-deep)] shadow-sm hover:bg-white hover:text-[var(--brand-deep)] focus-visible:bg-white focus-visible:text-[var(--brand-deep)]"
                      : "text-white/62 hover:bg-white/[.07] hover:text-white focus-visible:bg-white/[.1] focus-visible:text-white"
                  }`}
                >
                  <span
                    className={`grid size-6 place-items-center rounded-md border text-[9px] font-semibold ${
                      isActive
                        ? "border-border bg-brand-subtle text-[var(--brand-strong)] group-hover:border-brand/30 group-focus-visible:border-brand/40"
                        : "border-white/12 text-white/45 group-hover:border-white/20 group-focus-visible:border-white/25"
                    }`}
                    aria-hidden="true"
                  >
                    {item.mark}
                  </span>
                  <span className={isActive ? "text-[var(--brand-deep)]" : undefined}>
                    {item.label}
                  </span>
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
  user,
  onNavigate,
}: {
  pathname: string;
  user: AuthenticatedUser;
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
          <span className="grid size-9 place-items-center rounded-full bg-brand-subtle text-xs font-bold text-brand-deep">
            {user.initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">
              {user.displayName}
            </span>
            <span className="block truncate text-xs text-white/42">
              {user.email}
            </span>
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-white/55 transition hover:bg-white/10 hover:text-white"
            >
              Logout
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: AuthenticatedUser;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const details = pageDetails[pathname] ?? pageDetails["/dashboard"];

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-navigation text-white lg:flex">
        <SidebarContent pathname={pathname} user={user} />
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
            <SidebarContent
              pathname={pathname}
              user={user}
              onNavigate={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <div className="min-w-0 lg:col-start-2">
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
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                className="relative grid size-10 place-items-center rounded-xl border border-border bg-surface text-sm text-neutral-strong"
                aria-label="Notifications"
              >
                <span aria-hidden="true">•</span>
                <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-warning" />
              </button>
              <Link
                href="/"
                className="hidden rounded-xl border border-border bg-surface px-4 py-2.5 text-xs font-semibold text-neutral-strong sm:block"
              >
                Public site
              </Link>
              <span className="grid size-10 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground sm:hidden">
                {user.initials}
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
