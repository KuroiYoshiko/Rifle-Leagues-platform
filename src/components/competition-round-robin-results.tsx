import { Fragment } from "react";
import { Card } from "@/components/ui";
import { ParticipantBreakdown } from "@/components/competition-aggregate-results";
import type { CompetitionRoundRobinResults, RoundRobinEntrant } from "@/lib/competition-round-robin-results";

const formatNumber = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const formatAverage = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const number = (value: number | null | undefined) => value == null ? "—" : formatNumber.format(value);
function name(entrant: RoundRobinEntrant) {
  return entrant.entrant_format === "individual"
    ? [entrant.participants[0]?.first_name?.trim(), entrant.participants[0]?.last_name?.trim()].filter(Boolean).join(" ") || "Shooter"
    : entrant.entrant_label;
}

function individualAverageSummary(entrant: RoundRobinEntrant) {
  const participant = entrant.participants[0];
  if (!participant) return null;
  const average = (value: number | null | undefined) =>
    value == null ? "—" : formatAverage.format(value);

  return (
    <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
      {Object.hasOwn(participant, "starting_average") ? (
        <>
          S/Av {average(participant.starting_average)}{" "}
          <span aria-hidden="true">·</span>{" "}
        </>
      ) : null}
      R/Av {average(participant.running_average)}
    </span>
  );
}

const labelKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");

// Pair/Team position is local to a club's Competition entry. Club prefixes are
// display-only excerpts of current names, never abbreviations or saved identities.
export function roundRobinOpponentLabels(entrants: RoundRobinEntrant[]) {
  const clubs = [...new Set(entrants.map(entrant => labelKey(entrant.club_name)))];
  const candidates = entrants.map(entrant => {
    const words = entrant.club_name.trim().split(/\s+/);
    const lastWordIndex = words.findIndex((_, index) =>
      clubs.every(other => other === labelKey(entrant.club_name) ||
        other.split(" ").slice(0, index + 1).join(" ") !== labelKey(words.slice(0, index + 1).join(" "))),
    );
    const club = words.slice(0, lastWordIndex < 0 ? words.length : lastWordIndex + 1).join(" ");
    const fullName = name(entrant);
    const full = `${fullName} · ${entrant.club_name}`;
    const participant = entrant.participants[0];
    const initial = Array.from(participant?.first_name?.trim() ?? "")[0];
    const surname = participant?.last_name?.trim();
    const shortName = initial && surname ? `${initial}. ${surname}` : fullName;
    return {
      entrant,
      full,
      options: [...new Set([
        ...(entrant.entrant_format === "individual" ? [shortName, fullName] : []),
        `${fullName} · ${club}`,
        full,
        ...(entrant.entrant_format === "individual" ? [`${full} · ${entrant.entrant_label}`] : []),
        `${full} · entry #${entrant.entrant_id}`,
      ])],
      index: 0,
    };
  });
  // Resolve collisions across the whole Division, including collisions created
  // when a different entrant falls back to a fuller label.
  let changed = true;
  while (changed) {
    changed = false;
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      const key = labelKey(candidate.options[candidate.index]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const candidate of candidates) {
      if ((counts.get(labelKey(candidate.options[candidate.index])) ?? 0) > 1 && candidate.index < candidate.options.length - 1) {
        candidate.index++;
        changed = true;
      }
    }
  }
  return new Map(candidates.map(({ entrant, full, options, index }) => [entrant.entrant_id, {
    compact: options[index],
    full: index === options.length - 1 ? options[index] :
      options[index].endsWith(` · ${entrant.entrant_label}`) ? `${full} · ${entrant.entrant_label}` : full,
  }]));
}
const outcomes = { win: "W", draw: "D", loss: "L", bye: "Bye · W", bye_nsr: "Bye · no win", unresolved: "Unresolved", pending: "Pending" };

export function CompetitionRoundRobinResultsTable({ data }: {data: CompetitionRoundRobinResults}) {
  if (data.status === "awaiting_divisions") {
    return <Card className="p-6 text-sm text-muted-foreground">Round Robin requires published Divisions and fixtures. Finalise Divisions before Competition Start; an existing live competition without fixtures needs organiser attention.</Card>;
  }
  const gunLabel = data.display_scoring_mode === "points_dropped" ? "Points dropped" : data.display_scoring_mode === "mixed" ? "Achieved points" : "Points scored";
  return <div className="min-w-0 space-y-6">
    <p className="text-sm text-muted-foreground">Win 2 · Draw 1 · Loss 0 match points. A bye earns 2 only with a complete score. Results release after Round End.</p>
    {data.released_round_count === 0 ? <p className="rounded-xl bg-brand-subtle px-4 py-3 text-sm text-brand-deep">No Rounds have been released yet.</p> : null}
    {data.groups.map(group => {
      const opponentLabels = roundRobinOpponentLabels(group.entrants);
      return <section key={group.id} aria-labelledby={`rr-division-${group.id}`} data-ranking-method="round_robin">
      <h2 id={`rr-division-${group.id}`} className="mb-3 text-lg font-semibold">{group.name}</h2>
      {group.entrants.some(entrant => entrant.unresolved_matches > 0) ? <p className="mb-3 text-xs text-muted-foreground">Standings are provisional: matches involving NSR remain unresolved and contribute no match points.</p> : null}
      <div role="region" aria-labelledby={`rr-division-${group.id}`} tabIndex={0} className="relative max-w-full overflow-x-auto rounded-2xl border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
          <caption className="sr-only">Round Robin standings: match points, {gunLabel}, then X when enabled. Equal positions remain tied. Scroll horizontally for Rounds.</caption>
          <thead><tr className="text-xs text-muted-foreground">
            <th scope="col" className="sticky left-0 z-20 min-w-44 border-b border-r border-border bg-surface-muted px-3 py-3 text-left sm:min-w-60">Position / Entrant</th>
            {data.rounds.map(round => <th key={round.id} scope="col" className="min-w-36 border-b border-border bg-surface-muted px-3 py-3 text-center">
              <span className="block font-semibold text-foreground">R{round.round_number}</span>
              <time dateTime={round.deadline} aria-label={`Round End ${round.deadline}`} className="mt-1 block whitespace-nowrap text-[10px] font-normal">{date.format(new Date(`${round.deadline}T00:00:00Z`))}</time>
              {!round.released ? <span className="block text-[10px] font-normal">Unreleased</span> : null}
            </th>)}
            <th scope="col" className="min-w-32 border-b border-border bg-brand-subtle px-3 py-3 text-center text-brand-deep">Total</th>
          </tr></thead>
          <tbody>{group.entrants.map(entrant => <Fragment key={entrant.entrant_id}>
            <tr data-entrant-row={entrant.entrant_id} className="[&:has(details[open])+tr]:table-row">
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-3 text-left align-top font-normal">
                <div className="flex w-40 gap-2 sm:w-56"><span className="min-w-6 text-xs text-muted-foreground">{data.released_round_count ? `${entrant.position}${entrant.tied ? "=" : ""}` : "—"}</span><div className="min-w-0 break-words"><span className="font-semibold">{name(entrant)}</span><span className="mt-1 block text-xs text-muted-foreground">{entrant.club_name}</span>{entrant.entrant_format === "individual" ? individualAverageSummary(entrant) : null}
                  {entrant.entrant_format !== "individual" ? <details className="mt-1">
                    <summary aria-controls={`rr-participants-${group.id}-${entrant.entrant_id}`} className="min-h-11 cursor-pointer content-center rounded py-2 text-xs font-semibold text-brand-strong outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
                      Participants <span className="sr-only">for {entrant.entrant_label}, {entrant.club_name}</span>
                    </summary>
                  </details> : null}
                </div></div>
              </th>
              {data.rounds.map(round => {
                const cell = entrant.rounds.find(cell => cell.round_id === round.id);
                const opponent = cell?.opponent_id == null ? undefined : opponentLabels.get(cell.opponent_id);
                return <td key={round.id} data-round-id={round.id} className="border-b border-border px-3 py-3 text-center align-top">
                  <div title={opponent ? `Versus ${opponent.full}` : undefined} className="mx-auto max-w-44 text-[11px] text-muted-foreground">{opponent ? <><span aria-hidden="true">v {opponent.compact}</span><span className="sr-only">Versus {opponent.full}</span></> : cell ? "Bye" : "Fixture unavailable"}</div>
                  {!cell || cell.outcome === "pending" ? <span className="mt-1 block text-xs text-muted-foreground">Pending</span> : <>
                    <div className="mt-1 font-semibold">{cell.state === "nsr" ? <abbr title="No score returned: incomplete at Round End" className="no-underline">NSR</abbr> : number(cell.gun_score)}{data.uses_x_score && cell.state === "scored" ? <span className="ml-1 text-[11px] font-normal text-muted-foreground"> {number(cell.x_total)} X</span> : null}</div>
                    <span className="mt-1 block text-xs">{outcomes[cell.outcome]}</span>
                    <span className="mt-1 inline-block rounded-md bg-brand-subtle px-2 py-0.5 text-[11px] font-semibold text-brand-deep">{cell.match_points == null ? "No points awarded" : `${cell.match_points} match pts`}</span>
                  </>}
                </td>;
              })}
              <td className="border-b border-border bg-brand-subtle/30 px-3 py-3 text-center align-top"><span className="block font-semibold text-brand-deep">{entrant.total_match_points} match pts</span><span className="mt-1 block text-xs">{number(entrant.gun_total)} <span className="text-muted-foreground">{gunLabel.toLowerCase()}</span></span>{data.uses_x_score ? <span className="text-[11px] text-muted-foreground">{number(entrant.x_total)} X</span> : null}</td>
            </tr>
            {entrant.entrant_format !== "individual" ? <ParticipantBreakdown entrant={entrant} rounds={data.rounds} usesX={data.uses_x_score} rankingMethod="gun_score" disclosureId={`rr-participants-${group.id}-${entrant.entrant_id}`} /> : null}
          </Fragment>)}</tbody>
        </table>
      </div>
    </section>;
    })}
    <p className="text-xs text-muted-foreground">Order: match points, gun-score aggregate, then X when enabled. = indicates an unresolved tie. NSR contributes no gun total; no countback is applied. Participants contribute shooting results to their Pair or Team and receive no separate match points.</p>
  </div>;
}
