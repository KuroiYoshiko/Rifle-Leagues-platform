import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import { getActiveOrganisationBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation overview",
};

export default async function OrganisationOverviewPage({
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
      currentSection="overview"
    >
      <section>
        <SectionHeader
          title="About"
          description="Public information supplied for this organisation"
        />
        <Card className="p-6 sm:p-8">
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            {organisation.description ??
              "A detailed organisation description has not been added yet."}
          </p>
          {organisation.website ? (
            <a
              href={organisation.website}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
            >
              Visit organisation website
              <span className="ml-1" aria-hidden="true">↗</span>
            </a>
          ) : null}
        </Card>
      </section>

      <section className="mt-10" aria-labelledby="league-activity-heading">
        <SectionHeader
          title="League activity"
          description="A future summary of this organisation’s real leagues"
        />
        <Card className="p-6 sm:p-8">
          <h2 id="league-activity-heading" className="font-semibold text-foreground">
            No league data has been added yet
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Current league and season activity will appear here after the league
            data model is introduced and real records exist.
          </p>
        </Card>
      </section>

      <section className="mt-10" aria-labelledby="upcoming-leagues-heading">
        <SectionHeader
          title="Upcoming leagues"
          description="Future entry windows and published league dates"
        />
        <Card className="p-6 sm:p-8">
          <h2 id="upcoming-leagues-heading" className="font-semibold text-foreground">
            Nothing to show yet
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Upcoming league information will appear here once real league data
            exists. Adding this organisation does not grant entry permission.
          </p>
        </Card>
      </section>

      <section className="mt-10" aria-labelledby="overview-contact-heading">
        <SectionHeader title="Contact" description="Published organisation contact details" />
        <Card className="p-6 sm:p-8">
          <h2 id="overview-contact-heading" className="font-semibold text-foreground">
            {organisation.contact_email
              ? "Contact the organisation"
              : "Contact details are not available yet"}
          </h2>
          {organisation.contact_email ? (
            <a
              href={`mailto:${organisation.contact_email}`}
              className="mt-3 inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
            >
              {organisation.contact_email}
            </a>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              A contact email has not been published for this organisation.
            </p>
          )}
        </Card>
      </section>
    </OrganisationPageFrame>
  );
}
