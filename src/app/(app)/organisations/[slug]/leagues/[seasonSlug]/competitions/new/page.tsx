import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompetitionForm } from "@/components/competition-form";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
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

  if (!context || context.access.role !== "owner") {
    notFound();
  }

  const season = await getLeagueSeasonBySlug(
    context.organisation.id,
    seasonSlug,
  );

  if (!season) {
    notFound();
  }

  return (
    <OrganisationPageFrame
      organisation={context.organisation}
      currentSection="leagues"
    >
      <SectionHeader
        title="Add competition"
        description={`Configure a competition within ${season.name}`}
      />
      <Card className="min-w-0 p-5 sm:p-8">
        <CompetitionForm
          organisation={context.organisation}
          season={season}
        />
      </Card>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        New competitions are always saved as private drafts. Entries, divisions,
        scores, and standings are not created here.
      </p>
    </OrganisationPageFrame>
  );
}
