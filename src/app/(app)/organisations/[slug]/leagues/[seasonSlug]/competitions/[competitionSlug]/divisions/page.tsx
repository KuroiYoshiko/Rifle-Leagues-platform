import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompetitionDivisionManager } from "@/components/competition-division-manager";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { getCompetitionDivisionManagement } from "@/lib/competition-divisions";
import { getCompetitionBySlug } from "@/lib/competitions";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Competition divisions",
};

export default async function CompetitionDivisionsPage({
  params,
}: {
  params: Promise<{
    slug: string;
    seasonSlug: string;
    competitionSlug: string;
  }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const managementContext = await getOrganisationManagementContextBySlug(slug);
  if (!managementContext) notFound();

  const season = await getLeagueSeasonBySlug(
    managementContext.organisation.id,
    seasonSlug,
  );
  if (!season) notFound();

  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition) notFound();

  const data = await getCompetitionDivisionManagement(
    managementContext.organisation.id,
    season.id,
    competition.id,
  );
  if (!data) notFound();

  const competitionHref = `/organisations/${slug}/leagues/${seasonSlug}/competitions/${competitionSlug}`;

  return (
    <OrganisationPageFrame
      organisation={managementContext.organisation}
      currentSection="leagues"
    >
      <CompetitionDivisionManager
        data={data}
        organisationId={managementContext.organisation.id}
        leagueSeasonId={season.id}
        competitionId={competition.id}
        backHref={competitionHref}
      />
    </OrganisationPageFrame>
  );
}
