import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrganisationPageFrame } from "@/components/organisation-page-frame";
import { Badge, Card, SectionHeader } from "@/components/ui";
import {
  formatCompetitionEntryFee,
  formatCompetitionRoundDate,
  getCompetitionBySlug,
  getCompetitionEntryFormatLabel,
  getCompetitionRounds,
  getCompetitionScoringMethodLabel,
  getCompetitionStatusLabel,
} from "@/lib/competitions";
import { getLeagueSeasonBySlug } from "@/lib/league-seasons";
import {
  getActiveOrganisationBySlug,
  getOrganisationManagementContextBySlug,
} from "@/lib/organisations";

export const metadata: Metadata = {
  title: "Competition",
};

export default async function CompetitionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{
    slug: string;
    seasonSlug: string;
    competitionSlug: string;
  }>;
  searchParams: Promise<{
    created?: string | string[];
    published?: string | string[];
  }>;
}) {
  const { slug, seasonSlug, competitionSlug } = await params;
  const { created, published } = await searchParams;
  const [organisation, managementContext] = await Promise.all([
    getActiveOrganisationBySlug(slug),
    getOrganisationManagementContextBySlug(slug),
  ]);

  if (!organisation) {
    notFound();
  }

  const season = await getLeagueSeasonBySlug(organisation.id, seasonSlug);
  if (!season) {
    notFound();
  }

  const competition = await getCompetitionBySlug(season.id, competitionSlug);
  if (!competition) {
    notFound();
  }

  const rounds = await getCompetitionRounds(competition.id);
  const isOwner = managementContext?.access.role === "owner";
  const creationSucceeded = Array.isArray(created)
    ? created[0] === "1"
    : created === "1";
  const publishSucceeded = Array.isArray(published)
    ? published[0] === "1"
    : published === "1";
  const fee = formatCompetitionEntryFee(competition.entry_fee);
  const entryFormat = getCompetitionEntryFormatLabel(
    competition.entry_format,
  );
  const entryFormatDetail =
    competition.entry_format === "team"
      ? `${entryFormat} · ${competition.team_size} shooters`
      : entryFormat;

  return (
    <OrganisationPageFrame organisation={organisation} currentSection="leagues">
      {creationSucceeded || publishSucceeded ? (
        <div
          className="mb-6 rounded-2xl border border-success/20 bg-success-subtle px-5 py-4 text-sm leading-6 text-success"
          role="status"
        >
          <strong className="font-semibold">
            {publishSucceeded ? "Competition published." : "Draft saved."}
          </strong>{" "}
          {publishSucceeded
            ? "It is visible whenever the parent league season is public."
            : "Only the active organisation owner can see it until it is published."}
        </div>
      ) : null}

      <Link
        href={`/organisations/${organisation.slug}/leagues/${season.slug}`}
        className="inline-flex text-sm font-semibold text-brand-strong hover:text-brand-deep hover:underline"
      >
        ← Back to {season.name}
      </Link>

      <Card className="mt-5 min-w-0 p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Badge
              tone={competition.status === "draft" ? "warning" : "positive"}
            >
              {getCompetitionStatusLabel(competition.status)}
            </Badge>
            <h2 className="mt-4 break-words text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              {competition.name}
            </h2>
            {competition.description ? (
              <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {competition.description}
              </p>
            ) : null}
            {competition.status === "draft" ? (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                This draft is private to the active organisation owner.
              </p>
            ) : null}
          </div>
          {isOwner ? (
            <Link
              href={`/organisations/${organisation.slug}/leagues/${season.slug}/competitions/${competition.slug}/edit`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center self-start rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle"
            >
              Edit competition
            </Link>
          ) : null}
        </div>

        <dl className="mt-8 grid gap-3 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Entry format
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {entryFormatDetail}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Rounds
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {competition.number_of_rounds} round
              {competition.number_of_rounds === 1 ? "" : "s"}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Scoring
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {getCompetitionScoringMethodLabel(competition.scoring_method)}
              {competition.uses_x_score ? " · X score" : ""}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Maximum score
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {competition.maximum_score_per_round
                ? `Ex ${competition.maximum_score_per_round.toLocaleString("en-GB")}`
                : "Not set"}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Shots
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {competition.shots_per_round
                ? `${competition.shots_per_round.toLocaleString("en-GB")} per round`
                : "Not set"}
            </dd>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-muted p-4">
            <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Entry fee
            </dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">
              {fee ?? "Not set"}
            </dd>
          </div>
        </dl>
      </Card>

      <section className="mt-10" aria-labelledby="round-schedule-heading">
        <SectionHeader
          title="Round schedule"
          description={`${rounds.length} of ${competition.number_of_rounds} deadlines set`}
        />
        {rounds.length === 0 ? (
          <Card className="p-6 sm:p-8">
            <h3 id="round-schedule-heading" className="font-semibold text-foreground">
              No round deadlines set
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The owner can generate and edit this schedule while configuring the
              draft.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <h3 id="round-schedule-heading" className="sr-only">
              Round deadlines
            </h3>
            <ol className="grid min-w-0 sm:grid-cols-2">
              {rounds.map((round) => (
                <li
                  key={round.id}
                  className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-3 border-b border-border px-5 py-4 last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0 sm:[&:nth-child(odd)]:border-r"
                >
                  <span className="font-semibold text-brand-deep">
                    R{round.round_number}
                  </span>
                  <time
                    dateTime={round.deadline}
                    className="min-w-0 text-sm font-medium text-foreground"
                  >
                    {formatCompetitionRoundDate(round.deadline)}
                  </time>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </section>
    </OrganisationPageFrame>
  );
}
