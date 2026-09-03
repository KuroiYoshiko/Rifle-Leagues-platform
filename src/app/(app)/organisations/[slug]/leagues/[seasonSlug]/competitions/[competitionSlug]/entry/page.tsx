import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionEntryEditor } from "@/components/competition-entry-editor";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card } from "@/components/ui";
import {
  getClubCompetitionEntryManagement,
  getClubCompetitionEntryStatusLabel,
  searchClubCompetitionEntryMembers,
} from "@/lib/competition-entries";
import { getCompetitionBySlug, getCompetitionEntryFormatLabel } from "@/lib/competitions";
import {
  formatLeagueSeasonDate,
  getLeagueSeasonBySlug,
} from "@/lib/league-seasons";
import { getActiveOrganisationBySlug } from "@/lib/organisations";

export const metadata: Metadata = { title: "Manage competition entry" };

function readEntryId(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const number = Number(raw);
  return /^\d+$/.test(raw ?? "") && Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

export default async function CompetitionEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; seasonSlug: string; competitionSlug: string }>;
  searchParams: Promise<{ entry?: string | string[] }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const entryId = readEntryId((await searchParams).entry);
  if (!entryId) notFound();

  const organisation = await getActiveOrganisationBySlug(slug);
  if (!organisation) notFound();

  const season = await getLeagueSeasonBySlug(organisation.id, seasonSlug);
  if (!season) notFound();

  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition) notFound();

  const data = await getClubCompetitionEntryManagement(entryId);
  if (
    !data ||
    data.organisation.id !== organisation.id ||
    data.season.id !== season.id ||
    data.competition.id !== competition.id
  ) {
    notFound();
  }

  const initialMembers = await searchClubCompetitionEntryMembers(entryId);
  const formatLabel = getCompetitionEntryFormatLabel(competition.entry_format);
  const entryWindow =
    season.entry_opens_at && season.entry_closes_at
      ? `${formatLeagueSeasonDate(season.entry_opens_at)} – ${formatLeagueSeasonDate(season.entry_closes_at)}`
      : "Entry dates not configured";

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      <Link
        href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`}
        className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        ← Back to {competition.name}
      </Link>

      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={data.entry.status === "submitted" ? "positive" : data.entry.status === "draft" ? "warning" : "neutral"}>
              {getClubCompetitionEntryStatusLabel(data.entry.status)}
            </Badge>
            {data.entry_window_state !== "open" ? <Badge tone="neutral">Entry closed</Badge> : null}
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">{data.club.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">{competition.name}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {formatLabel}{competition.entry_format === "team" ? ` · ${competition.team_size} shooters per team` : ""}
          </p>
        </div>
      </div>

      <Card className="mt-6 grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">League season</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{season.name}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Entry window</p>
          <p className="mt-2 text-sm font-semibold text-foreground">{entryWindow}</p>
        </div>
      </Card>

      <div className="mt-8">
        <CompetitionEntryEditor data={data} initialMembers={initialMembers} />
      </div>
    </OrganisationPageFrame>
  );
}
