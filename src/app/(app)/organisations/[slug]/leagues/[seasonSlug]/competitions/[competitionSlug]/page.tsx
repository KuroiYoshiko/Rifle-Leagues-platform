import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionDetailsDisclosure } from "@/components/competition-details-disclosure";
import { CompetitionEntryControls } from "@/components/competition-entry-controls";
import { CompetitionAggregateResultsTable } from "@/components/competition-aggregate-results";
import { getCompetitionAggregateResults } from "@/lib/competition-aggregate-results";
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
  const [rounds, scoreComponents, entryContexts, divisionManagement, publishedDivisions, lifecycleState, aggregateResults] = await Promise.all([
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
    competition.status === "published" && competition.ranking_method === "aggregate"
      ? getCompetitionAggregateResults(organisation.id, season.id, competition.id)
      : Promise.resolve(null),
  ]);
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
  const scoreMethods = [
    ...new Set(scoreComponents.map((component) => component.score_method)),
  ];
  const courseOfFireScoring =
    scoreMethods.length === 1
      ? getCompetitionScoringMethodLabel(scoreMethods[0]).toLowerCase()
      : scoreMethods.length > 1
        ? "mixed scoring"
        : getCompetitionScoringMethodLabel(
            competition.scoring_method,
          ).toLowerCase();
  const entryWindow =
    effectiveDates.effective_entry_opens_at &&
    effectiveDates.effective_entry_closes_at
      ? `${formatLeagueSeasonDate(effectiveDates.effective_entry_opens_at)} – ${formatLeagueSeasonDate(effectiveDates.effective_entry_closes_at)}`
      : "Not configured";
  const summaryItems = [
    entryFormatDetail,
    `${competition.number_of_rounds} round${competition.number_of_rounds === 1 ? "" : "s"}`,
    getCompetitionRankingMethodLabel(competition.ranking_method),
    scoreComponents.length
      ? `Ex ${derivedMaximum.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${courseOfFireScoring}`
      : "Course of Fire not set",
  ];
  if (competition.shots_per_round) {
    summaryItems.push(
      `${competition.shots_per_round.toLocaleString("en-GB")} shots / Round`,
    );
  }
  if (fee) summaryItems.push(fee);
  const resultsDuplicateDivisionRoster =
    aggregateResults?.status === "ready";

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

      <Card className="mt-5 min-w-0 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Badge
              tone={competition.status === "draft" ? "warning" : "positive"}
            >
              {getCompetitionStatusLabel(competition.status)}
            </Badge>
            <h2 className="mt-3 break-words text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              {competition.name}
            </h2>
            {competition.description ? (
              <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {competition.description}
              </p>
            ) : null}
            {competition.status === "draft" ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
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

        <div className="mt-5 border-y border-border py-3.5">
          <ul className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm font-semibold text-foreground">
            {summaryItems.map((item, index) => (
              <li key={item} className="flex items-center gap-2">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-border">
                    ·
                  </span>
                ) : null}
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">Entry window:</span>{" "}
            {entryWindow}
          </span>
          <span aria-hidden="true" className="text-border">
            ·
          </span>
          <span>
            <span className="font-semibold text-foreground">Competition start:</span>{" "}
            {formatLeagueSeasonDate(effectiveDates.effective_starts_at) ??
              "Not configured"}
          </span>
        </p>
      </Card>

      <CompetitionEntryControls
        contexts={entryContexts}
        competitionId={competition.id}
        basePath={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`}
      />

      {competition.status === "published" ? (
        <section className="mt-8 min-w-0" aria-label="Competition results">
          <SectionHeader
            title="Results"
            description={
              competition.ranking_method === "aggregate"
                ? "Aggregate standings across released Rounds"
                : `${getCompetitionRankingMethodLabel(competition.ranking_method)} standings`
            }
            action={
              aggregateResults ? (
                <Link
                  href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}/results`}
                  className="shrink-0 text-sm font-semibold text-brand-strong hover:underline"
                >
                  View results
                </Link>
              ) : undefined
            }
          />
          {aggregateResults ? (
            <CompetitionAggregateResultsTable data={aggregateResults} />
          ) : (
            <Card className="p-5 text-sm text-muted-foreground sm:p-6">
              {competition.ranking_method === "aggregate"
                ? "Results are not available yet."
                : "Standings for this ranking method are not available yet."}
            </Card>
          )}
        </section>
      ) : null}

      <CompetitionDetailsDisclosure
        competition={competition}
        effectiveDates={effectiveDates}
        rounds={rounds}
        scoreComponents={scoreComponents}
      />

      {publishedDivisions ? (
        <PublishedCompetitionDivisionsView
          data={publishedDivisions}
          collapseRoster={resultsDuplicateDivisionRoster}
        />
      ) : null}

      {(managementContext && competition.status === "published") ||
      divisionManagement ? (
        <section className="mt-8" aria-labelledby="competition-management-heading">
          <SectionHeader
            title="Competition management"
            description="Organisation staff tools"
          />
          <Card className="divide-y divide-border overflow-hidden">
            {managementContext && competition.status === "published" ? (
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <h3
                    id="competition-management-heading"
                    className="text-sm font-semibold text-foreground"
                  >
                    Round score entry
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Enter participant scores for submitted entrants.
                  </p>
                </div>
                <Link
                  href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}/scores`}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
                >
                  Manage scores
                </Link>
              </div>
            ) : (
              <h3 id="competition-management-heading" className="sr-only">
                Competition entry and division management
              </h3>
            )}

            {divisionManagement ? (
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      Entries and divisions
                    </p>
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
                  <p className="mt-1 text-sm text-muted-foreground">
                    {divisionManagement.entrant_count} entrant
                    {divisionManagement.entrant_count === 1 ? "" : "s"}
                    {` · ${divisionManagement.club_count} club${divisionManagement.club_count === 1 ? "" : "s"}`}
                    {` · ${
                      divisionManagement.config
                        ? `${divisionManagement.divisions.length} division${divisionManagement.divisions.length === 1 ? "" : "s"}`
                        : "divisions not configured"
                    }`}
                  </p>
                </div>
                <Link
                  href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}/divisions`}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
                >
                  Manage divisions
                </Link>
              </div>
            ) : null}
          </Card>
        </section>
      ) : null}

    </OrganisationPageFrame>
  );
}
