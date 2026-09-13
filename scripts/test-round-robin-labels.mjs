import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const ui = await loadModule("src/components/ui.tsx");
const aggregate = await loadModule("src/components/competition-aggregate-results.tsx", { "@/components/ui": ui });
const { roundRobinOpponentLabels: labels, roundRobinPrintLabels: printLabels, CompetitionRoundRobinResultsTable: Table } =
  await loadModule("src/components/competition-round-robin-results.tsx", {
    "@/components/ui": ui,
    "@/components/competition-aggregate-results": aggregate,
  });

function entrant(id, club, label = "Pair 2", first = null, last = null) {
  return { entrant_id: id, club_name: club, entrant_label: label,
    entrant_format: label.startsWith("Individual") ? "individual" : label.startsWith("Team") ? "team" : "pairs",
    participants: [{first_name: first, last_name: last, slot_number: 1}],
    rounds: [{round_id: 1, opponent_id: id === 1 ? 2 : 1, state: "pending", outcome: "pending", match_points: null, gun_score: null}],
    position: 1, tied: true, total_match_points: 0, gun_total: null, x_total: null, unresolved_matches: 0,
  };
}

test("print opponent codes deterministically extend colliding Club prefixes and remain unique without exposing IDs", () => {
  const entrants = [
    entrant(41, "Basildon Rifle and Pistol Club", "Pair 1"),
    entrant(42, "Basingstoke Rifle Club", "Pair 1"),
    entrant(43, "Braintree and District Rifle Club", "Pair 2"),
    entrant(44, "Braintree and District Rifle Club", "Pair 2"),
  ];
  const result = printLabels(entrants);
  assert.equal(result.get(41).code, "BASIL-1");
  assert.equal(result.get(42).code, "BASIN-1");
  assert.equal(result.get(43).code, "BRA-2A");
  assert.equal(result.get(44).code, "BRA-2B");
  assert.equal(new Set([...result.values()].map(value => value.code)).size, entrants.length);
  assert.deepEqual(printLabels([...entrants].reverse()).get(41), result.get(41));
  assert.doesNotMatch([...result.values()].map(value => `${value.code} ${value.legend}`).join(" "), /41|42|43|44|entry #/);
});

test("club-scoped Pair and Team numbers always retain unambiguous current Club context", () => {
  for (const label of ["Pair 2", "Team 2"]) {
    const result = labels([entrant(1,"Basildon Rifle and Pistol Club",label),entrant(2,"Northbridge Target Shooting Club",label)]);
    assert.equal(result.get(1).compact,`${label} · Basildon`);
    assert.equal(result.get(2).compact,`${label} · Northbridge`);
    assert.equal(result.get(1).full,`${label} · Basildon Rifle and Pistol Club`);
  }
});

test("shared Club prefixes expand rather than inventing acronyms", () => {
  const result=labels([entrant(1,"St Mary Rifle Club"),entrant(2,"St John Rifle Club"),entrant(3,"St Mary Target Club")]);
  assert.deepEqual([...result.values()].map(v=>v.compact),["Pair 2 · St Mary Rifle","Pair 2 · St John","Pair 2 · St Mary Target"]);
});

test("individual initial/surname collisions expand to full names then Club context", () => {
  const a=entrant(1,"Basildon Rifle and Pistol Club","Individual 1","Isla","Morgan");
  assert.equal(labels([a]).get(1).compact,"I. Morgan");
  const b=entrant(2,"Northbridge Target Shooting Club","Individual 1","Ian","Morgan");
  assert.deepEqual([...labels([a,b]).values()].map(v=>v.compact),["Isla Morgan","Ian Morgan"]);
  b.participants[0].first_name="Isla";
  assert.deepEqual([...labels([a,b]).values()].map(v=>v.compact),["Isla Morgan · Basildon","Isla Morgan · Northbridge"]);
});

test("identical names in one Club use current entry labels; indistinguishable labels retain current entry IDs", () => {
  const a=entrant(1,"Basildon Rifle Club","Individual 1","Isla","Morgan");
  const b=entrant(2,"Basildon Rifle Club","Individual 2","Isla","Morgan");
  const result=labels([a,b]);
  assert.equal(result.get(1).compact,"Isla Morgan · Basildon Rifle Club · Individual 1");
  assert.equal(result.get(2).compact,"Isla Morgan · Basildon Rifle Club · Individual 2");
  const identical=labels([entrant(1,"Same Club"),entrant(2,"Same Club")]);
  assert.equal(identical.get(1).compact,"Pair 2 · Same Club · entry #1");
  assert.equal(identical.get(2).compact,"Pair 2 · Same Club · entry #2");
});

test("labels are order-independent, case-insensitive for collision detection, and do not mutate data", () => {
  const input=[entrant(1,"Basildon Rifle Club","Individual 1","Isla","Morgan"),entrant(2,"Northbridge Club","Individual 1","ian","morgan")];
  const original=structuredClone(input);
  const result=labels(input);
  assert.notEqual(result.get(1).compact.toLowerCase(),result.get(2).compact.toLowerCase());
  assert.deepEqual(labels([...input].reverse()).get(1),result.get(1));
  assert.deepEqual(input,original);
});

test("rendered compact opponent text wraps without destructive ellipsis and retains full accessible names", () => {
  const entrants=[entrant(1,"Basildon Rifle and Pistol Club"),entrant(2,"Northbridge Target Shooting Club")];
  const html=renderToStaticMarkup(createElement(Table,{data:{status:"ready",display_scoring_mode:"points_scored",uses_x_score:false,released_round_count:0,
    rounds:[{id:1,round_number:1,deadline:"2026-09-20",released:false}],groups:[{id:1,name:"Division 1",entrants}]}}));
  assert.match(html,/<span aria-hidden="true">v Pair 2 · Northbridge<\/span>/);
  assert.match(html,/title="Versus Pair 2 · Northbridge Target Shooting Club"/);
  assert.match(html,/<span class="sr-only">Versus Pair 2 · Northbridge Target Shooting Club<\/span>/);
  assert.match(html,/results-opponent-label/);
  assert.doesNotMatch(html,/results-opponent-label[^>]*truncate/);
  assert.match(html,/data-average-columns="0"/);
  assert.doesNotMatch(html,/>S\/Av<|>R\/Av</);
  assert.match(html,/Pending/);
});

test("print Round Robin cells use two-line codes and compact outcomes while screen retains opponent and per-Round X detail", () => {
  const home = entrant(1, "Basildon Rifle and Pistol Club", "Pair 1");
  const opponents = [
    entrant(2, "Braintree and District Rifle Club", "Pair 2"),
    entrant(3, "Chelmsford Rifle Club", "Pair 1"),
    entrant(4, "Southend-on-Sea Rifle Club", "Pair 1"),
  ];
  home.position = 1;
  home.tied = false;
  home.total_match_points = 5;
  home.gun_total = 703.65;
  home.x_total = 120;
  home.rounds = [
    {round_id:1,opponent_id:2,match_number:1,state:"scored",outcome:"win",match_points:2,gun_score:181.05,x_total:9},
    {round_id:2,opponent_id:3,match_number:2,state:"scored",outcome:"draw",match_points:1,gun_score:170.2,x_total:7},
    {round_id:3,opponent_id:4,match_number:3,state:"scored",outcome:"loss",match_points:0,gun_score:166.6,x_total:6},
    {round_id:4,opponent_id:null,match_number:4,state:"scored",outcome:"bye",match_points:2,gun_score:185.8,x_total:8},
  ];
  const entrants = [home, ...opponents];
  const rounds = home.rounds.map((cell, index) => ({id:cell.round_id,round_number:index+1,deadline:`2026-09-${20+index}`,released:true}));
  const html = renderToStaticMarkup(createElement(Table,{data:{status:"ready",display_scoring_mode:"points_scored",uses_x_score:true,released_round_count:4,
    rounds,groups:[{id:1,name:"Division 1",entrants}]}}));

  const legend = html.match(/class="results-round-robin-legend[^>]*>(.*?)<\/div><div role="region"/s)?.[1] ?? "";
  for (const {code, legend: description} of printLabels(entrants).values()) {
    assert.match(legend, new RegExp(`${code}.*${description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "s"));
  }
  const printCells = [...html.matchAll(/data-print-round-cell="true"[^>]*>(.*?)<\/div>/gs)].map(match => match[1]);
  assert.match(printCells[0], /BRA-2[\s\S]*181\.05 · W2/);
  assert.match(printCells[1], /CHE-1[\s\S]*170\.2 · D1/);
  assert.match(printCells[2], /SOU-1[\s\S]*166\.6 · L0/);
  assert.match(printCells[3], /BYE[\s\S]*185\.8 · W2/);
  assert.doesNotMatch(printCells.slice(0,4).join(" "), /\d+X|pts|Versus|v Pair/);
  assert.match(html, /data-screen-only="true" class="contents"[\s\S]*v Pair 2 · Braintree[\s\S]*9X[\s\S]*W · 2 pts/);
  assert.match(html, /703\.65 gun total · 120X/);
  assert.doesNotMatch(html, /results-opponent-label[^>]*truncate/);
});

test("Pair/Team disclosure belongs to the sticky entrant cell and controls a trigger-free breakdown row", () => {
  for (const label of ["Pair 2", "Team 2", "Individual 1"]) {
    const unit=entrant(1,"Basildon Rifle Club",label,"Isla","Morgan");
    const html=renderToStaticMarkup(createElement(Table,{data:{status:"ready",display_scoring_mode:"points_scored",uses_x_score:false,released_round_count:0,
      rounds:[{id:1,round_number:1,deadline:"2026-09-20",released:false}],groups:[{id:1,name:"Division 1",entrants:[unit]}]}}));
    const stickyCell=html.match(/<th scope="row" class="results-sticky-entrant[^>]*>(.*?)<\/th>/s)?.[1];
    if (label.startsWith("Individual")) {
      assert.doesNotMatch(stickyCell,/<summary/);
      assert.doesNotMatch(html,/id="rr-participants-/);
    } else {
      assert.match(stickyCell,/<details[^>]*><summary aria-controls="rr-participants-1-1"/);
      assert.match(stickyCell,/Participants/);
      assert.equal((html.match(/<summary/g) ?? []).length,1);
      const breakdown=html.match(/<tr id="rr-participants-1-1"[^>]*class="hidden[^>]*>(.*?)<\/tr>/s)?.[1];
      assert.match(breakdown,/Released shooting results by participant/);
      assert.doesNotMatch(breakdown,/<summary|<details/);
      assert.match(html,/\[&amp;:has\(details\[open\]\)\+tr\]:table-row/);
    }
  }
});
