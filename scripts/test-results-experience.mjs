import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

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

test("mobile Results keep identity and participant disclosure outside shared-value Round scrollers", async () => {
  const ui = await loadModule("src/components/ui.tsx");
  const results = await loadModule("src/components/competition-aggregate-results.tsx", {
    "@/components/ui": ui,
  });
  const rounds = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    round_number: index + 1,
    deadline: `2026-${String(index + 1).padStart(2, "0")}-20`,
    released: true,
  }));
  const participant = (slot, first, startingAverage) => ({
    first_name: first,
    last_name: "Shooter with a deliberately long name",
    slot_number: slot,
    starting_average: startingAverage,
    running_average: 93.47,
    gun_total: 420.6,
    x_total: 27,
    rounds: rounds.map((round) => ({ round_id: round.id, state: "scored", gun_score: 84.12, x_total: 3 })),
  });
  const entrants = [{
    entrant_id: 17,
    entrant_format: "team",
    entrant_label: "Basildon Team with a deliberately long name",
    club_name: "Basildon Rifle and Pistol Club",
    participants: [participant(1, "Jane", null), participant(2, "Alex", null)],
    position: 1,
    tied: false,
    total_points: 54,
    scored_rounds: 10,
    achieved_total: 841.2,
    maximum_total: 1000,
    gun_total: 841.2,
    x_total: 54,
    rounds: rounds.map((round) => ({ round_id: round.id, state: "scored", gun_score: 84.12, ranking_points: 6, x_total: 5 })),
  }];
  const html = renderToStaticMarkup(createElement(results.CompetitionAggregateResultsTable, { data: {
    status: "ready",
    display_scoring_mode: "points_scored",
    uses_x_score: true,
    released_round_count: 10,
    rounds,
    groups: [{ id: 2, name: "Division 1", entrants }],
  } }));

  const mobileCard = html.match(/<article data-mobile-entrant-card="17"[^>]*>(.*?)<\/article>/s)?.[1] ?? "";
  const identity = mobileCard.match(/data-mobile-entrant-identity[^>]*>(.*?)<div data-mobile-round-scroller/s)?.[1] ?? "";
  const roundScroller = mobileCard.match(/<div data-mobile-round-scroller[^>]*>(.*?)<details data-mobile-participants/s)?.[1] ?? "";
  assert.match(identity, /Basildon Team with a deliberately long name/);
  assert.match(identity, /841\.2/);
  assert.doesNotMatch(roundScroller, /Basildon Team with a deliberately long name|Participants/);
  assert.match(mobileCard, /<details data-mobile-participants[^>]*>[\s\S]*<summary[^>]*>\s*Participants/);
  assert.match(mobileCard, /data-mobile-participant-identity[\s\S]*Jane Shooter with a deliberately long name/);
  assert.match(mobileCard, /data-mobile-participant-round-scroller/);
  assert.match(html, /data-mobile-results[^>]*md:hidden/);
  assert.match(html, /data-desktop-results[^>]*md:block[\s\S]*<table/);
  assert.equal((html.match(/841\.2/g) ?? []).length, 2, "mobile card and desktop table render the same supplied final value");
  assert.equal((html.match(/84\.12/g) ?? []).length, 60, "mobile and desktop entrant/participant views render the same supplied Round values");
});

test("mobile Results are screen-only and do not replace the dedicated print table", async () => {
  const [table, roundRobin, css] = await Promise.all([
    read("src/components/competition-aggregate-results.tsx"),
    read("src/components/competition-round-robin-results.tsx"),
    read("src/app/globals.css"),
  ]);
  for (const component of [table, roundRobin]) {
    assert.match(component, /data-screen-only="true" data-mobile-results/);
    assert.match(component, /data-desktop-results/);
    assert.match(component, /data-mobile-round-scroller/);
    assert.match(component, /Swipe to view all Rounds/);
  }
  assert.match(table, /group\.entrants\.map\(\(entrant\) => <MobileResultsCard/);
  assert.doesNotMatch(table, /MobileResultsCard[\s\S]*\.reduce\(/);
  assert.match(css, /\[data-results-print-document\][\s\S]*\.results-score-table/);
  assert.match(css, /\[data-screen-only\][\s\S]*display: none !important/);
});

test("print document is intentional A4 portrait official standings with pagination guards", async () => {
  const [page, button, css, table, roundRobin] = await Promise.all([
    read("src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx"),
    read("src/components/print-results-button.tsx"),
    read("src/app/globals.css"),
    read("src/components/competition-aggregate-results.tsx"),
    read("src/components/competition-round-robin-results.tsx"),
  ]);
  assert.match(page, /data-results-print-document/);
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
  assert.match(page + css, /data-results-print-document[\s\S]*results-score-table|results-score-table[\s\S]*data-results-print-document/);
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
