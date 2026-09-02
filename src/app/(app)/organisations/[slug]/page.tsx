import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrganisationAbout } from "@/components/organisation-about";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Card, SectionHeader } from "@/components/ui";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Organisation overview",
};

export default async function OrganisationOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ registered?: string | string[] }>;
}) {
  const { slug } = await params;
  const { registered } = await searchParams;
  const [organisation, managementContext] = await Promise.all([
    getActiveOrganisationBySlug(slug),
    getOrganisationManagementContextBySlug(slug),
  ]);
  const registrationSucceeded = Array.isArray(registered)
    ? registered[0] === "1"
    : registered === "1";

  if (!organisation) {
    notFound();
  }

  return (
    <OrganisationPageFrame
      organisation={organisation}
      currentSection="overview"
    >
      {registrationSucceeded ? (
        <div
          className="mb-8 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">Organisation registered.</strong>{" "}
          You are now its owner, and it has been added to My Organisations through
          your active management access.
        </div>
      ) : null}
      <OrganisationAbout
        key={organisation.updated_at}
        organisationId={organisation.id}
        initialContent={organisation.about_content}
        isOwner={managementContext?.access.role === "owner"}
      />

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
    </OrganisationPageFrame>
  );
}
