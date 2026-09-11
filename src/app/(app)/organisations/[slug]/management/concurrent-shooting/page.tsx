import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ConcurrentShootingGroupList,
  type ConcurrentShootingListRow,
} from "@/components/concurrent-shooting-management";
import { OrganisationManagementNavigation } from "@/components/organisation-management-navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { SectionHeader } from "@/components/ui";
import {
  getConcurrentShootingGroupLifecycle,
  getConcurrentShootingGroups,
} from "@/lib/concurrent-shooting";
import { getLeagueSeasons } from "@/lib/league-seasons";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = { title: "Concurrent Shooting" };

const createButtonClass = "inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep";

export default async function OrganisationConcurrentShootingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);
  if (!context) notFound();

  const [groups, seasons] = await Promise.all([
    getConcurrentShootingGroups(context.organisation.id),
    getLeagueSeasons(context.organisation.id),
  ]);
  const lifecycleRows = await Promise.all(
    groups.map((group) => getConcurrentShootingGroupLifecycle(context.organisation.id, group.id)),
  );
  const seasonNames = new Map(seasons.map((season) => [season.id, season.name]));
  const rows: ConcurrentShootingListRow[] = groups.map((group, index) => ({
    ...group,
    season_name: seasonNames.get(group.league_season_id) ?? "Unknown Season",
    lifecycle: lifecycleRows[index],
  }));

  return <OrganisationPageFrame organisation={context.organisation} currentSection="management">
    <OrganisationManagementNavigation organisationSlug={context.organisation.slug} current="concurrent" />
    <SectionHeader
      title="Concurrent Shooting"
      description="Reuse one physical shooter score across compatible Competitions"
      action={<Link href={`/organisations/${context.organisation.slug}/management/concurrent-shooting/new`} className={createButtonClass}>Create group</Link>}
    />
    <ConcurrentShootingGroupList
      organisation={{ id: context.organisation.id, slug: context.organisation.slug }}
      groups={rows}
      isOwner={context.access.role === "owner"}
    />
  </OrganisationPageFrame>;
}
