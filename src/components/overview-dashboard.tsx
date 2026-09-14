import Link from "next/link";
import {
  DashboardClubCards,
  type DashboardClubMembership,
} from "@/components/dashboard-club-cards";
import { Badge, Card, SectionHeader } from "@/components/ui";
import type { ClubOperationalSummary } from "@/lib/club-operational-summaries";
import {
  formatClubCutoffDate,
  formatClubCutoffDistance,
  getClubScoreManagementPath,
} from "@/lib/club-operational-summary-presentation";
import { formatLeagueSeasonDate } from "@/lib/league-seasons";
import {
  getMyShootingRoundStatus,
  getNextRelevantRound,
  type MyShootingCompetition,
  type MyShootingCompetitionTab,
} from "@/lib/my-shooting-competitions";
import type { ShooterAnalytics } from "@/lib/shooter-analytics";

export type OverviewCompetitionGroups = Record<
  MyShootingCompetitionTab,
  MyShootingCompetition[]
>;

const percentageFormatter = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function competitionPath(participation: MyShootingCompetition) {
  return `/organisations/${participation.organisation.slug}/leagues/${participation.season.slug}/competitions/${participation.competition.slug}`;
}

function SectionLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 text-xs font-semibold text-brand-strong transition hover:text-brand-deep hover:underline sm:text-sm"
    >
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}

function AttentionSection({
  summaries,
}: {
  summaries: ClubOperationalSummary[];
}) {
  const actionable = summaries.filter(
    (summary) =>
      summary.attention_status === "action_needed" ||
      summary.attention_status === "deadline_passed",
  );
  if (actionable.length === 0) return null;

  return (
    <section aria-label="Needs attention">
      <SectionHeader
        title="Needs attention"
        description="Authorised Club scoring work with an incomplete participant score."
      />
      <Card className="divide-y divide-border overflow-hidden border-warning/25">
        {actionable.map((summary) => {
          const managementPath = getClubScoreManagementPath(summary);
          const overdue = summary.attention_status === "deadline_passed";

          return (
            <div
              key={summary.club_id}
              className="grid min-w-0 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold ${
                    overdue
                      ? "bg-danger-subtle text-danger"
                      : "bg-warning-subtle text-warning"
                  }`}
                  aria-hidden="true"
                >
                  !
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {overdue ? "Scoring deadline passed" : "Scores due soon"}
                    </h3>
                    <Badge tone={overdue ? "danger" : "warning"}>
                      {summary.incomplete_participant_count} incomplete
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-semibold text-neutral-strong">
                      {summary.club_name}
                    </span>
                    {summary.competition_name && summary.round_number
                      ? ` · ${summary.competition_name} · Round ${summary.round_number}`
                      : ""}
                  </p>
                  {summary.local_cutoff && summary.days_until_cutoff !== null ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatClubCutoffDate(summary.local_cutoff)} ·{" "}
                      {formatClubCutoffDistance(summary.days_until_cutoff)}
                    </p>
                  ) : null}
                </div>
              </div>
              {managementPath ? (
                <Link
                  href={managementPath}
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep sm:w-auto"
                >
                  Manage scores
                </Link>
              ) : null}
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function CurrentCompetitionCard({
  participation,
  today,
}: {
  participation: MyShootingCompetition;
  today: string;
}) {
  const round = getNextRelevantRound(participation);

  return (
    <Card className="flex min-w-0 flex-col p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {participation.organisation.name}
          </p>
          <h3 className="mt-1 break-words text-base font-semibold tracking-[-0.02em] text-foreground">
            {participation.competition.name}
          </h3>
        </div>
        {participation.division ? (
          <Badge tone="brand">{participation.division.name}</Badge>
        ) : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm">
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs text-muted-foreground">Club</dt>
          <dd className="mt-0.5 break-words font-semibold text-foreground">
            {participation.club.name}
          </dd>
        </div>
        {round ? (
          <>
            <div>
              <dt className="text-xs text-muted-foreground">Next Round</dt>
              <dd className="mt-0.5 font-semibold text-foreground">
                Round {round.round_number}
              </dd>
            </div>
            {round.shoot_by_date ? (
              <div>
                <dt className="text-xs text-muted-foreground">Shoot-by</dt>
                <dd className="mt-0.5 font-semibold text-foreground">
                  {formatLeagueSeasonDate(round.shoot_by_date)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-muted-foreground">Round End</dt>
              <dd className="mt-0.5 font-semibold text-foreground">
                {formatLeagueSeasonDate(round.deadline)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
      {round ? (
        <p className="mt-4 text-xs font-medium text-brand-strong">
          {getMyShootingRoundStatus(round, today)}
        </p>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Awaiting the next Round.
        </p>
      )}
      <Link
        href={competitionPath(participation)}
        className="mt-auto inline-flex min-h-10 items-end pt-4 text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        View Competition <span className="ml-1.5" aria-hidden="true">→</span>
      </Link>
    </Card>
  );
}

function CurrentShootingSection({
  groups,
  today,
}: {
  groups: OverviewCompetitionGroups | null;
  today: string | null;
}) {
  return (
    <section className="mt-9" aria-label="Current shooting">
      <SectionHeader
        title="Current shooting"
        description="Your active Competition entries and nearest unreleased Rounds."
        action={<SectionLink href="/competitions">View all competitions</SectionLink>}
      />
      {!groups || !today ? (
        <Card className="p-5 text-sm text-muted-foreground">
          <p role="status">Competition activity is temporarily unavailable.</p>
        </Card>
      ) : groups.active.length > 0 ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          {groups.active.slice(0, 4).map((participation) => (
            <CurrentCompetitionCard
              key={participation.competition_entrant_participant_id}
              participation={participation}
              today={today}
            />
          ))}
        </div>
      ) : (
        <Card className="p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                No active Competitions
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {groups.upcoming.length > 0
                  ? `${groups.upcoming.length} upcoming ${groups.upcoming.length === 1 ? "Competition is" : "Competitions are"} already on your schedule.`
                  : "You have no current or upcoming submitted Competition entries."}
              </p>
            </div>
            {groups.upcoming[0] ? (
              <p className="shrink-0 text-xs font-medium text-brand-strong">
                Next start ·{" "}
                {formatLeagueSeasonDate(
                  groups.upcoming[0].competition.effective_starts_at,
                ) ?? "Not published"}
              </p>
            ) : null}
          </div>
        </Card>
      )}
    </section>
  );
}

function NextUpSection({ groups }: { groups: OverviewCompetitionGroups | null }) {
  if (!groups || groups.upcoming.length === 0) return null;

  return (
    <section aria-label="Next up">
      <SectionHeader
        title="Next up"
        description="The nearest Competition starts already in your schedule."
        action={<SectionLink href="/competitions?tab=upcoming">View upcoming</SectionLink>}
      />
      <Card className="divide-y divide-border overflow-hidden">
        {groups.upcoming.slice(0, 3).map((participation) => (
          <Link
            key={participation.competition_entrant_participant_id}
            href={competitionPath(participation)}
            className="grid min-w-0 gap-2 p-4 transition hover:bg-surface-muted sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <h3 className="break-words text-sm font-semibold text-foreground">
                {participation.competition.name}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {participation.season.name} · {participation.club.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {participation.organisation.name}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-[11px] text-muted-foreground">Competition start</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {formatLeagueSeasonDate(
                  participation.competition.effective_starts_at,
                ) ?? "Not published"}
              </p>
            </div>
          </Link>
        ))}
      </Card>
    </section>
  );
}

function RecentFormSection({ analytics }: { analytics: ShooterAnalytics | null }) {
  const summary = analytics?.summary;
  const recentPoints = analytics?.recent_scores.slice(0, 5) ?? [];
  const trend = summary
    ? {
        up: { label: "Improving", tone: "positive" as const },
        steady: { label: "Steady", tone: "neutral" as const },
        down: { label: "Declining", tone: "warning" as const },
        unavailable: { label: "Not available", tone: "neutral" as const },
      }[summary.trend_direction]
    : null;

  return (
    <section aria-label="Recent form">
      <SectionHeader
        title="Recent form"
        description="A small unfiltered teaser from your shooter Statistics."
        action={<SectionLink href="/statistics">View statistics</SectionLink>}
      />
      <Card className="min-w-0 p-5 sm:p-6">
        {!analytics || !summary ? (
          <p className="text-sm text-muted-foreground" role="status">
            Recent Statistics are temporarily unavailable.
          </p>
        ) : summary.physical_shoot_count === 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              No released scores yet
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Your recent form will appear after an eligible score is released.
            </p>
          </div>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Latest performance</dt>
                <dd className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-foreground tabular-nums">
                  {summary.recent_score_percentage === null
                    ? "—"
                    : `${percentageFormatter.format(summary.recent_score_percentage)}%`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Overall trend</dt>
                <dd className="mt-2">
                  <Badge tone={trend!.tone}>{trend!.label}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Released scores</dt>
                <dd className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-foreground tabular-nums">
                  {summary.physical_shoot_count}
                </dd>
              </div>
            </dl>
            {recentPoints.length > 0 ? (
              <div className="mt-6 min-w-0 border-t border-border pt-5">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Latest released values
                </p>
                <div
                  className="mt-3 flex h-20 min-w-0 items-end gap-2"
                  aria-label="Recent score percentages"
                >
                  {[...recentPoints].reverse().map((point) => (
                    <div
                      key={point.event_key}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                    >
                      <span className="text-[10px] font-semibold tabular-nums text-neutral-strong">
                        {percentageFormatter.format(point.score_percentage)}
                      </span>
                      <span
                        className="w-full max-w-12 rounded-t-md bg-brand"
                        style={{
                          height: `${Math.max(8, Math.min(100, point.score_percentage))}%`,
                        }}
                        aria-hidden="true"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </section>
  );
}

function ClubsSection({
  memberships,
  available,
}: {
  memberships: DashboardClubMembership[];
  available: boolean;
}) {
  return (
    <section className="mt-9" aria-label="Clubs">
      <SectionHeader
        title="Clubs"
        description="Your active memberships and roles."
        action={<SectionLink href="/clubs">Browse clubs</SectionLink>}
      />
      {!available ? (
        <Card className="p-5 text-sm text-muted-foreground">
          <p role="status">Club memberships are temporarily unavailable.</p>
        </Card>
      ) : memberships.length > 0 ? (
        <DashboardClubCards memberships={memberships} />
      ) : (
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              No active Club membership
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Find your Club to keep its Competition access close at hand.
            </p>
          </div>
          <SectionLink href="/clubs">Find a club</SectionLink>
        </Card>
      )}
    </section>
  );
}

export function OverviewDashboard({
  firstName,
  competitionGroups,
  competitionAsOfDate,
  analytics,
  memberships,
  membershipsAvailable,
  managementSummaries,
}: {
  firstName: string;
  competitionGroups: OverviewCompetitionGroups | null;
  competitionAsOfDate: string | null;
  analytics: ShooterAnalytics | null;
  memberships: DashboardClubMembership[];
  membershipsAvailable: boolean;
  managementSummaries: ClubOperationalSummary[];
}) {
  return (
    <div className="min-w-0">
      <header className="mb-8 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
          Personal dashboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
          Overview
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
          {firstName}, here is what matters across your shooting and Club roles.
        </p>
      </header>

      <AttentionSection summaries={managementSummaries} />
      <CurrentShootingSection
        groups={competitionGroups}
        today={competitionAsOfDate}
      />

      <div
        className={`mt-9 grid min-w-0 gap-9 ${
          competitionGroups?.upcoming.length
            ? "xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]"
            : ""
        }`}
      >
        <NextUpSection groups={competitionGroups} />
        <RecentFormSection analytics={analytics} />
      </div>

      <ClubsSection
        memberships={memberships}
        available={membershipsAvailable}
      />
    </div>
  );
}
