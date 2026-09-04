import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionResultsPreview } from "@/components/competition-results-preview";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card } from "@/components/ui";
import {
  getCompetitionBySlug,
  getCompetitionEntryFormatLabel,
} from "@/lib/competitions";
import { getCompetitionRoundResults } from "@/lib/competition-results";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import { getActiveOrganisationBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Competition results preview",
};

function positiveInteger(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^[1-9][0-9]*$/.test(candidate)) return null;
  const number = Number(candidate);
  return Number.isSafeInteger(number) ? number : null;
}

export default async function CompetitionResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{
    slug: string;
    seasonSlug: string;
    competitionSlug: string;
  }>;
  searchParams: Promise<{ club?: string | string[] }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const query = await searchParams;
  const organisation = await getActiveOrganisationBySlug(slug);
  if (!organisation) notFound();

  const season = await getLeagueSeasonBySlug(organisation.id, seasonSlug);
  if (!season) notFound();

  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition || competition.status !== "published") notFound();

  const clubId = positiveInteger(query.club);
  const data = await getCompetitionRoundResults(
    organisation.id,
    season.id,
    competition.id,
    clubId,
  );
  if (!data) notFound();

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
              <Badge tone="brand">Internal preview</Badge>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              Competition results
            </h1>
            <p className="mt-2 text-base font-semibold text-brand-deep">
              {competition.name}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Live Round results derived from participant source scores. This
              diagnostic preview does not calculate ranking positions or
              standings.
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <CompetitionResultsPreview data={data} />
      </div>
    </OrganisationPageFrame>
  );
}
