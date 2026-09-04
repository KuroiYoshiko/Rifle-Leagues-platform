import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionEntryControls } from "@/components/competition-entry-controls";
import { CompetitionLifecycleActions } from "@/components/competition-lifecycle-actions";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { PublishedCompetitionDivisionsView } from "@/components/published-competition-divisions";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  getCompetitionDivisionManagement,
  getPublishedCompetitionDivisions,
} from "@/lib/competition-divisions";
import {
  formatCompetitionEntryFee,
  getCompetitionMaximumPerRound,
  getCompetitionBySlug,
  getCompetitionEntryFormatLabel,
  getCompetitionLifecycleState,
  getCompetitionRankingMethodLabel,
  getCompetitionRounds,
  getCompetitionScoreComponents,
  getCompetitionScoringMethodLabel,
  getCompetitionStatusLabel,
  resolveCompetitionEffectiveDates,
} from "@/lib/competitions";
import { getCompetitionClubEntryContext } from "@/lib/competition-entries";
import {
  formatLeagueSeasonDate,
  getLeagueSeasonBySlug,
} from "@/lib/league-seasons";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Competition",
};

const compactMonthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const accessibleRoundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function getCompactRoundDateLabels(rounds: Array<{ deadline: string }>) {
  const years = new Set(rounds.map((round) => round.deadline.slice(0, 4)));
  const crossesCalendarYear = years.size > 1;
  let previousYear: string | null = null;

  return rounds.map((round) => {
    const year = round.deadline.slice(0, 4);
    const [, month, day] = round.deadline.split("-").map(Number);
    const date = new Date(`${round.deadline}T00:00:00Z`);
    const compactDate = `${day} ${compactMonthLabels[month - 1]}`;
    const label =
      crossesCalendarYear && previousYear !== null && year !== previousYear
        ? `${compactDate} ’${year.slice(-2)}`
        : compactDate;

    previousYear = year;
    return {
      compact: label,
      accessible: accessibleRoundDateFormatter.format(date),
    };
  });
}

export default async function CompetitionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{
    slug: string;
    seasonSlug: string;
    competitionSlug: string;
  }>;
  searchParams: Promise<{
    created?: string | string[];
    drafted?: string | string[];
    published?: string | string[];
    saved?: string | string[];
  }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const { created, drafted, published, saved } = await searchParams;
  const [organisation, managementContext] = await Promise.all([
    getActiveOrganisationBySlug(slug),
    getOrganisationManagementContextBySlug(slug),
  ]);

  if (!organisation) {
    notFound();
  }

  const season = await getLeagueSeasonBySlug(organisation.id, seasonSlug);
  if (!season) {
    notFound();
  }

  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition) {
    notFound();
  }

  const isOwner = managementContext?.access.role === "owner";
  const [rounds, scoreComponents, entryContexts, divisionManagement, publishedDivisions, lifecycleState] = await Promise.all([
    getCompetitionRounds(competition.id),
    getCompetitionScoreComponents(competition.id),
    competition.status === "published"
      ? getCompetitionClubEntryContext(competition.id)
      : Promise.resolve([]),
    managementContext
      ? getCompetitionDivisionManagement(
          organisation.id,
          season.id,
          competition.id,
        )
      : Promise.resolve(null),
    competition.status === "published"
      ? getPublishedCompetitionDivisions(competition.id)
      : Promise.resolve(null),
    isOwner
      ? getCompetitionLifecycleState(
          organisation.id,
          season.id,
          competition.id,
        )
      : Promise.resolve(null),
  ]);
  const roundDateLabels = getCompactRoundDateLabels(rounds);
  const creationSucceeded = Array.isArray(created)
    ? created[0] === "1"
    : created === "1";
  const publishSucceeded = Array.isArray(published)
    ? published[0] === "1"
    : published === "1";
  const saveSucceeded = Array.isArray(saved)
    ? saved[0] === "1"
    : saved === "1";
  const returnToDraftSucceeded = Array.isArray(drafted)
    ? drafted[0] === "1"
    : drafted === "1";
  const fee = formatCompetitionEntryFee(competition.entry_fee);
  const entryFormat = getCompetitionEntryFormatLabel(
    competition.entry_format,
  );
  const entryFormatDetail =
    competition.entry_format === "team"
      ? `${entryFormat} · ${competition.team_size} shooters`
      : entryFormat;
  const effectiveDates = resolveCompetitionEffectiveDates(competition, season);
  const derivedMaximum = getCompetitionMaximumPerRound(
    competition.sets_per_round,
    scoreComponents,
  );
  const entryWindow =
    effectiveDates.effective_entry_opens_at &&
    effectiveDates.effective_entry_closes_at
      ? `${formatLeagueSeasonDate(effectiveDates.effective_entry_opens_at)} – ${formatLeagueSeasonDate(effectiveDates.effective_entry_closes_at)}`
      : "Not configured";

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      {creationSucceeded || publishSucceeded || saveSucceeded || returnToDraftSucceeded ? (
        <div
          className="mb-6 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">
            {publishSucceeded
              ? "Competition published."
              : returnToDraftSucceeded
                ? "Competition returned to draft."
              : saveSucceeded
                ? "Competition changes saved."
                : "Draft saved."}
          </strong>{" "}
          {publishSucceeded
            ? "It is visible whenever the parent season is public."
            : competition.status === "draft"
              ? "Only the active organisation owner can see it until it is published."
              : "The published Competition remains visible."}
        </div>
      ) : null}

      <Link
        href={`/organisations/${organisation.slug}/leagues/${season.slug}`}
        className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        ← Back to {season.name}
      </Link>

      <Card className="mt-5 min-w-0 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Badge
              tone={competition.status === "draft" ? "warning" : "positive"}
            >
              {getCompetitionStatusLabel(competition.status)}
            </Badge>
            <h2 className="mt-4 break-words text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              {competition.name}
            </h2>
            {competition.description ? (
              <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {competition.description}
              </p>
            ) : null}
            {competition.status === "draft" ? (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                This draft is private to the active organisation owner.
              </p>
            ) : null}
          </div>
          {isOwner && lifecycleState ? (
            <CompetitionLifecycleActions
              organisationId={organisation.id}
              leagueSeasonId={season.id}
              competitionId={competition.id}
              competitionName={competition.name}
              status={competition.status}
              canReturnToDraft={lifecycleState.can_return_to_draft}
              canDelete={lifecycleState.can_delete}
              editHref={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}/edit`}
            />
          ) : null}
        </div>

        <dl className="mt-8 grid gap-3 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Entry format
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {entryFormatDetail}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Rounds
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {competition.number_of_rounds} round
              {competition.number_of_rounds === 1 ? "" : "s"}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Scoring
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {getCompetitionRankingMethodLabel(competition.ranking_method)}
              {competition.uses_x_score ? " · Records X" : " · No X"}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Maximum score
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {scoreComponents.length
                ? `Ex ${derivedMaximum.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`
                : "Not set"}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Shots
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {competition.shots_per_round
                ? `${competition.shots_per_round.toLocaleString("en-GB")} per round`
                : "Not set"}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Entry fee
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {fee ?? "Not set"}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Entry window
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {entryWindow}
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">
              {competition.entry_window_mode === "custom" ? "Custom" : "Season default"}
            </p>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Competition Start
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {formatLeagueSeasonDate(effectiveDates.effective_starts_at) ?? "Not configured"}
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">
              {competition.start_date_mode === "custom" ? "Custom" : "Season start"}
            </p>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Scoring access
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {competition.local_scoring_enabled
                ? "Club + organisation scoring"
                : "Organisation scoring only"}
            </dd>
          </div>
        </dl>
      </Card>

      <section className="mt-10" aria-labelledby="course-of-fire-heading">
        <SectionHeader
          title="Course of Fire"
          description={`${competition.sets_per_round} set${competition.sets_per_round === 1 ? "" : "s"} per shooter / round`}
        />
        <Card className="p-5 sm:p-6">
          <h3 id="course-of-fire-heading" className="sr-only">Course of Fire score components</h3>
          {scoreComponents.length ? (
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {scoreComponents.map((component) => (
                <li key={component.id} className="rounded-xl bg-surface-muted p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-strong">
                    {component.short_label || `Score ${component.position}`}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    Ex {Number(component.maximum_score).toLocaleString("en-GB", { maximumFractionDigits: 2 })}
                    {` · ${getCompetitionScoringMethodLabel(component.score_method)}`}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No score components configured.</p>
          )}
        </Card>
      </section>

      <CompetitionEntryControls
        contexts={entryContexts}
        competitionId={competition.id}
        basePath={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`}
      />

      {managementContext &&
      competition.status === "published" ? (
        <section className="mt-10" aria-labelledby="score-management-heading">
          <SectionHeader
            title="Score management"
            description="Enter participant source scores for submitted entrants"
          />
          <Card className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3
                  id="score-management-heading"
                  className="font-semibold text-foreground"
                >
                  Round score entry
                </h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Organisation owners and managers can score every participant
                  after the Competition starts, including after club cutoffs.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}/results`}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
                >
                  Preview results
                </Link>
                <Link
                  href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}/scores`}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
                >
                  Manage scores
                </Link>
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="round-schedule-heading">
        <SectionHeader
          title="Round schedule"
          description={`${rounds.length} of ${competition.number_of_rounds} Round End dates set`}
        />
        {rounds.length === 0 ? (
          <Card className="p-6 sm:p-8">
            <h3 id="round-schedule-heading" className="font-semibold text-foreground">
              No Round End dates set
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The owner can generate and edit this schedule while configuring the
              draft.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden bg-border">
            <h3 id="round-schedule-heading" className="sr-only">
              Round End dates
            </h3>
            <ol className="grid min-w-0 grid-cols-1 gap-px min-[360px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-5 2xl:grid-cols-10">
              {rounds.map((round, index) => (
                <li
                  key={round.id}
                  className="min-w-0 bg-surface px-3 py-2.5"
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-strong">
                    R{round.round_number}
                  </span>
                  <time
                    dateTime={round.deadline}
                    title={roundDateLabels[index].accessible}
                    aria-label={roundDateLabels[index].accessible}
                    className="mt-0.5 block min-w-0 whitespace-nowrap text-sm font-semibold text-foreground"
                  >
                    {roundDateLabels[index].compact}
                  </time>
                  {round.shoot_by_date ? (
                    <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                      Shoot by {formatLeagueSeasonDate(round.shoot_by_date)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </section>

      {publishedDivisions ? (
        <PublishedCompetitionDivisionsView data={publishedDivisions} />
      ) : null}

      {divisionManagement ? (
        <section className="mt-10" aria-labelledby="competition-management-heading">
          <SectionHeader
            title="Competition management"
            description="Review submitted entries and organise entrant units"
          />
          <Card className="p-5 sm:p-6">
            <h3 id="competition-management-heading" className="sr-only">
              Competition entry and division management
            </h3>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Entries
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {divisionManagement.entrant_count} entrant
                  {divisionManagement.entrant_count === 1 ? "" : "s"}
                  {` · ${divisionManagement.club_count} club${divisionManagement.club_count === 1 ? "" : "s"}`}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Divisions
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {divisionManagement.config
                      ? `${divisionManagement.divisions.length} division${divisionManagement.divisions.length === 1 ? "" : "s"}`
                      : "Not configured"}
                  </span>
                  {divisionManagement.config ? (
                    <Badge
                      tone={
                        divisionManagement.config.status === "published"
                          ? "positive"
                          : "warning"
                      }
                    >
                      {divisionManagement.config.status === "published"
                        ? "Published"
                        : "Draft"}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <Link
                href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}/divisions`}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
              >
                Manage divisions
              </Link>
            </div>
          </Card>
        </section>
      ) : null}

    </OrganisationPageFrame>
  );
}
