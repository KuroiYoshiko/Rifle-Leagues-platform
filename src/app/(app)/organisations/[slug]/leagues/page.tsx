import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  OrganisationEmptyState,
  OrganisationPageFrame,
} from "@/components/organisation-page-frame";
import { Card } from "@/components/ui";
import { getActiveOrganisationBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation leagues",
};

const leagueAreas = [
  {
    title: "Current",
    description: "Leagues currently in progress will appear here.",
  },
  {
    title: "Upcoming",
    description: "Published future leagues and entry windows will appear here.",
  },
  {
    title: "Past",
    description: "Completed league history will appear here.",
  },
];

export default async function OrganisationLeaguesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const organisation = await getActiveOrganisationBySlug(slug);

  if (!organisation) {
    notFound();
  }

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      <Card className="p-6 sm:p-8">
        <OrganisationEmptyState
          mark="L"
          title="No league data has been added yet"
          description="Real league records will be organised here as current, upcoming and past once the league and season model exists."
        />
      </Card>

      <section className="mt-6 grid gap-4 md:grid-cols-3" aria-label="Future league areas">
        {leagueAreas.map((area) => (
          <Card key={area.title} className="p-5 sm:p-6">
            <h2 className="font-semibold text-foreground">{area.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {area.description}
            </p>
          </Card>
        ))}
      </section>

      <Card className="mt-6 bg-surface-muted p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">League entry</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
          Adding an organisation to your dashboard is for navigation only. A club
          official with the relevant club permissions may later enter shooters
          from their club when the entry workflow exists.
        </p>
      </Card>
    </OrganisationPageFrame>
  );
}
