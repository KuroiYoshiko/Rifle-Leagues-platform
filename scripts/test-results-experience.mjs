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
  assert.match(table, /results-position-column/);
  assert.match(table, /results-entrant-column/);
  assert.match(table, />S\/Av</);
  assert.match(table, />R\/Av</);
  assert.match(table, /results-round-column/);
  assert.match(table, /if \(rankingMethod === "aggregate"\) return "Points"/);
  assert.match(table, /return `Best \$\{bestRoundsCount\} avg`/);
  assert.match(table, /return "Gun result"/);
  assert.match(roundRobin, />Match pts</);
  assert.match(roundRobin, /results-round-robin-column/);
  assert.match(css, /\.results-round-column \{ width: 3\.65rem; \}/);
  assert.doesNotMatch(table, /min-w-24|min-w-32|min-w-60/);
});

test("print document is intentional A4 landscape output with pagination guards", async () => {
  const [page, button, css] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx"),
    read("src/components/print-results-button.tsx"),
    read("src/app/globals.css"),
  ]);
  assert.match(page, /data-print-document/);
  assert.match(page, /data-print-only/);
  assert.match(page, /Organisation|organisation\.name/);
  assert.match(page, /Course of Fire/);
  assert.match(button, /window\.print\(\)/);
  assert.match(button, /Print results/);
  assert.match(css, /size: A4 landscape/);
  assert.match(css, /table-header-group/);
  assert.match(css, /break-inside: avoid-page/);
  assert.match(css, /overflow: visible !important/);
});

test("released Results replace duplicate division rosters but retain pre-results rosters", async () => {
  const page = await read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx");
  assert.match(page, /publishedDivisions && !resultsDuplicateDivisionRoster/);
  assert.match(page, /data-results-division-summary/);
  assert.match(page, /Your division:/);
});
