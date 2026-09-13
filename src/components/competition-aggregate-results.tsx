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

function InlineAverageSummary({ participant, showStarting = true, showRunning = true }: {
  participant: AggregateParticipant;
  showStarting?: boolean;
  showRunning?: boolean;
}) {
  if (!showStarting && !showRunning) return null;
  return (
    <span className="results-inline-averages mt-1 block text-[11px] font-normal leading-snug text-muted-foreground lg:hidden">
      {showStarting ? <>S/Av {average(participant.starting_average)}{showRunning ? <> <span aria-hidden="true">·</span>{" "}</> : null}</> : null}
      {showRunning ? <>R/Av {average(participant.running_average)}</> : null}
    </span>
  );
}

function AverageCells({ participant, showStarting = true, showRunning = true }: {
  participant?: AggregateParticipant;
  showStarting?: boolean;
  showRunning?: boolean;
}) {
  return (
    <>
      {showStarting ? <td className="results-average-cell hidden border-b border-border px-1 py-2.5 text-center text-xs text-foreground lg:table-cell">
        {participant && hasStartingAverage(participant) ? average(participant.starting_average) : "—"}
      </td> : null}
      {showRunning ? <td className="results-average-cell hidden border-b border-border px-1 py-2.5 text-center text-xs text-foreground lg:table-cell">
        {participant ? average(participant.running_average) : "—"}
      </td> : null}
    </>
  );
}

function averageColumnVisibility(entrants: ResultsEntrant[]) {
  const individualParticipants = entrants.flatMap((entrant) =>
    entrant.entrant_format === "individual" && entrant.participants[0] ? [entrant.participants[0]] : [],
  );
  const showStarting = individualParticipants.some((participant) =>
    hasStartingAverage(participant) && participant.starting_average != null,
  );
  const showRunning = individualParticipants.some((participant) => participant.running_average != null);
  return { showStarting, showRunning, count: Number(showStarting) + Number(showRunning) };
}

function RoundCell({ cell, usesX, rankingMethod }: {
  cell: ResultsRoundCell;
  usesX: boolean;
  rankingMethod: ResultsRankingMethod;
}) {
  if (cell.state === "pending") {
    return <span className="text-[11px] text-muted-foreground">—<span className="sr-only"> Unreleased</span></span>;
  }
  if (cell.state === "nsr") {
    return <abbr title="No score returned: incomplete at Round End" className="text-[11px] font-semibold text-muted-foreground no-underline">NSR</abbr>;
  }
  const detail = rankingMethod === "aggregate"
    ? `${number((cell as AggregateRoundCell).ranking_points)} pts`
    : rankingMethod === "best_n_average"
      ? ((cell as BestNAverageRoundCell).counts_towards_average ? "Counts" : "Excluded")
      : null;
  const xTotal = "x_total" in cell ? cell.x_total : null;
  return (
    <div className="results-cell-stack leading-snug">
      <span className="results-cell-primary block text-[13px] font-semibold text-foreground">
        {number(cell.gun_score)}<span className="sr-only"> gun result</span>
      </span>
      {detail || usesX ? (
        <span className="results-cell-secondary mt-0.5 block whitespace-nowrap text-[10px] text-muted-foreground">
          {detail ? <span className={rankingMethod === "best_n_average" && detail === "Excluded" ? "opacity-70" : "font-semibold text-brand-deep"}>{detail}</span> : null}
          {detail && usesX ? <span aria-hidden="true"> · </span> : null}
          {usesX ? `${number(xTotal)}X` : null}
        </span>
      ) : null}
    </div>
  );
}

function FinalCell({ entrant, usesX, rankingMethod }: {
  entrant: ResultsEntrant;
  usesX: boolean;
  rankingMethod: ResultsRankingMethod;
}) {
  if (rankingMethod === "aggregate") {
    const aggregate = entrant as AggregateEntrant;
    return <div className="results-cell-stack leading-snug"><span className="results-cell-primary block text-[13px] font-bold text-brand-deep">{number(aggregate.gun_total)}<span className="sr-only"> total shooting result</span></span><span className="results-cell-secondary mt-0.5 block whitespace-nowrap text-[10px] text-muted-foreground">{number(aggregate.total_points)} pts<span className="sr-only"> total aggregate ranking points</span>{usesX ? ` · ${number(aggregate.x_total)}X` : ""}</span></div>;
  }
  if (rankingMethod === "best_n_average") {
    const best = entrant as BestNAverageEntrant;
    return <div className="results-cell-stack leading-snug"><span className="results-cell-primary block text-[13px] font-bold text-brand-deep">{average(best.qualifying_average)}</span>{best.ranking_eligible ? <span className="results-cell-secondary mt-0.5 block text-[10px] text-muted-foreground">{best.counted_rounds}/{best.required_complete_results} required</span> : <><span className="results-cell-secondary mt-0.5 block text-[10px] font-semibold text-warning">Not qualified</span><span className="results-cell-tertiary mt-0.5 block text-[10px] text-muted-foreground">{best.scored_rounds}/{best.required_complete_results} required</span></>}</div>;
  }
  const gun = entrant as GunScoreEntrant;
  return <div className="results-cell-stack leading-snug"><span className="results-cell-primary block text-[13px] font-bold text-brand-deep">{number(gun.gun_total)}<span className="sr-only"> total gun score</span></span>{usesX ? <span className="results-cell-secondary mt-0.5 block text-[10px] text-muted-foreground">{number(gun.x_total)}X</span> : null}</div>;
}

function ParticipantResultCell({ cell, usesX }: {
  cell: AggregateParticipantRoundCell | undefined;
  usesX: boolean;
}) {
  if (!cell || cell.state === "pending") return <span className="text-muted-foreground">—<span className="sr-only"> Unreleased</span></span>;
  if (cell.state === "nsr") return <abbr title="No score returned: incomplete at Round End" className="text-[11px] font-semibold text-muted-foreground no-underline">NSR</abbr>;
  return <div className="results-cell-stack leading-snug"><span className="results-cell-primary block text-[12px] font-medium text-foreground">{number(cell.gun_score)}</span>{usesX ? <span className="results-cell-secondary block text-[10px] text-muted-foreground">{number(cell.x_total)}X</span> : null}</div>;
}

export function ParticipantBreakdown({ entrant, rounds, usesX, rankingMethod, disclosureId, standingsAverageColumnCount = 2 }: {
  entrant: ResultsEntrant;
  rounds: Array<{ id: number; round_number: number }>;
  usesX: boolean;
  rankingMethod: ResultsRankingMethod;
  disclosureId?: string;
  standingsAverageColumnCount?: number;
}) {
  const showParticipantStarting = entrant.participants.some((participant) =>
    hasStartingAverage(participant) && participant.starting_average != null,
  );
  const showParticipantRunning = entrant.participants.some((participant) => participant.running_average != null);
  const participantAverageColumnCount = Number(showParticipantStarting) + Number(showParticipantRunning);
  const content = (
    <div className="results-participant-content border-t border-border bg-surface px-2 pb-2">
      <table data-average-columns={participantAverageColumnCount} className="results-participant-table w-full table-fixed border-separate border-spacing-0 text-[11px] tabular-nums">
        <caption className="sr-only">Released shooting results by participant for {entrant.entrant_label}. Participant rows do not receive {rankingMethod === "aggregate" ? "Aggregate ranking points" : "a separate ranking position"}.</caption>
        <colgroup>
          <col className="results-participant-name-column" />
          {showParticipantStarting ? <col className="results-average-column hidden lg:table-column" /> : null}
          {showParticipantRunning ? <col className="results-average-column hidden lg:table-column" /> : null}
          {rounds.map((round) => <col key={round.id} className="results-round-column" />)}
          <col className="results-final-column" />
        </colgroup>
        <thead><tr className="text-muted-foreground">
          <th scope="col" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-1.5 text-left font-medium">Participant</th>
          {showParticipantStarting ? <th scope="col" className="results-average-cell hidden border-b border-border px-1 py-1.5 text-center font-medium lg:table-cell"><abbr title="Starting Average" className="no-underline">S/Av</abbr></th> : null}
          {showParticipantRunning ? <th scope="col" className="results-average-cell hidden border-b border-border px-1 py-1.5 text-center font-medium lg:table-cell"><abbr title="Running Average" className="no-underline">R/Av</abbr></th> : null}
          {rounds.map((round) => <th key={round.id} scope="col" className="border-b border-l border-border px-1 py-1.5 text-center font-medium">R{round.round_number}</th>)}
          <th scope="col" className="results-final-cell border-b border-l-2 border-brand/30 px-1 py-1.5 text-center font-medium">Total</th>
        </tr></thead>
        <tbody>{entrant.participants.map((participant) => (
          <tr key={participant.slot_number} data-participant-row={participant.slot_number}>
            <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-1.5 text-left font-medium text-foreground">
              {participantName(participant)}<InlineAverageSummary participant={participant} showStarting={showParticipantStarting} showRunning={showParticipantRunning} />
            </th>
            <AverageCells participant={participant} showStarting={showParticipantStarting} showRunning={showParticipantRunning} />
            {rounds.map((round) => <td key={round.id} data-participant-round={round.id} className="border-b border-l border-border/70 px-1 py-2 text-center"><ParticipantResultCell cell={participant.rounds?.find((cell) => cell.round_id === round.id)} usesX={usesX} /></td>)}
            <td data-participant-total className="results-final-cell border-b border-l-2 border-brand/30 px-1 py-2 text-center"><span className="font-semibold text-foreground">{number(participant.gun_total)}</span>{usesX ? <span className="ml-1 text-[10px] text-muted-foreground">{number(participant.x_total)}X</span> : null}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  return (
    <tr id={disclosureId} data-participant-breakdown className={disclosureId ? "hidden bg-surface-muted/40" : "bg-surface-muted/40"}>
      <td colSpan={rounds.length + 2 + standingsAverageColumnCount} className="border-b border-border p-0">
        {disclosureId ? content : <details className="results-participant-details"><summary className="min-h-9 cursor-pointer content-center rounded px-3 py-1.5 text-[11px] font-semibold text-brand-strong outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">Participants <span className="sr-only">for {entrant.entrant_label}, {entrant.club_name}</span></summary>{content}</details>}
      </td>
    </tr>
  );
}

function finalHeading(rankingMethod: ResultsRankingMethod, bestRoundsCount?: number) {
  if (rankingMethod === "aggregate") return "Total";
  if (rankingMethod === "best_n_average") return `Best ${bestRoundsCount} avg`;
  return "Gun total";
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
    {data.groups.map((group) => {
      const averageColumns = averageColumnVisibility(group.entrants);
      const tableStyle = {
        "--results-round-count": data.rounds.length,
        "--results-table-base-width": `${19 + averageColumns.count * 3.5}rem`,
      } as CSSProperties;
      return (
      <section key={group.id} aria-labelledby={`results-${rankingMethod}-${group.id}`} className="results-group min-w-0" data-ranking-method={rankingMethod}>
        <h2 id={`results-${rankingMethod}-${group.id}`} className="results-division-heading mb-2 text-base font-semibold text-foreground">{group.name}</h2>
        {group.entrants.length === 0 ? <Card className="p-5 text-sm text-muted-foreground">No submitted entrants yet.</Card> : (
          <div role="region" aria-labelledby={`results-${rankingMethod}-${group.id}`} tabIndex={0} className="results-table-region relative max-w-full overflow-x-auto rounded-xl border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <table style={tableStyle} data-average-columns={averageColumns.count} className="results-score-table w-full table-fixed border-separate border-spacing-0 text-xs tabular-nums">
              <caption className="sr-only">{group.name} {caption} Scroll horizontally for more Rounds on narrow screens. Equal positions remain tied.</caption>
              <colgroup>
                <col className="results-entrant-column" />
                {averageColumns.showStarting ? <col className="results-average-column hidden lg:table-column" /> : null}
                {averageColumns.showRunning ? <col className="results-average-column hidden lg:table-column" /> : null}
                {data.rounds.map((round) => <col key={round.id} className="results-round-column" />)}
                <col className="results-final-column" />
              </colgroup>
              <thead><tr className="text-[11px] text-muted-foreground">
                <th scope="col" className="results-sticky-entrant sticky left-0 z-20 border-b border-r border-border bg-surface-muted px-2 py-2.5 text-left">Entrant</th>
                {averageColumns.showStarting ? <th scope="col" className="results-average-cell hidden border-b border-border bg-surface-muted px-1 py-2.5 text-center lg:table-cell"><abbr title="Starting Average" className="no-underline">S/Av</abbr></th> : null}
                {averageColumns.showRunning ? <th scope="col" className="results-average-cell hidden border-b border-border bg-surface-muted px-1 py-2.5 text-center lg:table-cell"><abbr title="Running Average" className="no-underline">R/Av</abbr></th> : null}
                {data.rounds.map((round) => <th key={round.id} scope="col" className="border-b border-l border-border/70 bg-surface-muted px-1 py-2 text-center">
                  <span className="block font-semibold text-foreground">R{round.round_number}</span>
                  <time data-round-date-heading dateTime={round.deadline} title={accessibleRoundDateFormatter.format(new Date(`${round.deadline}T00:00:00Z`))} aria-label={`Round End ${accessibleRoundDateFormatter.format(new Date(`${round.deadline}T00:00:00Z`))}`} className="mt-0.5 block whitespace-nowrap text-[9px] font-normal leading-snug">{compactRoundDate(round.deadline)}</time>
                  {!round.released ? <span className="results-round-release-label block text-[9px] font-normal leading-snug">Unreleased</span> : null}
                </th>)}
                <th scope="col" className="results-final-cell border-b border-l-2 border-brand/30 bg-brand-subtle px-1 py-2.5 text-center font-semibold text-brand-deep">{finalHeading(rankingMethod, bestRoundsCount)}</th>
              </tr></thead>
              <tbody>{group.entrants.map((entrant) => {
                const participant = entrant.entrant_format === "individual" ? entrant.participants[0] : undefined;
                const bestNEntrant = rankingMethod === "best_n_average" ? entrant as BestNAverageEntrant : null;
                const hasPosition = data.released_round_count > 0 && (bestNEntrant?.ranking_eligible ?? true) && entrant.position != null;
                return <Fragment key={entrant.entrant_id}>
                  <tr data-entrant-row={entrant.entrant_id}>
                    <th scope="row" className="results-sticky-entrant sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-2.5 text-left align-top font-normal">
                      <span className="results-entrant-layout flex min-w-0 items-start gap-2">
                        <span data-entrant-position className="inline-flex w-5 shrink-0 justify-end pt-px text-[11px] font-bold leading-snug text-muted-foreground" aria-label={!hasPosition ? (bestNEntrant && !bestNEntrant.ranking_eligible ? "Not qualified" : "Not ranked yet") : `${entrant.tied ? "Tied " : ""}position ${entrant.position}`}>{hasPosition ? `${entrant.position}${entrant.tied ? "=" : ""}` : "—"}</span>
                        <span className="results-entrant-copy min-w-0">
                          <span className="results-entrant-name block break-words text-[13px] font-semibold leading-snug text-foreground">{entrant.entrant_format === "individual" ? (participant ? participantName(participant) : "Shooter") : entrant.entrant_label}</span>
                          <span className="results-entrant-club mt-1 block break-words text-[10px] leading-snug text-muted-foreground">{entrant.club_name}</span>
                          {participant ? <InlineAverageSummary participant={participant} showStarting={averageColumns.showStarting} showRunning={averageColumns.showRunning} /> : null}
                        </span>
                      </span>
                    </th>
                    <AverageCells participant={participant} showStarting={averageColumns.showStarting} showRunning={averageColumns.showRunning} />
                    {entrant.rounds.map((cell) => <td key={cell.round_id} className="border-b border-l border-border/70 px-1 py-2.5 text-center align-top"><RoundCell cell={cell} usesX={data.uses_x_score} rankingMethod={rankingMethod} /></td>)}
                    <td data-total-cell className="results-final-cell border-b border-l-2 border-brand/30 bg-brand-subtle/30 px-1 py-2.5 text-center align-top"><FinalCell entrant={entrant} usesX={data.uses_x_score} rankingMethod={rankingMethod} /></td>
                  </tr>
                  {entrant.entrant_format !== "individual" ? <ParticipantBreakdown entrant={entrant} rounds={data.rounds} usesX={data.uses_x_score} rankingMethod={rankingMethod} standingsAverageColumnCount={averageColumns.count} /> : null}
                </Fragment>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      );
    })}
    {rankingMethod === "best_n_average" ? <p className="text-xs text-muted-foreground">Qualification requires a complete result in every released Round until Best {bestRoundsCount} is reached. Eligible entrants then rank on their best {bestRoundsCount} complete released results. Ineligible entrants remain visible without a position; NSR stays missing and X is not a tie-break.</p> : null}
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
