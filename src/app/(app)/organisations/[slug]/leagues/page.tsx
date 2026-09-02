import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  OrganisationEmptyState,
  OrganisationPageFrame,
} from "@/components/organisation-page-frame";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  getLeagueEntrySummary,
  getLeagueSeasons,
  getLeagueSeasonDateSummary,
  getLeagueSeasonStatusLabel,
  type LeagueSeason,
  type LeagueSeasonStatus,
} from "@/lib/league-seasons";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation leagues",
};

const statusSections: Array<{
  status: LeagueSeasonStatus;
  title: string;
  description: string;
  tone: "neutral" | "positive" | "warning" | "brand";
}> = [
  {
    status: "draft",
    title: "Draft",
    description: "Private seasons still being prepared",
    tone: "warning",
  },
  {
    status: "open",
    title: "Open",
    description: "Published seasons preparing to accept entries later",
    tone: "brand",
  },
  {
    status: "active",
    title: "Active",
    description: "Published seasons currently running",
    tone: "positive",
  },
  {
    status: "completed",
    title: "Completed",
    description: "Published season history",
    tone: "neutral",
  },
];

function LeagueSeasonCard({
  season,
  organisationSlug,
  isOwner,
  tone,
}: {
  season: LeagueSeason;
  organisationSlug: string;
  isOwner: boolean;
  tone: "neutral" | "positive" | "warning" | "brand";
}) {
  const detailPath = `/organisations/${organisationSlug}/leagues/${season.slug}`;
  const entrySummary = getLeagueEntrySummary(
    season.entry_opens_at,
    season.entry_closes_at,
  );
  const seasonSummary = getLeagueSeasonDateSummary(
    season.starts_at,
    season.ends_at,
  );

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>
              {getLeagueSeasonStatusLabel(season.status)}
            </Badge>
            {season.status === "draft" ? (
              <span className="text-xs text-muted-foreground">Owner only</span>
            ) : null}
          </div>
          <h3 className="mt-3 break-words text-lg font-semibold tracking-[-0.02em] text-foreground">
            <Link href={detailPath} className="hover:text-brand-deep hover:underline">
              {season.name}
            </Link>
          </h3>
          <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
            {entrySummary ? <p>{entrySummary}</p> : null}
            {seasonSummary ? <p>{seasonSummary}</p> : null}
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
  const [organisation, managementContext] = await Promise.all([
    getActiveOrganisationBySlug(slug),
    getOrganisationManagementContextBySlug(slug),
  ]);

  if (!organisation) {
    notFound();
  }

  const seasons = await getLeagueSeasons(organisation.id);
  const isOwner = managementContext?.access.role === "owner";

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      <SectionHeader
        title="Leagues"
        description={
          isOwner
            ? `${seasons.length} league season${seasons.length === 1 ? "" : "s"}`
            : "Published league seasons"
        }
        action={
          isOwner ? (
            <Link
              href={`/organisations/${organisation.slug}/leagues/new`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
            >
              + Create league
            </Link>
          ) : null
        }
      />

      {seasons.length === 0 ? (
        <Card className="p-6 sm:p-8">
          <OrganisationEmptyState
            mark="L"
            title={isOwner ? "Create the first league season" : "No published leagues yet"}
            description={
              isOwner
                ? "League seasons are the containers that will later hold competitions. Your first season will begin as a private draft."
                : "This organisation has not published an open, active, or completed league season yet."
            }
          />
          {isOwner ? (
            <Link
              href={`/organisations/${organisation.slug}/leagues/new`}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep"
            >
              Create league
            </Link>
          ) : null}
        </Card>
      ) : (
        <div className="space-y-10">
          {statusSections.map((section) => {
            const matchingSeasons = seasons.filter(
              (season) => season.status === section.status,
            );

            if (matchingSeasons.length === 0) return null;

            return (
              <section key={section.status} aria-labelledby={`${section.status}-leagues-heading`}>
                <div className="mb-4">
                  <h2
                    id={`${section.status}-leagues-heading`}
                    className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground"
                  >
                    {section.title}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {section.description}
                  </p>
                </div>
                <div className="space-y-3">
                  {matchingSeasons.map((season) => (
                    <LeagueSeasonCard
                      key={season.id}
                      season={season}
                      organisationSlug={organisation.slug}
                      isOwner={isOwner}
                      tone={section.tone}
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
