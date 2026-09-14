import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import {
  getCompetitionEntryFormatLabel,
  getCompetitionRankingMethodLabel,
} from "@/lib/competitions";
import { formatLeagueSeasonDate } from "@/lib/league-seasons";
import {
  getMyShootingRoundStatus,
  getNextRelevantRound,
  type MyShootingCompetition,
  type MyShootingCompetitionTab,
} from "@/lib/my-shooting-competitions";

const tabDetails: Array<{
  id: MyShootingCompetitionTab;
  label: string;
}> = [
  { id: "active", label: "Active" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "Completed" },
];

const emptyStateCopy: Record<
  MyShootingCompetitionTab,
  { title: string; description: string }
> = {
  active: {
    title: "No active Competitions",
    description: "Competitions you are currently shooting will appear here.",
  },
  upcoming: {
    title: "No upcoming Competitions",
    description: "Submitted entries for Competitions that have not started will appear here.",
  },
  completed: {
    title: "No completed Competition history",
    description: "Competitions you have finished will appear here with official Results.",
  },
};

const averageFormatter = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const resultFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 2,
});

function participantName(
  participant: MyShootingCompetition["participants"][number],
) {
  return (
    [participant.first_name, participant.last_name].filter(Boolean).join(" ") ||
    `Shooter ${participant.slot_number}`
  );
}

function placing(position: number) {
  const remainder = position % 100;
  if (remainder >= 11 && remainder <= 13) return `${position}th`;
  if (position % 10 === 1) return `${position}st`;
  if (position % 10 === 2) return `${position}nd`;
  if (position % 10 === 3) return `${position}rd`;
  return `${position}th`;
}

function competitionPath(participation: MyShootingCompetition) {
  return `/organisations/${participation.organisation.slug}/leagues/${participation.season.slug}/competitions/${participation.competition.slug}`;
}

function CompetitionActions({
  participation,
}: {
  participation: MyShootingCompetition;
}) {
  const path = competitionPath(participation);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <Link
        href={path}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle sm:w-auto"
      >
        View Competition
      </Link>
      {participation.has_released_results ? (
        <Link
          href={`${path}#results`}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground! transition hover:bg-brand-deep sm:w-auto"
        >
          Official Results
        </Link>
      ) : null}
    </div>
  );
}

function ContextDetails({
  participation,
}: {
  participation: MyShootingCompetition;
}) {
  const format = getCompetitionEntryFormatLabel(
    participation.competition.entry_format,
  );
  const entrantParticipants = participation.participants
    .map(participantName)
    .join(", ");

  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">
        {participation.organisation.name}
      </p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Entered through</dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {participation.club.name}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Season</dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {participation.season.name}
          </dd>
        </div>
        {participation.division ? (
          <div>
            <dt className="text-xs text-muted-foreground">Division</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {participation.division.name}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">Format / ranking</dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {format} · {getCompetitionRankingMethodLabel(participation.competition.ranking_method)}
          </dd>
        </div>
      </dl>
      {participation.competition.entry_format !== "individual" ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-neutral-strong">
            {participation.entrant_label}:
          </span>{" "}
          {entrantParticipants}
        </p>
      ) : null}
    </>
  );
}

function ActiveDetails({
  participation,
  today,
}: {
  participation: MyShootingCompetition;
  today: string;
}) {
  const round = getNextRelevantRound(participation);
  if (!round) return null;

  return (
    <div className="mt-5 rounded-2xl bg-surface-muted p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-foreground">
          Next: Round {round.round_number}
        </p>
        <Badge tone={round.shoot_by_date && round.shoot_by_date < today ? "warning" : "brand"}>
          {getMyShootingRoundStatus(round, today)}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {round.shoot_by_date ? (
          <div>
            <dt className="text-xs text-muted-foreground">Shoot-by date</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {formatLeagueSeasonDate(round.shoot_by_date)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">Round End</dt>
          <dd className="mt-0.5 font-semibold text-foreground">
            {formatLeagueSeasonDate(round.deadline)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function UpcomingDetails({
  participation,
}: {
  participation: MyShootingCompetition;
}) {
  return (
    <div className="mt-5 rounded-2xl bg-surface-muted p-4 text-sm">
      <p className="text-xs text-muted-foreground">Competition start</p>
      <p className="mt-0.5 font-semibold text-foreground">
        {formatLeagueSeasonDate(participation.competition.effective_starts_at) ??
          "Start date not published"}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">Entry submitted</p>
    </div>
  );
}

function CompletedDetails({
  participation,
}: {
  participation: MyShootingCompetition;
}) {
  const result = participation.result;
  const lastRound = participation.rounds.at(-1);

  return (
    <div className="mt-5 rounded-2xl bg-surface-muted p-4">
      {result ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Final placing</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {result.position === null
                ? "Not ranked"
                : `${result.tied ? "Tied " : ""}${placing(result.position)}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{result.value_label}</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {result.value === null ? "—" : resultFormatter.format(result.value)}
            </dd>
          </div>
          {participation.competition.entry_format === "individual" ? (
            <div>
              <dt className="text-xs text-muted-foreground">Frozen S/Av</dt>
              <dd className="mt-0.5 font-semibold text-foreground">
                {result.starting_average === null
                  ? "—"
                  : averageFormatter.format(result.starting_average)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">Your R/Av</dt>
            <dd className="mt-0.5 font-semibold text-foreground">
              {result.running_average === null
                ? "—"
                : averageFormatter.format(result.running_average)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          Official placing is not available yet.
        </p>
      )}
      {lastRound ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Final Round End {formatLeagueSeasonDate(lastRound.deadline)}
        </p>
      ) : null}
    </div>
  );
}

function CompetitionCard({
  participation,
  tab,
  today,
}: {
  participation: MyShootingCompetition;
  tab: MyShootingCompetitionTab;
  today: string;
}) {
  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tab === "completed" ? "neutral" : tab === "upcoming" ? "brand" : "positive"}>
              {tab[0].toUpperCase() + tab.slice(1)}
            </Badge>
            {participation.division ? (
              <Badge tone="brand">{participation.division.name}</Badge>
            ) : null}
          </div>
          <h2 className="mt-3 break-words text-xl font-semibold tracking-[-0.025em] text-foreground sm:text-2xl">
            {participation.competition.name}
          </h2>
          <ContextDetails participation={participation} />
          {tab === "active" ? (
            <ActiveDetails participation={participation} today={today} />
          ) : tab === "upcoming" ? (
            <UpcomingDetails participation={participation} />
          ) : (
            <CompletedDetails participation={participation} />
          )}
        </div>
        <CompetitionActions participation={participation} />
      </div>
    </Card>
  );
}

export function MyShootingCompetitionTabs({
  activeTab,
  counts,
}: {
  activeTab: MyShootingCompetitionTab;
  counts: Record<MyShootingCompetitionTab, number>;
}) {
  return (
    <nav
      aria-label="My Competition status"
      className="mt-7 flex w-full gap-1 rounded-2xl border border-border bg-surface p-1 sm:w-fit"
    >
      {tabDetails.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={tab.id === "active" ? "/competitions" : `/competitions?tab=${tab.id}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition sm:flex-none sm:px-5 ${
              active
                ? "bg-primary text-primary-foreground!"
                : "text-neutral-strong hover:bg-surface-muted"
            }`}
          >
            <span>{tab.label}</span>
            <span className={active ? "text-primary-foreground/70" : "text-muted-foreground"}>
              {counts[tab.id]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MyShootingCompetitionList({
  tab,
  participations,
  today,
}: {
  tab: MyShootingCompetitionTab;
  participations: MyShootingCompetition[];
  today: string;
}) {
  if (participations.length === 0) {
    const copy = emptyStateCopy[tab];
    return (
      <Card className="mt-6 p-6 sm:p-8">
        <h2 className="font-semibold text-foreground">{copy.title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
      </Card>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {participations.map((participation) => (
        <CompetitionCard
          key={participation.competition_entrant_participant_id}
          participation={participation}
          tab={tab}
          today={today}
        />
      ))}
    </div>
  );
}
