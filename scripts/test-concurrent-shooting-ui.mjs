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
      { competition_id: 11, name: "Individual A", slug: "individual-a", status: "published", entry_format: "individual", ranking_method: "aggregate", number_of_rounds: 3, selected: true, existing_group_id: 8, existing_group_name: "Winter shared shooting", existing_group_status: status, compatible: true, compatibility_mismatches: [], has_course_of_fire: true, selectable: status === "draft" },
      { competition_id: 12, name: "Pair B", slug: "pair-b", status: "published", entry_format: "pairs", ranking_method: "aggregate", number_of_rounds: 2, selected: true, existing_group_id: 8, existing_group_name: "Winter shared shooting", existing_group_status: status, compatible: true, compatibility_mismatches: [], has_course_of_fire: true, selectable: status === "draft" },
      { competition_id: 13, name: "Incompatible C", slug: "incompatible-c", status: "published", entry_format: "team", ranking_method: "aggregate", number_of_rounds: 2, selected: false, existing_group_id: null, existing_group_name: null, existing_group_status: null, compatible: false, compatibility_mismatches: ["components", "uses_x_score"], has_course_of_fire: true, selectable: false },
    ],
    lifecycle: status === "active" ? lifecycle : { can_cancel_activation: false, cancel_block_reason: "not_active", has_score_provenance: false },
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
  assert.match(ownerHtml, /Course of Fire—not Competition names/);
  assert.match(ownerHtml, /Course of Fire mismatch: component structure, labels, maximums, or scoring methods differ; X scoring differs/);
  assert.match(ownerHtml, /Choose every mapping explicitly/);
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
