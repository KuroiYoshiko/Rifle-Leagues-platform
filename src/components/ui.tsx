import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-surface shadow-xs ${className}`}>
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.025em] text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "brand";
}) {
  const tones = {
    neutral: "bg-surface-muted text-neutral-strong",
    positive: "bg-success-subtle text-success",
    warning: "bg-warning-subtle text-warning",
    brand: "bg-brand-subtle text-brand-deep",
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  supporting,
  accent,
}: {
  label: string;
  value: string;
  supporting: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className={`relative overflow-hidden p-5 sm:p-6 ${accent ? "bg-primary text-primary-foreground" : ""}`}>
      {accent ? (
        <span className="absolute -right-8 -top-8 size-28 rounded-full border-[20px] border-white/[.055]" />
      ) : null}
      <p className={`relative text-xs font-medium ${accent ? "text-white/60" : "text-muted-foreground"}`}>
        {label}
      </p>
      <p className="relative mt-3 text-3xl font-semibold tracking-[-0.045em] tabular-nums">
        {value}
      </p>
      <div className={`relative mt-3 text-xs ${accent ? "text-white/70" : "text-muted-foreground"}`}>
        {supporting}
      </div>
    </Card>
  );
}

export function ProgressBar({
  value,
  light = false,
}: {
  value: number;
  light?: boolean;
}) {
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full ${light ? "bg-white/15" : "bg-surface-muted"}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${light ? "bg-brand" : "bg-primary"}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
