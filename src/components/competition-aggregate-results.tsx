import { Fragment } from "react";
import { Card } from "@/components/ui";
import type {
  AggregateEntrant,
  AggregateParticipant,
  AggregateParticipantRoundCell,
  AggregateRoundCell,
  CompetitionAggregateResults,
} from "@/lib/competition-aggregate-results";
import type {
  CompetitionGunScoreResults,
  GunScoreEntrant,
  GunScoreRoundCell,
} from "@/lib/competition-gun-score-results";

type ResultsRankingMethod = "aggregate" | "gun_score";
type ResultsEntrant = AggregateEntrant | GunScoreEntrant;
type ResultsRoundCell = AggregateRoundCell | GunScoreRoundCell;
type ResultsData = CompetitionAggregateResults | CompetitionGunScoreResults;

const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const compactRoundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", timeZone: "UTC",
});
const accessibleRoundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

function compactRoundDate(value: string) {
  const parts = compactRoundDateFormatter.formatToParts(
    new Date(`${value}T00:00:00Z`),
  );
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value.slice(0, 3);
  return `${day} ${month}`;
}

function number(value: number | null | undefined) {
  return value == null ? "—" : numberFormatter.format(value);
}

function participantName(participant: AggregateParticipant) {
  return [participant.first_name, participant.last_name].filter(Boolean).join(" ") ||
    `Shooter ${participant.slot_number}`;
}

function RoundCell({ cell, usesX, rankingMethod }: {
  cell: ResultsRoundCell;
  usesX: boolean;
  rankingMethod: ResultsRankingMethod;
}) {
  if (cell.state === "pending") {
    return <span className="text-xs text-muted-foreground">Pending</span>;
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={cell.state === "nsr" ? "text-xs font-semibold text-muted-foreground" : "font-semibold text-foreground"}>
        {cell.state === "nsr" ? <abbr title="No score returned: incomplete at Round End" className="no-underline">NSR</abbr> : number(cell.gun_score)}
        {cell.state === "scored" ? <span className="sr-only"> gun result</span> : null}
      </span>
      {rankingMethod === "aggregate" ? (
        <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand-deep">
          {(cell as AggregateRoundCell).ranking_points} <span aria-hidden="true">pts</span><span className="sr-only">aggregate ranking points</span>
        </span>
      ) : null}
      {usesX && cell.state === "scored" ? (
        <span className="text-[11px] text-muted-foreground">{number(cell.x_total)} X</span>
      ) : null}
    </div>
  );
}

function TotalCell({ entrant, usesX, gunLabel, rankingMethod }: {
  entrant: ResultsEntrant;
  usesX: boolean;
  gunLabel: string;
  rankingMethod: ResultsRankingMethod;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-semibold text-foreground">
        {number(entrant.gun_total)}
        <span className="sr-only"> total gun result</span>
      </span>
      {rankingMethod === "aggregate" ? (
        <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand-deep">
          {(entrant as AggregateEntrant).total_points} <span aria-hidden="true">pts</span><span className="sr-only">total aggregate ranking points</span>
        </span>
      ) : null}
      {usesX ? <span className="text-[11px] text-muted-foreground">{number(entrant.x_total)} X</span> : null}
      <span className="sr-only">{entrant.scored_rounds} scored Rounds. {gunLabel}.</span>
    </div>
  );
}

function ParticipantResultCell({ cell, usesX }: {
  cell: AggregateParticipantRoundCell | undefined;
  usesX: boolean;
}) {
  if (!cell || cell.state === "pending") {
    return <span className="text-muted-foreground">—<span className="sr-only"> Unreleased</span></span>;
  }
  if (cell.state === "nsr") {
    return <abbr title="No score returned: incomplete at Round End" className="text-xs font-semibold text-muted-foreground no-underline">NSR</abbr>;
  }
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-medium text-foreground">{number(cell.gun_score)}</span>
      {usesX ? <span className="text-[11px] text-muted-foreground">{number(cell.x_total)} X</span> : null}
    </div>
  );
}

export function ParticipantBreakdown({ entrant, rounds, usesX, rankingMethod, disclosureId }: {
  entrant: ResultsEntrant;
  rounds: Array<{ id: number; round_number: number }>;
  usesX: boolean;
  rankingMethod: ResultsRankingMethod;
  disclosureId?: string;
}) {
  const content = (
          <div className="border-t border-border bg-surface px-2 pb-2 sm:px-3">
            <table className="w-full border-separate border-spacing-0 text-xs tabular-nums">
              <caption className="sr-only">
                Released shooting results by participant for {entrant.entrant_label}. Participant rows do not receive {rankingMethod === "aggregate" ? "Aggregate ranking points" : "a separate ranking position"}.
              </caption>
              <thead>
                <tr className="text-muted-foreground">
                  <th scope="col" className="sticky left-0 z-10 min-w-44 border-b border-border bg-surface px-2 py-2 text-left font-medium sm:min-w-60">Participant</th>
                  {rounds.map((round) => (
                    <th key={round.id} scope="col" className="min-w-24 border-b border-border px-2 py-2 text-center font-medium">R{round.round_number}</th>
                  ))}
                  <th scope="col" className="min-w-32 border-b border-border px-2 py-2 text-center font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {entrant.participants.map((participant) => (
                  <tr key={participant.slot_number} data-participant-row={participant.slot_number}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-border bg-surface px-2 py-2 text-left font-medium text-foreground">
                      {participantName(participant)}
                    </th>
                    {rounds.map((round) => (
                      <td key={round.id} data-participant-round={round.id} className="border-b border-border px-2 py-2 text-center">
                        <ParticipantResultCell
                          cell={participant.rounds?.find((cell) => cell.round_id === round.id)}
                          usesX={usesX}
                        />
                      </td>
                    ))}
                    <td data-participant-total className="border-b border-border px-2 py-2 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="font-semibold text-foreground">{number(participant.gun_total)}</span>
                        {usesX ? <span className="text-[11px] text-muted-foreground">{number(participant.x_total)} X</span> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
  );
  return (
    <tr id={disclosureId} className={disclosureId ? "hidden bg-surface-muted/40" : "bg-surface-muted/40"}>
      <td colSpan={rounds.length + 2} className="border-b border-border p-0">
        {disclosureId ? content : <details>
          <summary className="min-h-11 cursor-pointer content-center rounded px-3 py-2 text-xs font-semibold text-brand-strong outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
            Participants <span className="sr-only">for {entrant.entrant_label}, {entrant.club_name}</span>
          </summary>
          {content}
        </details>}
      </td>
    </tr>
  );
}

function CompetitionResultsTable({ data, rankingMethod }: {
  data: ResultsData;
  rankingMethod: ResultsRankingMethod;
}) {
  if (data.status === "awaiting_divisions") {
    return <Card className="p-6 text-sm text-muted-foreground">Results will be available when division allocations are published.</Card>;
  }
  const gunLabel = data.display_scoring_mode === "points_dropped" ? "Points dropped" :
    data.display_scoring_mode === "mixed" ? "Achieved points" : "Points scored";

  return (
    <div className="min-w-0 space-y-6">
      {data.released_round_count === 0 ? (
        <p className="rounded-xl bg-brand-subtle px-4 py-3 text-sm text-brand-deep">No Rounds have been released yet.</p>
      ) : null}
      {data.groups.map((group) => (
        <section key={group.id} aria-labelledby={`results-division-${group.id}`} className="min-w-0" data-ranking-method={rankingMethod}>
          <h2 id={`results-division-${group.id}`} className="mb-3 text-lg font-semibold text-foreground">{group.name}</h2>
          {group.entrants.length === 0 ? (
            <Card className="p-5 text-sm text-muted-foreground">No submitted entrants yet.</Card>
          ) : (
            <div role="region" aria-labelledby={`results-division-${group.id}`} tabIndex={0}
              className="relative max-w-full overflow-x-auto rounded-2xl border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
                <caption className="sr-only">
                  {group.name} {rankingMethod === "aggregate" ? `Aggregate standings. ${gunLabel} and ranking points per Round.` : `Gun Score standings. ${gunLabel} per Round.`} Scroll horizontally for more Rounds. Equal positions remain tied.
                </caption>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col" className="sticky left-0 z-20 min-w-44 border-b border-r border-border bg-surface-muted px-3 py-3 text-left sm:min-w-60">Position / Entrant</th>
                    {data.rounds.map((round) => (
                      <th key={round.id} scope="col" className="min-w-24 whitespace-nowrap border-b border-border bg-surface-muted px-3 py-3 text-center">
                        <span className="block font-semibold text-foreground">R{round.round_number}</span>
                        <time
                          dateTime={round.deadline}
                          title={accessibleRoundDateFormatter.format(new Date(`${round.deadline}T00:00:00Z`))}
                          aria-label={`Round End ${accessibleRoundDateFormatter.format(new Date(`${round.deadline}T00:00:00Z`))}`}
                          className="mt-1 block text-[10px] font-normal"
                        >
                          {compactRoundDate(round.deadline)}
                        </time>
                        {!round.released ? <span className="mt-1 block text-[10px] font-normal">Unreleased</span> : null}
                      </th>
                    ))}
                    <th scope="col" className="min-w-32 border-b border-border bg-brand-subtle px-3 py-3 text-center text-brand-deep">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {group.entrants.map((entrant) => (
                    <Fragment key={entrant.entrant_id}>
                    <tr data-entrant-row={entrant.entrant_id}>
                      <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-3 text-left align-top font-normal">
                        <div className="flex w-40 items-start gap-2 sm:w-56">
                          <span className="min-w-6 pt-0.5 text-xs font-semibold text-muted-foreground" aria-label={data.released_round_count === 0 ? "Not ranked yet" : `${entrant.tied ? "Tied " : ""}position ${entrant.position}`}>
                            {data.released_round_count === 0 ? "—" : `${entrant.position}${entrant.tied ? "=" : ""}`}
                          </span>
                          <div className="min-w-0 flex-1 break-words">
                            <span className="font-semibold text-foreground">
                              {entrant.entrant_format === "individual" ? (entrant.participants[0] ? participantName(entrant.participants[0]) : "Shooter") : entrant.entrant_label}
                            </span>
                            <p className="mt-1 text-xs text-muted-foreground">{entrant.club_name}</p>
                          </div>
                        </div>
                      </th>
                      {entrant.rounds.map((cell) => (
                        <td key={cell.round_id} className="border-b border-border px-3 py-3 text-center align-top">
                          <RoundCell cell={cell} usesX={data.uses_x_score} rankingMethod={rankingMethod} />
                        </td>
                      ))}
                      <td data-total-cell className="border-b border-border bg-brand-subtle/30 px-3 py-3 text-center align-top">
                        <TotalCell entrant={entrant} usesX={data.uses_x_score} gunLabel={gunLabel} rankingMethod={rankingMethod} />
                      </td>
                    </tr>
                    {entrant.entrant_format !== "individual" ? (
                      <ParticipantBreakdown entrant={entrant} rounds={data.rounds} usesX={data.uses_x_score} rankingMethod={rankingMethod} />
                    ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function CompetitionAggregateResultsTable({ data }: { data: CompetitionAggregateResults }) {
  return <CompetitionResultsTable data={data} rankingMethod="aggregate" />;
}

export function CompetitionGunScoreResultsTable({ data }: { data: CompetitionGunScoreResults }) {
  return <CompetitionResultsTable data={data} rankingMethod="gun_score" />;
}
