import Link from "next/link";

export function ApplicationSidebarBrand() {
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

export function ApplicationSidebarLink({
  href,
  label,
  mark,
  active = false,
  onNavigate,
}: {
  href: string;
  label: string;
  mark: string;
  active?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm transition ${
        active
          ? "bg-white text-[var(--brand-deep)] shadow-sm hover:bg-white hover:text-[var(--brand-deep)] focus-visible:bg-white focus-visible:text-[var(--brand-deep)]"
          : "text-white/62 hover:bg-white/[.07] hover:text-white focus-visible:bg-white/[.1] focus-visible:text-white"
      }`}
    >
      <span
        className={`grid size-6 place-items-center rounded-md border text-[9px] font-semibold ${
          active
            ? "border-border bg-brand-subtle text-[var(--brand-strong)] group-hover:border-brand/30 group-focus-visible:border-brand/40"
            : "border-white/12 text-white/45 group-hover:border-white/20 group-focus-visible:border-white/25"
        }`}
        aria-hidden="true"
      >
        {mark}
      </span>
      <span className={active ? "text-[var(--brand-deep)]" : undefined}>
        {label}
      </span>
    </Link>
  );
}
