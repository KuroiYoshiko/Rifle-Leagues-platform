import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompetitionCreationFlow } from "@/components/competition-creation-flow";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import { getCompetitionSeriesCreationOptions } from "@/lib/competition-series";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Add competition",
};

export default async function CreateCompetitionPage({
  params,
}: {
  params: Promise<{ slug: string; seasonSlug: string }>;
}) {
  const { slug, seasonSlug } = await params;
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
  const seriesOptions = await getCompetitionSeriesCreationOptions(
    context.organisation.id,
    season.id,
  );

  return (
    <OrganisationPageFrame
      organisation={context.organisation}
      currentSection="leagues"
    >
      <SectionHeader
        title="Add competition"
        description={`Choose how this Competition belongs in ${season.name}`}
      />
      <Card className="min-w-0 p-5 sm:p-8">
        <CompetitionCreationFlow
          organisation={context.organisation}
          season={season}
          seriesOptions={seriesOptions}
        />
      </Card>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        New competitions are always saved as private drafts. Entries, divisions,
        scores, and standings are not created here.
      </p>
    </OrganisationPageFrame>
  );
}
