import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AverageManagement } from "@/components/average-management";
import { OrganisationManagementNavigation } from "@/components/organisation-management-navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { SectionHeader } from "@/components/ui";
import {
  getAverageConfiguration,
  getAverageSeriesManagementRows,
} from "@/lib/competition-averages";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = { title: "Averages" };

export default async function OrganisationAveragesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);
  if (!context) notFound();

  const [configuration, series] = await Promise.all([
    getAverageConfiguration(context.organisation.id),
    getAverageSeriesManagementRows(context.organisation.id),
  ]);

  return <OrganisationPageFrame organisation={context.organisation} currentSection="management">
    <OrganisationManagementNavigation organisationSlug={context.organisation.slug} current="averages" />
    <SectionHeader
      title="Averages"
      description="Set which Competitions share shooter history and how Starting Averages are calculated"
    />
    <AverageManagement
      organisation={{ id: context.organisation.id, slug: context.organisation.slug }}
      configuration={configuration}
      series={series}
    />
  </OrganisationPageFrame>;
}
