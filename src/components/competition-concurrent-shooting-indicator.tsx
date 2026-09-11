import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import type { CompetitionConcurrentShootingSummary } from "@/lib/concurrent-shooting";

export function CompetitionConcurrentShootingIndicator({
  organisationSlug,
  summary,
}: {
  organisationSlug: string;
  summary: CompetitionConcurrentShootingSummary;
}) {
  const statusLabel = summary.status[0].toUpperCase() + summary.status.slice(1);
  return <Card className="mt-8 border-brand/25 bg-brand-subtle/20 p-5 sm:p-6">
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-foreground">Concurrent Shooting</h2>
          <Badge tone={summary.status === "active" ? "positive" : summary.status === "draft" ? "warning" : "neutral"}>{statusLabel}</Badge>
        </div>
        <p className="mt-2 text-lg font-semibold text-brand-deep">{summary.group_name}</p>
        <p className="mt-2 text-sm text-muted-foreground">{summary.shared_round_count} shared Round{summary.shared_round_count === 1 ? "" : "s"} · {summary.season_name}</p>
        {summary.linked_competitions.length ? <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Linked Competitions</p>
          <ul className="mt-2 flex flex-wrap gap-2">{summary.linked_competitions.map((competition) => <li key={competition.competition_id} className="rounded-full border border-brand/20 bg-surface px-3 py-1.5 text-xs font-medium text-foreground">{competition.name}</li>)}</ul>
        </div> : null}
      </div>
      <Link href={`/organisations/${organisationSlug}/management/concurrent-shooting/${summary.group_id}`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle">View Concurrent Shooting</Link>
    </div>
  </Card>;
}
