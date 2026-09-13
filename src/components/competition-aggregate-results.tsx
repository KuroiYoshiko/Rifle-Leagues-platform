import { Fragment, type CSSProperties } from "react";
import { Card } from "@/components/ui";
import type {
  AggregateEntrant,
  AggregateParticipant,
  AggregateParticipantRoundCell,
  AggregateRoundCell,
  CompetitionAggregateResults,
} from "@/lib/competition-aggregate-results";
import type {
  BestNAverageEntrant,
  BestNAverageRoundCell,
  CompetitionBestNAverageResults,
} from "@/lib/competition-best-n-average-results";
import type {
  CompetitionGunScoreResults,
  GunScoreEntrant,
  GunScoreRoundCell,
} from "@/lib/competition-gun-score-results";

export type ResultsRankingMethod = "aggregate" | "best_n_average" | "gun_score";
type ResultsEntrant = AggregateEntrant | BestNAverageEntrant | GunScoreEntrant;
type ResultsRoundCell = AggregateRoundCell | BestNAverageRoundCell | GunScoreRoundCell;
type ResultsData = CompetitionAggregateResults | CompetitionBestNAverageResults | CompetitionGunScoreResults;

const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const averageFormatter = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const compactRoundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", timeZone: "UTC",
});
const accessibleRoundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

function compactRoundDate(value: string) {
  const parts = compactRoundDateFormatter.formatToParts(new Date(`${value}T00:00:00Z`));
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value.slice(0, 3);
  return `${day} ${month}`;
}

function number(value: number | null | undefined) {
  return value == null ? "—" : numberFormatter.format(value);
}

function average(value: number | null | undefined) {
  return value == null ? "—" : averageFormatter.format(value);
}

function participantName(participant: AggregateParticipant) {
  return [participant.first_name, participant.last_name].filter(Boolean).join(" ") ||
    `Shooter ${participant.slot_number}`;
}

function hasStartingAverage(participant: AggregateParticipant) {
  return Object.hasOwn(participant, "starting_average");
}

function InlineAverageSummary({ participant }: { participant: AggregateParticipant }) {
  return (
    <span className="results-inline-averages mt-1 block text-[10px] font-normal text-muted-foreground lg:hidden">
      {hasStartingAverage(participant) ? <>S/Av {average(participant.starting_average)} <span aria-hidden="true">·</span>{" "}</> : null}
      R/Av {average(participant.running_average)}
    </span>
  );
}

function AverageCells({ participant }: { participant?: AggregateParticipant }) {
  return (
    <>
      <td className="results-average-cell hidden border-b border-border px-1 py-2 text-center text-[11px] text-foreground lg:table-cell">
        {participant && hasStartingAverage(participant) ? average(participant.starting_average) : "—"}
      </td>
      <td className="results-average-cell hidden border-b border-border px-1 py-2 text-center text-[11px] text-foreground lg:table-cell">
        {participant ? average(participant.running_average) : "—"}
      </td>
    </>
  );
}

function RoundCell({ cell, usesX, rankingMethod }: {
  cell: ResultsRoundCell;
  usesX: boolean;
  rankingMethod: ResultsRankingMethod;
}) {
  if (cell.state === "pending") {
    return <span className="text-[10px] text-muted-foreground">—<span className="sr-only"> Unreleased</span></span>;
  }
  if (cell.state === "nsr") {
    return <abbr title="No score returned: incomplete at Round End" className="text-[10px] font-semibold text-muted-foreground no-underline">NSR</abbr>;
  }
  const detail = rankingMethod === "aggregate"
    ? `${number((cell as AggregateRoundCell).ranking_points)}p`
    : rankingMethod === "best_n_average"
      ? ((cell as BestNAverageRoundCell).counts_towards_average ? "Counts" : "Excluded")
      : null;
  const xTotal = "x_total" in cell ? cell.x_total : null;
  return (
    <div className="leading-tight">
      <span className="block text-[12px] font-semibold text-foreground">
        {number(cell.gun_score)}<span className="sr-only"> gun result</span>
      </span>
      {detail || usesX ? (
        <span className="mt-0.5 block whitespace-nowrap text-[9px] text-muted-foreground">
          {detail ? <span className={rankingMethod === "best_n_average" && detail === "Excluded" ? "opacity-70" : "font-semibold text-brand-deep"}>{detail}</span> : null}
          {detail && usesX ? <span aria-hidden="true"> · </span> : null}
          {usesX ? `${number(xTotal)}X` : null}
        </span>
      ) : null}
    </div>
  );
}

function FinalCell({ entrant, usesX, rankingMethod, bestRoundsCount }: {
  entrant: ResultsEntrant;
  usesX: boolean;
  rankingMethod: ResultsRankingMethod;
  bestRoundsCount?: number;
}) {
  if (rankingMethod === "aggregate") {
    const aggregate = entrant as AggregateEntrant;
    return <div className="leading-tight"><span className="block text-[12px] font-bold text-brand-deep">{number(aggregate.total_points)} pts<span className="sr-only"> total aggregate ranking points</span></span><span className="mt-0.5 block text-[9px] text-muted-foreground">{number(aggregate.gun_total)} result{usesX ? ` · ${number(aggregate.x_total)}X` : ""}</span></div>;
  }
  if (rankingMethod === "best_n_average") {
    const best = entrant as BestNAverageEntrant;
    return <div className="leading-tight"><span className="block text-[12px] font-bold text-brand-deep">{average(best.qualifying_average)}</span><span className="mt-0.5 block text-[9px] text-muted-foreground">{best.counted_rounds}/{bestRoundsCount} rounds</span></div>;
  }
  const gun = entrant as GunScoreEntrant;
  return <div className="leading-tight"><span className="block text-[12px] font-bold text-brand-deep">{number(gun.gun_total)}<span className="sr-only"> total gun result</span></span>{usesX ? <span className="mt-0.5 block text-[9px] text-muted-foreground">{number(gun.x_total)}X</span> : null}</div>;
}

function ParticipantResultCell({ cell, usesX }: {
  cell: AggregateParticipantRoundCell | undefined;
  usesX: boolean;
}) {
  if (!cell || cell.state === "pending") return <span className="text-muted-foreground">—<span className="sr-only"> Unreleased</span></span>;
  if (cell.state === "nsr") return <abbr title="No score returned: incomplete at Round End" className="text-[10px] font-semibold text-muted-foreground no-underline">NSR</abbr>;
  return <div className="leading-tight"><span className="block font-medium text-foreground">{number(cell.gun_score)}</span>{usesX ? <span className="text-[9px] text-muted-foreground">{number(cell.x_total)}X</span> : null}</div>;
}

export function ParticipantBreakdown({ entrant, rounds, usesX, rankingMethod, disclosureId }: {
  entrant: ResultsEntrant;
  rounds: Array<{ id: number; round_number: number }>;
  usesX: boolean;
  rankingMethod: ResultsRankingMethod;
  disclosureId?: string;
}) {
  const content = (
    <div className="results-participant-content border-t border-border bg-surface px-2 pb-2">
      <table className="results-participant-table w-full table-fixed border-separate border-spacing-0 text-[10px] tabular-nums">
        <caption className="sr-only">Released shooting results by participant for {entrant.entrant_label}. Participant rows do not receive {rankingMethod === "aggregate" ? "Aggregate ranking points" : "a separate ranking position"}.</caption>
        <colgroup>
          <col className="results-participant-name-column" />
          <col className="results-average-column hidden lg:table-column" />
          <col className="results-average-column hidden lg:table-column" />
          {rounds.map((round) => <col key={round.id} className="results-round-column" />)}
          <col className="results-final-column" />
        </colgroup>
        <thead><tr className="text-muted-foreground">
          <th scope="col" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-1.5 text-left font-medium">Participant</th>
          <th scope="col" className="results-average-cell hidden border-b border-border px-1 py-1.5 text-center font-medium lg:table-cell"><abbr title="Starting Average" className="no-underline">S/Av</abbr></th>
          <th scope="col" className="results-average-cell hidden border-b border-border px-1 py-1.5 text-center font-medium lg:table-cell"><abbr title="Running Average" className="no-underline">R/Av</abbr></th>
          {rounds.map((round) => <th key={round.id} scope="col" className="border-b border-l border-border px-1 py-1.5 text-center font-medium">R{round.round_number}</th>)}
          <th scope="col" className="border-b border-l border-border px-1 py-1.5 text-center font-medium">Total</th>
        </tr></thead>
        <tbody>{entrant.participants.map((participant) => (
          <tr key={participant.slot_number} data-participant-row={participant.slot_number}>
            <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-1.5 text-left font-medium text-foreground">
              {participantName(participant)}<InlineAverageSummary participant={participant} />
            </th>
            <AverageCells participant={participant} />
            {rounds.map((round) => <td key={round.id} data-participant-round={round.id} className="border-b border-l border-border px-1 py-1.5 text-center"><ParticipantResultCell cell={participant.rounds?.find((cell) => cell.round_id === round.id)} usesX={usesX} /></td>)}
            <td data-participant-total className="border-b border-l border-border px-1 py-1.5 text-center"><span className="font-semibold text-foreground">{number(participant.gun_total)}</span>{usesX ? <span className="ml-1 text-[9px] text-muted-foreground">{number(participant.x_total)}X</span> : null}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  return (
    <tr id={disclosureId} data-participant-breakdown className={disclosureId ? "hidden bg-surface-muted/40" : "bg-surface-muted/40"}>
      <td colSpan={rounds.length + 5} className="border-b border-border p-0">
        {disclosureId ? content : <details className="results-participant-details"><summary className="min-h-9 cursor-pointer content-center rounded px-3 py-1.5 text-[11px] font-semibold text-brand-strong outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">Participants <span className="sr-only">for {entrant.entrant_label}, {entrant.club_name}</span></summary>{content}</details>}
      </td>
    </tr>
  );
}

function finalHeading(rankingMethod: ResultsRankingMethod, bestRoundsCount?: number) {
  if (rankingMethod === "aggregate") return "Points";
  if (rankingMethod === "best_n_average") return `Best ${bestRoundsCount} avg`;
  return "Gun result";
}

function CompetitionResultsTable({ data, rankingMethod }: {
  data: ResultsData;
  rankingMethod: ResultsRankingMethod;
}) {
  if (data.status === "awaiting_divisions") return <Card className="p-6 text-sm text-muted-foreground">Results will be available when division allocations are published.</Card>;
  const bestRoundsCount = rankingMethod === "best_n_average" ? (data as Extract<CompetitionBestNAverageResults, { status: "ready" }>).best_rounds_count : undefined;
  const gunLabel = data.display_scoring_mode === "points_dropped" ? "Points dropped" : data.display_scoring_mode === "mixed" ? "Achieved points" : "Points scored";
  const caption = rankingMethod === "aggregate"
    ? `Aggregate standings. ${gunLabel} and ranking points per Round.`
    : rankingMethod === "best_n_average"
      ? `Best ${bestRoundsCount} rounds average standings. Complete released achieved scores only.`
      : `Gun Score standings. ${gunLabel} per Round.`;

  return <div className="min-w-0 space-y-6">
    {data.released_round_count === 0 ? <p className="rounded-xl bg-brand-subtle px-4 py-3 text-sm text-brand-deep">No Rounds have been released yet.</p> : null}
    {data.groups.map((group) => (
      <section key={group.id} aria-labelledby={`results-${rankingMethod}-${group.id}`} className="results-group min-w-0" data-ranking-method={rankingMethod}>
        <h2 id={`results-${rankingMethod}-${group.id}`} className="results-division-heading mb-2 text-base font-semibold text-foreground">{group.name}</h2>
        {group.entrants.length === 0 ? <Card className="p-5 text-sm text-muted-foreground">No submitted entrants yet.</Card> : (
          <div role="region" aria-labelledby={`results-${rankingMethod}-${group.id}`} tabIndex={0} className="results-table-region relative max-w-full overflow-x-auto rounded-xl border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <table style={{ "--results-round-count": data.rounds.length } as CSSProperties} className="results-score-table w-full table-fixed border-separate border-spacing-0 text-[11px] tabular-nums">
              <caption className="sr-only">{group.name} {caption} Scroll horizontally for more Rounds on narrow screens. Equal positions remain tied.</caption>
              <colgroup>
                <col className="results-position-column" />
                <col className="results-entrant-column" />
                <col className="results-average-column hidden lg:table-column" />
                <col className="results-average-column hidden lg:table-column" />
                {data.rounds.map((round) => <col key={round.id} className="results-round-column" />)}
                <col className="results-final-column" />
              </colgroup>
              <thead><tr className="text-[10px] text-muted-foreground">
                <th scope="col" className="results-sticky-position sticky left-0 z-30 border-b border-r border-border bg-surface-muted px-1 py-2 text-center">Pos</th>
                <th scope="col" className="results-sticky-entrant sticky left-10 z-20 border-b border-r border-border bg-surface-muted px-2 py-2 text-left">Entrant</th>
                <th scope="col" className="results-average-cell hidden border-b border-border bg-surface-muted px-1 py-2 text-center lg:table-cell"><abbr title="Starting Average" className="no-underline">S/Av</abbr></th>
                <th scope="col" className="results-average-cell hidden border-b border-border bg-surface-muted px-1 py-2 text-center lg:table-cell"><abbr title="Running Average" className="no-underline">R/Av</abbr></th>
                {data.rounds.map((round) => <th key={round.id} scope="col" className="border-b border-l border-border bg-surface-muted px-1 py-1.5 text-center">
                  <span className="block font-semibold text-foreground">R{round.round_number}</span>
                  <time data-round-date-heading dateTime={round.deadline} title={accessibleRoundDateFormatter.format(new Date(`${round.deadline}T00:00:00Z`))} aria-label={`Round End ${accessibleRoundDateFormatter.format(new Date(`${round.deadline}T00:00:00Z`))}`} className="mt-0.5 block whitespace-nowrap text-[8px] font-normal">{compactRoundDate(round.deadline)}</time>
                  {!round.released ? <span className="block text-[8px] font-normal">Unreleased</span> : null}
                </th>)}
                <th scope="col" className="border-b border-l border-border bg-brand-subtle px-1 py-2 text-center font-semibold text-brand-deep">{finalHeading(rankingMethod, bestRoundsCount)}</th>
              </tr></thead>
              <tbody>{group.entrants.map((entrant) => {
                const participant = entrant.entrant_format === "individual" ? entrant.participants[0] : undefined;
                return <Fragment key={entrant.entrant_id}>
                  <tr data-entrant-row={entrant.entrant_id}>
                    <td className="results-sticky-position sticky left-0 z-20 border-b border-r border-border bg-surface px-1 py-2 text-center align-top text-[10px] font-semibold text-muted-foreground" aria-label={data.released_round_count === 0 ? "Not ranked yet" : `${entrant.tied ? "Tied " : ""}position ${entrant.position}`}>{data.released_round_count === 0 ? "—" : `${entrant.position}${entrant.tied ? "=" : ""}`}</td>
                    <th scope="row" className="results-sticky-entrant sticky left-10 z-10 border-b border-r border-border bg-surface px-2 py-2 text-left align-top font-normal">
                      <span className="block break-words text-[12px] font-semibold leading-tight text-foreground">{entrant.entrant_format === "individual" ? (participant ? participantName(participant) : "Shooter") : entrant.entrant_label}</span>
                      <span className="mt-1 block break-words text-[9px] leading-tight text-muted-foreground">{entrant.club_name}</span>
                      {participant ? <InlineAverageSummary participant={participant} /> : null}
                    </th>
                    <AverageCells participant={participant} />
                    {entrant.rounds.map((cell) => <td key={cell.round_id} className="border-b border-l border-border px-1 py-2 text-center align-top"><RoundCell cell={cell} usesX={data.uses_x_score} rankingMethod={rankingMethod} /></td>)}
                    <td data-total-cell className="border-b border-l border-border bg-brand-subtle/30 px-1 py-2 text-center align-top"><FinalCell entrant={entrant} usesX={data.uses_x_score} rankingMethod={rankingMethod} bestRoundsCount={bestRoundsCount} /></td>
                  </tr>
                  {entrant.entrant_format !== "individual" ? <ParticipantBreakdown entrant={entrant} rounds={data.rounds} usesX={data.uses_x_score} rankingMethod={rankingMethod} /> : null}
                </Fragment>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    ))}
    {rankingMethod === "best_n_average" ? <p className="text-xs text-muted-foreground">Best {bestRoundsCount} complete released Round results count. Before {bestRoundsCount} results are available, the average uses every complete released result. NSR and unreleased Rounds are excluded.</p> : null}
  </div>;
}

export function CompetitionAggregateResultsTable({ data }: { data: CompetitionAggregateResults }) {
  return <CompetitionResultsTable data={data} rankingMethod="aggregate" />;
}

export function CompetitionBestNAverageResultsTable({ data }: { data: CompetitionBestNAverageResults }) {
  return <CompetitionResultsTable data={data} rankingMethod="best_n_average" />;
}

export function CompetitionGunScoreResultsTable({ data }: { data: CompetitionGunScoreResults }) {
  return <CompetitionResultsTable data={data} rankingMethod="gun_score" />;
}
