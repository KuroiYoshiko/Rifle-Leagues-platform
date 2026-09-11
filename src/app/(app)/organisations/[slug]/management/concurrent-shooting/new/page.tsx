import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConcurrentShootingCreateForm } from "@/components/concurrent-shooting-management";
import { OrganisationManagementNavigation } from "@/components/organisation-management-navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { SectionHeader } from "@/components/ui";
import { getLeagueSeasons } from "@/lib/league-seasons";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = { title: "Create Concurrent Shooting group" };

export default async function CreateConcurrentShootingGroupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);
  if (!context) notFound();
  const seasons = (await getLeagueSeasons(context.organisation.id))
    .filter((season) => season.status !== "completed");

  return <OrganisationPageFrame organisation={context.organisation} currentSection="management">
    <OrganisationManagementNavigation organisationSlug={context.organisation.slug} current="concurrent" />
    <Link href={`/organisations/${context.organisation.slug}/management/concurrent-shooting`} className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline">← Back to Concurrent Shooting</Link>
    <div className="mt-6">
      <SectionHeader title="Create Concurrent Shooting Group" description="Start with a Season and an organiser-facing name" />
      <ConcurrentShootingCreateForm
        organisation={{ id: context.organisation.id, slug: context.organisation.slug }}
        seasons={seasons}
      />
    </div>
  </OrganisationPageFrame>;
}
