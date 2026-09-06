import Link from "next/link";
import { Badge, SectionHeader, TargetContextCard } from "@/components/ui";
import type {
  ClubOperationalStatus,
  ClubOperationalSummary,
} from "@/lib/club-operational-summaries";
import {
  clubOperationalStatusLabels,
  formatClubCutoffDate,
  formatClubCutoffDistance,
  getClubScoreManagementPath,
} from "@/lib/club-operational-summary-presentation";

const badgeTones: Record<
  ClubOperationalStatus,
  "neutral" | "positive" | "warning" | "danger"
> = {
  all_on_track: "positive",
  action_needed: "warning",
  deadline_passed: "danger",
  no_active_scoring: "neutral",
};

function StatusBadge({ status }: { status: ClubOperationalStatus }) {
  return (
    <Badge tone={badgeTones[status]}>
      {clubOperationalStatusLabels[status]}
    </Badge>
  );
}

function CompetitionContext({ summary }: { summary: ClubOperationalSummary }) {
  if (!summary.competition_name || !summary.round_number) return null;

  return (
    <p className="mt-1 text-sm font-semibold text-foreground">
      {summary.competition_name} · R{summary.round_number}
    </p>
  );
}

function CompletionLine({ summary }: { summary: ClubOperationalSummary }) {
  if (summary.incomplete_participant_count) {
    const count = summary.incomplete_participant_count;
    return (
      <p className="mt-2 text-xs font-medium text-neutral-strong">
        {count} {count === 1 ? "participant" : "participants"} incomplete
      </p>
    );
  }

  if (summary.participant_count) {
    return (
      <p className="mt-2 text-xs font-medium text-success">
        All {summary.participant_count} participants complete
      </p>
    );
  }

  return null;
}

function DeadlineLine({ summary }: { summary: ClubOperationalSummary }) {
  if (!summary.local_cutoff || summary.days_until_cutoff === null) return null;

  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {formatClubCutoffDate(summary.local_cutoff)} ·{" "}
      {formatClubCutoffDistance(summary.days_until_cutoff)}
    </p>
  );
}

export function ClubOperationalSummaryCard({
  summary,
}: {
  summary: ClubOperationalSummary;
}) {
  const managementPath = getClubScoreManagementPath(summary);
  const needsAttention =
    summary.attention_status === "action_needed" ||
    summary.attention_status === "deadline_passed";

  return (
    <section aria-labelledby="club-operations-heading">
      <SectionHeader
        title="Club operations"
        description="Local score completeness and the next relevant Club cutoff"
      />
      <TargetContextCard className="p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
              Scoring overview
            </p>
            <h2
              id="club-operations-heading"
              className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl"
            >
              {summary.club_name}
            </h2>
          </div>
          <StatusBadge status={summary.attention_status} />
        </div>

        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[.07] px-4 py-4 backdrop-blur-sm">
            <dt className="text-xs font-medium text-white/55">Active members</dt>
            <dd className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums text-white">
              {summary.active_member_count}
            </dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[.07] px-4 py-4 backdrop-blur-sm">
            <dt className="text-xs font-medium text-white/55">
              {needsAttention ? "Outstanding scores" : "Active competitions"}
            </dt>
            <dd className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums text-white">
              {needsAttention
                ? summary.outstanding_score_count
                : summary.active_competition_count}
            </dd>
          </div>
        </dl>

        <div className="mt-3 rounded-2xl bg-white p-5 text-foreground shadow-sm sm:p-6">
          <p className="text-xs font-medium text-brand-strong">
            {summary.attention_status === "deadline_passed"
              ? "Scores overdue"
              : summary.attention_status === "action_needed"
                ? "Scores required"
                : summary.attention_status === "all_on_track"
                  ? "Next score deadline"
                  : "Scoring status"}
          </p>
          {summary.attention_status === "no_active_scoring" ? (
            <p className="mt-2 text-base font-semibold text-foreground">
              No actionable Club-scored Competition work
            </p>
          ) : (
            <>
              <CompetitionContext summary={summary} />
              <DeadlineLine summary={summary} />
              <CompletionLine summary={summary} />
            </>
          )}
          {needsAttention && managementPath ? (
            <Link
              href={managementPath}
              className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
            >
              Manage scores <span className="ml-2" aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </TargetContextCard>
    </section>
  );
}
