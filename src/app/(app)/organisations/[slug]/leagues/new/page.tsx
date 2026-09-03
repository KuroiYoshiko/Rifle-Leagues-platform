import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeagueSeasonForm } from "@/components/league-season-form";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Create league",
};

export default async function CreateLeagueSeasonPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);

  if (!context || context.access.role !== "owner") {
    notFound();
  }

  const { organisation } = context;

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      <section aria-labelledby="create-league-heading">
        <SectionHeader
          title="Create league"
          description="Add a season container for this organisation"
        />
        <Card className="p-6 sm:p-8">
          <h2 id="create-league-heading" className="sr-only">
            League season details
          </h2>
          <LeagueSeasonForm organisation={organisation} />
        </Card>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          This creates the league season only. Competitions, entries, scores,
          and standings are not part of this step.
        </p>
      </section>
    </OrganisationPageFrame>
  );
}
