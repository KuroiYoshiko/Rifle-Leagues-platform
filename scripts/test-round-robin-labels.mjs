import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const ui = await loadModule("src/components/ui.tsx");
const aggregate = await loadModule("src/components/competition-aggregate-results.tsx", { "@/components/ui": ui });
const { roundRobinOpponentLabels: labels, CompetitionRoundRobinResultsTable: Table } =
  await loadModule("src/components/competition-round-robin-results.tsx", {
    "@/components/ui": ui,
    "@/components/competition-aggregate-results": aggregate,
  });

function entrant(id, club, label = "Pair 2", first = null, last = null) {
  return { entrant_id: id, club_name: club, entrant_label: label,
    entrant_format: label.startsWith("Individual") ? "individual" : label.startsWith("Team") ? "team" : "pairs",
    participants: [{first_name: first, last_name: last, slot_number: 1}],
    rounds: [{round_id: 1, opponent_id: id === 1 ? 2 : 1, state: "pending", outcome: "pending", match_points: null, gun_score: null}],
    position: 1, tied: true, total_match_points: 0, gun_total: null, unresolved_matches: 0,
  };
}

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

test("rendered compact opponent text includes full accessible and hover names", () => {
  const entrants=[entrant(1,"Basildon Rifle and Pistol Club"),entrant(2,"Northbridge Target Shooting Club")];
  const html=renderToStaticMarkup(createElement(Table,{data:{status:"ready",display_scoring_mode:"points_scored",uses_x_score:false,released_round_count:0,
    rounds:[{id:1,round_number:1,deadline:"2026-09-20",released:false}],groups:[{id:1,name:"Division 1",entrants}]}}));
  assert.match(html,/<span aria-hidden="true">v Pair 2 · Northbridge<\/span>/);
  assert.match(html,/title="Versus Pair 2 · Northbridge Target Shooting Club"/);
  assert.match(html,/<span class="sr-only">Versus Pair 2 · Northbridge Target Shooting Club<\/span>/);
  assert.match(html,/Pending/);
});

test("Pair/Team disclosure belongs to the sticky entrant cell and controls a trigger-free breakdown row", () => {
  for (const label of ["Pair 2", "Team 2", "Individual 1"]) {
    const unit=entrant(1,"Basildon Rifle Club",label,"Isla","Morgan");
    const html=renderToStaticMarkup(createElement(Table,{data:{status:"ready",display_scoring_mode:"points_scored",uses_x_score:false,released_round_count:0,
      rounds:[{id:1,round_number:1,deadline:"2026-09-20",released:false}],groups:[{id:1,name:"Division 1",entrants:[unit]}]}}));
    const stickyCell=html.match(/<th scope="row" class="sticky left-0[^>]*>(.*?)<\/th>/s)?.[1];
    if (label.startsWith("Individual")) {
      assert.doesNotMatch(stickyCell,/<summary/);
      assert.doesNotMatch(html,/id="rr-participants-/);
    } else {
      assert.match(stickyCell,/<details[^>]*><summary aria-controls="rr-participants-1-1"/);
      assert.match(stickyCell,/Participants/);
      assert.equal((html.match(/<summary/g) ?? []).length,1);
      const breakdown=html.match(/<tr id="rr-participants-1-1" class="hidden[^>]*>(.*?)<\/tr>/s)?.[1];
      assert.match(breakdown,/Released shooting results by participant/);
      assert.doesNotMatch(breakdown,/<summary|<details/);
      assert.match(html,/\[&amp;:has\(details\[open\]\)\+tr\]:table-row/);
    }
  }
});
