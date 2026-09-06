import type {
  Competition,
  CompetitionEffectiveDates,
  CompetitionRound,
  CompetitionScoreComponent,
} from "@/lib/competitions";
import {
  getCompetitionMaximumPerRound,
  getCompetitionRankingMethodLabel,
  getCompetitionScoringMethodLabel,
} from "@/lib/competitions";
import { formatLeagueSeasonDate } from "@/lib/league-seasons";

const compactMonthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const accessibleRoundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function getCompactRoundDateLabels(rounds: Array<{ deadline: string }>) {
  return rounds.map((round) => {
    const [, month, day] = round.deadline.split("-").map(Number);
    const date = new Date(`${round.deadline}T00:00:00Z`);
    return {
      compact: `${day} ${compactMonthLabels[month - 1]}`,
      accessible: accessibleRoundDateFormatter.format(date),
    };
  });
}

export function CompetitionDetailsDisclosure({
  competition,
  effectiveDates,
  rounds,
  scoreComponents,
  showScoringAccess = true,
}: {
  competition: Competition;
  effectiveDates: CompetitionEffectiveDates;
  rounds: CompetitionRound[];
  scoreComponents: CompetitionScoreComponent[];
  showScoringAccess?: boolean;
}) {
  const entryWindow =
    effectiveDates.effective_entry_opens_at &&
    effectiveDates.effective_entry_closes_at
      ? `${formatLeagueSeasonDate(effectiveDates.effective_entry_opens_at)} – ${formatLeagueSeasonDate(effectiveDates.effective_entry_closes_at)}`
      : "Not configured";
  const maximumPerRound = getCompetitionMaximumPerRound(
    competition.sets_per_round,
    scoreComponents,
  );
  const roundDateLabels = getCompactRoundDateLabels(rounds);

  return (
    <details className="group mt-8 overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 outline-none transition hover:bg-surface-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-base font-semibold tracking-[-0.02em] text-foreground">
            Competition details
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Dates, scoring configuration and Round schedule
          </span>
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="size-5 shrink-0 text-brand-strong transition-transform group-open:rotate-180"
        >
          <path
            d="m5 7.5 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      <div className="border-t border-border px-5 py-5 sm:px-6 sm:py-6">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Entry window
            </dt>
            <dd className="mt-1.5 text-sm font-semibold text-foreground">
              {entryWindow}
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">
              {competition.entry_window_mode === "custom"
                ? "Competition-specific dates"
                : "Season default dates"}
            </p>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Competition start
            </dt>
            <dd className="mt-1.5 text-sm font-semibold text-foreground">
              {formatLeagueSeasonDate(effectiveDates.effective_starts_at) ??
                "Not configured"}
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">
              {competition.start_date_mode === "custom"
                ? "Competition-specific date"
                : "Season start date"}
            </p>
          </div>
          {showScoringAccess ? (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Scoring access
              </dt>
              <dd className="mt-1.5 text-sm font-semibold text-foreground">
                {competition.local_scoring_enabled
                  ? "Club and organisation scoring"
                  : "Organisation scoring only"}
              </dd>
            </div>
          ) : null}
        </dl>

        <section className="mt-7 border-t border-border pt-6" aria-labelledby="course-of-fire-heading">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <h3 id="course-of-fire-heading" className="font-semibold text-foreground">
              Course of Fire
            </h3>
            <p className="text-sm text-muted-foreground">
              {competition.sets_per_round} set
              {competition.sets_per_round === 1 ? "" : "s"} per shooter / Round
              {scoreComponents.length
                ? ` · Ex ${maximumPerRound.toLocaleString("en-GB", { maximumFractionDigits: 2 })} per Round`
                : ""}
            </p>
          </div>

          {scoreComponents.length ? (
            <ol className="mt-4 divide-y divide-border rounded-xl border border-border">
              {scoreComponents.map((component) => (
                <li
                  key={component.id}
                  className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
                >
                  <span className="text-sm font-semibold text-foreground">
                    {component.short_label || `Score ${component.position}`}
                  </span>
                  <span className="text-sm text-muted-foreground sm:text-right">
                    Ex {Number(component.maximum_score).toLocaleString("en-GB", {
                      maximumFractionDigits: 2,
                    })}
                    {` · ${getCompetitionScoringMethodLabel(component.score_method)}`}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No score components configured.
            </p>
          )}

          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Standings use {getCompetitionRankingMethodLabel(competition.ranking_method)}.
            {competition.uses_x_score
              ? " X scores are recorded and used where the Results rules require them."
              : " X scores are not recorded."}
          </p>
        </section>

        <section className="mt-7 border-t border-border pt-6" aria-labelledby="round-schedule-heading">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <h3 id="round-schedule-heading" className="font-semibold text-foreground">
              Round schedule
            </h3>
            <p className="text-sm text-muted-foreground">
              {rounds.length} of {competition.number_of_rounds} Round End dates set
            </p>
          </div>

          {rounds.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              No Round End dates are configured.
            </p>
          ) : (
            <ol className="mt-4 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-px overflow-hidden rounded-xl border border-border bg-border">
              {rounds.map((round, index) => (
                <li key={round.id} className="min-w-0 bg-surface px-3 py-2.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-strong">
                    Round {round.round_number}
                  </span>
                  <time
                    dateTime={round.deadline}
                    title={roundDateLabels[index].accessible}
                    aria-label={`Round ${round.round_number} ends ${roundDateLabels[index].accessible}`}
                    className="mt-0.5 block min-w-0 whitespace-nowrap text-sm font-semibold text-foreground"
                  >
                    {roundDateLabels[index].compact}
                  </time>
                  {round.shoot_by_date ? (
                    <p className="mt-1 text-xs leading-4 text-muted-foreground">
                      Shoot by {formatLeagueSeasonDate(round.shoot_by_date)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </details>
  );
}
