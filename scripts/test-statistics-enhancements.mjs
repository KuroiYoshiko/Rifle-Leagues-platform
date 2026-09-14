import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getIfSeededTodayDivision,
  substituteCurrentShooterSeed,
} from "../src/lib/shooter-statistics-seeding.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("If seeded today substitutes only the signed-in entrant and preserves frozen/null peers", () => {
  const entrants = [
    { id: 1, starting_average: 80 },
    { id: 2, starting_average: 98 },
    { id: 3, starting_average: null },
    { id: 4, starting_average: 92 },
    { id: 5, starting_average: 90 },
    { id: 6, starting_average: 88 },
  ];
  const before = structuredClone(entrants);
  const substituted = substituteCurrentShooterSeed(entrants, 1, 99);

  assert.equal(substituted.find((entrant) => entrant.id === 1).starting_average, 99);
  assert.deepEqual(substituted.filter((entrant) => entrant.id !== 1), entrants.filter((entrant) => entrant.id !== 1));
  assert.equal(substituted.find((entrant) => entrant.id === 3).starting_average, null);
  assert.deepEqual(entrants, before, "the reviewed roster is not mutated");
  assert.equal(getIfSeededTodayDivision({
    entrants,
    ownEntrantId: 1,
    targetSize: 3,
    currentRunningAverage: 99,
  }), "Division 1");
});

test("If seeded today reuses the deterministic automatic allocator and requires current R/Av", async () => {
  const [helper, canonical] = await Promise.all([
    read("src/lib/shooter-statistics-seeding.mjs"),
    read("src/lib/competition-division-seeding.mjs"),
  ]);
  assert.match(helper, /import \{ generateIndividualDivisionDraft \}/);
  assert.match(helper, /generateIndividualDivisionDraft\(hypotheticalRoster, targetSize\)/);
  assert.match(canonical, /right\.starting_average - left\.starting_average \|\| left\.id - right\.id/);
  assert.equal(getIfSeededTodayDivision({
    entrants: [{ id: 1, starting_average: 80 }],
    ownEntrantId: 1,
    targetSize: 3,
    currentRunningAverage: null,
  }), null);
});

test("Statistics Division inputs are Individual-only, frozen, read-only and contain no six-card invention", async () => {
  const [sql, loader, dashboard] = await Promise.all([
    read("database/shooter-analytics.sql"),
    read("src/lib/shooter-analytics.ts"),
    read("src/components/shooter-analytics-dashboard.tsx"),
  ]);
  assert.match(sql, /competition\.entry_format = 'individual'/);
  assert.match(sql, /snapshot\.status = 'frozen'/);
  assert.match(sql, /config\.status = 'published'/);
  assert.doesNotMatch(sql, /Pair|Team|pair|team/);
  assert.doesNotMatch(`${sql}\n${loader}`, /(?:>=|>|minimum|min)\s*6|six[- ](?:card|score)/i);
  assert.match(loader, /getCompetitionResultAverages/);
  assert.match(loader, /getIfSeededTodayDivision/);
  assert.doesNotMatch(loader, /supabase\.(?:from|rpc)\([^\n]+(?:insert|update|delete)/);
  assert.match(dashboard, /This does not change your published Division/);
  assert.doesNotMatch(dashboard, /Projected promotion|promotion|demotion/i);
});

test("Statistics workspace exposes coherent views, explained trend, chart choices and paged physical history", async () => {
  const [page, dashboard, chart, sql] = await Promise.all([
    read("src/app/(app)/statistics/page.tsx"),
    read("src/components/shooter-analytics-dashboard.tsx"),
    read("src/components/shooter-performance-chart.tsx"),
    read("database/shooter-analytics.sql"),
  ]);
  assert.match(page, /"overview", "performance", "seasons", "history"/);
  assert.match(dashboard, /Overview[\s\S]*Performance[\s\S]*Seasons[\s\S]*Score history/);
  assert.match(dashboard, /Estimated change across selected history/);
  assert.match(dashboard, /linear regression[\s\S]*not the difference between the latest two scores/i);
  assert.match(chart, /"line" \| "bars"/);
  assert.match(chart, /<LineChart[\s\S]*<BarChart/);
  assert.match(sql, /limit 10 offset \(\(p_history_page - 1\) \* 10\)/i);
  assert.match(dashboard, /10 physical released score events per page/);
  assert.match(dashboard, /md:hidden[\s\S]*hidden md:block/);
  assert.doesNotMatch(dashboard, /overflow-x-auto/);
});

test("canonical discipline and Season comparisons never use display names as identities", async () => {
  const sql = await read("database/shooter-analytics.sql");
  assert.match(sql, /'equipment_code', representative\.equipment_type_code/);
  assert.match(sql, /'equipment_custom_id', representative\.organisation_equipment_type_id/);
  assert.match(sql, /'position_code', component\.shooting_position_code/);
  assert.match(sql, /'position_custom_id', component\.organisation_shooting_position_id/);
  assert.match(sql, /'distance_value', component\.distance_value/);
  assert.match(sql, /group by season_id, organisation_id/);
  assert.doesNotMatch(sql, /md5\([^\n]*competition_name/);
});
