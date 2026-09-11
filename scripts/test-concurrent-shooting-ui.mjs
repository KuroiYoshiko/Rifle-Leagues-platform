import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const link = ({ children, ...props }) => createElement("a", props, children);

async function loadUi() {
  const ui = await loadModule("src/components/ui.tsx");
  const management = await loadModule("src/components/concurrent-shooting-management.tsx", {
    "next/link": { __esModule: true, default: link },
    "@/components/ui": ui,
    "@/app/(app)/organisations/[slug]/concurrent-shooting-actions": {
      createConcurrentShootingGroup: async () => ({}),
      mutateConcurrentShootingGroup: async () => ({}),
    },
    "@/lib/competitions": {
      getCompetitionEntryFormatLabel: (value) => ({ individual: "Individual", pairs: "Pairs", team: "Team" })[value],
      getCompetitionRankingMethodLabel: (value) => value === "aggregate" ? "Aggregate points" : value,
    },
  });
  return { ui, management };
}

const organisation = { id: 1, slug: "test-org" };
const lifecycle = {
  can_activate: false,
  activation_block_reasons: [],
  can_cancel_activation: true,
  cancel_block_reason: null,
  has_score_provenance: false,
};

test("Organisation management navigation has four routed destinations and Overview no longer owns Series", async () => {
  const navigation = await loadModule("src/components/organisation-management-navigation.tsx", {
    "next/link": { __esModule: true, default: link },
  });
  const html = renderToStaticMarkup(createElement(navigation.OrganisationManagementNavigation, {
    organisationSlug: "test-org",
    current: "concurrent",
  }));
  const labels = ["Overview", "Competition Series", "Averages", "Concurrent Shooting"];
  let lastIndex = -1;
  for (const label of labels) {
    const index = html.indexOf(label);
    assert.ok(index > lastIndex, `${label} should be present in navigation order`);
    lastIndex = index;
  }
  assert.match(html, /management\/series/);
  assert.match(html, /management\/averages/);
  assert.match(html, /management\/concurrent-shooting/);

  const overview = await readFile(new URL("../src/app/(app)/organisations/[slug]/management/page.tsx", import.meta.url), "utf8");
  const seriesPage = await readFile(new URL("../src/app/(app)/organisations/[slug]/management/series/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(overview, /CompetitionSeriesManager|getCompetitionSeriesManagementRows/);
  assert.match(seriesPage, /CompetitionSeriesManager|getCompetitionSeriesManagementRows/);
  assert.match(seriesPage, /canManage=\{context\.access\.role === "owner"\}/);
});

test("group list renders lifecycle sections, empty CTA, and owner-only Active actions", async () => {
  const { management } = await loadUi();
  const emptyHtml = renderToStaticMarkup(createElement(management.ConcurrentShootingGroupList, {
    organisation,
    groups: [],
    isOwner: false,
  }));
  assert.match(emptyHtml, /No Concurrent Shooting groups yet/);
  assert.match(emptyHtml, /Create Concurrent Shooting Group/);

  const groups = ["draft", "active", "archived"].map((status, index) => ({
    id: index + 1,
    league_season_id: 1,
    name: `${status} group`,
    status,
    member_count: index + 2,
    physical_round_count: index + 1,
    season_name: "Winter 2026",
    lifecycle,
  }));
  const ownerHtml = renderToStaticMarkup(createElement(management.ConcurrentShootingGroupList, {
    organisation,
    groups,
    isOwner: true,
  }));
  assert.match(ownerHtml, />Draft</);
  assert.match(ownerHtml, />Active</);
  assert.match(ownerHtml, />Archived</);
  assert.match(ownerHtml, /Cancel activation/);
  assert.match(ownerHtml, />Archive</);
  const managerHtml = renderToStaticMarkup(createElement(management.ConcurrentShootingGroupList, {
    organisation,
    groups,
    isOwner: false,
  }));
  assert.doesNotMatch(managerHtml, /Cancel activation/);
  assert.doesNotMatch(managerHtml, />Archive</);
  assert.match(managerHtml, /Open Draft/);
});

function workspace(status) {
  return {
    group: {
      id: 8,
      organisation_id: 1,
      league_season_id: 1,
      name: "Winter shared shooting",
      status,
      compatibility_version: status === "draft" ? null : 1,
      compatibility_signature: status === "draft" ? null : {},
      activated_at: status === "draft" ? null : "2026-01-02T12:00:00Z",
      archived_at: status === "archived" ? "2026-02-02T12:00:00Z" : null,
      created_at: "2026-01-01T12:00:00Z",
      updated_at: "2026-01-02T12:00:00Z",
    },
    members: [
      { competition_id: 11, name: "Individual A", entry_format: "individual", status: "published", compatibility_signature: {}, compatibility_mismatches: [] },
      { competition_id: 12, name: "Pair B", entry_format: "pairs", status: "published", compatibility_signature: {}, compatibility_mismatches: [] },
    ],
    physical_rounds: [{
      id: 21,
      position: 1,
      label: "Opening shoot",
      mappings: [
        { competition_id: 11, competition_round_id: 101, round_number: 1 },
        { competition_id: 12, competition_round_id: 201, round_number: 2 },
      ],
    }],
    candidates: [
      { competition_id: 11, name: "Individual A", slug: "individual-a", status: "published", entry_format: "individual", ranking_method: "aggregate", number_of_rounds: 3, selected: true, existing_group_id: 8, existing_group_name: "Winter shared shooting", existing_group_status: status, compatible: true, compatibility_mismatches: [], has_course_of_fire: true, physical_details_configured: true, effective_starts_at: "2026-03-01", has_started: false, selectable: status === "draft" },
      { competition_id: 12, name: "Pair B", slug: "pair-b", status: "published", entry_format: "pairs", ranking_method: "aggregate", number_of_rounds: 2, selected: true, existing_group_id: 8, existing_group_name: "Winter shared shooting", existing_group_status: status, compatible: true, compatibility_mismatches: [], has_course_of_fire: true, physical_details_configured: true, effective_starts_at: "2026-03-01", has_started: false, selectable: status === "draft" },
      { competition_id: 13, name: "Incompatible C", slug: "incompatible-c", status: "published", entry_format: "team", ranking_method: "aggregate", number_of_rounds: 2, selected: false, existing_group_id: null, existing_group_name: null, existing_group_status: null, compatible: false, compatibility_mismatches: ["components", "uses_x_score"], has_course_of_fire: true, physical_details_configured: true, effective_starts_at: "2026-03-01", has_started: false, selectable: false },
      { competition_id: 14, name: "Legacy D", slug: "legacy-d", status: "published", entry_format: "individual", ranking_method: "gun_score", number_of_rounds: 2, selected: false, existing_group_id: null, existing_group_name: null, existing_group_status: null, compatible: false, compatibility_mismatches: ["physical_details"], has_course_of_fire: true, physical_details_configured: false, effective_starts_at: "2026-03-01", has_started: false, selectable: false },
    ],
    lifecycle: status === "active" ? lifecycle : {
      can_activate: status === "draft",
      activation_block_reasons: [],
      can_cancel_activation: false,
      cancel_block_reason: "not_active",
      has_score_provenance: false,
    },
    roundsByCompetition: {
      11: [{ id: 101, competition_id: 11, round_number: 1, deadline: "2026-03-01", shoot_by_date: null }, { id: 102, competition_id: 11, round_number: 2, deadline: "2026-03-08", shoot_by_date: null }, { id: 103, competition_id: 11, round_number: 3, deadline: "2026-03-15", shoot_by_date: null }],
      12: [{ id: 201, competition_id: 12, round_number: 2, deadline: "2026-03-04", shoot_by_date: null }, { id: 202, competition_id: 12, round_number: 3, deadline: "2026-03-11", shoot_by_date: null }],
    },
  };
}

test("Draft workflow shows compatibility, explicit mapping, independent Rounds, and role-specific activation", async () => {
  const { management } = await loadUi();
  const ownerHtml = renderToStaticMarkup(createElement(management.ConcurrentShootingWorkspaceView, {
    organisation,
    seasonName: "Winter 2026",
    workspace: workspace("draft"),
    isOwner: true,
  }));
  assert.match(ownerHtml, /structured physical Course of Fire—not Competition names/);
  assert.match(ownerHtml, /Physical eligibility mismatch: component structure, labels, maximums, or scoring methods differ; X scoring differs/);
  assert.match(ownerHtml, /Physical shooting details required/);
  assert.match(ownerHtml, /Review every generated or manual mapping/);
  assert.match(ownerHtml, /Map matching Round numbers/);
  assert.match(ownerHtml, /one physical shoot whose score counts/);
  assert.match(ownerHtml, /Manual different-number mapping/);
  assert.match(ownerHtml, /Round 3 · already mapped|Round 2/);
  assert.match(ownerHtml, /Individual A:<\/span> 2, 3/);
  assert.match(ownerHtml, /Pair B:<\/span> 3/);
  assert.match(ownerHtml, /Activate Concurrent Shooting/);

  const managerHtml = renderToStaticMarkup(createElement(management.ConcurrentShootingWorkspaceView, {
    organisation,
    seasonName: "Winter 2026",
    workspace: workspace("draft"),
    isOwner: false,
  }));
  assert.doesNotMatch(managerHtml, /Activate Concurrent Shooting/);
  assert.match(managerHtml, /Organisation owner must activate/);
});

test("first Competition establishes the reference without false Compatible wording", async () => {
  const { management } = await loadUi();
  const first = workspace("draft");
  first.members = [];
  first.physical_rounds = [];
  first.roundsByCompetition = {};
  first.candidates = first.candidates.map((candidate) => ({
    ...candidate,
    selected: false,
    existing_group_id: null,
    existing_group_name: null,
    selectable: candidate.physical_details_configured,
    compatibility_mismatches: candidate.physical_details_configured ? [] : ["physical_details"],
  }));
  first.lifecycle = {
    can_activate: false,
    activation_block_reasons: ["member_count", "rounds_missing"],
    can_cancel_activation: false,
    cancel_block_reason: "not_active",
    has_score_provenance: false,
  };
  const html = renderToStaticMarkup(createElement(management.ConcurrentShootingWorkspaceView, {
    organisation, seasonName: "Winter 2026", workspace: first, isOwner: true,
  }));
  assert.match(html, /Start with this Competition/);
  assert.match(html, /establishes the physical Course of Fire/);
  assert.doesNotMatch(html, />Compatible</);
  assert.doesNotMatch(html, /Eligible for Concurrent Shooting/);
});

test("started Draft member stays visible and disables predictable activation", async () => {
  const { management } = await loadUi();
  const started = workspace("draft");
  started.candidates[0].has_started = true;
  started.candidates[0].selectable = false;
  started.lifecycle = {
    can_activate: false,
    activation_block_reasons: ["competition_started"],
    can_cancel_activation: false,
    cancel_block_reason: "not_active",
    has_score_provenance: false,
  };
  const html = renderToStaticMarkup(createElement(management.ConcurrentShootingWorkspaceView, {
    organisation, seasonName: "Winter 2026", workspace: started, isOwner: true,
  }));
  assert.match(html, /Selected · activation blocked/);
  assert.match(html, /Competition has already started/);
  assert.match(html, /Activate Concurrent Shooting/);
  assert.match(html, /type="submit" disabled="" class="[^"]*text-primary-foreground!/);
});

test("Concurrent filled primary actions use the high-contrast application convention", async () => {
  const source = await readFile(new URL("../src/components/concurrent-shooting-management.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/(app)/organisations/[slug]/management/concurrent-shooting/page.tsx", import.meta.url), "utf8");
  assert.match(source, /bg-primary[^"\n]*text-primary-foreground!/);
  assert.match(source, /hover:bg-brand-deep/);
  assert.match(page, /bg-primary[^"\n]*text-primary-foreground!/);
});

test("Competition details render equipment and component physical identity while legacy stays unchanged", async () => {
  const disclosure = await loadModule("src/components/competition-details-disclosure.tsx", {
    "@/lib/competitions": {
      getCompetitionMaximumPerRound: () => 100,
      getCompetitionRankingMethodLabel: () => "Aggregate points",
      getCompetitionScoringMethodLabel: () => "Points scored",
    },
    "@/lib/league-seasons": { formatLeagueSeasonDate: (value) => value },
  });
  const competition = {
    sets_per_round: 1, entry_window_mode: "season_default", start_date_mode: "season_default",
    local_scoring_enabled: true, ranking_method: "aggregate", uses_x_score: false,
    number_of_rounds: 1,
  };
  const components = [{ id: 1, position: 1, short_label: "50m", maximum_score: 100, score_method: "points_scored" }];
  const structured = renderToStaticMarkup(createElement(disclosure.CompetitionDetailsDisclosure, {
    competition,
    effectiveDates: { effective_entry_opens_at: null, effective_entry_closes_at: null, effective_starts_at: null },
    rounds: [], scoreComponents: components,
    shootingDisplay: { configured: true, equipment_name: "Water Pistol", components: [{ component_id: 1, position_mode: "fixed", position_name: "Prone", distance_mode: "fixed", distance_value: 50, distance_unit: "metres", shots: 20 }] },
  }));
  assert.match(structured, /Prone · 50 metres · 20 shots · Ex 100 · Points scored/);
  const legacy = renderToStaticMarkup(createElement(disclosure.CompetitionDetailsDisclosure, {
    competition,
    effectiveDates: { effective_entry_opens_at: null, effective_entry_closes_at: null, effective_starts_at: null },
    rounds: [], scoreComponents: components,
    shootingDisplay: { configured: false, equipment_name: null, components: [] },
  }));
  assert.match(legacy, /Ex 100 · Points scored/);
  assert.doesNotMatch(legacy, /Prone|metres|shots · Ex/);
  const page = await readFile(new URL("../src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /shootingDisplay\.equipment_name/);
});

test("Active and Archived group views are read-only", async () => {
  const { management } = await loadUi();
  const activeHtml = renderToStaticMarkup(createElement(management.ConcurrentShootingWorkspaceView, {
    organisation,
    seasonName: "Winter 2026",
    workspace: workspace("active"),
    isOwner: true,
  }));
  assert.match(activeHtml, /Active configuration/);
  assert.match(activeHtml, /Membership and shared Round mappings are locked/);
  assert.doesNotMatch(activeHtml, /Save mapping|Add shared Round|Save label/);
  assert.match(activeHtml, /Cancel activation/);

  const archivedHtml = renderToStaticMarkup(createElement(management.ConcurrentShootingWorkspaceView, {
    organisation,
    seasonName: "Winter 2026",
    workspace: workspace("archived"),
    isOwner: true,
  }));
  assert.match(archivedHtml, /Archived configuration/);
  assert.match(archivedHtml, /historical configuration is preserved/);
  assert.doesNotMatch(archivedHtml, /Save mapping|Add shared Round|Cancel activation/);
});

test("Competition management indicator is informational and links to the Organisation workflow", async () => {
  const ui = await loadModule("src/components/ui.tsx");
  const indicator = await loadModule("src/components/competition-concurrent-shooting-indicator.tsx", {
    "next/link": { __esModule: true, default: link },
    "@/components/ui": ui,
  });
  const html = renderToStaticMarkup(createElement(indicator.CompetitionConcurrentShootingIndicator, {
    organisationSlug: "test-org",
    summary: {
      group_id: 8,
      group_name: "Winter shared shooting",
      status: "active",
      activated_at: "2026-01-02T12:00:00Z",
      season_id: 1,
      season_name: "Winter 2026",
      shared_round_count: 8,
      linked_competitions: [{ competition_id: 12, name: "Pair B", entry_format: "pairs" }],
    },
  }));
  assert.match(html, /Concurrent Shooting/);
  assert.match(html, />Active</);
  assert.match(html, /8 shared Rounds/);
  assert.match(html, /Pair B/);
  assert.match(html, /management\/concurrent-shooting\/8/);

  const competitionPage = await readFile(new URL("../src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/page.tsx", import.meta.url), "utf8");
  assert.match(competitionPage, /managementContext\s*\?\s*getCompetitionConcurrentShootingSummary/);
  assert.match(competitionPage, /CompetitionConcurrentShootingIndicator/);
});
