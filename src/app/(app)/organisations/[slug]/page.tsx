import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LeagueSeasonPhaseBadge } from "@/components/league-season-phase-badge";
import { OrganisationAbout } from "@/components/organisation-about";
import { OrganisationManagementPanel } from "@/components/organisation-management-panel";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import {
  getLeagueEntrySummary,
  getLeagueSeasons,
  getLeagueSeasonDateDisplay,
  getLeagueSeasonPresentationPhase,
  getLeagueToday,
  type LeagueSeason,
  type LeagueSeasonPresentationPhase,
} from "@/lib/league-seasons";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";
import { getPublicResultsCatalog } from "@/lib/public-results";
import { getViewerId } from "@/lib/viewer";

export const metadata: Metadata = {
  title: "Organisation overview",
};

function OverviewLeagueCard({
  organisationSlug,
  season,
  phase,
  label,
  today,
}: {
  organisationSlug: string;
  season: LeagueSeason;
  phase: LeagueSeasonPresentationPhase;
  label: string;
  today: string;
}) {
  const entrySummary = getLeagueEntrySummary(
    season.entry_opens_at,
    season.entry_closes_at,
    today,
  );
  const seasonSummary = getLeagueSeasonDateDisplay(
    season.starts_at,
    season.ends_at,
  );

  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words font-semibold text-foreground">
          <Link
            href={`/organisations/${organisationSlug}/leagues/${season.slug}`}
            className="hover:text-brand-deep hover:underline"
          >
            {season.name}
          </Link>
        </h3>
        <LeagueSeasonPhaseBadge phase={phase} />
      </div>
      <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
        {seasonSummary ? <p>{seasonSummary}</p> : null}
        {entrySummary ? <p>{entrySummary}</p> : null}
        {!entrySummary && !seasonSummary ? <p>Dates have not been set</p> : null}
      </div>
    </Card>
  );
}

export default async function OrganisationOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ registered?: string | string[] }>;
}) {
  const { slug } = await params;
  const { registered } = await searchParams;
  const viewerId = await getViewerId();
  const isAuthenticated = Boolean(viewerId);
  const publicCatalog = viewerId
    ? null
    : await getPublicResultsCatalog({ organisationSlug: slug });
  const [organisation, managementContext] = viewerId
    ? await Promise.all([
        getActiveOrganisationBySlug(slug),
        getOrganisationManagementContextBySlug(slug),
      ])
    : [publicCatalog?.organisation ?? null, null];
  const registrationSucceeded = Array.isArray(registered)
    ? registered[0] === "1"
    : registered === "1";

  if (!organisation) {
    notFound();
  }

  const seasons = viewerId
    ? await getLeagueSeasons(organisation.id)
    : (publicCatalog?.seasons ?? []);
  const today = getLeagueToday();
  const publishedSeasons = seasons.filter(
    (season) => season.status === "open" || season.status === "active",
  );
  const ongoingSeason = publishedSeasons
    .filter(
      (season) => getLeagueSeasonPresentationPhase(season, today) === "ongoing",
    )
    .sort((left, right) =>
      (left.ends_at ?? "9999-12-31").localeCompare(
        right.ends_at ?? "9999-12-31",
      ),
    )[0];
  const upcomingSeason = publishedSeasons
    .filter(
      (season) => getLeagueSeasonPresentationPhase(season, today) === "upcoming",
    )
    .sort((left, right) =>
      (left.starts_at ?? "9999-12-31").localeCompare(
        right.starts_at ?? "9999-12-31",
      ),
    )[0];

  return (
    <OrganisationPageFrame
      organisation={organisation}
      currentSection="overview"
    >
      {isAuthenticated && registrationSucceeded ? (
        <div
          className="mb-8 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">Organisation registered.</strong>{" "}
          You are now its owner, and it has been added to My Organisations through
          your active management access.
        </div>
      ) : null}
      {isAuthenticated && managementContext ? (
        <OrganisationManagementPanel
          organisation={organisation}
          role={managementContext.access.role}
        />
      ) : null}
      <OrganisationAbout
        key={`${organisation.id}:${organisation.about_content ?? ""}`}
        organisationId={organisation.id}
        initialContent={organisation.about_content}
        isOwner={managementContext?.access.role === "owner"}
      />

      {ongoingSeason || upcomingSeason ? (
        <section className="mt-10" aria-label="Season summary">
          <SectionHeader
            title="Season summary"
            description="Current and next published seasons"
            action={
              <Link
                href={`/organisations/${organisation.slug}/leagues`}
                className="text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
              >
                View all seasons
              </Link>
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {ongoingSeason ? (
              <OverviewLeagueCard
                organisationSlug={organisation.slug}
                season={ongoingSeason}
                phase="ongoing"
                label="Ongoing season"
                today={today}
              />
            ) : null}
            {upcomingSeason ? (
              <OverviewLeagueCard
                organisationSlug={organisation.slug}
                season={upcomingSeason}
                phase="upcoming"
                label="Next season"
                today={today}
              />
            ) : null}
          </div>
        </section>
      ) : null}
    </OrganisationPageFrame>
  );
}
