import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  OrganisationEmptyState,
  OrganisationPageFrame,
} from "@/components/organisation-page-frame";
import { Card } from "@/components/ui";
import { getActiveOrganisationBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation results",
};

export default async function OrganisationResultsPage({
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
    <OrganisationPageFrame organisation={organisation} currentSection="results">
      <Card className="p-6 sm:p-8">
        <OrganisationEmptyState
          mark="R"
          title="No results are available yet"
          description="Published results will appear here after real leagues, competitions, divisions and scores exist in RifleLeagues."
        />
      </Card>

      <Card className="mt-6 bg-surface-muted p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">
          Designed for focused result browsing
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
          This area will later support finding results by season, competition and
          division. No standings, shooter records or statistics are being inferred
          before those data models exist.
        </p>
      </Card>
    </OrganisationPageFrame>
  );
}
