"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ShooterAnalyticsPoint } from "@/lib/shooter-analytics";
import {
  buildPerformanceChartData,
  selectXAxisTicks,
  xAxisTickLimit,
} from "@/lib/shooter-chart-axis.mjs";

const SIX_MONTHS_IN_MILLISECONDS = 183 * 86_400_000;

function formatDate(value: string, compact = false) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", compact
    ? { day: "2-digit", month: "short", timeZone: "UTC" }
    : { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
  ).format(date);
}

function formatAxisDate(value: number, longRange: boolean) {
  return new Intl.DateTimeFormat("en-GB", longRange
    ? { month: "short", year: "2-digit", timeZone: "UTC" }
    : { day: "2-digit", month: "short", timeZone: "UTC" }
  ).format(new Date(value));
}

function score(value: number) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
}

function physicalDetails(point: ShooterAnalyticsPoint) {
  const details = point.components.map((component) => {
    const distance = component.distance_mode === "fixed"
      ? `${score(component.distance_value!)} ${component.distance_unit}`
      : component.distance_mode === "variable"
        ? "Variable distance"
        : component.distance_mode === "not_applicable"
          ? "Distance not applicable"
          : "Distance unspecified";
    return `${component.position_label}, ${distance}`;
  });
  return [...new Set(details)].join(" · ");
}

function PerformanceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ShooterAnalyticsPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="max-w-72 rounded-xl border border-border bg-surface p-4 shadow-xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-strong">
        Round end · {formatDate(point.round_end_date)}
      </p>
      <p className="mt-2 text-sm font-semibold text-foreground">
        {point.competition_name} · {point.round_label}
      </p>
      {point.shared ? (
        <div className="mt-2 text-xs leading-5 text-muted-foreground">
          <p>One physical score used by {point.contexts.length} Competitions:</p>
          <ul className="mt-1">
            {point.contexts.map((context) => (
              <li key={`${context.competition}:${context.round}`}>
                {context.competition} · {context.round}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-lg font-semibold text-foreground">
        {score(point.score_percentage)}%
      </p>
      <p className="text-xs text-muted-foreground">
        {score(point.achieved_score)} / {score(point.maximum_possible_score)} achieved
        {point.x_total !== null ? ` · ${point.x_total} X` : ""}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {point.equipment_label} · {physicalDetails(point)}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {point.season_name}{point.series_name ? ` · ${point.series_name}` : ""}
      </p>
    </div>
  );
}

export function ShooterPerformanceChart({ points }: { points: ShooterAnalyticsPoint[] }) {
  const [chartWidth, setChartWidth] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const chartData = useMemo(() => buildPerformanceChartData(points), [points]);
  const timestamps = chartData.map((point) => point.round_end_timestamp);
  const tickLimit = xAxisTickLimit(chartWidth, printing);
  const xAxisTicks = selectXAxisTicks(timestamps, tickLimit);
  const longRange = xAxisTicks.length > 1 &&
    xAxisTicks[xAxisTicks.length - 1] - xAxisTicks[0] >= SIX_MONTHS_IN_MILLISECONDS;
  const percentages = points.map((point) => point.score_percentage);
  const minimum = Math.min(...percentages);
  const maximum = Math.max(...percentages);
  const lower = Math.max(0, Math.floor(minimum - 2));
  const upper = Math.min(100, Math.ceil(maximum + 2));
  const domain: [number, number] = lower === upper
    ? [Math.max(0, lower - 1), Math.min(100, upper + 1)]
    : [lower, upper];

  useEffect(() => {
    const beforePrint = () => setPrinting(true);
    const afterPrint = () => setPrinting(false);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  return (
    <figure aria-labelledby="performance-chart-title" className="min-w-0">
      <div className="h-72 w-full sm:h-80 lg:h-96">
        <ResponsiveContainer
          width="100%"
          height="100%"
          onResize={(width) => setChartWidth(width)}
        >
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 12, right: 12, bottom: 8, left: 0 }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="4 5" vertical={false} />
            <XAxis
              dataKey="round_end_timestamp"
              type="number"
              scale="time"
              domain={chartData.length === 1
                ? [chartData[0].round_end_timestamp - 86_400_000, chartData[0].round_end_timestamp + 86_400_000]
                : ["dataMin", "dataMax"]}
              ticks={xAxisTicks}
              tickFormatter={(value) => formatAxisDate(Number(value), longRange)}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              domain={domain}
              tickFormatter={(value) => `${value}%`}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<PerformanceTooltip />} cursor={{ stroke: "var(--brand)", strokeDasharray: "4 4" }} />
            <Line
              type="monotone"
              dataKey="score_percentage"
              name="Score percentage"
              stroke="var(--brand-strong)"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "var(--surface)", stroke: "var(--brand-strong)", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: "var(--brand)", stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
        Dates are Competition Round ends, because the canonical model does not store an
        actual firing date. Results become available after the inclusive Round end.
      </figcaption>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-brand-strong">
          View chart as text
        </summary>
        <ol className="mt-3 space-y-2 pl-5">
          {points.map((point) => (
            <li key={point.event_key}>
              {formatDate(point.round_end_date)}: {score(point.score_percentage)}%, {point.competition_name} {point.round_label}, {score(point.achieved_score)} of {score(point.maximum_possible_score)}.
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}
