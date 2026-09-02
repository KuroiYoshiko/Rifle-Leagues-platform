import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card } from "@/components/ui";
import {
  getActiveOrganisationBySlug,
  getOrganisationTypeLabel,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation information",
};

export default async function OrganisationInformationPage({
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
    <OrganisationPageFrame
      organisation={organisation}
      currentSection="information"
    >
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-6">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
            About the leagues
          </span>
          <h2 className="mt-3 font-semibold text-foreground">
            Organisation league context
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {organisation.description ??
              "Detailed organisation-specific league information has not been published yet."}
          </p>
          <p className="mt-4 text-xs font-medium text-muted-foreground">
            Type: {getOrganisationTypeLabel(organisation.organisation_type)}
          </p>
        </Card>

        <Card className="p-6">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
            How to enter
          </span>
          <h2 className="mt-3 font-semibold text-foreground">
            Entry guidance is coming later
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Organisation-specific instructions will appear after the real league
            entry workflow is defined. Dashboard access itself grants no entry
            permission.
          </p>
        </Card>

        <Card className="p-6">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
            Rules &amp; regulations
          </span>
          <h2 className="mt-3 font-semibold text-foreground">
            No detailed rules published here yet
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Organisation-specific rules and regulations can be added to this area
            once that content is modelled and supplied.
          </p>
        </Card>
      </div>

      {organisation.website ? (
        <Card className="mt-6 bg-surface-muted p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-foreground">
            Published organisation website
          </h2>
          <a
            href={organisation.website}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
          >
            Visit website
            <span className="ml-1" aria-hidden="true">↗</span>
          </a>
        </Card>
      ) : null}
    </OrganisationPageFrame>
  );
}
