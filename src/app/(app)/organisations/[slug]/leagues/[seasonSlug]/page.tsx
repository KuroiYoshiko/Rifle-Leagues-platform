import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LeagueSeasonPhaseBadge } from "@/components/league-season-phase-badge";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  formatCompetitionEntryFee,
  getCompetitionEntryFormatLabel,
  getCompetitions,
  getCompetitionScoringMethodLabel,
  type Competition,
} from "@/lib/competitions";
import {
  getLeagueEntryWindowDateDisplay,
  getLeagueEntryWindowState,
  getLeagueSeasonBySlug,
  getLeagueSeasonDateDisplay,
  getLeagueSeasonPresentationPhase,
} from "@/lib/league-seasons";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";
import { getPublicResultsCatalog } from "@/lib/public-results";
import { getViewerId } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "Season",
};

function CompetitionCard({
  competition,
  organisationSlug,
  seasonSlug,
  canManage,
}: {
  competition: Competition;
  organisationSlug: string;
  seasonSlug: string;
  canManage: boolean;
}) {
  const detailPath = `/organisations/${organisationSlug}/leagues/${seasonSlug}/competitions/${competition.slug}`;
  const fee = formatCompetitionEntryFee(competition.entry_fee);
  const entryFormat = getCompetitionEntryFormatLabel(
    competition.entry_format,
  );

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={competition.status === "draft" ? "warning" : "positive"}
            >
              {competition.status === "draft" ? "Draft" : "Published"}
            </Badge>
            {competition.status === "draft" ? (
              <span className="text-xs text-muted-foreground">Management only</span>
            ) : null}
          </div>
          <h3 className="mt-3 break-words text-lg font-semibold tracking-[-0.02em] text-foreground">
            <Link href={detailPath} className="hover:text-brand-deep hover:underline">
              {competition.name}
            </Link>
          </h3>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {entryFormat}
            {competition.entry_format === "team"
              ? ` · ${competition.team_size} shooters`
              : ""}
            {` · ${competition.number_of_rounds} round${competition.number_of_rounds === 1 ? "" : "s"}`}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {getCompetitionScoringMethodLabel(competition.scoring_method)}
            {competition.maximum_score_per_round
              ? ` · Ex ${competition.maximum_score_per_round.toLocaleString("en-GB")}`
              : ""}
            {competition.uses_x_score ? " · X score" : ""}
            {fee ? ` · ${fee} entry` : ""}
          </p>
        </div>
        <Link
          href={detailPath}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
        >
          {canManage ? "Manage" : "View"}
        </Link>
      </div>
    </Card>
  );
}

export default async function LeagueSeasonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; seasonSlug: string }>;
  searchParams: Promise<{
    competitionDeleted?: string | string[];
    created?: string | string[];
  }>;
}) {
  const { slug, seasonSlug } = await params;
  const { competitionDeleted, created } = await searchParams;
  const viewerId = await getViewerId();
  const isAuthenticated = Boolean(viewerId);
  const publicCatalog = viewerId
    ? null
    : await getPublicResultsCatalog({
        organisationSlug: slug,
        seasonSlug,
      });
  const [organisation, managementContext] = viewerId
    ? await Promise.all([
        getActiveOrganisationBySlug(slug),
        getOrganisationManagementContextBySlug(slug),
      ])
    : [publicCatalog?.organisation ?? null, null];

  if (!organisation) {
    notFound();
  }

  const season = viewerId
    ? await getLeagueSeasonBySlug(organisation.id, seasonSlug)
    : (publicCatalog?.season ?? null);

  if (!season) {
    notFound();
  }

  const isOwner = managementContext?.access.role === "owner";
  const canManageCompetitions = Boolean(managementContext);
  const competitions = viewerId
    ? await getCompetitions(season.id)
    : (publicCatalog?.competitions ?? []);
  const creationSucceeded = Array.isArray(created)
    ? created[0] === "1"
    : created === "1";
  const competitionDeletionSucceeded = Array.isArray(competitionDeleted)
    ? competitionDeleted[0] === "1"
    : competitionDeleted === "1";
  const entryWindowDates = getLeagueEntryWindowDateDisplay(
    season.entry_opens_at,
    season.entry_closes_at,
  );
  const entryWindowState = getLeagueEntryWindowState(
    season.entry_opens_at,
    season.entry_closes_at,
  );
  const seasonDates = getLeagueSeasonDateDisplay(
    season.starts_at,
    season.ends_at,
  );
  const seasonPhase = getLeagueSeasonPresentationPhase(season);

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      {isAuthenticated && creationSucceeded ? (
        <div
          className="mb-6 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">Season created.</strong> It is a
          private draft until you move it to Open.
        </div>
      ) : null}
      {isAuthenticated && competitionDeletionSucceeded ? (
        <div
          className="mb-6 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">Competition deleted.</strong>{" "}
          Its configuration has been permanently removed.
        </div>
      ) : null}

      <Link
        href={`/organisations/${organisation.slug}/leagues`}
        className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        ← Back to seasons
      </Link>

      <Card className="mt-5 min-w-0 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h2 className="min-w-0 break-words text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
                {season.name}
              </h2>
              <LeagueSeasonPhaseBadge phase={seasonPhase} />
            </div>
            {season.description ? (
              <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {season.description}
              </p>
            ) : null}
            {season.status === "draft" ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Only active organisation management staff can see this draft.
              </p>
            ) : null}
          </div>
          {isOwner ? (
            <Link
              href={`/organisations/${organisation.slug}/leagues/${season.slug}/edit`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center self-start rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
            >
              Edit season
            </Link>
          ) : null}
        </div>

        <dl className="mt-8 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
          <div className="min-w-0 rounded-xl bg-surface-muted p-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Default entry window
            </dt>
            <dd className="mt-2 break-words text-base font-semibold leading-6 text-foreground">
              {entryWindowDates ?? "Not scheduled"}
            </dd>
            {entryWindowState ? (
              <dd className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {entryWindowState}
              </dd>
            ) : null}
            <dd className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Default dates for competitions in this season.
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Season
            </dt>
            <dd className="mt-2 break-words text-base font-semibold leading-6 text-foreground">
              {seasonDates ?? "Not scheduled"}
            </dd>
          </div>
        </dl>
      </Card>

      <section className="mt-10" aria-label="Competitions">
        <SectionHeader
          title="Competitions"
          description={
            canManageCompetitions
              ? `${competitions.length} competition${competitions.length === 1 ? "" : "s"} within this season`
              : "Published competitions within this season"
          }
          action={
            canManageCompetitions ? (
              <Link
                href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/new`}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
              >
                + Add competition
              </Link>
            ) : null
          }
        />
        {competitions.length === 0 ? (
          <Card className="p-6 sm:p-8">
            <div className="flex flex-col items-start gap-5 sm:flex-row">
              <span
                className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-subtle text-sm font-bold text-brand-deep"
                aria-hidden="true"
              >
                C
              </span>
              <div>
                <h3
                  id="competitions-heading"
                  className="font-semibold text-foreground"
                >
                  {canManageCompetitions
                    ? "Add the first competition"
                    : "No published competitions yet"}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {canManageCompetitions
                    ? "Configure its entry format, scoring details, and explicit round deadlines. It will begin as a private draft."
                    : "This season does not have any published competitions to show yet."}
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {competitions.map((competition) => (
              <CompetitionCard
                key={competition.id}
                competition={competition}
                organisationSlug={organisation.slug}
                seasonSlug={season.slug}
                canManage={canManageCompetitions}
              />
            ))}
          </div>
        )}
      </section>
    </OrganisationPageFrame>
  );
}
