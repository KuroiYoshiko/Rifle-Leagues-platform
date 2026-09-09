import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompetitionSeriesManager } from "@/components/competition-series-manager";
import { OrganisationManagementNavigation } from "@/components/organisation-management-navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { SectionHeader } from "@/components/ui";
import { getCompetitionSeriesManagementRows } from "@/lib/competition-series";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = { title: "Competition Series" };

export default async function OrganisationCompetitionSeriesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);
  if (!context) notFound();
  const series = await getCompetitionSeriesManagementRows(context.organisation.id);

  return <OrganisationPageFrame organisation={context.organisation} currentSection="management">
    <OrganisationManagementNavigation organisationSlug={context.organisation.slug} current="series" />
    <SectionHeader
      title="Competition Series"
      description="Manage recurring Competition identity and editions"
    />
    <CompetitionSeriesManager
      organisation={{ id: context.organisation.id, slug: context.organisation.slug }}
      series={series}
      canManage={context.access.role === "owner"}
    />
  </OrganisationPageFrame>;
}
