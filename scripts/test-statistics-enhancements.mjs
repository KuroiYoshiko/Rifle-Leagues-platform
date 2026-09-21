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

test("Division comparison places strong, middle and weak current form across three Divisions", () => {
  const entrants = [
    { id: 1, starting_average: 80 },
    { id: 2, starting_average: 98 },
    { id: 3, starting_average: 96 },
    { id: 4, starting_average: 94 },
    { id: 5, starting_average: 90 },
    { id: 6, starting_average: 88 },
    { id: 7, starting_average: 86 },
    { id: 8, starting_average: 70 },
    { id: 9, starting_average: 68 },
    { id: 10, starting_average: 66 },
    { id: 11, starting_average: 20 },
    { id: 12, starting_average: 10 },
  ];
  const divisionFor = (currentRunningAverage) => getIfSeededTodayDivision({
    entrants,
    ownEntrantId: 1,
    targetSize: 4,
    currentRunningAverage,
  });

  assert.equal(divisionFor(99), "Division 1");
  assert.equal(divisionFor(75), "Division 2");
  assert.equal(divisionFor(5), "Division 3");
});

test("Statistics Division inputs are Individual-only, frozen, read-only and contain no six-card invention", async () => {
  const [sql, loader, dashboard] = await Promise.all([
    read("database/17_shooter_analytics.sql"),
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
  assert.match(dashboard, /This is a read-only comparison/);
  assert.match(dashboard, /does not change your official Division or predict promotion or demotion/);
  assert.doesNotMatch(dashboard, /Projected promotion|promotion threshold|demotion threshold/i);
  assert.match(loader, /getMyShootingCompetitions/);
  assert.match(loader, /classifyMyShootingCompetition/);
  assert.match(loader, /=== "active"/);
  assert.match(loader, /activeInputs\.map/);
});

test("Statistics workspace exposes coherent views, explained trend, chart choices and paged physical history", async () => {
  const [page, dashboard, loading, chart, sql] = await Promise.all([
    read("src/app/(app)/statistics/page.tsx"),
    read("src/components/shooter-analytics-dashboard.tsx"),
    read("src/app/(app)/statistics/loading.tsx"),
    read("src/components/shooter-performance-chart.tsx"),
    read("database/17_shooter_analytics.sql"),
  ]);
  assert.match(page, /"overview", "performance", "seasons", "history"/);
  assert.match(dashboard, /Overview[\s\S]*Performance[\s\S]*Seasons[\s\S]*Score history/);
  assert.match(dashboard, /Estimated change across selected history/);
  assert.match(dashboard, /Trend is estimated across all released scores in the selected range, not just the latest two/);
  assert.match(chart, /"line" \| "bars"/);
  assert.match(chart, /<LineChart[\s\S]*<BarChart/);
  assert.match(sql, /limit 10 offset \(\(p_history_page - 1\) \* 10\)/i);
  assert.match(dashboard, /10 unique released shoots per page/);
  assert.match(dashboard, />First</);
  assert.match(dashboard, />Previous</);
  assert.match(dashboard, />Next</);
  assert.match(dashboard, />Last</);
  assert.match(dashboard, /md:hidden[\s\S]*hidden md:block/);
  assert.doesNotMatch(dashboard, /overflow-x-auto/);
  assert.match(dashboard, /window\.history\.pushState/);
  assert.match(dashboard, /window\.addEventListener\("popstate"/);
  assert.match(dashboard, /allowLocalNavigation=\{analytics\.history\.page === 1\}/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /aria-label="Loading Statistics"/);
  assert.match(loading, /Analysis scope|grid-cols-2/);
});

test("Statistics overlaps independent analytics requests before the averages fan-out", async () => {
  const loader = await read("src/lib/shooter-analytics.ts");
  assert.match(loader, /const analyticsRequest = supabase\.rpc\("get_my_shooter_analytics", filters\)/);
  assert.match(loader, /const myShootingRequest = filters\.p_include_if_seeded_today/);
  assert.match(loader, /Promise\.all\(\[\s*analyticsRequest,\s*myShootingRequest/);
  assert.match(loader, /Promise\.all\(activeInputs\.map/);
});

test("public homepage Login is one aligned, comfortably sized navigation target", async () => {
  const [homepage, css] = await Promise.all([
    read("src/app/page.tsx"),
    read("src/app/globals.css"),
  ]);
  assert.match(
    homepage,
    /<Link href="\/login" className="[^"]*inline-flex[^"]*min-h-11[^"]*items-center[^"]*justify-center[^"]*leading-none[^"]*">\s*Login\s*<\/Link>/,
  );
  assert.doesNotMatch(homepage, /<Link href="\/login"[^>]*>\s*<(?:span|button)[^>]*>\s*Login/);
  assert.match(css, /\.target-mark \{\s*pointer-events: none;/);
});

test("canonical discipline and Season comparisons never use display names as identities", async () => {
  const sql = await read("database/17_shooter_analytics.sql");
  assert.match(sql, /'equipment_code', representative\.equipment_type_code/);
  assert.match(sql, /'equipment_custom_id', representative\.organisation_equipment_type_id/);
  assert.match(sql, /'position_code', component\.shooting_position_code/);
  assert.match(sql, /'position_custom_id', component\.organisation_shooting_position_id/);
  assert.match(sql, /'distance_value', component\.distance_value/);
  assert.match(sql, /group by season_id, organisation_id/);
  assert.doesNotMatch(sql, /md5\([^\n]*competition_name/);
});

test("Statistics copy explains the experience without implementation terminology", async () => {
  const [dashboard, chart] = await Promise.all([
    read("src/components/shooter-analytics-dashboard.tsx"),
    read("src/components/shooter-performance-chart.tsx"),
  ]);
  const userInterface = `${dashboard}\n${chart}`;

  assert.match(dashboard, /Track your released scores, performance trends and progress over time/);
  assert.match(dashboard, /Released scores only/);
  assert.match(dashboard, /Division comparison/);
  assert.match(dashboard, /For comparison only/);
  assert.match(dashboard, /Published Division/);
  assert.match(dashboard, /Using current R\/Av/);
  assert.doesNotMatch(userInterface, /canonical shooter analytics model|canonical score sources|distinct released usages|highest normalized result|linear regression|canonical Season|structured scope|structured equipment identity/i);
});

test("Statistics has a native browser-print surface without weakening dedicated Results printing", async () => {
  const [css, shell, dashboard, chart, resultsPage] = await Promise.all([
    read("src/app/globals.css"),
    read("src/components/app-shell.tsx"),
    read("src/components/shooter-analytics-dashboard.tsx"),
    read("src/components/shooter-performance-chart.tsx"),
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx"),
  ]);
  const printCss = css.slice(css.indexOf("@media print"));

  assert.doesNotMatch(css, /\n\s*body \* \{\s*display: none !important;/);
  assert.doesNotMatch(css, /data-print-document/);
  assert.match(resultsPage, /data-results-print-document/);
  assert.match(dashboard, /data-statistics-print-document/);

  assert.match(css, /body:has\(\[data-results-print-document\]\) :where\(\*\) \{\s*display: none !important;/);
  assert.match(css, /body:has\(\[data-results-print-document\]\) :where\(\*:has\(\[data-results-print-document\]\)\) \{\s*display: contents !important;/);
  assert.match(css, /body:has\(\[data-results-print-document\]\) :where\([\s\S]*\[data-results-print-document\] \*[\s\S]*\) \{\s*display: revert !important;/);
  assert.doesNotMatch(css, /body:has\(\[data-statistics-print-document\]\) \* \{\s*display: none !important;/);

  assert.match(shell, /data-application-chrome/);
  assert.match(shell, /data-application-content/);
  assert.match(css, /body:has\(\[data-statistics-print-document\]\) \[data-application-chrome\]/);
  assert.match(css, /:is\(\[data-results-print-document\], \[data-statistics-print-document\]\) \[data-screen-only\]/);

  assert.match(css, /\[data-results-print-document\] \.results-score-table/);
  assert.doesNotMatch(printCss, /\n\s{2}\.results-score-table[^\n]*\{/);
  assert.match(css, /\[data-statistics-print-document\] \[data-statistics-history-cards\]/);
  assert.match(css, /\[data-statistics-print-document\] \[data-statistics-chart\]/);
  assert.doesNotMatch(printCss, /\[data-results-print-document\] (?:\.statistics-print|\[data-statistics-history|\[data-statistics-chart)/);
  assert.doesNotMatch(printCss, /\[data-statistics-print-document\] (?:\.results-|\[data-results-division)/);

  assert.match(dashboard, /Score history · Page \$\{analytics\.history\.page\} of/);
  assert.match(dashboard, /Filters: \{selectedFilters\.length/);
  assert.match(dashboard, /<div data-screen-only>[\s\S]*<Card className="p-5 sm:p-6">[\s\S]*Analysis scope/);
  assert.match(dashboard, /data-screen-only aria-label="Statistics analysis"/);
  assert.match(dashboard, /data-screen-only aria-label="Score history pagination"/);
  assert.match(dashboard, /data-statistics-history-cards/);
  assert.match(dashboard, /data-statistics-history-table/);
  assert.match(css, /\[data-statistics-print-document\] \[data-statistics-history-cards\] \{\s*display: none !important/);
  assert.match(css, /\[data-statistics-print-document\] \[data-statistics-history-table\] \{\s*display: block !important/);
  assert.doesNotMatch(css, /\[data-statistics-print-document\] section,/);
  assert.match(chart, /data-statistics-chart/);
  assert.match(chart, /data-screen-only className="mb-4/);
  assert.match(css, /\[data-statistics-print-document\] \[data-statistics-chart\][\s\S]*\.recharts-responsive-container[\s\S]*overflow: visible !important/);
});
