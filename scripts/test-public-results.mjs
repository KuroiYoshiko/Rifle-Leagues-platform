import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, afterEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
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
    create table clubs(id bigint primary key, name text);
    create table profiles(id uuid primary key, first_name text, last_name text, phone text, address text);
    create table club_memberships(id bigint primary key, user_id uuid);
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
    insert into clubs values (1,'Riverside RC');
    insert into club_competition_entries values (1,1,1,'submitted');
    insert into competition_entrants values (1,1,1);
    insert into competition_division_assignments values (1,1,1);
    insert into profiles values ('00000000-0000-0000-0000-000000000001','Ava','Stone','PRIVATE PROFILE PHONE','PRIVATE PROFILE ADDRESS');
    insert into club_memberships values (1,'00000000-0000-0000-0000-000000000001');
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

test("anonymous directory exposes active organisations and no private fields", async () => {
  const data = await publicCatalog();
  assert.equal(data.total_count, 1);
  assert.deepEqual(data.organisations.map((organisation) => organisation.slug), ["county-league"]);
  const json = JSON.stringify(data);
  for (const forbidden of ["PRIVATE", "contact_email", "address", "postcode", "telephone", "website", "local_scoring_enabled", "is_current_user"]) {
    assert.ok(!json.includes(forbidden), forbidden);
  }
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
  ]) assert.equal(isPublicResultsPathname(pathname), true, pathname);

  for (const pathname of [
    "/dashboard", "/profile", "/clubs", "/organisations/access",
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
});
