import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";

const db = new PGlite();
const actors = {
  owner: "91000000-0000-4000-8000-000000000001",
  official: "91000000-0000-4000-8000-000000000002",
  member: "91000000-0000-4000-8000-000000000003",
  otherOwner: "91000000-0000-4000-8000-000000000004",
  organisationOwner: "91000000-0000-4000-8000-000000000005",
  fourth: "91000000-0000-4000-8000-000000000006",
  fifth: "91000000-0000-4000-8000-000000000007",
  sixth: "91000000-0000-4000-8000-000000000008",
  otherMember1: "91000000-0000-4000-8000-000000000009",
  otherMember2: "91000000-0000-4000-8000-000000000010",
  inactive: "91000000-0000-4000-8000-000000000011",
  seventh: "91000000-0000-4000-8000-000000000012",
  eighth: "91000000-0000-4000-8000-000000000013",
};

before(async () => installCanonicalDatabase(db, { concurrentShootingStage3a: true }));
after(async () => db.close());

async function actor(name) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actors[name] ?? ""]);
  await db.exec(`set role ${name === "anon" ? "anon" : "authenticated"}`);
}

async function admin(sql, params = []) {
  await db.exec("reset role; savepoint club_team_admin");
  try {
    const result = await db.query(sql, params);
    await db.exec("release savepoint club_team_admin; set role authenticated");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint club_team_admin; release savepoint club_team_admin; set role authenticated");
    throw error;
  }
}

async function expectError(run, pattern) {
  await db.exec("savepoint expected_club_team_error");
  try {
    await run();
    assert.fail("Expected the database operation to fail");
  } catch (error) {
    await db.exec("rollback to savepoint expected_club_team_error; release savepoint expected_club_team_error");
    assert.match(error.message, pattern);
    return;
  }
}

async function call(name, params = []) {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(",");
  return (await db.query(`select public.${name}(${placeholders}) data`, params)).rows[0].data;
}

async function createUnit({
  name = null,
  clubId = 1,
  unitType = "team",
  roster = unitType === "pair" ? [1, 2] : [1, 2, 3],
} = {}) {
  return call("create_club_team", [clubId, name, unitType, roster]);
}

beforeEach(async () => {
  await db.exec("begin");
  for (const [name, id] of Object.entries(actors)) {
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [
      id,
      { first_name: name, last_name: "Shooter" },
    ]);
  }
  await db.exec(`
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'County League','county-league','active');
    insert into league_seasons(
      id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (1,1,'2026 Season','2026-season','open',current_date-20,current_date+20,current_date+30,current_date+120);
    insert into clubs(id,name,slug,status) overriding system value values
      (1,'Basildon','basildon','active'),
      (2,'Riverside','riverside','active');
  `);
  await db.query(`insert into club_memberships(
    id,club_id,user_id,status,role
  ) overriding system value values
    (1,1,$1,'active','owner'),
    (2,1,$2,'active','official'),
    (3,1,$3,'active','member'),
    (4,2,$4,'active','owner'),
    (5,1,$5,'active','member'),
    (6,1,$6,'active','member'),
    (7,1,$7,'active','member'),
    (8,2,$8,'active','member'),
    (9,2,$9,'active','member'),
    (10,1,$10,'left','member'),
    (11,1,$11,'active','member'),
    (12,1,$12,'active','member')`, [
    actors.owner,
    actors.official,
    actors.member,
    actors.otherOwner,
    actors.fourth,
    actors.fifth,
    actors.sixth,
    actors.otherMember1,
    actors.otherMember2,
    actors.inactive,
    actors.seventh,
    actors.eighth,
  ]);
  await db.query(`insert into organisation_staff(
    organisation_id,user_id,role,status
  ) values(1,$1,'owner','active')`, [actors.organisationOwner]);
  await db.exec(`
    insert into competitions(
      id,league_season_id,name,slug,status,entry_format,team_size,scoring_method,
      maximum_score_per_round,shots_per_round,uses_x_score,number_of_rounds,
      entry_window_mode,start_date_mode,sets_per_round,ranking_method,local_scoring_enabled
    ) overriding system value values
      (1,1,'Team League','team-league','draft','team',3,'points_scored',100,10,false,1,
       'season_default','season_default',1,'aggregate',false),
      (2,1,'Pair League','pair-league','draft','pairs',2,'points_scored',100,10,false,1,
       'season_default','season_default',1,'aggregate',false),
      (3,1,'Individual League','individual-league','draft','individual',1,'points_scored',100,10,false,1,
       'season_default','season_default',1,'aggregate',false),
      (4,1,'Other Club Team League','other-team-league','draft','team',3,'points_scored',100,10,false,1,
       'season_default','season_default',1,'aggregate',false),
      (5,1,'Five Person Team League','five-team-league','draft','team',5,'points_scored',100,10,false,1,
       'season_default','season_default',1,'aggregate',false),
      (6,1,'Later Team League','later-team-league','draft','team',3,'points_scored',100,10,false,1,
       'season_default','season_default',1,'aggregate',false);
    insert into competition_rounds(competition_id,round_number,deadline,shoot_by_date)
      values
        (1,1,current_date+40,current_date+38),
        (2,1,current_date+40,current_date+38);
    insert into competition_score_components(
      competition_id,position,short_label,maximum_score,score_method
    ) values
      (1,1,'Score',100,'points_scored'),
      (2,1,'Score',100,'points_scored');
    update competitions set status='published';
    insert into club_competition_entries(
      id,competition_id,club_id,status
    ) overriding system value values
      (1,1,1,'draft'),
      (2,2,1,'draft'),
      (3,3,1,'draft'),
      (4,4,2,'draft'),
      (5,5,1,'draft'),
      (6,6,1,'draft');
  `);
  await actor("owner");
});

afterEach(async () => db.exec("rollback; reset role"));

test("active owners and officials manage complete Club units; members and organisation staff alone cannot", async () => {
  const defaultTeam = await createUnit();
  assert.equal(defaultTeam.name, "Team 1");
  assert.equal(defaultTeam.unit_type, "team");
  assert.equal(defaultTeam.fixed_size, 3);
  assert.deepEqual(defaultTeam.roster.map((member) => member.membership_id), [1, 2, 3]);
  const ownerList = await call("get_club_teams", [1, true]);
  assert.equal(ownerList.can_manage, true);
  assert.deepEqual(ownerList.teams.map((team) => team.name), ["Team 1"]);

  await actor("official");
  const namedTeam = await createUnit({ name: "  Basildon   A  ", roster: [2, 3, 5] });
  assert.equal(namedTeam.name, "Basildon A");
  const renamed = await call("update_club_team", [namedTeam.id, "Basildon Elite", "team", [2, 5, 6]]);
  assert.equal(renamed.name, "Basildon Elite");
  assert.deepEqual(renamed.roster.map((member) => member.membership_id), [2, 5, 6]);
  const officialList = await call("get_club_teams", [1, true]);
  assert.equal(officialList.can_manage, true);

  await expectError(() => createUnit({ name: " basildon   elite ", roster: [1, 5, 6] }), /duplicate|already exists/i);
  await call("archive_club_team", [defaultTeam.id]);
  await expectError(() => createUnit({ name: " team 1 ", roster: [1, 5, 6] }), /duplicate|already exists/i);
  const nextDefault = await createUnit({ roster: [1, 5, 6] });
  assert.equal(nextDefault.name, "Team 2");

  const pair = await createUnit({ unitType: "pair", roster: [2, 3] });
  assert.equal(pair.name, "Pair 1");
  assert.equal(pair.fixed_size, 2);

  await actor("member");
  const memberList = await call("get_club_teams", [1, false]);
  assert.deepEqual(memberList.teams.map((team) => team.name), ["Basildon Elite", "Team 2", "Pair 1"]);
  assert.equal(memberList.can_manage, false);
  await expectError(() => createUnit({ name: "Member Team" }), /owner or official/i);
  await expectError(() => call("rename_club_team", [defaultTeam.id, "Member Rename"]), /owner or official/i);
  await expectError(
    () => call("update_club_team", [namedTeam.id, "Member Edit", "team", [2, 5, 6]]),
    /owner or official/i,
  );

  await actor("organisationOwner");
  await expectError(() => call("get_club_teams", [1, true]), /active membership/i);
  await expectError(() => createUnit({ name: "Organisation Team" }), /owner or official/i);
  const leaked = await db.query("select id from public.club_teams order by id");
  assert.equal(leaked.rows.length, 0);

  await actor("anon");
  await expectError(() => call("get_club_teams", [1, true]), /permission denied/i);
  await expectError(() => createUnit({ name: "Anonymous Team" }), /permission denied/i);
});

test("Club Team read RPC retains its exact hardened callable contract", async () => {
  const metadata = (await admin(`select
      p.oid::regprocedure::text as signature,
      p.prosecdef,
      p.provolatile,
      p.proconfig,
      pg_get_functiondef(p.oid) as definition,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
      has_function_privilege('anon', p.oid, 'execute') as anon_execute
    from pg_proc as p
    where p.oid = 'public.get_club_teams(bigint,boolean)'::regprocedure`)).rows[0];

  assert.equal(metadata.signature, "get_club_teams(bigint,boolean)");
  assert.equal(metadata.prosecdef, true);
  assert.equal(metadata.provolatile, "v");
  assert.match(String(metadata.proconfig), /search_path=/);
  assert.equal(metadata.authenticated_execute, true);
  assert.equal(metadata.anon_execute, false);
  assert.match(metadata.definition, /private\.require_club_team_member\(p_club_id, false\)/);
  assert.match(metadata.definition, /public\.club_teams/);
  assert.match(metadata.definition, /public\.competition_entrants/);
  assert.match(metadata.definition, /public\.club_competition_entries/);

  const authority = (await admin(`select pg_get_functiondef(
    'private.require_club_team_member(bigint,boolean)'::regprocedure
  ) as definition`)).rows[0].definition;
  assert.match(authority, /auth\.uid\(\)/);
  assert.match(authority, /membership\.role in \('owner', 'official'\)/);
  assert.match(authority, /membership\.status = 'active'/);
});

test("Pair and Team creation requires a complete active same-Club roster and fixed compatible size", async () => {
  await expectError(
    () => createUnit({ unitType: "pair", roster: [1, 2, 3] }),
    /exactly 2/i,
  );
  await expectError(
    () => createUnit({ unitType: "team", roster: [1, 2] }),
    /between 3 and 20/i,
  );
  await expectError(
    () => createUnit({ unitType: "team", roster: [1, 1, 3] }),
    /cannot appear twice/i,
  );
  await expectError(
    () => createUnit({ unitType: "team", roster: [1, 2, 4] }),
    /active member of this Club/i,
  );
  await expectError(
    () => createUnit({ unitType: "team", roster: [1, 2, 10] }),
    /active member of this Club/i,
  );

  const pair = await createUnit({ name: "Pair A", unitType: "pair", roster: [1, 2] });
  const pairSave = await call("save_club_competition_entry", [2, JSON.stringify([
    { club_team_id: pair.id, participants: [5, 6] },
  ])]);
  assert.equal(pairSave.participant_count, 2);
  let pairEntry = await call("get_club_competition_entry_management", [2]);
  assert.deepEqual(pairEntry.entrants[0].participants.map((participant) => participant.membership_id), [1, 2]);
  await call("submit_club_competition_entry", [2]);
  await call("rename_club_team", [pair.id, "Pair Renamed"]);
  pairEntry = await call("get_club_competition_entry_management", [2]);
  assert.equal(pairEntry.entrants[0].entrant_label, "Pair A");
  const pairResults = await call("get_competition_round_results", [1, 1, 2, 1]);
  assert.equal(pairResults.rounds[0].entrants[0].entrant_label, "Pair A");
  const pairShooting = await call("get_my_shooting_competitions");
  assert.equal(
    pairShooting.competitions.find((row) => row.competition.id === 2).entrant_label,
    "Pair A",
  );

  const three = await createUnit({ name: "Three", roster: [1, 2, 3] });
  await expectError(
    () => call("save_club_competition_entry", [5, JSON.stringify([{ club_team_id: three.id }])]),
    /not compatible/i,
  );
  const five = await createUnit({ name: "Five", roster: [1, 2, 3, 5, 6] });
  assert.equal(five.fixed_size, 5);
  const fiveSave = await call("save_club_competition_entry", [5, JSON.stringify([{ club_team_id: five.id }])]);
  assert.equal(fiveSave.participant_count, 5);

  const incomplete = (await admin(`insert into club_teams(
      club_id,name,display_order,created_by,updated_by
    ) values(1,'Existing V1 Team',100,$1,$1) returning id`, [actors.owner])).rows[0];
  const listed = await call("get_club_teams", [1, true]);
  assert.equal(listed.teams.find((unit) => unit.id === incomplete.id).is_complete, false);
  await expectError(
    () => call("save_club_competition_entry", [6, JSON.stringify([{ club_team_id: incomplete.id }])]),
    /not compatible/i,
  );
  const completed = await call("update_club_team", [incomplete.id, "Existing V1 Team", "team", [1, 2, 3]]);
  assert.equal(completed.is_complete, true);
  await call("save_club_competition_entry", [6, JSON.stringify([{ club_team_id: incomplete.id }])]);
  await expectError(
    () => call("update_club_team", [incomplete.id, "Existing V1 Team", "team", [1, 2, 3, 5]]),
    /size cannot be changed/i,
  );
  await expectError(async () => {
    await admin("delete from club_team_roster_members where club_team_id=$1 and position=3", [incomplete.id]);
    await admin("set constraints validate_club_team_roster_complete_from_member immediate");
  }, /exactly 3 current roster members/i);
});

test("database constraints enforce Club ownership, Pair/Team compatibility, uniqueness and archive state", async () => {
  const sameClub = await createUnit({ name: "Basildon A" });
  const sameClubPair = await createUnit({ name: "Basildon Pair A", unitType: "pair", roster: [1, 2] });
  await actor("otherOwner");
  const otherClub = await createUnit({ name: "Riverside A", clubId: 2, roster: [4, 8, 9] });

  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(1,1,$1)", [otherClub.id]),
    /different club/i,
  );
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(2,1,$1)", [sameClub.id]),
    /not compatible/i,
  );
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(1,1,$1)", [sameClubPair.id]),
    /not compatible/i,
  );
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(3,1,$1)", [sameClub.id]),
    /matching Pair\/Team/i,
  );

  const linked = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position,club_team_id,club_team_name_snapshot
  ) values(1,1,$1,'Untrusted client value') returning club_team_name_snapshot`, [sameClub.id])).rows[0];
  assert.equal(linked.club_team_name_snapshot, "Basildon A");
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(1,2,$1)", [sameClub.id]),
    /duplicate key|unique constraint/i,
  );

  const pairLinked = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position,club_team_id
  ) values(2,1,$1) returning club_team_name_snapshot`, [sameClubPair.id])).rows[0];
  assert.equal(pairLinked.club_team_name_snapshot, "Basildon Pair A");

  await admin("insert into competition_entrants(club_competition_entry_id,position) values(1,2),(2,2),(3,1)");
  await actor("otherOwner");
  await call("archive_club_team", [otherClub.id]);
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(4,1,$1)", [otherClub.id]),
    /archived/i,
  );
});

test("linked saves derive current rosters while submitted snapshots remain historical", async () => {
  const team = await createUnit({ name: "Basildon A", roster: [1, 2, 3] });
  const payload = [
    { club_team_id: team.id, participants: [5, 6, 7] },
    { club_team_id: null, participants: [5, 6, 7] },
  ];

  const draft = await call("save_club_competition_entry", [1, JSON.stringify(payload)]);
  assert.equal(draft.status, "draft");
  assert.equal(draft.participant_count, 6);
  let management = await call("get_club_competition_entry_management", [1]);
  assert.equal(management.entrants[0].club_team_id, team.id);
  assert.equal(management.entrants[0].entrant_label, "Basildon A");
  assert.deepEqual(management.entrants[0].participants.map((participant) => participant.membership_id), [1, 2, 3]);
  assert.equal(management.entrants[1].entrant_label, "Team 2");

  await call("update_club_team", [team.id, "Basildon Elite", "team", [1, 2, 11]]);
  await call("save_club_competition_entry", [1, JSON.stringify([{ club_team_id: team.id }, payload[1]])]);
  management = await call("get_club_competition_entry_management", [1]);
  assert.equal(management.entrants[0].club_team_name_snapshot, "Basildon Elite");
  assert.deepEqual(management.entrants[0].participants.map((participant) => participant.membership_id), [1, 2, 11]);

  const submitted = await call("save_and_submit_club_competition_entry", [1, JSON.stringify([
    { club_team_id: team.id },
    payload[1],
  ])]);
  assert.equal(submitted.status, "submitted");
  await call("update_club_team", [team.id, "Basildon Renamed", "team", [1, 2, 12]]);

  const later = await call("save_club_competition_entry", [6, JSON.stringify([{ club_team_id: team.id }])]);
  assert.equal(later.participant_count, 3);
  const laterManagement = await call("get_club_competition_entry_management", [6]);
  assert.equal(laterManagement.entrants[0].entrant_label, "Basildon Renamed");
  assert.deepEqual(
    laterManagement.entrants[0].participants.map((participant) => participant.membership_id),
    [1, 2, 12],
  );
  await call("submit_club_competition_entry", [6]);

  const archived = await call("archive_club_team", [team.id]);
  assert.ok(archived.archived_at);

  management = await call("get_club_competition_entry_management", [1]);
  assert.equal(management.entrants[0].club_team_name_snapshot, "Basildon Elite");
  assert.equal(management.entrants[0].entrant_label, "Basildon Elite");
  assert.deepEqual(management.entrants[0].participants.map((participant) => participant.membership_id), [1, 2, 11]);

  const linkedEntrantId = management.entrants[0].id;
  const unlinkedEntrantId = management.entrants[1].id;
  await admin(`insert into competition_division_configs(
    competition_id,target_size,status,published_at
  ) values(1,10,'published',now())`);
  await admin(`insert into competition_divisions(id,competition_id,name,position)
    overriding system value values(1,1,'Division One',1)`);
  await admin(`insert into competition_division_assignments(
    competition_entrant_id,competition_id,competition_division_id
  ) values($1,1,1),($2,1,1)`, [linkedEntrantId, unlinkedEntrantId]);

  const activeTeams = await call("get_club_teams", [1, false]);
  assert.equal(activeTeams.teams.some((row) => row.id === team.id), false);
  const allTeams = await call("get_club_teams", [1, true]);
  assert.equal(allTeams.teams.find((row) => row.id === team.id).submitted_usage_count, 2);

  const results = await call("get_competition_round_results", [1, 1, 1, 1]);
  assert.deepEqual(results.rounds[0].entrants.map((entrant) => entrant.entrant_label), ["Basildon Elite", "Team 2"]);
  const aggregate = await call("get_competition_aggregate_results", [1, 1, 1]);
  assert.deepEqual(aggregate.groups[0].entrants.map((entrant) => entrant.entrant_label), ["Basildon Elite", "Team 2"]);

  const publishedDivisions = await call("get_published_competition_divisions", [1]);
  assert.deepEqual(
    publishedDivisions.divisions[0].entrants.map((entrant) => entrant.entrant_label),
    ["Basildon Elite", "Team 2"],
  );

  await actor("organisationOwner");
  const divisions = await call("get_competition_division_management", [1, 1, 1]);
  assert.deepEqual(divisions.entrants.map((entrant) => entrant.entrant_label), ["Basildon Elite", "Team 2"]);

  await actor("owner");
  const myShooting = await call("get_my_shooting_competitions");
  const historicalShooting = myShooting.competitions.find((row) => row.competition.id === 1);
  assert.equal(historicalShooting.entrant_label, "Basildon Elite");
  assert.equal(historicalShooting.club_team_id, team.id);
});

test("draft references block archive, duplicate selections fail clearly, and archived Teams can be unarchived", async () => {
  const team = await createUnit({ name: "Draft Team" });
  const payload = [{ club_team_id: team.id }];
  await call("save_club_competition_entry", [1, JSON.stringify(payload)]);
  await expectError(() => call("archive_club_team", [team.id]), /draft Competition entry/i);

  await expectError(
    () => call("save_club_competition_entry", [1, JSON.stringify([
      { club_team_id: team.id },
      { club_team_id: team.id },
    ])]),
    /only be used once/i,
  );

  await call("save_club_competition_entry", [1, JSON.stringify([
    { club_team_id: null, participants: [1, 2, 3] },
  ])]);
  await call("archive_club_team", [team.id]);
  await expectError(
    () => call("save_club_competition_entry", [1, JSON.stringify(payload)]),
    /archived/i,
  );
  const restored = await call("unarchive_club_team", [team.id]);
  assert.equal(restored.archived_at, null);
  await call("save_club_competition_entry", [1, JSON.stringify(payload)]);
  const submitted = await call("submit_club_competition_entry", [1]);
  assert.equal(submitted.status, "submitted");
  const linked = (await admin(`select club_team_id, club_team_name_snapshot
    from competition_entrants where club_competition_entry_id=1`)).rows[0];
  assert.equal(linked.club_team_id, team.id);
  assert.equal(linked.club_team_name_snapshot, "Draft Team");
});

test("legacy save payloads remain valid and the canonical Club Team schema is complete", async () => {
  const legacy = await call("save_club_competition_entry", [2, JSON.stringify([[1, 2]])]);
  assert.equal(legacy.status, "draft");
  const row = (await admin(`select club_team_id, club_team_name_snapshot
    from competition_entrants where club_competition_entry_id=2`)).rows[0];
  assert.equal(row.club_team_id, null);
  assert.equal(row.club_team_name_snapshot, null);

  const isolated = new PGlite();
  try {
    await installCanonicalDatabase(isolated);
    const columns = await isolated.query(`select column_name
      from information_schema.columns
      where table_schema='public' and table_name='competition_entrants'
        and column_name in ('club_team_id','club_team_name_snapshot')
      order by column_name`);
    assert.deepEqual(columns.rows.map((column) => column.column_name), [
      "club_team_id",
      "club_team_name_snapshot",
    ]);
    const teamColumns = await isolated.query(`select column_name
      from information_schema.columns
      where table_schema='public' and table_name='club_teams'
        and column_name in ('unit_type','fixed_size')
      order by column_name`);
    assert.deepEqual(teamColumns.rows.map((column) => column.column_name), ["fixed_size", "unit_type"]);
    const rosterTable = await isolated.query(`select to_regclass('public.club_team_roster_members') as relation`);
    assert.equal(rosterTable.rows[0].relation, "club_team_roster_members");
    const entryFunctions = await isolated.query(`select proname,
        pg_get_function_identity_arguments(oid) as arguments,
        pg_get_functiondef(oid) as definition
      from pg_proc
      where pronamespace='public'::regnamespace
        and proname in (
          'save_club_competition_entry',
          'submit_club_competition_entry',
          'save_and_submit_club_competition_entry'
        )
      order by proname`);
    assert.equal(entryFunctions.rows.length, 3);
    assert.deepEqual(entryFunctions.rows.map((fn) => fn.arguments), [
      "p_club_competition_entry_id bigint, p_entrants jsonb",
      "p_club_competition_entry_id bigint, p_entrants jsonb",
      "p_club_competition_entry_id bigint",
    ]);
    assert.match(
      entryFunctions.rows.find((fn) => fn.proname === "save_club_competition_entry").definition,
      /club_team_id/,
    );
    assert.match(
      entryFunctions.rows.find((fn) => fn.proname === "submit_club_competition_entry").definition,
      /club_team_name_snapshot/,
    );
    const mutationFunctions = await isolated.query(`select oid::regprocedure::text as signature
      from pg_proc
      where oid in (
        'public.create_club_team(bigint,text,text,bigint[])'::regprocedure,
        'public.update_club_team(bigint,text,text,bigint[])'::regprocedure
      ) order by signature`);
    assert.deepEqual(mutationFunctions.rows.map((row) => row.signature), [
      "create_club_team(bigint,text,text,bigint[])",
      "update_club_team(bigint,text,text,bigint[])",
    ]);
  } finally {
    await isolated.close();
  }
});

test("UI and schema expose current Pair/Team rosters without changing scoring or average ownership", async () => {
  const [schema, editor, manager, frame, results, averages, concurrent] = await Promise.all([
    readFile(new URL("../database/03_clubs.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/components/competition-entry-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/club-teams-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/club-page-frame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../database/10_results.sql", import.meta.url), "utf8"),
    readFile(new URL("../database/13_averages.sql", import.meta.url), "utf8"),
    readFile(new URL("../database/15_concurrent_shooting.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /club_team_id bigint/);
  assert.match(schema, /club_team_name_snapshot/);
  assert.match(schema, /create table "public"\."club_team_roster_members"/);
  assert.match(schema, /unit_type text/);
  assert.match(schema, /fixed_size integer/);
  assert.doesNotMatch(schema, /organisation_id.*club_teams/i);
  assert.match(editor, /Select Club \{formatLabel\(format\)\}/);
  assert.match(editor, /current roster is copied/i);
  assert.match(editor, /Manage Club Pairs and Teams/);
  assert.doesNotMatch(editor, /Create new Club Team|Continue without a persistent Team/);
  assert.match(manager, /ConfirmationDialog/);
  assert.match(manager, /Pair/);
  assert.match(manager, /Team/);
  assert.match(manager, /Current shooters/);
  assert.doesNotMatch(manager, /window\.confirm|\bconfirm\s*\(/);
  assert.match(frame, /id: "teams", label: "Teams"/);
  assert.match(results, /shooting_score_source_id/);
  assert.doesNotMatch(averages, /club_team_id|club_team_name_snapshot/);
  assert.doesNotMatch(concurrent, /club_team_id|club_team_name_snapshot/);
});
