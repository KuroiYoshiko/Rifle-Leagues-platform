import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionAverageWorkspace } from "@/components/competition-average-workspace";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { SectionHeader } from "@/components/ui";
import {
  getAverageConfiguration,
  getCompetitionAverageManagement,
} from "@/lib/competition-averages";
import {
  getCompetitionBySlug,
  getCompetitionScoreComponents,
} from "@/lib/competitions";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import { getOrganisationManagementContextBySlug } from "@/lib/organisations";

export const metadata: Metadata = { title: "Starting averages" };

export default async function CompetitionAveragesPage({
  params,
}: {
  params: Promise<{ slug: string; seasonSlug: string; competitionSlug: string }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const context = await getOrganisationManagementContextBySlug(slug);
  if (!context) notFound();
  const season = await getLeagueSeasonBySlug(context.organisation.id, seasonSlug);
  if (!season) notFound();
  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition) notFound();

  const [scoreComponents, configuration] = await Promise.all([
    getCompetitionScoreComponents(competition.id),
    getAverageConfiguration(context.organisation.id),
  ]);
  const shooterMaximum = competition.sets_per_round * scoreComponents.reduce(
    (total, component) => total + Number(component.maximum_score), 0,
  );
  const management = await getCompetitionAverageManagement(
    context.organisation.id,
    season.id,
    competition.id,
    configuration,
  );
  const competitionPath = `/organisations/${context.organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`;

  return <OrganisationPageFrame organisation={context.organisation} currentSection="leagues">
    <SectionHeader
      title="Starting averages"
      description={`${competition.name} · provisional shooter averages`}
      action={<Link href={competitionPath} className="inline-flex min-h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle">Back to Competition</Link>}
    />
    <CompetitionAverageWorkspace
      organisation={{ id: context.organisation.id, slug: context.organisation.slug }}
      season={{ id: season.id, slug: season.slug }}
      competition={{
        id: competition.id,
        name: competition.name,
        slug: competition.slug,
        status: competition.status,
        shooterMaximum,
      }}
      configuration={configuration}
      management={management}
    />
  </OrganisationPageFrame>;
}
