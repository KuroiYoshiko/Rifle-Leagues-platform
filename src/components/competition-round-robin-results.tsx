import { Fragment, type CSSProperties } from "react";
import { Card } from "@/components/ui";
import { ParticipantBreakdown } from "@/components/competition-aggregate-results";
import type { CompetitionRoundRobinResults, RoundRobinCell, RoundRobinEntrant } from "@/lib/competition-round-robin-results";

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

function individualAverageSummary(entrant: RoundRobinEntrant, showStarting: boolean, showRunning: boolean) {
  const participant = entrant.participants[0];
  if (!participant || (!showStarting && !showRunning)) return null;
  const average = (value: number | null | undefined) =>
    value == null ? "—" : formatAverage.format(value);

  return (
    <span className="mt-1 block text-[11px] font-normal leading-snug text-muted-foreground">
      {showStarting ? (
        <>
          S/Av {average(participant.starting_average)}{" "}
          {showRunning ? <><span aria-hidden="true">·</span>{" "}</> : null}
        </>
      ) : null}
      {showRunning ? <>R/Av {average(participant.running_average)}</> : null}
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

const printCodeSource = (value: string) => value
  .normalize("NFKD")
  .replace(/\p{M}/gu, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, "") || "CLUB";

const printEntrantSuffix = (entrant: RoundRobinEntrant) => {
  const numberSuffix = entrant.entrant_label.match(/\d+(?!.*\d)/)?.[0];
  if (numberSuffix) return numberSuffix;
  const initials = name(entrant).split(/\s+/).filter(Boolean).map(word => Array.from(word)[0]).join("");
  return printCodeSource(initials).slice(0, 3);
};

const printIdentityKey = (entrant: RoundRobinEntrant) => [
  labelKey(entrant.club_name),
  labelKey(entrant.entrant_label),
  labelKey(name(entrant)),
  entrant.participants.map(participant => labelKey(`${participant.first_name ?? ""} ${participant.last_name ?? ""}`)).join("|"),
].join("|");

// Print codes are derived only from current public entrant/Club labels. Club
// prefixes lengthen until unique; an alphabetic suffix handles otherwise
// indistinguishable public labels without exposing database IDs.
export function roundRobinPrintLabels(entrants: RoundRobinEntrant[]) {
  const uniqueClubs = [...new Map(entrants.map(entrant => [labelKey(entrant.club_name), entrant.club_name])).entries()]
    .map(([key, display]) => ({ key, display, source: printCodeSource(display), length: Math.min(3, printCodeSource(display).length) }));

  while (true) {
    const counts = new Map<string, number>();
    for (const club of uniqueClubs) {
      const code = club.source.slice(0, club.length);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const colliding = uniqueClubs.filter(club => (counts.get(club.source.slice(0, club.length)) ?? 0) > 1);
    if (colliding.length === 0 || !colliding.some(club => club.length < club.source.length)) break;
    for (const club of colliding) {
      if (club.length < club.source.length) club.length++;
    }
  }

  const baseClubCodes = new Map<string, string>();
  const clubGroups = new Map<string, typeof uniqueClubs>();
  for (const club of uniqueClubs) {
    const code = club.source.slice(0, club.length);
    clubGroups.set(code, [...(clubGroups.get(code) ?? []), club]);
  }
  for (const [code, clubs] of clubGroups) {
    for (const [index, club] of [...clubs].sort((a, b) => a.key.localeCompare(b.key, "en-GB")).entries()) {
      baseClubCodes.set(club.key, clubs.length === 1 ? code : `${code}${String.fromCharCode(65 + index)}`);
    }
  }

  const candidates = entrants.map(entrant => ({
    entrant,
    base: `${baseClubCodes.get(labelKey(entrant.club_name))}-${printEntrantSuffix(entrant)}`,
    identity: printIdentityKey(entrant),
  }));
  const baseCounts = new Map<string, number>();
  for (const candidate of candidates) baseCounts.set(candidate.base, (baseCounts.get(candidate.base) ?? 0) + 1);

  const collisionIndexes = new Map<number, string>();
  for (const base of new Set(candidates.filter(candidate => (baseCounts.get(candidate.base) ?? 0) > 1).map(candidate => candidate.base))) {
    const colliding = candidates
      .filter(candidate => candidate.base === base)
      .sort((a, b) => a.identity.localeCompare(b.identity, "en-GB") || a.entrant.entrant_id - b.entrant.entrant_id);
    colliding.forEach((candidate, index) => collisionIndexes.set(candidate.entrant.entrant_id, String.fromCharCode(65 + index)));
  }

  return new Map(candidates.map(({ entrant, base }) => {
    const code = `${base}${collisionIndexes.get(entrant.entrant_id) ?? ""}`;
    return [entrant.entrant_id, { code, legend: `${entrant.club_name} · ${name(entrant)}` }];
  }));
}

const printOutcome = (cell: RoundRobinCell) => {
  if (cell.outcome === "pending") return "Pending";
  const score = cell.state === "nsr" ? "NSR" : number(cell.gun_score);
  const outcome = cell.outcome === "win" || cell.outcome === "bye" ? "W" :
    cell.outcome === "draw" ? "D" : cell.outcome === "loss" ? "L" : null;
  if (outcome && cell.match_points != null) return `${score} · ${outcome}${cell.match_points}`;
  if (cell.outcome === "bye_nsr") return `${score} · 0`;
  return `${score} · —`;
};
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
      const printLabels = roundRobinPrintLabels(group.entrants);
      const individualParticipants = group.entrants.flatMap((entrant) =>
        entrant.entrant_format === "individual" && entrant.participants[0] ? [entrant.participants[0]] : [],
      );
      const showStartingAverage = individualParticipants.some((participant) =>
        Object.hasOwn(participant, "starting_average") && participant.starting_average != null,
      );
      const showRunningAverage = individualParticipants.some((participant) => participant.running_average != null);
      const averageColumnCount = Number(showStartingAverage) + Number(showRunningAverage);
      const tableStyle = {
        "--results-round-count": data.rounds.length,
        "--results-table-base-width": `${19 + averageColumnCount * 3.5}rem`,
      } as CSSProperties;
      return <section key={group.id} aria-labelledby={`rr-division-${group.id}`} className="results-group" data-ranking-method="round_robin">
      <h2 id={`rr-division-${group.id}`} className="results-division-heading mb-2 text-base font-semibold">{group.name}</h2>
      {group.entrants.some(entrant => entrant.unresolved_matches > 0) ? <p className="mb-3 text-xs text-muted-foreground">Standings are provisional: matches involving NSR remain unresolved and contribute no match points.</p> : null}
      <div data-print-only="true" className="results-round-robin-legend hidden" aria-label={`${group.name} opponent code legend`}>
        {[...printLabels.values()].map(label => <div key={label.code} className="results-round-robin-legend-item"><strong>{label.code}</strong><span aria-hidden="true"> = </span>{label.legend}</div>)}
      </div>
      <div role="region" aria-labelledby={`rr-division-${group.id}`} tabIndex={0} className="results-table-region relative max-w-full overflow-x-auto rounded-xl border border-border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <table style={tableStyle} data-average-columns={averageColumnCount} className="results-score-table results-round-robin-table w-full table-fixed border-separate border-spacing-0 text-xs tabular-nums">
          <caption className="sr-only">Round Robin standings: match points, {gunLabel}, then X when enabled. Equal positions remain tied. Scroll horizontally for Rounds.</caption>
          <colgroup>
            <col className="results-entrant-column" />
            {showStartingAverage ? <col className="results-average-column hidden lg:table-column" /> : null}
            {showRunningAverage ? <col className="results-average-column hidden lg:table-column" /> : null}
            {data.rounds.map(round => <col key={round.id} className="results-round-robin-column" />)}
            <col className="results-final-column" />
          </colgroup>
          <thead><tr className="text-[11px] text-muted-foreground">
            <th scope="col" className="results-sticky-entrant sticky left-0 z-20 border-b border-r border-border bg-surface-muted px-2 py-2.5 text-left">Entrant</th>
            {showStartingAverage ? <th scope="col" className="results-average-cell hidden border-b border-border bg-surface-muted px-1 py-2.5 text-center lg:table-cell"><abbr title="Starting Average" className="no-underline">S/Av</abbr></th> : null}
            {showRunningAverage ? <th scope="col" className="results-average-cell hidden border-b border-border bg-surface-muted px-1 py-2.5 text-center lg:table-cell"><abbr title="Running Average" className="no-underline">R/Av</abbr></th> : null}
            {data.rounds.map(round => <th key={round.id} scope="col" className="border-b border-l border-border/70 bg-surface-muted px-1 py-2 text-center">
              <span className="block font-semibold text-foreground">R{round.round_number}</span>
              <time data-round-date-heading dateTime={round.deadline} aria-label={`Round End ${round.deadline}`} className="mt-0.5 block whitespace-nowrap text-[9px] font-normal leading-snug">{date.format(new Date(`${round.deadline}T00:00:00Z`))}</time>
              {!round.released ? <span className="results-round-release-label block text-[9px] font-normal leading-snug">Unreleased</span> : null}
            </th>)}
            <th scope="col" className="results-final-cell border-b border-l-2 border-brand/30 bg-brand-subtle px-1 py-2.5 text-center font-semibold text-brand-deep">Match pts</th>
          </tr></thead>
          <tbody>{group.entrants.map(entrant => <Fragment key={entrant.entrant_id}>
            <tr data-entrant-row={entrant.entrant_id} className="[&:has(details[open])+tr]:table-row">
              <th scope="row" className="results-sticky-entrant sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-2.5 text-left align-top font-normal">
                <div className="results-entrant-layout flex min-w-0 items-start gap-2">
                  <span data-entrant-position className="inline-flex w-5 shrink-0 justify-end pt-px text-[11px] font-bold leading-snug text-muted-foreground" aria-label={data.released_round_count ? `${entrant.tied ? "Tied " : ""}position ${entrant.position}` : "Not ranked yet"}>{data.released_round_count ? `${entrant.position}${entrant.tied ? "=" : ""}` : "—"}</span>
                  <div className="results-entrant-copy min-w-0 break-words"><span className="results-entrant-name block text-[13px] font-semibold leading-snug">{name(entrant)}</span><span className="results-entrant-club mt-1 block text-[10px] leading-snug text-muted-foreground">{entrant.club_name}</span><span className="results-inline-averages lg:hidden">{entrant.entrant_format === "individual" ? individualAverageSummary(entrant, showStartingAverage, showRunningAverage) : null}</span>
                    {entrant.entrant_format !== "individual" ? <details data-screen-only="true" className="mt-1">
                      <summary aria-controls={`rr-participants-${group.id}-${entrant.entrant_id}`} className="min-h-8 cursor-pointer content-center rounded py-1 text-[11px] font-semibold text-brand-strong outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
                        Participants <span className="sr-only">for {entrant.entrant_label}, {entrant.club_name}</span>
                      </summary>
                    </details> : null}
                  </div>
                </div>
              </th>
              {showStartingAverage ? <td className="results-average-cell hidden border-b border-border px-1 py-2.5 text-center text-xs lg:table-cell">{entrant.entrant_format === "individual" && entrant.participants[0] && Object.hasOwn(entrant.participants[0], "starting_average") && entrant.participants[0].starting_average != null ? formatAverage.format(entrant.participants[0].starting_average) : "—"}</td> : null}
              {showRunningAverage ? <td className="results-average-cell hidden border-b border-border px-1 py-2.5 text-center text-xs lg:table-cell">{entrant.entrant_format === "individual" && entrant.participants[0]?.running_average != null ? formatAverage.format(entrant.participants[0].running_average) : "—"}</td> : null}
              {data.rounds.map(round => {
                const cell = entrant.rounds.find(cell => cell.round_id === round.id);
                const opponent = cell?.opponent_id == null ? undefined : opponentLabels.get(cell.opponent_id);
                const printOpponent = cell?.opponent_id == null ? undefined : printLabels.get(cell.opponent_id);
                return <td key={round.id} data-round-id={round.id} className="border-b border-l border-border/70 px-1 py-2.5 text-center align-top leading-snug">
                  <div data-screen-only="true" className="contents">
                    <div title={opponent ? `Versus ${opponent.full}` : undefined} className="results-opponent-label mx-auto break-words text-[9px] leading-tight text-muted-foreground">{opponent ? <><span aria-hidden="true">v {opponent.compact}</span><span className="sr-only">Versus {opponent.full}</span></> : cell ? "Bye" : "No fixture"}</div>
                    {!cell || cell.outcome === "pending" ? <span className="mt-1 block text-[11px] text-muted-foreground">Pending</span> : <>
                      <div className="results-cell-primary mt-1 block text-[13px] font-semibold">{cell.state === "nsr" ? <abbr title="No score returned: incomplete at Round End" className="no-underline">NSR</abbr> : number(cell.gun_score)}{data.uses_x_score && cell.state === "scored" ? <span className="results-round-robin-x ml-0.5 text-[10px] font-normal text-muted-foreground">{number(cell.x_total)}X</span> : null}</div>
                      <span className="results-cell-secondary mt-0.5 block whitespace-nowrap text-[10px]">{outcomes[cell.outcome]}{cell.match_points == null ? " · —" : ` · ${cell.match_points} pts`}</span>
                    </>}
                  </div>
                  <div data-print-only="true" data-print-round-cell="true" className="results-round-robin-print-cell hidden">
                    <span className="results-round-robin-print-opponent">{cell ? printOpponent?.code ?? "BYE" : "—"}</span>
                    <span className="results-round-robin-print-result">{cell ? printOutcome(cell) : "No fixture"}</span>
                  </div>
                </td>;
              })}
              <td className="results-final-cell border-b border-l-2 border-brand/30 bg-brand-subtle/30 px-1 py-2.5 text-center align-top leading-snug"><span className="results-cell-primary block text-[13px] font-bold text-brand-deep">{entrant.total_match_points} pts</span><span className="results-cell-secondary mt-0.5 block text-[10px] text-muted-foreground">{number(entrant.gun_total)} gun total{data.uses_x_score ? ` · ${number(entrant.x_total)}X` : ""}</span></td>
            </tr>
            {entrant.entrant_format !== "individual" ? <ParticipantBreakdown entrant={entrant} rounds={data.rounds} usesX={data.uses_x_score} rankingMethod="gun_score" disclosureId={`rr-participants-${group.id}-${entrant.entrant_id}`} standingsAverageColumnCount={averageColumnCount} /> : null}
          </Fragment>)}</tbody>
        </table>
      </div>
    </section>;
    })}
    <p className="text-xs text-muted-foreground">Order: match points, gun-score aggregate, then X when enabled. = indicates an unresolved tie. NSR contributes no gun total; no countback is applied. Participants contribute shooting results to their Pair or Team and receive no separate match points.</p>
  </div>;
}
