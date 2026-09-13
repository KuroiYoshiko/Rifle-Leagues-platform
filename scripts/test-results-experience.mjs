import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("compact Results matrix keeps all ten Round columns and ranking-aware finals", async () => {
  const [table, roundRobin, css] = await Promise.all([
    read("src/components/competition-aggregate-results.tsx"),
    read("src/components/competition-round-robin-results.tsx"),
    read("src/app/globals.css"),
  ]);
  assert.doesNotMatch(table, /results-position-column/);
  assert.doesNotMatch(table, />Pos<\/th>/);
  assert.match(table, /data-entrant-position/);
  assert.match(table, /results-entrant-column/);
  assert.match(table, />S\/Av</);
  assert.match(table, />R\/Av</);
  assert.match(table, /results-round-column/);
  assert.match(table, /if \(rankingMethod === "aggregate"\) return "Total"/);
  assert.match(table, /aggregate\.gun_total[^\n]+total shooting result/);
  assert.match(table, /aggregate\.total_points[^\n]+total aggregate ranking points/);
  assert.match(table, /return `Best \$\{bestRoundsCount\} avg`/);
  assert.match(table, /return "Gun total"/);
  assert.match(roundRobin, />Match pts</);
  assert.doesNotMatch(roundRobin, /results-position-column|>Pos<\/th>/);
  assert.match(roundRobin, /data-entrant-position/);
  assert.match(roundRobin, /results-round-robin-column/);
  assert.match(css, /\.results-round-column \{ width: 3\.65rem; \}/);
  assert.match(css, /\.results-entrant-column \{ width: 13\.5rem; \}/);
  assert.match(css, /min-width: calc\(var\(--results-table-base-width, 26rem\) \+ var\(--results-round-count, 1\) \* 3\.65rem\)/);
  assert.match(table, /data-average-columns=\{averageColumns\.count\}/);
  assert.match(roundRobin, /data-average-columns=\{averageColumnCount\}/);
  assert.doesNotMatch(table, /min-w-24|min-w-32|min-w-60/);
});

test("print document is intentional A4 portrait official standings with pagination guards", async () => {
  const [page, button, css, table, roundRobin] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx"),
    read("src/components/print-results-button.tsx"),
    read("src/app/globals.css"),
    read("src/components/competition-aggregate-results.tsx"),
    read("src/components/competition-round-robin-results.tsx"),
  ]);
  assert.match(page, /data-print-document/);
  assert.match(page, /data-print-only/);
  assert.match(page, /Organisation|organisation\.name/);
  assert.match(page, /Course of Fire/);
  assert.match(button, /window\.print\(\)/);
  assert.match(button, /Print results/);
  assert.match(css, /size: A4 portrait/);
  assert.match(css, /table-header-group/);
  assert.match(css, /break-inside: avoid-page/);
  assert.match(css, /overflow: visible !important/);
  assert.match(css, /\.results-entrant-layout[\s\S]*display: flex !important/);
  assert.match(css, /\[data-entrant-position\][\s\S]*column-gap|column-gap[\s\S]*\[data-entrant-position\]/);
  assert.match(css, /\.results-cell-primary,[\s\S]*\.results-cell-secondary[\s\S]*display: block !important/);
  assert.match(css, /padding: 1\.2mm 0\.45mm !important/);
  assert.match(css, /\[data-round-date-heading\],[\s\S]*\.results-round-release-label[\s\S]*display: none !important/);
  assert.match(page + css, /data-print-document[\s\S]*results-score-table|results-score-table[\s\S]*data-print-document/);
  assert.match(table, /return "Total"/);
  assert.match(table, /aggregate\.gun_total[^\n]+aggregate\.total_points/);
  assert.match(table, /counts_towards_average \? "Counts" : "Excluded"/);
  assert.match(css, /\[data-participant-breakdown\][\s\S]*display: none !important/);
  assert.match(css, /\.results-opponent-label[\s\S]*white-space: normal !important/);
  assert.match(css, /\.results-round-robin-print-cell[\s\S]*white-space: nowrap !important/);
  assert.match(css, /\.results-round-robin-legend[\s\S]*grid-template-columns/);
  assert.doesNotMatch(roundRobin, /results-opponent-label[^\n]*truncate/);
  assert.match(roundRobin, /details data-screen-only="true"/);
  assert.match(roundRobin, /data-print-round-cell="true"/);
  assert.match(roundRobin, /gun total/);
});

test("released Results replace duplicate division rosters but retain pre-results rosters", async () => {
  const page = await read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx");
  assert.match(page, /publishedDivisions && !resultsDuplicateDivisionRoster/);
  assert.match(page, /data-results-division-summary/);
  assert.match(page, /Your division:/);
});
