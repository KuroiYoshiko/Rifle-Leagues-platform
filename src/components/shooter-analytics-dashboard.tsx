import Link from "next/link";
import { ShooterPerformanceChart } from "@/components/shooter-performance-chart";
import { Badge, Card } from "@/components/ui";
import {
  distanceOptionValue,
  equipmentOptionValue,
  positionOptionValue,
  type ShooterAnalytics,
  type ShooterAnalyticsComponent,
  type ShooterAnalyticsFilterSelection,
  type ShooterAnalyticsPoint,
  type ShooterAnalyticsTrendDirection,
} from "@/lib/shooter-analytics";

function number(value: number) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
}

function percentage(value: number | null) {
  return value === null ? "—" : `${number(value)}%`;
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

function trendLabel(direction: ShooterAnalyticsTrendDirection, change: number | null) {
  if (direction === "unavailable") return "Needs 2 scores";
  if (direction === "steady") return "Steady";
  const amount = change === null ? "" : ` ${number(Math.abs(change))} pts`;
  return direction === "up" ? `Up${amount}` : `Down${amount}`;
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
    <Card className="min-w-0 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 truncate text-2xl font-semibold tracking-[-0.04em] text-foreground">
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
}: {
  analytics: ShooterAnalytics;
  selection: ShooterAnalyticsFilterSelection;
}) {
  const hasFilters = Object.values(selection).some(Boolean);

  return (
    <Card className="p-5 sm:p-6">
      <form action="/statistics" method="get">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Filters</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Position and distance filters analyse matching components only.
            </p>
          </div>
          {hasFilters ? (
            <Link href="/statistics" className="text-xs font-semibold text-brand-strong hover:underline">
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
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep"
        >
          Apply filters
        </button>
      </form>
    </Card>
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
          ? "Try a broader Season or physical shooting filter. Only complete, released Results are included."
          : "Your performance history will appear after a complete Competition Round result has passed its Round end."}
      </p>
      {filtered ? (
        <Link href="/statistics" className="mt-5 inline-flex text-sm font-semibold text-brand-strong hover:underline">
          Clear filters
        </Link>
      ) : null}
    </Card>
  );
}

function RecentScores({ scores }: { scores: ShooterAnalyticsPoint[] }) {
  return (
    <Card className="mt-6 min-w-0 overflow-hidden">
      <div className="border-b border-border px-5 py-5 sm:px-6">
        <h2 className="font-semibold text-foreground">Recent score history</h2>
        <p className="mt-1 text-xs text-muted-foreground">Latest 20 released physical scores</p>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left text-sm">
          <thead className="bg-surface-muted text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-semibold">Round end</th>
              <th className="px-5 py-3 font-semibold">Competition / Round</th>
              <th className="px-5 py-3 font-semibold">Equipment</th>
              <th className="px-5 py-3 font-semibold">Physical details</th>
              <th className="px-5 py-3 text-right font-semibold">Achieved</th>
              <th className="px-5 py-3 text-right font-semibold">Score %</th>
              <th className="px-5 py-3 text-right font-semibold">X</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {scores.map((point) => (
              <tr key={point.event_key} className="align-top">
                <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{date(point.round_end_date)}</td>
                <td className="px-5 py-4">
                  <p className="font-semibold text-foreground">{point.competition_name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {point.round_label} · {point.season_name}
                  </p>
                  {point.shared ? (
                    <span className="mt-2 block text-xs text-muted-foreground">
                      <Badge tone="brand">Shared across {point.contexts.length} Competitions</Badge>
                      <span className="mt-2 block leading-5">
                        {point.contexts.map((context) => `${context.competition} · ${context.round}`).join("; ")}
                      </span>
                    </span>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-foreground">{point.equipment_label}</td>
                <td className="max-w-80 px-5 py-4 text-xs leading-5 text-muted-foreground">{physicalDetails(point)}</td>
                <td className="whitespace-nowrap px-5 py-4 text-right font-medium text-foreground">
                  {number(point.achieved_score)} / {number(point.maximum_possible_score)}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-brand-deep">
                  {percentage(point.score_percentage)}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-right text-muted-foreground">
                  {point.x_total ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function ShooterAnalyticsDashboard({
  analytics,
  selection,
}: {
  analytics: ShooterAnalytics;
  selection: ShooterAnalyticsFilterSelection;
}) {
  const summary = analytics.summary;
  const filtered = Object.values(selection).some(Boolean);

  return (
    <div className="min-w-0">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-brand-strong">My shooting</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
            Performance analytics
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Complete released physical scores, normalized across compatible Courses of Fire.
          </p>
        </div>
        <Badge tone="positive">Released Results only</Badge>
      </div>

      <Filters analytics={analytics} selection={selection} />

      {summary.physical_shoot_count === 0 ? (
        <EmptyState filtered={filtered} />
      ) : (
        <>
          {analytics.component_scope === "filtered_components" ? (
            <div className="mt-5 rounded-xl border border-brand/20 bg-brand-subtle px-4 py-3 text-xs leading-5 text-brand-deep">
              Component view: achieved score and maximum include only components matching the selected position and distance. Each physical score still appears once.
            </div>
          ) : null}

          <section aria-label="Performance summary" className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <SummaryCard label="Physical scores" value={summary.physical_shoot_count} detail="Canonical score sources" />
            <SummaryCard label="Competitions" value={summary.competition_count} detail="Separate released usages" />
            <SummaryCard label="Best score" value={percentage(summary.best_score_percentage)} detail="Highest normalized result" />
            <SummaryCard label="Recent score" value={percentage(summary.recent_score_percentage)} detail="Latest Round end" />
            <SummaryCard label="Mean score %" value={percentage(summary.mean_score_percentage)} detail="Mean of physical scores" />
            <SummaryCard label="Trend" value={trendLabel(summary.trend_direction, summary.trend_change)} detail="Linear direction over time" />
          </section>

          <Card className="mt-6 min-w-0 p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="performance-chart-title" className="font-semibold text-foreground">Performance over time</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Score percentage by released physical scoring event</p>
              </div>
              <Badge tone="brand">{analytics.chart_points.length} points</Badge>
            </div>
            <ShooterPerformanceChart points={analytics.chart_points} />
            {analytics.chart_truncated ? (
              <p className="mt-3 text-xs text-warning">Showing the latest 500 points; summary metrics include all matching history.</p>
            ) : null}
          </Card>

          <RecentScores scores={analytics.recent_scores} />
        </>
      )}
    </div>
  );
}
