import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrganisationAbout } from "@/components/organisation-about";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  formatLeagueSeasonDate,
  getLeagueSeasons,
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
  type,
}: {
  organisationSlug: string;
  season: LeagueSeason;
  type: "active" | "open";
}) {
  const starts = formatLeagueSeasonDate(season.starts_at);
  const entryCloses = formatLeagueSeasonDate(season.entry_closes_at);

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <Badge tone={type === "active" ? "positive" : "brand"}>
        {type === "active" ? "Active" : "Open"}
      </Badge>
      <h3 className="mt-3 break-words font-semibold text-foreground">
        <Link
          href={`/organisations/${organisationSlug}/leagues/${season.slug}`}
          className="hover:text-brand-deep hover:underline"
        >
          {season.name}
        </Link>
      </h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {type === "open"
          ? entryCloses
            ? `Entry closes ${entryCloses}`
            : starts
              ? `Starts ${starts}`
              : "Dates have not been set"
          : starts
            ? `Started ${starts}`
            : "Season dates have not been set"}
      </p>
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
  const activeSeasons = seasons.filter((season) => season.status === "active");
  const openSeasons = seasons.filter((season) => season.status === "open");

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

      <section className="mt-10" aria-label="League activity">
        <SectionHeader
          title="League activity"
          description="League seasons currently marked as active"
        />
        {activeSeasons.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {activeSeasons.map((season) => (
              <OverviewLeagueCard
                key={season.id}
                organisationSlug={organisation.slug}
                season={season}
                type="active"
              />
            ))}
          </div>
        ) : (
          <Card className="p-6 sm:p-8">
            <h2 className="font-semibold text-foreground">
              No active league seasons
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              A season will appear here when its owner moves it to Active.
            </p>
          </Card>
        )}
      </section>

      <section className="mt-10" aria-label="Upcoming leagues">
        <SectionHeader
          title="Upcoming leagues"
          description="Published league seasons currently open"
        />
        {openSeasons.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {openSeasons.map((season) => (
              <OverviewLeagueCard
                key={season.id}
                organisationSlug={organisation.slug}
                season={season}
                type="open"
              />
            ))}
          </div>
        ) : (
          <Card className="p-6 sm:p-8">
            <h2 className="font-semibold text-foreground">
              No open league seasons
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Published seasons will appear here when they are marked Open.
            </p>
          </Card>
        )}
      </section>
    </OrganisationPageFrame>
  );
}
