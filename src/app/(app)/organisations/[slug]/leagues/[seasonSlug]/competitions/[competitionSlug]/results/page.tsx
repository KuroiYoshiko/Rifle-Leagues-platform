import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionAggregateResultsTable } from "@/components/competition-aggregate-results";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card } from "@/components/ui";
import {
  getCompetitionBySlug,
  getCompetitionEntryFormatLabel,
} from "@/lib/competitions";
import { getCompetitionAggregateResults } from "@/lib/competition-aggregate-results";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import { getActiveOrganisationBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Competition results",
};

export default async function CompetitionResultsPage({
  params,
}: {
  params: Promise<{
    slug: string;
    seasonSlug: string;
    competitionSlug: string;
  }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const organisation = await getActiveOrganisationBySlug(slug);
  if (!organisation) notFound();

  const season = await getLeagueSeasonBySlug(organisation.id, seasonSlug);
  if (!season) notFound();

  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition || competition.status !== "published") notFound();

  const data = competition.ranking_method === "aggregate" ? await getCompetitionAggregateResults(
    organisation.id,
    season.id,
    competition.id,
  ) : null;
  if (competition.ranking_method === "aggregate" && !data) notFound();

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      <Link
        href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`}
        className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        ← Back to competition
      </Link>

      <Card className="mt-5 p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="positive">
                {getCompetitionEntryFormatLabel(competition.entry_format)} Competition
              </Badge>
              {competition.ranking_method === "aggregate" ? <Badge tone="brand">Aggregate standings</Badge> : null}
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              Competition results
            </h1>
            <p className="mt-2 text-base font-semibold text-brand-deep">
              {competition.name}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Released Round results and standings across all participating clubs.
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-6">
        {data ? <CompetitionAggregateResultsTable data={data} /> : (
          <Card className="p-6 text-sm text-muted-foreground">Standings for this ranking method are not available yet.</Card>
        )}
      </div>
    </OrganisationPageFrame>
  );
}
