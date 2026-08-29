import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(22rem,.8fr)_1.2fr]">
      <section className="relative hidden overflow-hidden bg-hero-background p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="target-grid absolute inset-0 opacity-50" />
        <div className="target-mark absolute -bottom-40 -right-44 aspect-square w-[42rem] rounded-full opacity-40" />
        <Link
          href="/"
          className="relative inline-flex items-baseline text-xl font-semibold tracking-[-0.035em]"
          aria-label="RifleLeagues home"
        >
          Rifle <span className="ml-1.5 font-medium text-brand">Leagues</span>
        </Link>
        <div className="relative max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            Every round matters
          </p>
          <p className="mt-5 text-4xl font-semibold leading-tight tracking-[-0.05em] xl:text-5xl">
            Your season, scores, and club in one focused place.
          </p>
          <p className="mt-5 max-w-sm leading-7 text-white/60">
            Sign in to continue to the RifleLeagues application.
          </p>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="mb-10 inline-flex items-baseline text-lg font-semibold tracking-[-0.035em] text-brand-deep lg:hidden"
            aria-label="RifleLeagues home"
          >
            Rifle <span className="ml-1.5 font-medium text-brand-strong">Leagues</span>
          </Link>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-strong">
            {eyebrow}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 leading-7 text-muted-foreground">{description}</p>
          <div className="mt-8 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-7">
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}
