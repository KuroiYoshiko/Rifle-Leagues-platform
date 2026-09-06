import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, afterEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";
import {
  getCompetitionViewerCapabilities,
  isPublicResultsPathname,
} from "../src/lib/public-results-routes.mjs";

const db = new PGlite();

before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    grant usage on schema public to anon, authenticated;
    create table organisations(
      id bigint primary key, name text, slug text, short_name text,
      description text, about_content text, contact_email text, address text,
      postcode text, telephone text, website text, status text,
      search_document tsvector
    );
    create table league_seasons(
      id bigint primary key, organisation_id bigint, name text, description text,
      slug text, status text, entry_opens_at date, entry_closes_at date,
      starts_at date, ends_at date, created_at timestamptz, updated_at timestamptz
    );
    create table competitions(
      id bigint primary key, league_season_id bigint, name text, slug text,
      description text, status text, entry_format text, team_size integer,
      scoring_method text, maximum_score_per_round numeric, shots_per_round integer,
      uses_x_score boolean, number_of_rounds integer, entry_fee numeric,
      entry_window_mode text, custom_entry_opens_at date, custom_entry_closes_at date,
      start_date_mode text, custom_starts_at date, sets_per_round integer,
      ranking_method text, best_rounds_count integer, local_scoring_enabled boolean,
      created_at timestamptz, updated_at timestamptz
    );
    create table competition_rounds(
      id bigint primary key, competition_id bigint, round_number integer,
      deadline date, shoot_by_date date, created_at timestamptz, updated_at timestamptz
    );
    create table competition_score_components(
      id bigint primary key, competition_id bigint, position integer,
      short_label text, maximum_score numeric, score_method text,
      created_at timestamptz, updated_at timestamptz
    );
    create table competition_division_configs(competition_id bigint primary key, status text);
    create table competition_divisions(id bigint primary key, competition_id bigint, name text, position integer);
    create table competition_division_assignments(competition_id bigint, competition_entrant_id bigint, competition_division_id bigint);
    create table club_competition_entries(id bigint primary key, competition_id bigint, club_id bigint, status text);
    create table competition_entrants(id bigint primary key, club_competition_entry_id bigint, position integer);
    create table clubs(
      id bigint primary key, name text, slug text, town text, county text,
      postcode text, website text, about_content text, status text,
      search_document tsvector
    );
    create table club_information_cards(
      id bigint primary key, club_id bigint, title text, content text,
      position integer, created_by uuid, updated_by uuid,
      created_at timestamptz, updated_at timestamptz
    );
    create table profiles(id uuid primary key, first_name text, last_name text, phone text, address text);
    create table club_memberships(id bigint primary key, user_id uuid, club_id bigint, status text, role text);
    create table competition_entrant_participants(id bigint primary key, competition_entrant_id bigint, club_membership_id bigint, slot_number integer);
  `);
  const sql = await readFile(new URL("../database/public-results.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql);
});

after(async () => db.close());
beforeEach(async () => {
  await db.exec(`
    begin;
    insert into organisations values
      (1,'County League','county-league','CL','Public description','Public about','PRIVATE EMAIL','PRIVATE ADDRESS','PRIVATE POSTCODE','PRIVATE PHONE','PRIVATE WEBSITE','active',to_tsvector('simple','County League CL')),
      (2,'Inactive League','inactive-league',null,null,null,'HIDDEN EMAIL','HIDDEN ADDRESS',null,null,null,'inactive',to_tsvector('simple','Inactive League'));
    insert into league_seasons values
      (1,1,'Summer 2026','Published season','summer-2026','active','2026-01-01','2026-02-01','2026-02-02','2026-09-01',now(),now()),
      (2,1,'Draft season','Hidden','draft-season','draft',null,null,null,null,now(),now());
    insert into competitions values
      (1,1,'Summer Aggregate','summer-aggregate','Published competition','published','pairs',2,'points_dropped',200,20,true,3,5,'season_default',null,null,'season_default',null,1,'aggregate',null,true,now(),now()),
      (2,1,'Draft competition','draft-competition','Hidden','draft','individual',1,'points_scored',100,10,false,1,null,'season_default',null,null,'season_default',null,1,'aggregate',null,false,now(),now()),
      (3,1,'Draft divisions','draft-divisions','Published competition','published','individual',1,'points_scored',100,10,false,1,null,'season_default',null,null,'season_default',null,1,'aggregate',null,false,now(),now());
    insert into competition_rounds values (1,1,1,'2026-03-01','2026-02-25',now(),now());
    insert into competition_score_components values (1,1,1,'Prone',100,'points_dropped',now(),now());
    insert into competition_division_configs values (1,'published'),(3,'draft');
    insert into competition_divisions values (1,1,'Division One',1),(2,3,'PRIVATE DRAFT DIVISION',1);
    insert into clubs values
      (1,'Riverside RC','riverside-rc','Basildon','Essex','SS1 1AA','https://riverside.example','Public club introduction','active',to_tsvector('simple','Riverside RC Basildon Essex SS1 1AA')),
      (2,'Inactive Club','inactive-club','Hidden town',null,null,null,'PRIVATE INACTIVE ABOUT','inactive',to_tsvector('simple','Inactive Club Hidden town'));
    insert into club_information_cards values
      (1,1,'Range information','Public range guidance',1,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',now(),now());
    insert into club_competition_entries values
      (1,1,1,'submitted'),
      (2,2,1,'draft'),
      (3,3,1,'withdrawn'),
      (4,1,1,'rejected');
    insert into competition_entrants values (1,1,1);
    insert into competition_division_assignments values (1,1,1);
    insert into profiles values ('00000000-0000-0000-0000-000000000001','Ava','Stone','PRIVATE PROFILE PHONE','PRIVATE PROFILE ADDRESS');
    insert into club_memberships values (1,'00000000-0000-0000-0000-000000000001',1,'active','owner');
    insert into competition_entrant_participants values (1,1,1,1);
  `);
});
afterEach(async () => db.exec("rollback; reset role"));

async function publicCatalog(parameters = {}) {
  const values = {
    organisation: null,
    season: null,
    competition: null,
    query: null,
    offset: 0,
    limit: 10,
    ...parameters,
  };
  await db.exec("set role anon");
  try {
    return (await db.query(
      "select public.get_public_results_catalog($1,$2,$3,$4,$5,$6) as data",
      [values.organisation, values.season, values.competition, values.query, values.offset, values.limit],
    )).rows[0].data;
  } finally {
    await db.exec("reset role").catch(() => {});
  }
}

async function publicClubCatalog(parameters = {}) {
  const values = {
    club: null,
    query: null,
    offset: 0,
    limit: 10,
    ...parameters,
  };
  await db.exec("set role anon");
  try {
    return (await db.query(
      "select public.get_public_club_results_catalog($1,$2,$3,$4) as data",
      [values.club, values.query, values.offset, values.limit],
    )).rows[0].data;
  } finally {
    await db.exec("reset role").catch(() => {});
  }
}

async function renderClubCompetitions({ viewerId = null, membership = null } = {}) {
  const ui = await loadModule("src/components/ui.tsx");
  let authenticatedEntryReads = 0;
  const club = {
    id: 1,
    name: "Riverside RC",
    slug: "riverside-rc",
    town: "Basildon",
    county: "Essex",
    postcode: "SS1 1AA",
    website: "https://riverside.example",
    about_content: "Public club introduction",
  };
  const publicCompetition = {
    competition_id: 1,
    competition_name: "Summer Aggregate",
    competition_slug: "summer-aggregate",
    entry_format: "pairs",
    team_size: 2,
    ranking_method: "aggregate",
    effective_starts_at: "2026-02-02",
    season_name: "Summer 2026",
    season_slug: "summer-2026",
    season_status: "active",
    season_starts_at: "2026-02-02",
    season_ends_at: "2026-09-30",
    organisation_name: "County League",
    organisation_slug: "county-league",
    has_released_results: true,
  };
  const authenticatedEntries = [
    {
      club_id: 1, entry_id: 10, entry_status: "draft", submitted_at: null,
      entry_updated_at: "2026-03-02T00:00:00Z", competition_id: 2,
      competition_status: "published", competition_name: "Owner Draft",
      competition_slug: "owner-draft", entry_format: "pairs", team_size: 2,
      league_season_name: "Summer 2026", league_season_slug: "summer-2026",
      league_season_starts_at: "2026-02-02", league_season_ends_at: "2026-09-30",
      competition_effective_starts_at: "2026-02-02", organisation_name: "County League",
      organisation_slug: "county-league", entrant_count: 1, participant_count: 2,
      is_user_entered: false, can_manage: true, entry_window_state: "open",
      local_scoring_enabled: false, score_rounds: [],
    },
    {
      club_id: 1, entry_id: 11, entry_status: "submitted", submitted_at: "2026-03-01T00:00:00Z",
      entry_updated_at: "2026-03-01T00:00:00Z", competition_id: 1,
      competition_status: "published", competition_name: "Summer Aggregate",
      competition_slug: "summer-aggregate", entry_format: "pairs", team_size: 2,
      league_season_name: "Summer 2026", league_season_slug: "summer-2026",
      league_season_starts_at: "2026-02-02", league_season_ends_at: "2026-09-30",
      competition_effective_starts_at: "2026-02-02", organisation_name: "County League",
      organisation_slug: "county-league", entrant_count: 1, participant_count: 2,
      is_user_entered: true, can_manage: true, entry_window_state: "closed",
      local_scoring_enabled: true,
      score_rounds: [{ id: 20, round_number: 1, deadline: "2026-09-30", shoot_by_date: "2026-09-29" }],
    },
    {
      club_id: 1, entry_id: 12, entry_status: "submitted", submitted_at: "2026-03-01T00:00:00Z",
      entry_updated_at: "2026-03-01T00:00:00Z", competition_id: 3,
      competition_status: "published", competition_name: "Summer Individual",
      competition_slug: "summer-individual", entry_format: "individual", team_size: 1,
      league_season_name: "Summer 2026", league_season_slug: "summer-2026",
      league_season_starts_at: "2026-02-02", league_season_ends_at: "2026-09-30",
      competition_effective_starts_at: "2026-02-02", organisation_name: "County League",
      organisation_slug: "county-league", entrant_count: 6, participant_count: 6,
      is_user_entered: false, can_manage: true, entry_window_state: "closed",
      local_scoring_enabled: false, score_rounds: [],
    },
    {
      club_id: 1, entry_id: 13, entry_status: "submitted", submitted_at: "2026-03-01T00:00:00Z",
      entry_updated_at: "2026-03-01T00:00:00Z", competition_id: 4,
      competition_status: "published", competition_name: "Summer Team",
      competition_slug: "summer-team", entry_format: "team", team_size: 4,
      league_season_name: "Summer 2026", league_season_slug: "summer-2026",
      league_season_starts_at: "2026-02-02", league_season_ends_at: "2026-09-30",
      competition_effective_starts_at: "2026-02-02", organisation_name: "County League",
      organisation_slug: "county-league", entrant_count: 2, participant_count: 8,
      is_user_entered: true, can_manage: true, entry_window_state: "closed",
      local_scoring_enabled: false, score_rounds: [],
    },
  ];

  const route = await loadModule(
    "src/app/(app)/clubs/[slug]/competitions/page.tsx",
    {
      "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
      "next/navigation": { notFound: () => { throw new Error("Unexpected club notFound"); } },
      "@/components/club-page-frame": {
        ClubPageFrame: ({ children, isAuthenticated }) => createElement("main", { "data-authenticated": String(isAuthenticated) }, children),
        ClubMembershipPanel: () => createElement("div", { "data-membership-panel": "true" }),
      },
      "@/components/league-season-phase-badge": {
        LeagueSeasonPhaseBadge: ({ phase }) => createElement("span", { "data-season-phase": phase }, ({ ongoing: "Ongoing", upcoming: "Upcoming", completed: "Completed" })[phase]),
      },
      "@/components/ui": ui,
      "@/lib/competition-entries": {
        getClubCompetitionEntries: async () => {
          authenticatedEntryReads += 1;
          const canManage = ["owner", "official"].includes(membership?.role);
          return authenticatedEntries.map((entry) => ({ ...entry, can_manage: canManage }));
        },
        getClubCompetitionEntryStatusLabel: (status) => status[0].toUpperCase() + status.slice(1),
      },
      "@/lib/clubs": {
        getClubPageContextBySlug: async () => ({ club, membership, informationCardCount: 1 }),
        isClubManager: (value) => value?.status === "active" && ["owner", "official"].includes(value.role),
      },
      "@/lib/competitions": {
        getCompetitionEntryFormatLabel: (format) => ({ individual: "Individual", pairs: "Pairs", team: "Team" })[format],
        getCompetitionRankingMethodLabel: () => "Aggregate points",
      },
      "@/lib/competition-score-dates": { isCompetitionRoundWithinLocalCutoff: () => true },
      "@/lib/league-seasons": {
        getLeagueSeasonPresentationPhase: () => "ongoing",
        getLeagueToday: () => "2026-09-06",
      },
      "@/lib/public-results": {
        getPublicClubResultsCatalog: async () => ({
          club,
          information_cards: [{ id: 1, title: "Info", content: "Public", position: 1, updated_at: "2026-01-01" }],
          competitions: [publicCompetition],
        }),
      },
      "@/lib/viewer": { getViewerId: async () => viewerId },
    },
  );
  const element = await route.default({
    params: Promise.resolve({ slug: club.slug }),
    searchParams: Promise.resolve({}),
  });
  return { html: renderToStaticMarkup(element), authenticatedEntryReads };
}

test("anonymous directory exposes active organisations and no private fields", async () => {
  const data = await publicCatalog();
  assert.equal(data.total_count, 1);
  assert.deepEqual(data.organisations.map((organisation) => organisation.slug), ["county-league"]);
  const json = JSON.stringify(data);
  for (const forbidden of ["PRIVATE", "contact_email", "address", "postcode", "telephone", "website", "local_scoring_enabled", "is_current_user"]) {
    assert.ok(!json.includes(forbidden), forbidden);
  }
});

test("anonymous directory discovers active clubs without membership or profile data", async () => {
  const data = await publicClubCatalog({ query: "Riverside" });
  assert.equal(data.total_count, 1);
  assert.deepEqual(data.clubs.map((club) => club.slug), ["riverside-rc"]);
  assert.equal(data.clubs[0].town, "Basildon");

  const json = JSON.stringify(data);
  for (const forbidden of [
    "Inactive Club",
    "PRIVATE",
    "user_id",
    "profile",
    "membership",
    "created_by",
    "updated_by",
  ]) assert.ok(!json.includes(forbidden), forbidden);
});

test("anonymous club page exposes public information and submitted public participation only", async () => {
  const data = await publicClubCatalog({ club: "riverside-rc" });
  assert.equal(data.club.name, "Riverside RC");
  assert.equal(data.club.about_content, "Public club introduction");
  assert.deepEqual(data.information_cards, [{
    id: 1,
    title: "Range information",
    content: "Public range guidance",
    position: 1,
    updated_at: data.information_cards[0].updated_at,
  }]);
  assert.deepEqual(data.competitions.map((competition) => competition.competition_slug), ["summer-aggregate"]);
  assert.equal(data.competitions[0].organisation_name, "County League");
  assert.equal(data.competitions[0].season_name, "Summer 2026");
  assert.equal(data.competitions[0].has_released_results, true);

  const json = JSON.stringify(data);
  for (const forbidden of [
    "draft-competition",
    "draft-divisions",
    "entry_id",
    "entry_status",
    "submitted_at",
    "membership",
    "first_name",
    "last_name",
    "phone",
    "address",
  ]) assert.ok(!json.includes(forbidden), forbidden);
});

test("inactive and invalid club contexts fail closed", async () => {
  assert.equal(await publicClubCatalog({ club: "inactive-club" }), null);
  assert.equal(await publicClubCatalog({ club: "Riverside RC" }), null);
});

test("anonymous Club Competitions render canonical released Results links and no management UI", async () => {
  const { html, authenticatedEntryReads } = await renderClubCompetitions();
  assert.equal(authenticatedEntryReads, 0);
  assert.match(html, /data-authenticated="false"/);
  assert.match(html, /Summer Aggregate/);
  assert.match(html, /County League/);
  assert.match(html, /Summer 2026/);
  assert.match(html, /data-season-phase="ongoing">Ongoing/);
  assert.match(
    html,
    /href="\/organisations\/county-league\/leagues\/summer-2026\/competitions\/summer-aggregate#results"/,
  );
  for (const forbidden of [
    "View entry",
    "Manage entry",
    "Manage scores",
    "Entry drafts",
    "data-membership-panel",
    "/members",
    "/settings",
  ]) assert.ok(!html.includes(forbidden), forbidden);
});

test("signed-in non-members see public Club Competitions without member capabilities", async () => {
  const { html, authenticatedEntryReads } = await renderClubCompetitions({
    viewerId: "00000000-0000-0000-0000-000000000002",
    membership: null,
  });
  assert.equal(authenticatedEntryReads, 0);
  assert.match(html, /data-authenticated="true"/);
  assert.match(html, /data-membership-panel="true"/);
  assert.match(html, /View released results/);
  assert.doesNotMatch(html, /View entry|Manage entry|Manage scores|Entry drafts/);
});

test("authenticated club owners retain entry and score management controls", async () => {
  const { html, authenticatedEntryReads } = await renderClubCompetitions({
    viewerId: "00000000-0000-0000-0000-000000000001",
    membership: {
      id: 1,
      club_id: 1,
      status: "active",
      role: "owner",
      created_at: "2026-01-01T00:00:00Z",
    },
  });
  assert.equal(authenticatedEntryReads, 1);
  assert.match(html, /Entry drafts/);
  assert.match(html, /Draft · Entry open/);
  assert.match(html, /Submitted · Entry closed/);
  assert.match(html, /You are entered/);
  assert.match(html, /Individual · 6 entrants · 6 shooters/);
  assert.match(html, /Pairs · 1 entrant · 2 shooters/);
  assert.match(html, /Team · 4 per team · 2 entrants · 8 shooters/);
  assert.match(html, /Continue entry/);
  assert.match(html, /Manage scores/);
});

test("ordinary club members see submitted cards without management actions", async () => {
  const { html } = await renderClubCompetitions({
    viewerId: "00000000-0000-0000-0000-000000000003",
    membership: {
      id: 2, club_id: 1, status: "active", role: "member",
      created_at: "2026-01-01T00:00:00Z",
    },
  });
  assert.match(html, /Summer Individual/);
  assert.match(html, /Summer Aggregate/);
  assert.match(html, /Summer Team/);
  assert.match(html, /You are entered/);
  assert.doesNotMatch(html, /Entry drafts|Continue entry|Manage entry|Manage scores|View entry/);
});

test("club officials retain entry and score management controls", async () => {
  const { html } = await renderClubCompetitions({
    viewerId: "00000000-0000-0000-0000-000000000004",
    membership: {
      id: 3, club_id: 1, status: "active", role: "official",
      created_at: "2026-01-01T00:00:00Z",
    },
  });
  assert.match(html, /Entry drafts/);
  assert.match(html, /Continue entry/);
  assert.match(html, /Manage scores/);
});

test("Season presentation phases use dates, inclusive boundaries, and definitive completion", async () => {
  const seasons = await loadModule("src/lib/league-seasons.ts", {
    "@/lib/supabase/server": { createClient: async () => ({}) },
  });
  const today = "2026-09-06";

  assert.equal(seasons.getLeagueSeasonPresentationPhase({ starts_at: "2026-09-07", ends_at: "2027-01-01", status: "open" }, today), "upcoming");
  assert.equal(seasons.getLeagueSeasonPresentationPhase({ starts_at: today, ends_at: today, status: "open" }, today), "ongoing");
  assert.equal(seasons.getLeagueSeasonPresentationPhase({ starts_at: "2026-01-01", ends_at: "2026-09-05", status: "active" }, today), "completed");
  assert.equal(seasons.getLeagueSeasonPresentationPhase({ starts_at: "2026-09-07", ends_at: "2027-01-01", status: "completed" }, today), "completed");
  assert.equal(seasons.getLeagueSeasonPhaseLabel("upcoming"), "Upcoming");
  assert.equal(seasons.getLeagueSeasonPhaseLabel("ongoing"), "Ongoing");
  assert.equal(seasons.getLeagueSeasonPhaseLabel("completed"), "Completed");
});

test("Organisation Results navigation is removed and its legacy route redirects to Seasons", async () => {
  const [frameSource, shellSource] = await Promise.all([
    readFile(new URL("../src/components/organisation-page-frame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(frameSource, /label:\s*"Results"/);
  assert.doesNotMatch(shellSource, /label:\s*"Results",\s*href:\s*`\$\{basePath\}\/results`/);

  let destination = null;
  const route = await loadModule("src/app/(app)/organisations/[slug]/results/page.tsx", {
    "next/navigation": { redirect: (value) => { destination = value; } },
  });
  await route.default({ params: Promise.resolve({ slug: "county-league" }) });
  assert.equal(destination, "/organisations/county-league/leagues");
});

test("Organisation management status uses the shared target card and supports owner and manager roles", async () => {
  const ui = await loadModule("src/components/ui.tsx");
  const panel = await loadModule("src/components/organisation-management-panel.tsx", {
    "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
    "@/components/ui": ui,
    "@/lib/organisations": {},
  });
  const organisation = { name: "Eastern Region Shooting Association", slug: "eastern-region" };
  const ownerHtml = renderToStaticMarkup(createElement(panel.OrganisationManagementPanel, { organisation, role: "owner" }));
  const managerHtml = renderToStaticMarkup(createElement(panel.OrganisationManagementPanel, { organisation, role: "manager" }));
  const overviewSource = await readFile(new URL("../src/app/(app)/organisations/[slug]/page.tsx", import.meta.url), "utf8");

  assert.match(ownerHtml, /bg-navigation/);
  assert.match(ownerHtml, /target-mark/);
  assert.match(ownerHtml, />Active</);
  assert.match(ownerHtml, />Owner</);
  assert.match(ownerHtml, /You manage Eastern Region Shooting Association\./);
  assert.match(ownerHtml, /href="\/organisations\/eastern-region\/management"/);
  assert.match(managerHtml, />Manager</);
  assert.doesNotMatch(managerHtml, />Owner</);
  assert.match(overviewSource, /isAuthenticated && managementContext/);
});

test("anonymous hierarchy exposes only public seasons, competitions, and divisions", async () => {
  const organisation = await publicCatalog({ organisation: "county-league" });
  assert.deepEqual(organisation.seasons.map((season) => season.slug), ["summer-2026"]);
  const season = await publicCatalog({ organisation: "county-league", season: "summer-2026" });
  assert.deepEqual(season.competitions.map((competition) => competition.slug), ["draft-divisions", "summer-aggregate"]);
  const competition = await publicCatalog({ organisation: "county-league", season: "summer-2026", competition: "summer-aggregate" });
  assert.equal(competition.competition.ranking_method, "aggregate");
  assert.equal(competition.rounds[0].round_number, 1);
  assert.equal(competition.score_components[0].short_label, "Prone");
  assert.equal(competition.published_divisions.divisions[0].name, "Division One");
  assert.equal(competition.published_divisions.divisions[0].entrants[0].club_name, "Riverside RC");
  assert.deepEqual(competition.published_divisions.divisions[0].entrants[0].participants[0], {
    first_name: "Ava", last_name: "Stone", slot_number: 1,
  });
  assert.ok(!JSON.stringify(competition).includes("local_scoring_enabled"));
  assert.ok(!JSON.stringify(competition).includes("is_current_user"));
  const draftDivisions = await publicCatalog({ organisation: "county-league", season: "summer-2026", competition: "draft-divisions" });
  assert.equal(draftDivisions.published_divisions, null);
  assert.ok(!JSON.stringify(draftDivisions).includes("PRIVATE DRAFT DIVISION"));
});

test("invalid, inactive, draft, and mismatched public contexts fail closed", async () => {
  assert.equal(await publicCatalog({ organisation: "inactive-league" }), null);
  assert.equal(await publicCatalog({ organisation: "county-league", season: "draft-season" }), null);
  assert.equal(await publicCatalog({ organisation: "county-league", season: "summer-2026", competition: "draft-competition" }), null);
  assert.equal(await publicCatalog({ organisation: "County League" }), null);
});

test("public route allowlist admits browsing leaves and rejects private application leaves", () => {
  for (const pathname of [
    "/organisations",
    "/organisations/county-league",
    "/organisations/county-league/results",
    "/organisations/county-league/leagues",
    "/organisations/county-league/leagues/summer-2026",
    "/organisations/county-league/leagues/summer-2026/competitions/summer-aggregate",
    "/organisations/county-league/leagues/summer-2026/competitions/summer-aggregate/results",
    "/clubs",
    "/clubs/riverside-rc",
    "/clubs/riverside-rc/competitions",
    "/clubs/riverside-rc/information",
  ]) assert.equal(isPublicResultsPathname(pathname), true, pathname);

  for (const pathname of [
    "/dashboard", "/profile", "/clubs/register", "/clubs/riverside-rc/members",
    "/clubs/riverside-rc/settings", "/organisations/access",
    "/organisations/register", "/organisations/county-league/contact",
    "/organisations/county-league/information", "/organisations/county-league/management",
    "/organisations/county-league/leagues/new",
    "/organisations/county-league/leagues/summer-2026/edit",
    "/organisations/county-league/leagues/summer-2026/competitions/new",
    "/organisations/county-league/leagues/summer-2026/competitions/summer-aggregate/entry",
    "/organisations/county-league/leagues/summer-2026/competitions/summer-aggregate/edit",
    "/organisations/county-league/leagues/summer-2026/competitions/summer-aggregate/scores",
    "/organisations/county-league/leagues/summer-2026/competitions/summer-aggregate/divisions",
  ]) assert.equal(isPublicResultsPathname(pathname), false, pathname);
});

test("anonymous Competition capabilities omit every entry and management control", () => {
  assert.deepEqual(getCompetitionViewerCapabilities({
    isAuthenticated: false,
    isOwner: false,
    hasManagementContext: false,
    competitionPublished: true,
    hasDivisionManagement: false,
  }), {
    loadEntryContext: false,
    showEntryControls: false,
    showLifecycleActions: false,
    showScoringAccess: false,
    showCompetitionManagement: false,
  });
  const authenticatedOwner = getCompetitionViewerCapabilities({
    isAuthenticated: true,
    isOwner: true,
    hasManagementContext: true,
    competitionPublished: true,
    hasDivisionManagement: true,
  });
  assert.equal(authenticatedOwner.showEntryControls, true);
  assert.equal(authenticatedOwner.showLifecycleActions, true);
  assert.equal(authenticatedOwner.showCompetitionManagement, true);
});

test("catalog migration grants only function execution and leaves table policy/grant surface alone", async () => {
  const sql = await readFile(new URL("../database/public-results.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all).*on\s+table/is);
  assert.doesNotMatch(sql, /create\s+policy|alter\s+table.*(?:disable|enable)\s+row\s+level\s+security/is);
  assert.match(sql, /revoke execute on function public\.get_public_results_catalog[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_public_results_catalog[\s\S]*to anon, authenticated/i);
  assert.match(sql, /revoke execute on function public\.get_public_club_results_catalog[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_public_club_results_catalog[\s\S]*to anon, authenticated/i);
});

test("anonymous callers still cannot select club participation or private source tables", async () => {
  await db.exec("set role anon");
  try {
    for (const [index, table] of [
      "club_competition_entries",
      "club_memberships",
      "profiles",
      "competition_entrants",
      "competition_entrant_participants",
    ].entries()) {
      const savepoint = `anon_source_${index}`;
      await db.exec(`savepoint ${savepoint}`);
      await assert.rejects(
        db.query(`select * from public.${table}`),
        /permission denied/i,
      );
      await db.exec(`rollback to savepoint ${savepoint}; release savepoint ${savepoint}`);
    }
  } finally {
    await db.exec("reset role").catch(() => {});
  }

  const managementSql = await readFile(
    new URL("../database/competition-entries.sql", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    managementSql,
    /grant execute on function public\.(?:get_club_competition_entries|get_club_competition_entry_management|start_club_competition_entry|save_club_competition_entry|submit_club_competition_entry|withdraw_club_competition_entry)[\s\S]{0,180}\bto\s+anon\b/i,
  );
});
