import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConcurrentShootingWorkspaceView } from "@/components/concurrent-shooting-management";
import { OrganisationManagementNavigation } from "@/components/organisation-management-navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { getConcurrentShootingWorkspace } from "@/lib/concurrent-shooting";
import { getLeagueSeasons } from "@/lib/league-seasons";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = { title: "Concurrent Shooting group" };

function parseGroupId(value: string) {
  const parsed = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

export default async function ConcurrentShootingGroupPage({
  params,
}: {
  params: Promise<{ slug: string; groupId: string }>;
}) {
  const { slug, groupId: rawGroupId } = await params;
  const groupId = parseGroupId(rawGroupId);
  if (!groupId) notFound();
  const context = await getOrganisationManagementContextBySlug(slug);
  if (!context) notFound();
  const [workspace, seasons] = await Promise.all([
    getConcurrentShootingWorkspace(context.organisation.id, groupId),
    getLeagueSeasons(context.organisation.id),
  ]);
  const seasonName = seasons.find((season) => season.id === workspace.group.league_season_id)?.name;
  if (!seasonName) notFound();

  return <OrganisationPageFrame organisation={context.organisation} currentSection="management">
    <OrganisationManagementNavigation organisationSlug={context.organisation.slug} current="concurrent" />
    <Link href={`/organisations/${context.organisation.slug}/management/concurrent-shooting`} className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline">← Back to Concurrent Shooting</Link>
    <div className="mt-6">
      <ConcurrentShootingWorkspaceView
        organisation={{ id: context.organisation.id, slug: context.organisation.slug }}
        seasonName={seasonName}
        workspace={workspace}
        isOwner={context.access.role === "owner"}
      />
    </div>
  </OrganisationPageFrame>;
}
