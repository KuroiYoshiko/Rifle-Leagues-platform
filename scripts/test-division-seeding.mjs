import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  divisionDraftNeedsRegenerationConfirmation,
  generateIndividualDivisionDraft,
  getBalancedDivisionSizes,
  getDivisionSeedingAvailability,
} from "../src/lib/competition-division-seeding.mjs";

function entrant(id, startingAverage, state = startingAverage === null ? "no_average" : "ready") {
  return {
    id,
    starting_average: startingAverage,
    starting_average_state: state,
  };
}

function availability(overrides = {}) {
  return getDivisionSeedingAvailability({
    entryFormat: "individual",
    workflowStatus: "draft",
    averageConfigured: true,
    currentFingerprint: "0123456789abcdef0123456789abcdef",
    entrants: [entrant(1, 95)],
    ...overrides,
  });
}

test("reviewed Individual S/Av values seed strongest-first contiguous Divisions deterministically", () => {
  const entrants = [
    entrant(9, 91),
    entrant(4, 99),
    entrant(2, 97),
    entrant(7, 95),
    entrant(1, 93),
    entrant(6, 89),
  ];
  const first = generateIndividualDivisionDraft(entrants, 3);
  const second = generateIndividualDivisionDraft([...entrants].reverse(), 3);

  assert.deepEqual(first.divisions, [
    { name: "Division 1", entrant_ids: [4, 2, 7] },
    { name: "Division 2", entrant_ids: [1, 9, 6] },
  ]);
  assert.deepEqual(second, first);
  assert.deepEqual(first.seededEntrantIds, [4, 2, 7, 1, 9, 6]);
});

test("equal averages use entrant id as a stable tie-breaker", () => {
  const result = generateIndividualDivisionDraft(
    [entrant(8, 94), entrant(3, 94), entrant(5, 94)],
    2,
  );
  assert.deepEqual(result.seededEntrantIds, [3, 5, 8]);
  assert.deepEqual(result.divisions.map((division) => division.entrant_ids), [[3, 5], [8]]);
});

test("balanced target-size planning avoids tiny final Divisions", () => {
  assert.deepEqual(getBalancedDivisionSizes(12, 4), [4, 4, 4]);
  assert.deepEqual(getBalancedDivisionSizes(13, 6), [5, 4, 4]);
  assert.deepEqual(getBalancedDivisionSizes(7, 6), [4, 3]);
  assert.deepEqual(getBalancedDivisionSizes(1, 6), [1]);
  assert.deepEqual(getBalancedDivisionSizes(0, 6), []);

  for (let count = 1; count <= 300; count += 1) {
    for (let target = 1; target <= 25; target += 1) {
      const sizes = getBalancedDivisionSizes(count, target);
      assert.equal(sizes.length, Math.ceil(count / target));
      assert.equal(sizes.reduce((sum, size) => sum + size, 0), count);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    }
  }
});

test("null S/Av remains unseeded while a genuine zero stays seeded", () => {
  const result = generateIndividualDivisionDraft(
    [entrant(4, null), entrant(2, 88), entrant(9, null, "frozen"), entrant(6, 0)],
    3,
  );
  assert.deepEqual(result.divisions, [
    { name: "Division 1", entrant_ids: [2, 6] },
  ]);
  assert.deepEqual(result.unseededEntrantIds, [4, 9]);
  assert.deepEqual(result.seededEntrantIds, [2, 6]);
});

test("automatic seeding is limited to an editable Individual draft with a resolved current projection", () => {
  assert.deepEqual(availability(), { available: true, reason: null });
  for (const entryFormat of ["pairs", "team"]) {
    const result = availability({ entryFormat });
    assert.equal(result.available, false);
    assert.match(result.reason, /only for Individual Competitions/i);
  }
  assert.match(availability({ workflowStatus: "published" }).reason, /cannot be regenerated/i);
  assert.match(availability({ averageConfigured: false }).reason, /Set up Starting Averages/i);
  assert.match(availability({ currentFingerprint: null }).reason, /current Starting Average review/i);
  assert.match(
    availability({ entrants: [entrant(1, null, "recalculation_required")] }).reason,
    /Calculate or review every participant/i,
  );
});

test("regeneration requires confirmation whenever numbered draft work exists", () => {
  assert.equal(divisionDraftNeedsRegenerationConfirmation([]), false);
  assert.equal(
    divisionDraftNeedsRegenerationConfirmation([{ key: "saved-1", name: "Division 1" }]),
    true,
  );
});

test("management UI keeps manual editing and saves generated work through the reviewed draft action", async () => {
  const [manager, actions, averageWorkspace, averageActions, seeding] = await Promise.all([
    readFile(new URL("../src/components/competition-division-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(app)/division-management-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/competition-average-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(app)/organisations/[slug]/average-actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/competition-division-seeding.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(manager, /Generate from Starting Averages/);
  assert.match(manager, /ConfirmationDialog/);
  assert.doesNotMatch(manager, /window\.confirm|\bconfirm\s*\(/);
  assert.match(manager, /Generate new Division draft\?/);
  assert.match(manager, /Generate new draft/);
  assert.match(manager, /saveCompetitionDivisionDraft\(\{/);
  assert.match(manager, /title="Needs placement"/);
  assert.match(manager, /Entrants not yet assigned to a Division\./);
  assert.match(manager, /Drop entrants here to leave them unassigned/);
  assert.match(manager, /Division 1 contains the strongest shooters/);
  assert.doesNotMatch(manager, /stay unseeded|Unseeded \/ manual placement/i);
  assert.match(manager, /starting_average_state === "frozen"\) return "Finalised"/);
  assert.match(manager, /Starting Averages are finalised for this Competition/);
  assert.match(averageWorkspace, /displayedStatus === "frozen" \? "Finalised"/);
  assert.match(averageActions, /Starting Averages have been finalised/);
  assert.match(manager, /DragDropProvider/);
  assert.match(manager, /function moveEntrant/);
  assert.match(manager, /function createDivisions/);
  assert.match(manager, /function addDivision/);
  assert.match(manager, /runAction\("save"\)/);
  assert.match(actions, /save_competition_division_draft_with_average_review/);
  assert.match(actions, /p_starting_average_fingerprint: input\.startingAverageFingerprint/);
  assert.match(actions, /save_and_publish_competition_divisions_with_average_review/);
  assert.doesNotMatch(seeding, /running_average|ranking_points|competition_results|calculate_competition/);
});
