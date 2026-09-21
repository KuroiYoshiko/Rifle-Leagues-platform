"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { ShooterPerformanceChart } from "@/components/shooter-performance-chart";
import { Badge, Card } from "@/components/ui";
import {
  distanceOptionValue,
  equipmentOptionValue,
  positionOptionValue,
} from "@/lib/shooter-analytics-options";
import type {
  IfSeededTodayAnalysis,
  ShooterAnalytics,
  ShooterAnalyticsComponent,
  ShooterAnalyticsFilterSelection,
  ShooterAnalyticsPoint,
  ShooterAnalyticsTrendDirection,
} from "@/lib/shooter-analytics";

export type StatisticsView = "overview" | "performance" | "seasons" | "history";

const views: Array<{ id: StatisticsView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "seasons", label: "Seasons" },
  { id: "history", label: "Score history" },
];

const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const signedFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 2,
  signDisplay: "always",
});

function number(value: number) {
  return numberFormatter.format(value);
}

function percentage(value: number | null) {
  return value === null ? "—" : `${number(value)}%`;
}

function average(value: number | null) {
  return value === null ? "—" : number(value);
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function distance(component: ShooterAnalyticsComponent) {
  if (component.distance_mode === "fixed") {
    const unit = component.distance_unit === "metres"
      ? "m"
      : component.distance_unit === "yards" ? "yd" : "ft";
    return `${number(component.distance_value!)} ${unit}`;
  }
  if (component.distance_mode === "variable") return "Variable distance";
  if (component.distance_mode === "not_applicable") return "Distance N/A";
  return "Distance unspecified";
}

function physicalDetails(point: ShooterAnalyticsPoint) {
  return [...new Set(point.components.map((component) =>
    `${component.position_label} · ${distance(component)}`,
  ))].join("; ");
}

function trendPresentation(direction: ShooterAnalyticsTrendDirection) {
  return {
    up: { label: "Improving", tone: "positive" as const },
    steady: { label: "Steady", tone: "neutral" as const },
    down: { label: "Declining", tone: "warning" as const },
    unavailable: { label: "Not available", tone: "neutral" as const },
  }[direction];
}

function selectionParams(selection: ShooterAnalyticsFilterSelection) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(selection)) {
    if (value) params.set(key, value);
  }
  return params;
}

function statisticsHref(
  selection: ShooterAnalyticsFilterSelection,
  view: StatisticsView,
  page?: number,
) {
  const params = selectionParams(selection);
  if (view !== "overview") params.set("view", view);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/statistics?${query}` : "/statistics";
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card className="statistics-print-card min-w-0 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-foreground tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </Card>
  );
}

function FilterSelect({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-2 block text-xs font-semibold text-foreground">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground"
      >
        <option value="">All</option>
        {children}
      </select>
    </label>
  );
}

function Filters({
  analytics,
  selection,
  activeView,
}: {
  analytics: ShooterAnalytics;
  selection: ShooterAnalyticsFilterSelection;
  activeView: StatisticsView;
}) {
  const hasFilters = Object.values(selection).some(Boolean);

  return (
    <div data-screen-only>
      <Card className="p-5 sm:p-6">
        <form action="/statistics" method="get">
        {activeView !== "overview" ? <input type="hidden" name="view" value={activeView} /> : null}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Analysis scope</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Choose which released scores to include. The same filters apply throughout Statistics.
            </p>
          </div>
          {hasFilters ? (
            <Link
              href={statisticsHref({ season: "", equipment: "", position: "", distance: "" }, activeView)}
              className="text-xs font-semibold text-brand-strong hover:underline"
            >
              Clear filters
            </Link>
          ) : null}
        </div>
        <div className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FilterSelect label="Season" name="season" value={selection.season}>
            {analytics.filter_options.seasons.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Equipment" name="equipment" value={selection.equipment}>
            {analytics.filter_options.equipment.map((option) => {
              const value = equipmentOptionValue(option);
              return <option key={value} value={value}>{option.label}</option>;
            })}
          </FilterSelect>
          <FilterSelect label="Position / style" name="position" value={selection.position}>
            {analytics.filter_options.positions.map((option) => {
              const value = positionOptionValue(option);
              return <option key={value} value={value}>{option.label}</option>;
            })}
          </FilterSelect>
          <FilterSelect label="Distance" name="distance" value={selection.distance}>
            {analytics.filter_options.distances.map((option) => {
              const value = distanceOptionValue(option);
              return <option key={value} value={value}>{option.label}</option>;
            })}
          </FilterSelect>
        </div>
        <button
          type="submit"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep sm:w-auto"
        >
          Apply filters
        </button>
        </form>
      </Card>
    </div>
  );
}

function AnalysisNavigation({
  activeView,
  selection,
  onViewChange,
  allowLocalNavigation,
}: {
  activeView: StatisticsView;
  selection: ShooterAnalyticsFilterSelection;
  onViewChange: (view: StatisticsView) => void;
  allowLocalNavigation: boolean;
}) {
  return (
    <nav data-screen-only aria-label="Statistics analysis" className="mt-5 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface p-1 sm:flex sm:w-fit">
      {views.map((view) => {
        const active = view.id === activeView;
        const href = statisticsHref(selection, view.id);
        return (
          <Link
            key={view.id}
            href={href}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              if (
                !allowLocalNavigation
                || event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
              ) return;

              event.preventDefault();
              window.history.pushState(null, "", href);
              onViewChange(view.id);
            }}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-semibold transition sm:px-5 ${
              active
                ? "bg-primary text-primary-foreground!"
                : "text-neutral-strong hover:bg-surface-muted"
            }`}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <Card className="mt-6 p-8 text-center sm:p-12">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-brand-subtle font-semibold text-brand-deep" aria-hidden="true">
        %
      </span>
      <h2 className="mt-5 text-xl font-semibold text-foreground">
        {filtered ? "No scores match these filters" : "No released scores yet"}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {filtered
          ? "Try broader filters. Only complete, released scores are included."
          : "Your performance history will appear after a complete Competition Round result has passed its Round End."}
      </p>
    </Card>
  );
}

function Summary({ analytics }: { analytics: ShooterAnalytics }) {
  const summary = analytics.summary;
  const trend = trendPresentation(summary.trend_direction);
  const trendChange = summary.trend_change === null
    ? "Needs at least 2 scores"
    : `${signedFormatter.format(summary.trend_change)} percentage points`;

  return (
    <>
      <section aria-label="Performance summary" className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="Latest performance" value={percentage(summary.recent_score_percentage)} detail="Latest released Round End" />
        <SummaryCard label="Overall mean" value={percentage(summary.mean_score_percentage)} detail="Average across released scores" />
        <SummaryCard label="Best performance" value={percentage(summary.best_score_percentage)} detail="Best released performance" />
        <SummaryCard label="Released shoots" value={summary.physical_shoot_count} detail="Unique released shoots" />
        <SummaryCard label="Competitions" value={summary.competition_count} detail="Competitions with released scores" />
        <SummaryCard label="Overall trend" value={trend.label} detail={`Estimated change: ${trendChange}`} />
      </section>
      <Card className="statistics-print-trend mt-4 border-brand/20 bg-brand-subtle p-4 text-xs leading-5 text-brand-deep">
        <p className="font-semibold">Estimated change across selected history: {trendChange}</p>
        <p className="mt-1">
          Trend is estimated across all released scores in the selected range, not just the latest two.
        </p>
      </Card>
    </>
  );
}

function RecentForm({ scores }: { scores: ShooterAnalyticsPoint[] }) {
  if (scores.length === 0) return null;
  return (
    <Card className="statistics-print-card min-w-0 p-5 sm:p-6">
      <h2 className="font-semibold text-foreground">Recent scores</h2>
      <p className="mt-1 text-xs text-muted-foreground">Your latest released scores</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {scores.map((point) => (
          <div key={point.event_key} className="rounded-xl border border-border bg-surface-muted p-4">
            <p className="text-xs text-muted-foreground">{date(point.round_end_date)}</p>
            <p className="mt-2 text-2xl font-semibold text-foreground tabular-nums">{percentage(point.score_percentage)}</p>
            <p className="mt-1 line-clamp-2 text-xs font-semibold text-neutral-strong">{point.competition_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{point.round_label}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function IfSeededTodayCard({ analysis }: { analysis: IfSeededTodayAnalysis }) {
  return (
    <Card className="statistics-print-card min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-brand-strong">{analysis.organisation_name} · {analysis.season_name}</p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">{analysis.competition_name}</h3>
        </div>
        <Badge tone="neutral">For comparison only</Badge>
      </div>
      {analysis.unavailable_reason ? (
        <div className="mt-5 rounded-xl bg-surface-muted p-4">
          <p className="text-sm font-semibold text-foreground">Analysis unavailable</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{analysis.unavailable_reason}</p>
        </div>
      ) : (
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Published Division</dt>
            <dd className="mt-1 font-semibold text-foreground">{analysis.current_division_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Using current R/Av</dt>
            <dd className="mt-1 font-semibold text-brand-deep">{analysis.hypothetical_division_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Starting Average</dt>
            <dd className="mt-1 font-semibold text-foreground tabular-nums">{average(analysis.starting_average)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Current R/Av</dt>
            <dd className="mt-1 font-semibold text-foreground tabular-nums">{average(analysis.running_average)}</dd>
          </div>
        </dl>
      )}
      <p className="mt-5 text-xs leading-5 text-muted-foreground">
        This is a read-only comparison. It does not change your official Division or predict promotion or demotion.
      </p>
      <Link data-screen-only href={analysis.competition_path} className="mt-4 inline-flex text-xs font-semibold text-brand-strong hover:underline">
        View Competition
      </Link>
    </Card>
  );
}

function IfSeededToday({ analyses }: { analyses: IfSeededTodayAnalysis[] }) {
  if (analyses.length === 0) return null;
  return (
    <section className="mt-6" aria-labelledby="if-seeded-title">
      <h2 id="if-seeded-title" className="text-xl font-semibold text-foreground">Division comparison</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
        See where your current R/Av would place you if automatic Division seeding were run again today.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {analyses.map((analysis) => <IfSeededTodayCard key={analysis.competition_id} analysis={analysis} />)}
      </div>
    </section>
  );
}

function PerformanceAnalysis({ analytics }: { analytics: ShooterAnalytics }) {
  return (
    <>
      <Card className="mt-6 min-w-0 p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="performance-chart-title" className="font-semibold text-foreground">Overall performance over time</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Performance percentage by released score</p>
          </div>
          <Badge tone="brand">{analytics.chart_points.length} points</Badge>
        </div>
        <ShooterPerformanceChart points={analytics.chart_points} />
        {analytics.chart_truncated ? (
          <p className="mt-3 text-xs text-warning">Showing the latest 500 points; summary metrics include all matching history.</p>
        ) : null}
      </Card>

      <section className="mt-8" aria-labelledby="discipline-title">
        <h2 id="discipline-title" className="text-xl font-semibold text-foreground">Performance by discipline</h2>
        <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
          See how you perform across different equipment, positions and distances. Different Courses of Fire are kept separate.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {analytics.disciplines.map((discipline) => {
            const trend = trendPresentation(discipline.trend_direction);
            return (
              <Card key={discipline.discipline_key} className="statistics-print-card min-w-0 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground">{discipline.equipment_label} · {discipline.position_label} · {discipline.distance_label}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ex{number(discipline.course_maximum)}{discipline.shot_count === null ? "" : ` · ${discipline.shot_count} shots`}
                    </p>
                  </div>
                  <Badge tone={trend.tone}>{trend.label}</Badge>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Average</dt><dd className="mt-1 font-semibold text-foreground">{percentage(discipline.average_score_percentage)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Best</dt><dd className="mt-1 font-semibold text-foreground">{percentage(discipline.best_score_percentage)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Latest</dt><dd className="mt-1 font-semibold text-foreground">{percentage(discipline.latest_score_percentage)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Released shoots</dt><dd className="mt-1 font-semibold text-foreground">{discipline.physical_shoot_count}</dd></div>
                </dl>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}

function SeasonAnalysis({ analytics }: { analytics: ShooterAnalytics }) {
  return (
    <section className="mt-6" aria-labelledby="season-comparison-title">
      <Card className="p-5 sm:p-6">
        <h2 id="season-comparison-title" className="text-xl font-semibold text-foreground">Season comparison</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
          Compare your average performance across Seasons. Changes are measured against the previous Season shown. Use the filters above for like-for-like comparisons.
        </p>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {analytics.seasons.map((season) => (
          <Card key={`${season.organisation_id}:${season.season_id}`} className="statistics-print-card min-w-0 p-5">
            <p className="text-xs font-medium text-brand-strong">{season.organisation_name}</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">{season.season_name}</h3>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Average</dt><dd className="mt-1 font-semibold text-foreground">{percentage(season.average_score_percentage)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Best</dt><dd className="mt-1 font-semibold text-foreground">{percentage(season.best_score_percentage)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Latest</dt><dd className="mt-1 font-semibold text-foreground">{percentage(season.latest_score_percentage)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Released shoots</dt><dd className="mt-1 font-semibold text-foreground">{season.physical_shoot_count}</dd></div>
            </dl>
            <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
              Change from previous Season shown: <span className="font-semibold text-foreground">{season.change_from_previous === null ? "Not available" : `${signedFormatter.format(season.change_from_previous)} percentage points`}</span>
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function HistoryContext({ point }: { point: ShooterAnalyticsPoint }) {
  return (
    <>
      <p className="font-semibold text-foreground">{point.competition_name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{point.round_label} · {point.season_name} · {point.organisation_name}</p>
      {point.shared ? (
        <div className="mt-2 text-xs leading-5 text-muted-foreground">
          <Badge tone="brand">Shared across {point.contexts.length} Competitions</Badge>
          <p data-screen-only className="mt-2">{point.contexts.map((context) => `${context.competition} · ${context.round}`).join("; ")}</p>
        </div>
      ) : null}
    </>
  );
}

function ScoreHistory({
  analytics,
  selection,
}: {
  analytics: ShooterAnalytics;
  selection: ShooterAnalyticsFilterSelection;
}) {
  const history = analytics.history;
  return (
    <Card className="statistics-print-history mt-6 min-w-0 overflow-hidden">
      <div className="border-b border-border px-5 py-5 sm:px-6">
        <h2 className="font-semibold text-foreground">Score history</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          10 unique released shoots per page · {history.total_items} total
        </p>
      </div>

      <div data-statistics-history-cards className="divide-y divide-border md:hidden">
        {history.items.map((point) => (
          <article key={point.event_key} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs text-muted-foreground">Round End</p><p className="mt-1 text-sm font-semibold text-foreground">{date(point.round_end_date)}</p></div>
              <p className="text-xl font-semibold text-brand-deep">{percentage(point.score_percentage)}</p>
            </div>
            <div className="mt-4"><HistoryContext point={point} /></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-muted-foreground">Discipline</dt><dd className="mt-1 text-foreground">{point.equipment_label} · {physicalDetails(point)}</dd></div>
              <div><dt className="text-muted-foreground">Achieved</dt><dd className="mt-1 font-semibold text-foreground">{number(point.achieved_score)} / {number(point.maximum_possible_score)}{point.x_total === null ? "" : ` · ${point.x_total} X`}</dd></div>
            </dl>
          </article>
        ))}
      </div>

      <div data-statistics-history-table className="hidden md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-surface-muted text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-semibold">Round End</th>
              <th className="px-5 py-3 font-semibold">Competition context</th>
              <th className="px-5 py-3 font-semibold">Discipline</th>
              <th className="px-5 py-3 text-right font-semibold">Achieved</th>
              <th className="px-5 py-3 text-right font-semibold">Performance</th>
              <th className="px-5 py-3 text-right font-semibold">X</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {history.items.map((point) => (
              <tr key={point.event_key} className="align-top">
                <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{date(point.round_end_date)}</td>
                <td className="px-5 py-4"><HistoryContext point={point} /></td>
                <td className="max-w-64 px-5 py-4 text-xs leading-5 text-muted-foreground">{point.equipment_label} · {physicalDetails(point)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-right font-medium text-foreground">{number(point.achieved_score)} / {number(point.maximum_possible_score)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-brand-deep">{percentage(point.score_percentage)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-right text-muted-foreground">{point.x_total ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history.total_pages > 1 ? (
        <nav data-screen-only aria-label="Score history pagination" className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">Page {history.page} of {history.total_pages}</p>
          <div className="grid grid-cols-4 gap-2 sm:flex">
            {history.page > 1 ? (
              <Link href={statisticsHref(selection, "history", 1)} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface-muted">First</Link>
            ) : <span />}
            {history.page > 1 ? (
              <Link href={statisticsHref(selection, "history", history.page - 1)} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface-muted">Previous</Link>
            ) : <span />}
            {history.page < history.total_pages ? (
              <Link href={statisticsHref(selection, "history", history.page + 1)} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface-muted">Next</Link>
            ) : null}
            {history.page < history.total_pages ? (
              <Link href={statisticsHref(selection, "history", history.total_pages)} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface-muted">Last</Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </Card>
  );
}

export function ShooterAnalyticsDashboard({
  analytics,
  selection,
  activeView,
}: {
  analytics: ShooterAnalytics;
  selection: ShooterAnalyticsFilterSelection;
  activeView: StatisticsView;
}) {
  const [currentView, setCurrentView] = useState(activeView);

  useEffect(() => {
    const syncViewFromHistory = () => {
      const requestedView = new URLSearchParams(window.location.search).get("view");
      setCurrentView(
        views.some((view) => view.id === requestedView)
          ? requestedView as StatisticsView
          : "overview",
      );
    };

    window.addEventListener("popstate", syncViewFromHistory);
    return () => window.removeEventListener("popstate", syncViewFromHistory);
  }, []);

  const summary = analytics.summary;
  const filtered = Object.values(selection).some(Boolean);
  const selectedFilters = [
    selection.season
      ? `Season: ${analytics.filter_options.seasons.find((option) => String(option.id) === selection.season)?.label}`
      : null,
    selection.equipment
      ? `Equipment: ${analytics.filter_options.equipment.find((option) => equipmentOptionValue(option) === selection.equipment)?.label}`
      : null,
    selection.position
      ? `Position / style: ${analytics.filter_options.positions.find((option) => positionOptionValue(option) === selection.position)?.label}`
      : null,
    selection.distance
      ? `Distance: ${analytics.filter_options.distances.find((option) => distanceOptionValue(option) === selection.distance)?.label}`
      : null,
  ].filter((value): value is string => Boolean(value));
  const activeViewLabel = views.find((view) => view.id === currentView)?.label ?? "Overview";

  return (
    <div data-statistics-print-document className="min-w-0">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-brand-strong">My shooting</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">Statistics</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Track your released scores, performance trends and progress over time.
          </p>
        </div>
        <Badge tone="positive">Released scores only</Badge>
      </div>

      <div data-print-only className="hidden border-y border-border py-3 text-sm text-foreground">
        <p className="font-semibold">
          {currentView === "history"
            ? `Score history · Page ${analytics.history.page} of ${Math.max(analytics.history.total_pages, 1)}`
            : activeViewLabel}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Filters: {selectedFilters.length > 0 ? selectedFilters.join(" · ") : "All released results"}
        </p>
      </div>

      <Filters analytics={analytics} selection={selection} activeView={currentView} />
      <AnalysisNavigation
        activeView={currentView}
        selection={selection}
        onViewChange={setCurrentView}
        allowLocalNavigation={analytics.history.page === 1}
      />

      {analytics.component_scope === "filtered_components" && summary.physical_shoot_count > 0 ? (
        <div className="mt-5 rounded-xl border border-brand/20 bg-brand-subtle px-4 py-3 text-xs leading-5 text-brand-deep">
          Filtered view: the score and maximum shown use only the selected position and distance. A shared shoot is still counted once.
        </div>
      ) : null}

      {summary.physical_shoot_count === 0 ? <EmptyState filtered={filtered} /> : <Summary analytics={analytics} />}

      {currentView === "overview" ? (
        <>
          {summary.physical_shoot_count > 0 ? <div className="mt-6"><RecentForm scores={analytics.recent_scores} /></div> : null}
          <IfSeededToday analyses={analytics.if_seeded_today} />
        </>
      ) : currentView === "performance" && summary.physical_shoot_count > 0 ? (
        <PerformanceAnalysis analytics={analytics} />
      ) : currentView === "seasons" && summary.physical_shoot_count > 0 ? (
        <SeasonAnalysis analytics={analytics} />
      ) : currentView === "history" && summary.physical_shoot_count > 0 ? (
        <ScoreHistory analytics={analytics} selection={selection} />
      ) : null}
    </div>
  );
}
