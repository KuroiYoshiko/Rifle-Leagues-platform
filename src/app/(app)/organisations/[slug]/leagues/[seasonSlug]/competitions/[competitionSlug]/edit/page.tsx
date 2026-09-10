import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompetitionForm } from "@/components/competition-form";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import {
  getCompetitionBySlug,
  getCompetitionRounds,
  getCompetitionScoreComponents,
  getShootingTaxonomy,
} from "@/lib/competitions";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import { getCompetitionSeries } from "@/lib/competition-series";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Edit competition",
};

export default async function EditCompetitionPage({
  params,
}: {
  params: Promise<{
    slug: string;
    seasonSlug: string;
    competitionSlug: string;
  }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);

  if (!context) {
    notFound();
  }

  const season = await getLeagueSeasonBySlug(
    context.organisation.id,
    seasonSlug,
  );
  if (!season) {
    notFound();
  }

  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition) {
    notFound();
  }
  if (context.access.role === "manager" && competition.status !== "draft") {
    notFound();
  }

  const [rounds, scoreComponents, seriesRows, shootingTaxonomy] = await Promise.all([
    getCompetitionRounds(competition.id),
    getCompetitionScoreComponents(competition.id),
    competition.competition_series_id
      ? getCompetitionSeries(context.organisation.id)
      : Promise.resolve([]),
    getShootingTaxonomy(context.organisation.id),
  ]);
  const series = seriesRows.find(
    (item) => item.id === competition.competition_series_id,
  );
  if (competition.competition_series_id && !series) {
    notFound();
  }

  return (
    <OrganisationPageFrame
      organisation={context.organisation}
      currentSection="leagues"
    >
      <SectionHeader
        title="Edit competition"
        description={`Update the configuration, Round End dates, and optional Shoot-by dates for ${competition.name}`}
      />
      <Card className="min-w-0 p-5 sm:p-8">
        <CompetitionForm
          organisation={context.organisation}
          season={season}
          competition={competition}
          rounds={rounds}
          scoreComponents={scoreComponents}
          series={series}
          shootingTaxonomy={shootingTaxonomy}
        />
      </Card>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Drafts remain private. Published competition changes must stay complete
        and valid.
      </p>
    </OrganisationPageFrame>
  );
}
