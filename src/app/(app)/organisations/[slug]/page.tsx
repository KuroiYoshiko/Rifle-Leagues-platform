import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrganisationAbout } from "@/components/organisation-about";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  getLeagueEntrySummary,
  getLeagueSeasons,
  getLeagueSeasonDateSummary,
  getLeagueSeasonPresentationPhase,
  getLeagueToday,
  type LeagueSeason,
} from "@/lib/league-seasons";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation overview",
};

function OverviewLeagueCard({
  organisationSlug,
  season,
  phase,
  today,
}: {
  organisationSlug: string;
  season: LeagueSeason;
  phase: "ongoing" | "upcoming";
  today: string;
}) {
  const entrySummary = getLeagueEntrySummary(
    season.entry_opens_at,
    season.entry_closes_at,
    today,
  );
  const seasonSummary = getLeagueSeasonDateSummary(
    season.starts_at,
    season.ends_at,
  );

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <Badge tone={phase === "ongoing" ? "positive" : "brand"}>
        {phase === "ongoing" ? "Ongoing" : "Upcoming"}
      </Badge>
      <h3 className="mt-3 break-words font-semibold text-foreground">
        <Link
          href={`/organisations/${organisationSlug}/leagues/${season.slug}`}
          className="hover:text-brand-deep hover:underline"
        >
          {season.name}
        </Link>
      </h3>
      <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
        {entrySummary ? <p>{entrySummary}</p> : null}
        {seasonSummary ? <p>{seasonSummary}</p> : null}
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
  const [organisation, managementContext] = await Promise.all([
    getActiveOrganisationBySlug(slug),
    getOrganisationManagementContextBySlug(slug),
  ]);
  const registrationSucceeded = Array.isArray(registered)
    ? registered[0] === "1"
    : registered === "1";

  if (!organisation) {
    notFound();
  }

  const seasons = await getLeagueSeasons(organisation.id);
  const today = getLeagueToday();
  const publishedSeasons = seasons.filter(
    (season) => season.status === "open" || season.status === "active",
  );
  const ongoingSeasons = publishedSeasons.filter(
    (season) => getLeagueSeasonPresentationPhase(season, today) === "ongoing",
  );
  const upcomingSeasons = publishedSeasons.filter(
    (season) => getLeagueSeasonPresentationPhase(season, today) === "upcoming",
  );

  return (
    <OrganisationPageFrame
      organisation={organisation}
      currentSection="overview"
    >
      {registrationSucceeded ? (
        <div
          className="mb-8 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">Organisation registered.</strong>{" "}
          You are now its owner, and it has been added to My Organisations through
          your active management access.
        </div>
      ) : null}
      <OrganisationAbout
        key={organisation.updated_at}
        organisationId={organisation.id}
        initialContent={organisation.about_content}
        isOwner={managementContext?.access.role === "owner"}
      />

      <section className="mt-10" aria-label="Ongoing leagues">
        <SectionHeader
          title="Ongoing leagues"
          description="Published seasons currently in progress"
        />
        {ongoingSeasons.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {ongoingSeasons.map((season) => (
              <OverviewLeagueCard
                key={season.id}
                organisationSlug={organisation.slug}
                season={season}
                phase="ongoing"
                today={today}
              />
            ))}
          </div>
        ) : (
          <Card className="p-6 sm:p-8">
            <h2 className="font-semibold text-foreground">
              No ongoing league seasons
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Published seasons appear here while today falls within their
              scheduled season dates.
            </p>
          </Card>
        )}
      </section>

      <section className="mt-10" aria-label="Upcoming leagues">
        <SectionHeader
          title="Upcoming leagues"
          description="Published seasons scheduled to start in the future"
        />
        {upcomingSeasons.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {upcomingSeasons.map((season) => (
              <OverviewLeagueCard
                key={season.id}
                organisationSlug={organisation.slug}
                season={season}
                phase="upcoming"
                today={today}
              />
            ))}
          </div>
        ) : (
          <Card className="p-6 sm:p-8">
            <h2 className="font-semibold text-foreground">
              No upcoming league seasons
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Published seasons with a future start date will appear here.
            </p>
          </Card>
        )}
      </section>
    </OrganisationPageFrame>
  );
}
