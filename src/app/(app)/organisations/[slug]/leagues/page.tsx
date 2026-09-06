import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  OrganisationEmptyState,
  OrganisationPageFrame,
} from "@/components/organisation-page-frame";
import { LeagueSeasonPhaseBadge } from "@/components/league-season-phase-badge";
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
  title: "Organisation seasons",
};

const phaseSections: Array<{
  phase: LeagueSeasonPresentationPhase;
  title: string;
}> = [
  {
    phase: "ongoing",
    title: "Ongoing",
  },
  {
    phase: "upcoming",
    title: "Upcoming",
  },
  {
    phase: "completed",
    title: "Previous seasons",
  },
];

function LeagueSeasonCard({
  season,
  organisationSlug,
  isOwner,
  phase,
  today,
}: {
  season: LeagueSeason;
  organisationSlug: string;
  isOwner: boolean;
  phase: LeagueSeasonPresentationPhase;
  today: string;
}) {
  const detailPath = `/organisations/${organisationSlug}/leagues/${season.slug}`;
  const entrySummary = phase === "completed"
    ? null
    : getLeagueEntrySummary(
        season.entry_opens_at,
        season.entry_closes_at,
        today,
      );
  const seasonSummary = getLeagueSeasonDateDisplay(
    season.starts_at,
    season.ends_at,
  );

  return (
    <Card className="min-w-0 p-4 sm:px-5 sm:py-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-base font-semibold tracking-[-0.02em] text-foreground">
              <Link href={detailPath} className="hover:text-brand-deep hover:underline">
                {season.name}
              </Link>
            </h3>
            <LeagueSeasonPhaseBadge phase={phase} />
            {season.status === "draft" ? (
              <span className="text-xs text-muted-foreground">Owner only</span>
            ) : null}
          </div>
          <div className="mt-2 space-y-0.5 text-xs leading-5 text-muted-foreground">
            {seasonSummary ? <p>{seasonSummary}</p> : null}
            {entrySummary ? <p>{entrySummary}</p> : null}
            {!entrySummary && !seasonSummary ? <p>Dates not set</p> : null}
          </div>
        </div>
        <Link
          href={detailPath}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
        >
          {isOwner ? "Manage" : "View"}
        </Link>
      </div>
    </Card>
  );
}

export default async function OrganisationLeaguesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewerId = await getViewerId();
  const publicCatalog = viewerId
    ? null
    : await getPublicResultsCatalog({ organisationSlug: slug });
  const [organisation, managementContext] = viewerId
    ? await Promise.all([
        getActiveOrganisationBySlug(slug),
        getOrganisationManagementContextBySlug(slug),
      ])
    : [publicCatalog?.organisation ?? null, null];

  if (!organisation) {
    notFound();
  }

  const seasons = viewerId
    ? await getLeagueSeasons(organisation.id)
    : (publicCatalog?.seasons ?? []);
  const isOwner = managementContext?.access.role === "owner";
  const today = getLeagueToday();
  const presentedSeasons = seasons.map((season) => ({
    season,
    phase: getLeagueSeasonPresentationPhase(season, today),
  }));

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      <SectionHeader
        title="Seasons"
        description={
          isOwner
            ? `${seasons.length} season${seasons.length === 1 ? "" : "s"}`
            : "Published seasons"
        }
        action={
          isOwner ? (
            <Link
              href={`/organisations/${organisation.slug}/leagues/new`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
            >
              + Create season
            </Link>
          ) : null
        }
      />

      {seasons.length === 0 ? (
        <Card className="p-6 sm:p-8">
          <OrganisationEmptyState
            mark="S"
            title={isOwner ? "Create the first season" : "No published seasons yet"}
            description={
              isOwner
                ? "Seasons contain this organisation’s competitions. Your first season will begin as a private draft."
                : "This organisation has not published an open, active, or completed season yet."
            }
          />
          {isOwner ? (
            <Link
              href={`/organisations/${organisation.slug}/leagues/new`}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
            >
              Create season
            </Link>
          ) : null}
        </Card>
      ) : (
        <div className="space-y-10">
          {phaseSections.map((section) => {
            const matchingSeasons = presentedSeasons
              .filter(({ phase }) => phase === section.phase)
              .sort((left, right) => {
                if (section.phase === "upcoming") {
                  return (left.season.starts_at ?? "9999-12-31").localeCompare(
                    right.season.starts_at ?? "9999-12-31",
                  );
                }
                if (section.phase === "completed") {
                  return (right.season.ends_at ?? "").localeCompare(
                    left.season.ends_at ?? "",
                  );
                }
                return (left.season.ends_at ?? "9999-12-31").localeCompare(
                  right.season.ends_at ?? "9999-12-31",
                );
              });

            if (matchingSeasons.length === 0) return null;

            return (
              <section key={section.phase} aria-labelledby={`${section.phase}-leagues-heading`}>
                <h2
                  id={`${section.phase}-leagues-heading`}
                  className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-foreground"
                >
                  {section.title}
                </h2>
                <div className="space-y-3">
                  {matchingSeasons.map(({ season, phase }) => (
                    <LeagueSeasonCard
                      key={season.id}
                      season={season}
                      organisationSlug={organisation.slug}
                      isOwner={isOwner}
                      phase={phase}
                      today={today}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </OrganisationPageFrame>
  );
}
