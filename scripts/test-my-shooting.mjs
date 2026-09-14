import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";
import { loadModule } from "./helpers/aggregate-ui-path.mjs";

const db = new PGlite();
const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const actors = {
  shooter: "80000000-0000-4000-8000-000000000001",
  other: "80000000-0000-4000-8000-000000000002",
  teammate: "80000000-0000-4000-8000-000000000003",
};
let competitionSequence = 0;

before(async () => installCanonicalDatabase(db));
after(async () => db.close());

async function actor(name) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    actors[name] ?? "",
  ]);
  await db.exec(`set role ${name === "anon" ? "anon" : "authenticated"}`);
}

async function admin(sql, params = []) {
  await db.exec("reset role; savepoint my_shooting_admin");
  try {
    const result = await db.query(sql, params);
    await db.exec("release savepoint my_shooting_admin; set role authenticated");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint my_shooting_admin; release savepoint my_shooting_admin; set role authenticated");
    throw error;
  }
}

async function flush() {
  await db.exec("set constraints all immediate; set constraints all deferred");
}

beforeEach(async () => {
  competitionSequence = 0;
  await db.exec("begin");
  for (const [name, id] of Object.entries(actors)) {
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [
      id,
      { first_name: name[0].toUpperCase() + name.slice(1), last_name: "Shooter" },
    ]);
  }
  await db.exec(`
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'County League','county-league','active'),
      (2,'Regional League','regional-league','active');
    insert into league_seasons(
      id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (1,1,'Current Season','current-season','active',current_date-70,current_date-60,current_date-30,current_date+90),
      (2,1,'Next Season','next-season','open',current_date-20,current_date-1,current_date+10,current_date+90),
      (3,2,'Past Season','past-season','completed',current_date-120,current_date-110,current_date-100,current_date-1);
    insert into clubs(id,name,slug,status) overriding system value values
      (1,'Riverside RC','riverside-rc','active'),
      (2,'Hilltop RC','hilltop-rc','active'),
      (3,'Other RC','other-rc','active');
  `);
  await db.query(`insert into club_memberships(
    id,club_id,user_id,status,role
  ) overriding system value values
    (1,1,$1,'active','member'),
    (2,2,$1,'active','member'),
    (3,1,$2,'active','member'),
    (4,2,$2,'active','member'),
    (5,3,$3,'active','member'),
    (6,1,$3,'active','member')`, [actors.shooter, actors.teammate, actors.other]);
  // The legacy dashboard relation must not create Competition participation.
  await db.query("insert into user_organisations(user_id,organisation_id) values($1,2)", [actors.shooter]);
  await actor("shooter");
});

afterEach(async () => db.exec("rollback; reset role"));

async function createParticipation({
  name,
  season = 1,
  club = 1,
  format = "individual",
  membershipIds = [1],
  deadlines = [5, 15],
  divisionStatus = null,
  entryStatus = "submitted",
  competitionStatus = "published",
  ranking = "aggregate",
} = {}) {
  competitionSequence += 1;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${competitionSequence}`;
  const teamSize = format === "individual" ? 1 : format === "pairs" ? 2 : membershipIds.length;
  const competition = (await admin(`insert into competitions(
    league_season_id,name,slug,status,entry_format,team_size,scoring_method,
    maximum_score_per_round,shots_per_round,uses_x_score,number_of_rounds,
    entry_window_mode,start_date_mode,sets_per_round,ranking_method,local_scoring_enabled
  ) values($1,$2,$3,'draft',$4,$5,'points_scored',100,10,false,$6,
    'season_default','season_default',1,$7,false) returning id`, [
      season, name, slug, format, teamSize, deadlines.length, ranking,
    ])).rows[0].id;
  await admin(`insert into competition_score_components(
    competition_id,position,short_label,maximum_score,score_method
  ) values($1,1,'Score',100,'points_scored')`, [competition]);
  for (const [index, offset] of deadlines.entries()) {
    await admin(`insert into competition_rounds(
      competition_id,round_number,deadline,shoot_by_date
    ) values($1,$2,current_date+$3::integer,current_date+$3::integer-2)`, [
      competition, index + 1, offset,
    ]);
  }
  await admin("update competitions set status=$2 where id=$1", [competition, competitionStatus]);
  const entry = (await admin(`insert into club_competition_entries(
    competition_id,club_id,status,submitted_at
  ) values($1,$2,$3,case when $3='submitted' then now() end) returning id`, [
    competition, club, entryStatus,
  ])).rows[0].id;
  const entrant = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position
  ) values($1,1) returning id`, [entry])).rows[0].id;
  const participants = [];
  for (const [index, membership] of membershipIds.entries()) {
    participants.push((await admin(`insert into competition_entrant_participants(
      club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
    ) values($1,$2,$3,$4) returning id`, [
      entry, entrant, membership, index + 1,
    ])).rows[0].id);
  }
  if (divisionStatus) {
    await admin(`insert into competition_division_configs(
      competition_id,target_size,status,published_at
    ) values($1,10,$2,case when $2='published' then now() end)`, [competition, divisionStatus]);
    const division = (await admin(`insert into competition_divisions(
      competition_id,name,position
    ) values($1,'Division One',1) returning id`, [competition])).rows[0].id;
    await admin(`insert into competition_division_assignments(
      competition_entrant_id,competition_id,competition_division_id
    ) values($1,$2,$3)`, [entrant, competition, division]);
  }
  await flush();
  return { competition, entrant, participants, slug };
}

async function myCompetitions() {
  return (await db.query("select public.get_my_shooting_competitions() data")).rows[0].data;
}

test("the authenticated projection returns only actual submitted participant slots across Clubs and Organisations", async () => {
  const individual = await createParticipation({
    name: "Current Individual",
    divisionStatus: "published",
  });
  const pair = await createParticipation({
    name: "Upcoming Pair",
    season: 2,
    club: 2,
    format: "pairs",
    membershipIds: [2, 4],
    deadlines: [20],
    divisionStatus: "draft",
  });
  const team = await createParticipation({
    name: "Completed Team",
    season: 3,
    club: 1,
    format: "team",
    membershipIds: [1, 3, 6],
    deadlines: [-20],
  });
  await createParticipation({
    name: "Another Shooter Only",
    club: 3,
    membershipIds: [5],
  });
  await createParticipation({
    name: "Own Draft Entry",
    entryStatus: "draft",
  });
  await createParticipation({
    name: "Own Draft Competition",
    competitionStatus: "draft",
  });

  const data = await myCompetitions();
  assert.deepEqual(
    new Set(data.competitions.map((item) => item.competition.name)),
    new Set(["Current Individual", "Upcoming Pair", "Completed Team"]),
  );
  assert.deepEqual(
    new Set(data.competitions.map((item) => item.club.name)),
    new Set(["Riverside RC", "Hilltop RC"]),
  );
  assert.deepEqual(
    new Set(data.competitions.map((item) => item.organisation.name)),
    new Set(["County League", "Regional League"]),
  );
  assert.equal(data.competitions.find((item) => item.competition.id === individual.competition).division.name, "Division One");
  assert.equal(data.competitions.find((item) => item.competition.id === pair.competition).division, null);
  assert.equal(data.competitions.find((item) => item.competition.id === pair.competition).entrant_label, "Pair 1");
  assert.equal(data.competitions.find((item) => item.competition.id === team.competition).entrant_label, "Team 1");
  assert.equal(JSON.stringify(data).includes("Another Shooter Only"), false);
  assert.equal(JSON.stringify(data).includes("Own Draft Entry"), false);
  assert.equal(JSON.stringify(data).includes("Own Draft Competition"), false);
});

test("historical participation survives a later Club departure and another shooter sees no leaked rows", async () => {
  await createParticipation({ name: "Durable History", deadlines: [-2] });
  await admin("update club_memberships set status='left' where id=1");
  assert.deepEqual((await myCompetitions()).competitions.map((item) => item.competition.name), ["Durable History"]);

  await actor("other");
  assert.deepEqual((await myCompetitions()).competitions, []);
});

test("classification reuses effective Competition start, Season completion, and released Round End state", async () => {
  await createParticipation({ name: "Active", deadlines: [2, 12] });
  await createParticipation({ name: "Upcoming", season: 2, club: 2, membershipIds: [2], deadlines: [20] });
  await createParticipation({ name: "Season Completed", season: 3, deadlines: [-10] });
  await createParticipation({ name: "Rounds Completed", deadlines: [-10, -1] });
  const data = await myCompetitions();
  const leagueSeasons = await loadModule("src/lib/league-seasons.ts", {
    "@/lib/supabase/server": {},
  });
  const model = await loadModule("src/lib/my-shooting-competitions.ts", {
    "@/lib/supabase/server": {},
    "@/lib/league-seasons": leagueSeasons,
    "@/lib/competition-aggregate-results": {},
    "@/lib/competition-best-n-average-results": {},
    "@/lib/competition-gun-score-results": {},
    "@/lib/competition-round-robin-results": {},
    "@/lib/competition-result-averages": {},
  });
  const grouped = model.groupMyShootingCompetitions(data);
  assert.deepEqual(grouped.active.map((item) => item.competition.name), ["Active"]);
  assert.deepEqual(grouped.upcoming.map((item) => item.competition.name), ["Upcoming"]);
  assert.deepEqual(
    new Set(grouped.completed.map((item) => item.competition.name)),
    new Set(["Season Completed", "Rounds Completed"]),
  );
  assert.equal(model.getNextRelevantRound(grouped.active[0]).round_number, 1);
  assert.equal(model.getMyShootingRoundStatus(grouped.active[0].rounds[0], data.as_of_date), "Shoot by today");
});

test("completed summaries select authoritative ranking fields and participant Average output without Pair or Team aggregates", async () => {
  const calls = [];
  const result = (field, value) => ({
    status: "ready",
    released_round_count: 4,
    groups: [{ entrants: [{ entrant_id: 41, position: 2, tied: true, [field]: value }] }],
  });
  const model = await loadModule("src/lib/my-shooting-competitions.ts", {
    "@/lib/supabase/server": {},
    "@/lib/league-seasons": { getLeagueSeasonPresentationPhase: () => "completed" },
    "@/lib/competition-aggregate-results": {
      getCompetitionAggregateResults: async (...args) => (calls.push(["aggregate", args]), result("total_points", 18)),
    },
    "@/lib/competition-best-n-average-results": {
      getCompetitionBestNAverageResults: async (...args) => (calls.push(["best_n_average", args]), result("qualifying_average", 98.25)),
    },
    "@/lib/competition-gun-score-results": {
      getCompetitionGunScoreResults: async (...args) => (calls.push(["gun_score", args]), result("gun_total", 397)),
    },
    "@/lib/competition-round-robin-results": {
      getCompetitionRoundRobinResults: async (...args) => (calls.push(["round_robin", args]), result("total_match_points", 6)),
    },
    "@/lib/competition-result-averages": {
      getCompetitionResultAverages: async () => ({
        participants: [{ entrant_id: 41, slot_number: 2, starting_average: 91.5, running_average: 96.25 }],
      }),
    },
  });
  const base = {
    competition_entrant_participant_id: 51,
    slot_number: 2,
    competition_entrant_id: 41,
    entrant_position: 1,
    entrant_label: "Individual 1",
    club_competition_entry_id: 31,
    entry_status: "submitted",
    submitted_at: "2026-01-01T00:00:00Z",
    club: { id: 3, name: "Club", slug: "club" },
    competition: { id: 4, name: "Competition", slug: "competition", entry_format: "individual", team_size: 1, ranking_method: "aggregate", number_of_rounds: 4, effective_starts_at: "2026-01-01" },
    season: { id: 2, name: "Season", slug: "season", status: "completed", starts_at: "2026-01-01", ends_at: "2026-02-01" },
    organisation: { id: 1, name: "Organisation", slug: "organisation" },
    division: { id: 1, name: "Division One", position: 1 },
    participants: [], rounds: [], has_released_results: true,
  };
  const expectations = {
    aggregate: ["Competition points", 18],
    best_n_average: ["Best-N average", 98.25],
    gun_score: ["Gun score", 397],
    round_robin: ["Match points", 6],
  };
  for (const [method, expected] of Object.entries(expectations)) {
    const summary = await model.loadMyShootingCompetitionResult({
      ...base,
      competition: { ...base.competition, ranking_method: method },
    });
    assert.equal(summary.position, 2);
    assert.equal(summary.tied, true);
    assert.equal(summary.value_label, expected[0]);
    assert.equal(summary.value, expected[1]);
    assert.equal(summary.starting_average, 91.5);
    assert.equal(summary.running_average, 96.25);
  }
  const pair = await model.loadMyShootingCompetitionResult({
    ...base,
    competition: { ...base.competition, entry_format: "pairs" },
  });
  assert.equal(pair.starting_average, null);
  assert.equal(pair.running_average, 96.25);
  assert.deepEqual(calls[0], ["aggregate", [1, 2, 4]]);
});

test("the read model is authenticated, hardened, rerunnable, and cannot expose future score payloads", async () => {
  await createParticipation({ name: "Future Score Boundary", deadlines: [0] });
  const data = await myCompetitions();
  assert.equal(data.competitions[0].rounds[0].released, false);
  assert.equal(data.competitions[0].has_released_results, false);
  for (const forbidden of ["achieved_score", "display_score", "x_count", "shooting_score_source_id"]) {
    assert.equal(JSON.stringify(data).includes(forbidden), false, forbidden);
  }

  await actor("anon");
  await db.exec("savepoint anonymous_my_shooting");
  try {
    await assert.rejects(() => db.query("select public.get_my_shooting_competitions()"), /permission denied/i);
  } finally {
    await db.exec("rollback to savepoint anonymous_my_shooting; release savepoint anonymous_my_shooting");
  }
  await actor("shooter");

  const hardening = (await admin(`select
    procedure.prosecdef,
    procedure.provolatile,
    coalesce(procedure.proconfig,'{}') @> array['search_path=""'] as safe_path,
    has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'execute') as anon_execute
  from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public' and procedure.proname='get_my_shooting_competitions'`)).rows[0];
  assert.deepEqual(hardening, {
    prosecdef: true,
    provolatile: "s",
    safe_path: true,
    authenticated_execute: true,
    anon_execute: false,
  });

  const isolated = new PGlite();
  try {
    await installCanonicalDatabase(isolated);
    await isolated.exec(await sqlFile("my-shooting-competitions"));
  } finally {
    await isolated.close();
  }
  const source = await read("database/my-shooting-competitions.sql");
  assert.doesNotMatch(source, /user_organisations/);
  assert.doesNotMatch(source, /shooting_score_(?:sources|values)|competition_score_usages/);
});

test("responsive cards expose official Results, participant context, and all concise empty states", async () => {
  const ui = await loadModule("src/components/ui.tsx");
  const component = await loadModule("src/components/my-shooting-competitions.tsx", {
    "next/link": { __esModule: true, default: ({ children, ...props }) => createElement("a", props, children) },
    "@/components/ui": ui,
    "@/lib/competitions": {
      getCompetitionEntryFormatLabel: (format) => ({ individual: "Individual", pairs: "Pairs", team: "Team" })[format],
      getCompetitionRankingMethodLabel: () => "Aggregate points",
    },
    "@/lib/league-seasons": { formatLeagueSeasonDate: (value) => value },
    "@/lib/my-shooting-competitions": {
      getNextRelevantRound: (item) => item.rounds.find((round) => !round.released) ?? null,
      getMyShootingRoundStatus: () => "Shoot-by date upcoming",
    },
  });
  for (const [tab, title] of [
    ["active", "No active Competitions"],
    ["upcoming", "No upcoming Competitions"],
    ["completed", "No completed Competition history"],
  ]) {
    const html = renderToStaticMarkup(createElement(component.MyShootingCompetitionList, {
      tab, participations: [], today: "2026-09-14",
    }));
    assert.match(html, new RegExp(title));
  }

  const pair = {
    competition_entrant_participant_id: 51, slot_number: 1,
    competition_entrant_id: 41, entrant_position: 1, entrant_label: "Pair 1",
    club_competition_entry_id: 31, entry_status: "submitted", submitted_at: "2026-01-01T00:00:00Z",
    club: { id: 3, name: "Riverside RC", slug: "riverside" },
    competition: { id: 4, name: "Winter Pair", slug: "winter-pair", entry_format: "pairs", team_size: 2, ranking_method: "aggregate", number_of_rounds: 1, effective_starts_at: "2026-01-01" },
    season: { id: 2, name: "Winter", slug: "winter", status: "completed", starts_at: "2026-01-01", ends_at: "2026-02-01" },
    organisation: { id: 1, name: "County League", slug: "county" },
    division: { id: 1, name: "Division One", position: 1 },
    participants: [
      { slot_number: 1, first_name: "Ava", last_name: "Stone", is_current_user: true },
      { slot_number: 2, first_name: "Ben", last_name: "Hill", is_current_user: false },
    ],
    rounds: [{ id: 1, round_number: 1, deadline: "2026-02-01", shoot_by_date: "2026-01-30", released: true }],
    has_released_results: true,
    result: { position: 2, tied: false, released_round_count: 1, value_label: "Competition points", value: 8, starting_average: 99, running_average: 96.25 },
  };
  const html = renderToStaticMarkup(createElement(component.MyShootingCompetitionList, {
    tab: "completed", participations: [pair], today: "2026-09-14",
  }));
  assert.match(html, /Winter Pair/);
  assert.match(html, /Pair 1/);
  assert.match(html, /Ava Stone, Ben Hill/);
  assert.match(html, /Official Results/);
  assert.match(html, /Your R\/Av/);
  assert.doesNotMatch(html, /Frozen S\/Av/);
  assert.doesNotMatch(html, /overflow-x-auto/);

  const upcomingHtml = renderToStaticMarkup(createElement(component.MyShootingCompetitionList, {
    tab: "upcoming",
    participations: [{
      ...pair,
      division: null,
      has_released_results: false,
      result: undefined,
      rounds: [{ ...pair.rounds[0], released: false }],
    }],
    today: "2025-12-01",
  }));
  assert.doesNotMatch(upcomingHtml, />Division</);
  assert.doesNotMatch(upcomingHtml, /Official Results/);
});

test("sidebar order and route auth follow existing application conventions", async () => {
  const shell = await read("src/components/app-shell.tsx");
  const shootingIndex = shell.indexOf("My shooting");
  const organisationsIndex = shell.indexOf('label="My organisations"');
  const clubsIndex = shell.indexOf('label="My clubs"');
  assert.ok(shootingIndex > -1 && shootingIndex < organisationsIndex && shootingIndex < clubsIndex);
  assert.match(shell, /label: "Competitions"[\s\S]*href: "\/competitions"/);
  assert.match(shell, /label: "Statistics"[\s\S]*href: "\/statistics"/);
  assert.doesNotMatch(shell, /label: "Results"/);
  assert.doesNotMatch(shell, /Personal competition activity is not available yet|Competition results are not available yet/);

  let competitionRead = false;
  const route = await loadModule("src/app/(app)/competitions/page.tsx", {
    "next/navigation": { redirect: (href) => { throw new Error(`redirect:${href}`); } },
    "@/components/my-shooting-competitions": {},
    "@/lib/my-shooting-competitions": {
      getMyShootingCompetitions: async () => { competitionRead = true; return { as_of_date: "2026-09-14", competitions: [] }; },
      groupMyShootingCompetitions: () => ({ active: [], upcoming: [], completed: [] }),
      addCompletedCompetitionResults: async (items) => items,
    },
    "@/lib/supabase/server": {
      createClient: async () => ({ auth: { getClaims: async () => ({ data: null, error: new Error("No session") }) } }),
    },
  });
  await assert.rejects(
    route.default({ searchParams: Promise.resolve({}) }),
    /redirect:\/login/,
  );
  assert.equal(competitionRead, false);
});
