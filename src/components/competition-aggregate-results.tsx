import { Card } from "@/components/ui";
import type {
  AggregateParticipant,
  AggregateRoundCell,
  CompetitionAggregateResults,
} from "@/lib/competition-aggregate-results";

const numberFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

function number(value: number | null | undefined) {
  return value == null ? "—" : numberFormatter.format(value);
}

function participantName(participant: AggregateParticipant) {
  return [participant.first_name, participant.last_name].filter(Boolean).join(" ") ||
    `Shooter ${participant.slot_number}`;
}

function RoundCell({ cell, usesX }: { cell: AggregateRoundCell; usesX: boolean }) {
  if (cell.state === "pending") {
    return <span className="text-xs text-muted-foreground">Pending</span>;
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={cell.state === "nsr" ? "text-xs font-semibold text-muted-foreground" : "font-semibold text-foreground"}>
        {cell.state === "nsr" ? <abbr title="No score returned: incomplete at Round End" className="no-underline">NSR</abbr> : number(cell.gun_score)}
        {cell.state === "scored" ? <span className="sr-only"> gun result</span> : null}
      </span>
      <span className="rounded-md bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand-deep">
        {cell.ranking_points} <span aria-hidden="true">pts</span><span className="sr-only">aggregate ranking points</span>
      </span>
      {usesX && cell.state === "scored" ? (
        <span className="text-[11px] text-muted-foreground">{number(cell.x_total)} X</span>
      ) : null}
    </div>
  );
}

export function CompetitionAggregateResultsTable({ data }: { data: CompetitionAggregateResults }) {
  if (data.status === "awaiting_divisions") {
    return <Card className="p-6 text-sm text-muted-foreground">Results will be available when division allocations are published.</Card>;
  }
  const gunLabel = data.display_scoring_mode === "points_dropped" ? "Points dropped" :
    data.display_scoring_mode === "mixed" ? "Achieved points" : "Points scored";

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm leading-6 text-muted-foreground">
        {gunLabel} above each Round’s ranking points. Total shows aggregate ranking points and the gun total across scored Rounds.
        {data.uses_x_score ? " X totals resolve equal gun results." : ""}
        {" "}Rounds release after their Round End date (UTC). Pending Rounds do not contribute to totals.
      </p>
      {data.released_round_count === 0 ? (
        <p className="rounded-xl bg-brand-subtle px-4 py-3 text-sm text-brand-deep">No Rounds have been released yet.</p>
      ) : null}
      {data.groups.map((group) => (
        <section key={group.id} aria-labelledby={`results-division-${group.id}`} className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id={`results-division-${group.id}`} className="text-lg font-semibold text-foreground">{group.name}</h2>
            <span className="text-xs text-muted-foreground">{group.entrants.length} entrant{group.entrants.length === 1 ? "" : "s"}</span>
          </div>
          {group.entrants.length === 0 ? (
            <Card className="p-5 text-sm text-muted-foreground">No submitted entrants yet.</Card>
          ) : (
            <div role="region" aria-labelledby={`results-division-${group.id}`} tabIndex={0}
              className="relative max-w-full overflow-x-auto rounded-2xl border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
                <caption className="sr-only">{group.name} Aggregate standings. {gunLabel} and ranking points per Round. Scroll horizontally for more Rounds. Equal positions remain tied.</caption>
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th scope="col" className="sticky left-0 z-20 min-w-44 border-b border-r border-border bg-surface-muted px-3 py-3 text-left sm:min-w-60">Position / Entrant</th>
                    {data.rounds.map((round) => (
                      <th key={round.id} scope="col" className="min-w-24 whitespace-nowrap border-b border-border bg-surface-muted px-3 py-3 text-center">
                        <span className="block font-semibold text-foreground">R{round.round_number}</span>
                        <time dateTime={round.deadline} className="mt-1 block text-[10px] font-normal">{dateFormatter.format(new Date(`${round.deadline}T00:00:00Z`))}</time>
                        {!round.released ? <span className="mt-1 block text-[10px] font-normal">Unreleased</span> : null}
                      </th>
                    ))}
                    <th scope="col" className="min-w-32 border-b border-border bg-brand-subtle px-3 py-3 text-center text-brand-deep">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {group.entrants.map((entrant) => (
                    <tr key={entrant.entrant_id}>
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
                            {entrant.entrant_format !== "individual" ? (
                              <details className="mt-1">
                                <summary className="min-h-11 cursor-pointer content-center rounded text-xs font-semibold text-brand-strong outline-none focus-visible:ring-2 focus-visible:ring-brand">
                                  Participants <span className="sr-only">for {entrant.entrant_label}, {entrant.club_name}</span>
                                </summary>
                                <ul className="space-y-1 pb-1 text-xs text-muted-foreground">
                                  {entrant.participants.map((participant) => <li key={participant.slot_number}>{participantName(participant)}</li>)}
                                </ul>
                              </details>
                            ) : null}
                          </div>
                        </div>
                      </th>
                      {entrant.rounds.map((cell) => (
                        <td key={cell.round_id} className="border-b border-border px-3 py-3 text-center align-top">
                          <RoundCell cell={cell} usesX={data.uses_x_score} />
                        </td>
                      ))}
                      <td className="border-b border-border bg-brand-subtle/30 px-3 py-3 text-center align-top">
                        <span className="block text-base font-bold text-brand-deep">{entrant.total_points} <span className="text-[11px] font-semibold">pts</span></span>
                        <span className="mt-1 block text-xs text-muted-foreground">Gun {number(entrant.gun_total)}</span>
                        {data.uses_x_score ? <span className="mt-1 block text-[11px] text-muted-foreground">{number(entrant.x_total)} X</span> : null}
                        <span className="sr-only">{entrant.scored_rounds} scored Rounds. {gunLabel}.</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
      <p className="text-xs leading-5 text-muted-foreground">NSR: no complete score returned after Round End; earns 0 ranking points. Equal results share position points, with the next position skipped. Unresolved overall ties show “=”. Countback is not applied.</p>
    </div>
  );
}
