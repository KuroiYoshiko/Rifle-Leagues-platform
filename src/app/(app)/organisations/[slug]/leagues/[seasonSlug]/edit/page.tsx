import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeagueSeasonForm } from "@/components/league-season-form";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Edit league",
};

export default async function EditLeagueSeasonPage({
  params,
}: {
  params: Promise<{ slug: string; seasonSlug: string }>;
}) {
  const { slug, seasonSlug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);

  if (!context || context.access.role !== "owner") {
    notFound();
  }

  const season = await getLeagueSeasonBySlug(context.organisation.id, seasonSlug);

  if (!season) {
    notFound();
  }

  return (
    <OrganisationPageFrame
      organisation={context.organisation}
      currentSection="leagues"
    >
      <section aria-labelledby="edit-league-heading">
        <SectionHeader
          title="Edit league"
          description="Update dates, name, or move the season forward"
        />
        <Card className="p-6 sm:p-8">
          <h2 id="edit-league-heading" className="sr-only">
            Edit {season.name}
          </h2>
          <LeagueSeasonForm
            organisation={context.organisation}
            season={season}
          />
        </Card>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Status changes are manual and forward-only. Dates never change the
          status automatically.
        </p>
      </section>
    </OrganisationPageFrame>
  );
}
