import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const root = new URL("../", import.meta.url);

async function applicationCss() {
  const from = new URL("src/app/globals.css", root);
  const source = await readFile(from, "utf8");
  return (await postcss([tailwindcss({ base: fileURLToPath(root) })])
    .process(source, { from: fileURLToPath(from) })).css;
}

async function resultsMarkup() {
  const ui = await loadModule("src/components/ui.tsx");
  const results = await loadModule("src/components/competition-aggregate-results.tsx", {
    "@/components/ui": ui,
  });
  const data = {
    status: "ready",
    display_scoring_mode: "points_scored",
    uses_x_score: false,
    released_round_count: 2,
    rounds: [
      { id: 1, round_number: 1, deadline: "2026-09-01", released: true },
      { id: 2, round_number: 2, deadline: "2026-09-08", released: true },
    ],
    groups: [{
      id: 1,
      name: "Division 1",
      entrants: [{
        entrant_id: 1,
        entrant_format: "individual",
        entrant_label: "Critical Print Shooter",
        club_name: "Northbridge Rifle Club",
        participants: [{
          first_name: "Critical",
          last_name: "Shooter",
          slot_number: 1,
          starting_average: 0,
          running_average: 96.5,
          gun_total: 193,
          x_total: null,
          rounds: [
            { round_id: 1, state: "scored", gun_score: 95, x_total: null },
            { round_id: 2, state: "scored", gun_score: 98, x_total: null },
          ],
        }],
        position: 1,
        tied: false,
        total_points: 12,
        scored_rounds: 2,
        achieved_total: 193,
        maximum_total: 200,
        gun_total: 193,
        x_total: null,
        rounds: [
          { round_id: 1, state: "scored", gun_score: 95, ranking_points: 6, x_total: null },
          { round_id: 2, state: "scored", gun_score: 98, ranking_points: 6, x_total: null },
        ],
      }],
    }],
  };
  return renderToStaticMarkup(createElement(
    "section",
    { "data-results-print-document": true },
    createElement("header", { "data-print-only": true, className: "hidden" },
      createElement("h1", null, "Critical Competition Results"),
      createElement("p", null, "Official standings")),
    createElement("button", { "data-screen-only": true }, "Print results"),
    createElement(results.CompetitionAggregateResultsTable, { data }),
  ));
}

function analyticsFixture() {
  const point = {
    event_key: "source-1",
    round_end_date: "2026-09-08",
    competition_name: "Critical Statistics Competition",
    round_label: "Round 2",
    season_name: "Critical Season",
    organisation_name: "Critical League",
    series_name: null,
    equipment_label: "Smallbore Rifle",
    component_scope: "all_components",
    achieved_score: 98,
    maximum_possible_score: 100,
    score_percentage: 98,
    x_total: null,
    components: [{
      label: "P",
      achieved_score: 98,
      maximum_score: 100,
      score_method: "points_scored",
      position_label: "Prone",
      position_mode: "fixed",
      distance_mode: "fixed",
      distance_value: 50,
      distance_unit: "metres",
    }],
    contexts: [{
      competition: "Critical Statistics Competition",
      round: "Round 2",
      round_end_date: "2026-09-08",
      season: "Critical Season",
      organisation: "Critical League",
      series: null,
    }],
    shared: false,
  };
  return {
    summary: {
      physical_shoot_count: 1,
      competition_count: 1,
      best_score_percentage: 98,
      recent_score_percentage: 98,
      mean_score_percentage: 98,
      trend_direction: "unavailable",
      trend_change: null,
    },
    component_scope: "all_components",
    chart_truncated: false,
    chart_points: [point],
    recent_scores: [point],
    disciplines: [],
    seasons: [],
    history: {
      items: [point],
      page: 1,
      page_size: 10,
      total_items: 11,
      total_pages: 2,
    },
    if_seeded_today: [],
    filter_options: { seasons: [], equipment: [], positions: [], distances: [] },
  };
}

async function statisticsMarkup() {
  const ui = await loadModule("src/components/ui.tsx");
  const dashboard = await loadModule("src/components/shooter-analytics-dashboard.tsx", {
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) => createElement("a", props, children),
    },
    "@/components/shooter-performance-chart": {
      ShooterPerformanceChart: () => createElement("figure", { "data-statistics-chart": true }, "Performance chart"),
    },
    "@/components/ui": ui,
    "@/lib/shooter-analytics-options": {
      distanceOptionValue: () => "",
      equipmentOptionValue: () => "",
      positionOptionValue: () => "",
    },
  });
  return renderToStaticMarkup(createElement(dashboard.ShooterAnalyticsDashboard, {
    analytics: analyticsFixture(),
    selection: { season: "", equipment: "", position: "", distance: "" },
    activeView: "history",
  }));
}

async function withPrintPage(content, run) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const css = await applicationCss();
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
      <aside data-application-chrome>Application navigation</aside>
      <main data-application-content>${content}</main>
    </body></html>`, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await run(page);
  } finally {
    await browser.close();
  }
}

async function visibleLayout(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      width: box.width,
      height: box.height,
      text: element.innerText,
    };
  });
}

test("real print cascade keeps Competition Results visible and non-blank", async () => {
  await withPrintPage(await resultsMarkup(), async (page) => {
    const rootLayout = await visibleLayout(page.locator("[data-results-print-document]"));
    assert.notEqual(rootLayout.display, "none");
    assert.equal(rootLayout.visibility, "visible");
    assert.notEqual(rootLayout.opacity, "0");
    assert.ok(rootLayout.width > 0 && rootLayout.height > 0);
    assert.match(rootLayout.text, /Critical Competition Results/);
    assert.match(rootLayout.text, /Critical Shooter/);
    assert.match(rootLayout.text, /95/);

    const tableLayout = await visibleLayout(page.locator(".results-score-table"));
    assert.ok(tableLayout.width > 0 && tableLayout.height > 0);
    assert.match(tableLayout.text, /Division 1|Critical Shooter/);
    assert.equal(await page.locator("[data-application-chrome]").evaluate((node) => getComputedStyle(node).display), "none");
    assert.equal(await page.locator("[data-results-print-document] [data-screen-only]").first().evaluate((node) => getComputedStyle(node).display), "none");
  });
});

test("the same real print cascade keeps Statistics and Score History visible", async () => {
  await withPrintPage(await statisticsMarkup(), async (page) => {
    const rootLayout = await visibleLayout(page.locator("[data-statistics-print-document]"));
    assert.notEqual(rootLayout.display, "none");
    assert.equal(rootLayout.visibility, "visible");
    assert.ok(rootLayout.width > 0 && rootLayout.height > 0);
    assert.match(rootLayout.text, /Statistics/);
    assert.match(rootLayout.text, /Score history · Page 1 of 2/);
    assert.match(rootLayout.text, /Critical Statistics Competition/);

    const historyLayout = await visibleLayout(page.locator("[data-statistics-history-table]"));
    assert.notEqual(historyLayout.display, "none");
    assert.ok(historyLayout.width > 0 && historyLayout.height > 0);
    assert.match(historyLayout.text, /Round End/i);
    assert.match(historyLayout.text, /98%/);
    assert.equal(await page.locator("[data-statistics-history-cards]").evaluate((node) => getComputedStyle(node).display), "none");
    assert.equal(await page.locator("[data-application-chrome]").evaluate((node) => getComputedStyle(node).display), "none");
    for (const element of await page.locator("[data-statistics-print-document] [data-screen-only]").all()) {
      assert.equal(await element.evaluate((node) => getComputedStyle(node).display), "none");
    }
  });
});
