import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[#dfe5df] bg-white shadow-[0_1px_2px_rgba(18,39,27,.025)] ${className}`}
    >
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
        <h2 className="text-lg font-semibold tracking-[-0.025em] text-[#17231d]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm text-[#77827b]">{description}</p>
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
    neutral: "bg-[#eef1ed] text-[#617068]",
    positive: "bg-[#e9f7ec] text-[#267244]",
    warning: "bg-[#fff3dc] text-[#9b5c0b]",
    brand: "bg-[#e5ff72] text-[#173e2c]",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}
    >
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
    <Card
      className={`relative overflow-hidden p-5 sm:p-6 ${accent ? "bg-[#174f36] text-white" : ""}`}
    >
      {accent ? (
        <span className="absolute -right-8 -top-8 size-28 rounded-full border-[20px] border-white/[.055]" />
      ) : null}
      <p
        className={`relative text-xs font-medium ${accent ? "text-white/58" : "text-[#748078]"}`}
      >
        {label}
      </p>
      <p className="relative mt-3 text-3xl font-semibold tracking-[-0.045em] tabular-nums">
        {value}
      </p>
      <div
        className={`relative mt-3 text-xs ${accent ? "text-white/68" : "text-[#77827b]"}`}
      >
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
      className={`h-1.5 overflow-hidden rounded-full ${light ? "bg-white/15" : "bg-[#e7ebe7]"}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${light ? "bg-[#e5ff72]" : "bg-[#174f36]"}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
