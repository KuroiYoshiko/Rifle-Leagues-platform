import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompetitionScoreEntryEditor } from "@/components/competition-score-entry-editor";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card } from "@/components/ui";
import {
  getCompetitionBySlug,
  getCompetitionEntryFormatLabel,
  getCompetitionRounds,
} from "@/lib/competitions";
import { getCompetitionScoreEntry } from "@/lib/competition-scores";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import { getActiveOrganisationBySlug } from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Competition scores",
};

function positiveInteger(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^[1-9][0-9]*$/.test(candidate)) return null;
  const number = Number(candidate);
  return Number.isSafeInteger(number) ? number : null;
}

export default async function CompetitionScoresPage({
  params,
  searchParams,
}: {
  params: Promise<{
    slug: string;
    seasonSlug: string;
    competitionSlug: string;
  }>;
  searchParams: Promise<{
    round?: string | string[];
    club?: string | string[];
  }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const query = await searchParams;
  const organisation = await getActiveOrganisationBySlug(slug);
  if (!organisation) notFound();

  const season = await getLeagueSeasonBySlug(organisation.id, seasonSlug);
  if (!season) notFound();

  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition || competition.status !== "published") {
    notFound();
  }

  const rounds = await getCompetitionRounds(competition.id);
  const requestedRoundId = positiveInteger(query.round);
  const selectedRound =
    rounds.find((round) => round.id === requestedRoundId) ?? rounds[0];
  const clubId = positiveInteger(query.club);

  if (!selectedRound) {
    return (
      <OrganisationPageFrame
        organisation={organisation}
        currentSection="leagues"
      >
        <Link
          href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`}
          className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
        >
          ← Back to competition
        </Link>
        <Card className="mt-5 p-6 sm:p-8">
          <h2 className="font-semibold text-foreground">
            No Competition Rounds configured
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            A Round must be configured before scores can be entered.
          </p>
        </Card>
      </OrganisationPageFrame>
    );
  }

  const data = await getCompetitionScoreEntry(
    organisation.id,
    season.id,
    competition.id,
    selectedRound.id,
    clubId,
  );
  if (!data) notFound();

  return (
    <OrganisationPageFrame
      organisation={organisation}
      currentSection="leagues"
    >
      <Link
        href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}`}
        className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        ← Back to competition
      </Link>

      <Card className="mt-5 p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Badge tone="positive">
              {getCompetitionEntryFormatLabel(competition.entry_format)} Competition
            </Badge>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              {data.can_edit ? "Manage scores" : "View scores"}
            </h1>
            <p className="mt-2 text-base font-semibold text-brand-deep">
              {competition.name}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {data.can_edit
                ? "Enter one selected Round for every participant in each submitted entrant. Blank fields remain unrecorded; they are not converted to zero or NSR."
                : "Review participant source scores for the selected Round. Read-only fields cannot be changed in this scoring scope."}
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-6">
        <CompetitionScoreEntryEditor
          key={`${selectedRound.id}-${clubId ?? "organisation"}`}
          data={data}
          rounds={rounds}
          organisationId={organisation.id}
          leagueSeasonId={season.id}
          clubId={clubId}
        />
      </div>
    </OrganisationPageFrame>
  );
}
