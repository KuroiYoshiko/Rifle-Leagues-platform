import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

let OverviewDashboard;

before(async () => {
  const Link = ({ children, ...props }) => createElement("a", props, children);
  const ui = await loadModule("src/components/ui.tsx");
  const presentation = await loadModule(
    "src/lib/club-operational-summary-presentation.ts",
  );
  const clubCards = await loadModule(
    "src/components/dashboard-club-cards.tsx",
    {
      "next/link": { __esModule: true, default: Link },
      "@/components/ui": ui,
      "@/lib/clubs": {
        getClubLocation: (club) =>
          [club.town, club.county].filter(Boolean).join(", ") || null,
        getClubRoleLabel: (role) => role[0].toUpperCase() + role.slice(1),
      },
    },
  );
  const component = await loadModule(
    "src/components/overview-dashboard.tsx",
    {
      "next/link": { __esModule: true, default: Link },
      "@/components/dashboard-club-cards": clubCards,
      "@/components/ui": ui,
      "@/lib/club-operational-summary-presentation": presentation,
      "@/lib/league-seasons": {
        formatLeagueSeasonDate: (value) => value,
      },
      "@/lib/my-shooting-competitions": {
        getNextRelevantRound: (item) =>
          item.rounds.find((round) => !round.released) ?? null,
        getMyShootingRoundStatus: () => "Shoot-by date upcoming",
      },
    },
  );
  OverviewDashboard = component.OverviewDashboard;
});

function participation({
  id,
  name,
  start = "2026-09-01",
  division = null,
  released = false,
}) {
  return {
    competition_entrant_participant_id: id,
    slot_number: 1,
    competition_entrant_id: 100 + id,
    entrant_position: 1,
    entrant_label: `Individual ${id}`,
    club_competition_entry_id: 200 + id,
    entry_status: "submitted",
    submitted_at: "2026-08-01T00:00:00Z",
    club: { id: 1, name: "Riverside RC", slug: "riverside-rc" },
    competition: {
      id,
      name,
      slug: name.toLowerCase().replaceAll(" ", "-"),
      entry_format: "individual",
      team_size: 1,
      ranking_method: "aggregate",
      number_of_rounds: 2,
      effective_starts_at: start,
    },
    season: {
      id: 1,
      name: "Autumn 2026",
      slug: "autumn-2026",
      status: "active",
      starts_at: "2026-09-01",
      ends_at: "2026-12-01",
    },
    organisation: { id: 1, name: "County League", slug: "county-league" },
    division,
    participants: [],
    rounds: [
      {
        id: 300 + id,
        round_number: 2,
        deadline: "2026-09-24",
        shoot_by_date: "2026-09-21",
        released,
      },
    ],
    has_released_results: released,
  };
}

const emptyGroups = () => ({ active: [], upcoming: [], completed: [] });

const analytics = {
  summary: {
    physical_shoot_count: 8,
    competition_count: 3,
    best_score_percentage: 98.2,
    recent_score_percentage: 94.6,
    mean_score_percentage: 92.4,
    trend_direction: "up",
    trend_change: 1.8,
  },
  component_scope: "all_components",
  chart_truncated: false,
  chart_points: [],
  recent_scores: [94.6, 93.2, 91.8, 90.4, 89.1, 88.5].map(
    (score_percentage, index) => ({
      event_key: `event-${index}`,
      score_percentage,
    }),
  ),
  filter_options: { seasons: [], equipment: [], positions: [], distances: [] },
};

const membership = {
  id: 1,
  club_id: 1,
  status: "active",
  role: "official",
  created_at: "2026-01-01T00:00:00Z",
  club: {
    id: 1,
    name: "Riverside RC",
    slug: "riverside-rc",
    town: "Basildon",
    county: "Essex",
    postcode: null,
    website: null,
  },
};

const action = {
  club_id: 1,
  club_name: "Riverside RC",
  club_slug: "riverside-rc",
  active_member_count: 20,
  active_competition_count: 2,
  attention_status: "action_needed",
  outstanding_score_count: 1,
  competition_id: 10,
  competition_name: "Autumn Postal",
  competition_slug: "autumn-postal",
  organisation_slug: "county-league",
  league_season_slug: "autumn-2026",
  competition_round_id: 42,
  round_number: 2,
  local_cutoff: "2026-09-20",
  days_until_cutoff: 6,
  participant_count: 4,
  complete_participant_count: 3,
  incomplete_participant_count: 1,
};

function render(overrides = {}) {
  return renderToStaticMarkup(
    createElement(OverviewDashboard, {
      firstName: "Ava",
      competitionGroups: emptyGroups(),
      competitionAsOfDate: "2026-09-14",
      analytics,
      memberships: [membership],
      membershipsAvailable: true,
      managementSummaries: [],
      ...overrides,
    }),
  );
}

test("active, upcoming and completed participation is summarised without duplicating full hubs", () => {
  const groups = emptyGroups();
  groups.active = [1, 2, 3, 4, 5].map((id) =>
    participation({ id, name: `Active ${id}` }),
  );
  groups.upcoming = [6, 7, 8, 9].map((id) =>
    participation({ id, name: `Upcoming ${id}`, start: `2026-10-0${id - 5}` }),
  );
  groups.completed = [participation({ id: 10, name: "Completed history", released: true })];
  const html = render({ competitionGroups: groups });

  assert.match(html, /Current shooting/);
  assert.match(html, /Next up/);
  assert.match(html, /Recent form/);
  assert.match(html, /Clubs/);
  assert.match(html, /Active 1/);
  assert.match(html, /Active 4/);
  assert.doesNotMatch(html, /Active 5/);
  assert.match(html, /Upcoming 8/);
  assert.doesNotMatch(html, /Upcoming 9/);
  assert.doesNotMatch(html, /Completed history/);
  assert.match(html, /View all competitions/);
  assert.doesNotMatch(html, /Overview counts|>5 active<|to action/);
});

test("no active Competition uses compact upcoming context and preserves the Next up list", () => {
  const groups = emptyGroups();
  groups.upcoming = [participation({ id: 2, name: "Winter League", start: "2026-10-02" })];
  const html = render({ competitionGroups: groups });
  assert.match(html, /No active Competitions/);
  assert.match(html, /1 upcoming Competition is already on your schedule/);
  assert.match(html, /Next start · 2026-10-02/);
  assert.match(html, /Winter League/);
});

test("published Division is shown and unavailable Division is omitted", () => {
  const groups = emptyGroups();
  groups.active = [
    participation({
      id: 1,
      name: "Division fixture",
      division: { id: 1, name: "Division One", position: 1 },
    }),
    participation({ id: 2, name: "Undivided fixture" }),
  ];
  const html = render({ competitionGroups: groups });
  assert.match(html, /Division One/);
  assert.doesNotMatch(html, /Projected Division|Promotion|Relegation/);

  groups.active = [participation({ id: 2, name: "Undivided fixture" })];
  assert.doesNotMatch(render({ competitionGroups: groups }), /Division One/);
});

test("recent form uses semantic trend direction and a balanced compact summary", () => {
  const html = render();
  assert.match(html, /Latest performance/);
  assert.match(html, /94\.6%/);
  assert.match(html, /Overall trend/);
  assert.match(html, /Improving/);
  assert.match(html, /Released scores/);
  assert.match(html, />8<\/dd>/);
  assert.doesNotMatch(html, /Trend \+| pp|Estimated trend across released scores/);
  assert.equal((html.match(/event-/g) ?? []).length, 0, "internal analytics keys stay hidden");
  assert.equal((html.match(/bg-brand/g) ?? []).length >= 5, true);
  assert.match(html, /href="\/statistics"/);

  const down = render({
    analytics: {
      ...analytics,
      summary: {
        ...analytics.summary,
        trend_direction: "down",
        trend_change: -2.4,
      },
    },
  });
  assert.match(down, /Declining/);
  assert.doesNotMatch(down, /−2\.4|earned|generic points/i);

  const steady = render({
    analytics: {
      ...analytics,
      summary: { ...analytics.summary, trend_direction: "steady", trend_change: 0 },
    },
  });
  assert.match(steady, /Steady/);

  const unavailable = render({
    analytics: {
      ...analytics,
      summary: {
        ...analytics.summary,
        trend_direction: "unavailable",
        trend_change: null,
      },
    },
  });
  assert.match(unavailable, /Not available/);
});

test("management attention appears only for authoritative actionable states", () => {
  const authorised = render({ managementSummaries: [action] });
  assert.match(authorised, /Needs attention/);
  assert.match(authorised, /Scores due soon/);
  assert.match(authorised, /1 incomplete/);
  assert.match(authorised, /Manage scores/);
  assert.match(authorised, /club=1&amp;round=42/);
  assert.doesNotMatch(authorised, /to action/);

  const overdue = render({
    managementSummaries: [
      {
        ...action,
        attention_status: "deadline_passed",
        days_until_cutoff: -1,
      },
    ],
  });
  assert.match(overdue, /Scoring deadline passed/);
  assert.match(overdue, /Manage scores/);

  const healthy = render({
    managementSummaries: [
      { ...action, attention_status: "all_on_track", incomplete_participant_count: 0 },
    ],
  });
  assert.doesNotMatch(healthy, /Needs attention/);
  assert.doesNotMatch(render({ managementSummaries: [] }), /Needs attention/);
});

test("clubs stay compact, identify role, and avoid operational warnings", () => {
  const html = render();
  assert.match(html, /Riverside RC/);
  assert.match(html, /Official/);
  assert.match(html, /View club/);
  assert.doesNotMatch(html, /Manage scores/);
  assert.doesNotMatch(html, /min-h-52|target-mark/);
  assert.match(html, /sm:grid-cols-2/);
  assert.match(html, /xl:grid-cols-3/);
});

test("empty and unavailable states stay small and keep navigation useful", () => {
  const empty = render({
    competitionGroups: emptyGroups(),
    analytics: { ...analytics, summary: { ...analytics.summary, physical_shoot_count: 0 } },
    memberships: [],
  });
  assert.match(empty, /no current or upcoming submitted Competition entries/i);
  assert.match(empty, /No released scores yet/);
  assert.match(empty, /No active Club membership/);
  assert.match(empty, /Find a club/);

  const unavailable = render({
    competitionGroups: null,
    competitionAsOfDate: null,
    analytics: null,
    memberships: [],
    membershipsAvailable: false,
  });
  assert.match(unavailable, /Competition activity is temporarily unavailable/);
  assert.match(unavailable, /Recent Statistics are temporarily unavailable/);
  assert.match(unavailable, /Club memberships are temporarily unavailable/);
});

test("Overview composes existing isolated read models and removes profile/account UI", async () => {
  const [page, overview, clubs, shell] = await Promise.all([
    read("src/app/(app)/dashboard/page.tsx"),
    read("src/components/overview-dashboard.tsx"),
    read("src/components/dashboard-club-cards.tsx"),
    read("src/components/app-shell.tsx"),
  ]);
  assert.match(page, /getMyShootingCompetitions\(\)/);
  assert.match(page, /groupMyShootingCompetitions/);
  assert.match(page, /getMyShooterAnalytics\(analyticsFilters\)/);
  assert.match(page, /getClubOperationalSummaries\(\)/);
  assert.doesNotMatch(page, /hasManagedClub|isClubManager/);
  assert.doesNotMatch(page, /user_organisations|shooting_score_values|competition_score_usages/);
  assert.doesNotMatch(`${page}\n${overview}`, /Profile and settings|Open profile|Complete profile|Account created/);
  assert.doesNotMatch(clubs, /operationalSummaries|LeaveClubButton|background="navigation"/);
  assert.match(shell, /label: "Settings", href: "\/dashboard#settings"/);
  assert.match(shell, /"\/dashboard": \{ eyebrow: "Personal dashboard", title: "Overview" \}/);
  assert.match(overview, /md:grid-cols-2/);
  assert.match(overview, /xl:grid-cols-\[minmax\(0,1\.15fr\)_minmax\(20rem,\.85fr\)\]/);
  assert.doesNotMatch(overview, /overflow-x-auto/);
  assert.match(overview, /bg-primary[\s\S]*text-primary-foreground![\s\S]*hover:bg-brand-deep/);
  assert.doesNotMatch(overview, /Overview counts|actionableCount|activeCount/);
  assert.doesNotMatch(overview, /summary\.trend_change|Estimated trend across released scores|Most recent score/);
  assert.match(overview, /sm:grid-cols-3/);
});
