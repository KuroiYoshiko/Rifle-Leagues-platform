import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";

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

async function createTeam(name = null, clubId = 1) {
  return call("create_club_team", [clubId, name]);
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
    (7,1,$7,'active','member')`, [
    actors.owner,
    actors.official,
    actors.member,
    actors.otherOwner,
    actors.fourth,
    actors.fifth,
    actors.sixth,
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
       'season_default','season_default',1,'aggregate',false);
    insert into competition_rounds(competition_id,round_number,deadline,shoot_by_date)
      values(1,1,current_date+40,current_date+38);
    insert into competition_score_components(
      competition_id,position,short_label,maximum_score,score_method
    ) values(1,1,'Score',100,'points_scored');
    update competitions set status='published';
    insert into club_competition_entries(
      id,competition_id,club_id,status
    ) overriding system value values
      (1,1,1,'draft'),
      (2,2,1,'draft'),
      (3,3,1,'draft'),
      (4,4,2,'draft');
  `);
  await actor("owner");
});

afterEach(async () => db.exec("rollback; reset role"));

test("active owners and officials manage Club Teams; members and organisation staff alone cannot", async () => {
  const defaultTeam = await createTeam();
  assert.equal(defaultTeam.name, "Team 1");

  await actor("official");
  const namedTeam = await createTeam("  Basildon   A  ");
  assert.equal(namedTeam.name, "Basildon A");
  const renamed = await call("rename_club_team", [namedTeam.id, "Basildon Elite"]);
  assert.equal(renamed.name, "Basildon Elite");

  await expectError(() => createTeam(" basildon   elite "), /already exists/i);
  await call("archive_club_team", [defaultTeam.id]);
  await expectError(() => createTeam(" team 1 "), /already exists/i);
  const nextDefault = await createTeam();
  assert.equal(nextDefault.name, "Team 2");

  await actor("member");
  const memberList = await call("get_club_teams", [1, false]);
  assert.deepEqual(memberList.teams.map((team) => team.name), ["Basildon Elite", "Team 2"]);
  assert.equal(memberList.can_manage, false);
  await expectError(() => createTeam("Member Team"), /owner or official/i);
  await expectError(() => call("rename_club_team", [defaultTeam.id, "Member Rename"]), /owner or official/i);

  await actor("organisationOwner");
  await expectError(() => createTeam("Organisation Team"), /owner or official/i);
  const leaked = await db.query("select id from public.club_teams order by id");
  assert.equal(leaked.rows.length, 0);
});

test("database constraints reject cross-Club, non-Team, duplicate and archived links while preserving unlinked entrants", async () => {
  const sameClub = await createTeam("Basildon A");
  await actor("otherOwner");
  const otherClub = await createTeam("Riverside A", 2);

  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(1,1,$1)", [otherClub.id]),
    /different club/i,
  );
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(2,1,$1)", [sameClub.id]),
    /only be linked to Team-format/i,
  );
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(3,1,$1)", [sameClub.id]),
    /only be linked to Team-format/i,
  );

  const linked = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position,club_team_id,club_team_name_snapshot
  ) values(1,1,$1,'Untrusted client value') returning club_team_name_snapshot`, [sameClub.id])).rows[0];
  assert.equal(linked.club_team_name_snapshot, "Basildon A");
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(1,2,$1)", [sameClub.id]),
    /duplicate key|unique constraint/i,
  );

  await admin("insert into competition_entrants(club_competition_entry_id,position) values(1,2),(2,1),(3,1)");
  await actor("otherOwner");
  await call("archive_club_team", [otherClub.id]);
  await expectError(
    () => admin("insert into competition_entrants(club_competition_entry_id,position,club_team_id) values(4,1,$1)", [otherClub.id]),
    /archived/i,
  );
});

test("complete Team saves preserve identity and roster slots, snapshots freeze on submit, and read models expose the historical label", async () => {
  const team = await createTeam("Basildon A");
  const payload = [
    { club_team_id: team.id, participants: [1, 2, 3] },
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

  await call("rename_club_team", [team.id, "Basildon Elite"]);
  await call("save_club_competition_entry", [1, JSON.stringify(payload)]);
  management = await call("get_club_competition_entry_management", [1]);
  assert.equal(management.entrants[0].club_team_name_snapshot, "Basildon Elite");
  assert.equal(management.entrants[0].participants.length, 3);

  const submitted = await call("save_and_submit_club_competition_entry", [1, JSON.stringify(payload)]);
  assert.equal(submitted.status, "submitted");
  await call("rename_club_team", [team.id, "Basildon Renamed"]);
  const archived = await call("archive_club_team", [team.id]);
  assert.ok(archived.archived_at);

  management = await call("get_club_competition_entry_management", [1]);
  assert.equal(management.entrants[0].club_team_name_snapshot, "Basildon Elite");
  assert.equal(management.entrants[0].entrant_label, "Basildon Elite");

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
  assert.equal(allTeams.teams.find((row) => row.id === team.id).submitted_usage_count, 1);

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
  assert.equal(myShooting.competitions[0].entrant_label, "Basildon Elite");
  assert.equal(myShooting.competitions[0].club_team_id, team.id);
});

test("draft references block archive, duplicate selections fail clearly, and archived Teams can be unarchived", async () => {
  const team = await createTeam("Draft Team");
  const payload = [{ club_team_id: team.id, participants: [1, 2, 3] }];
  await call("save_club_competition_entry", [1, JSON.stringify(payload)]);
  await expectError(() => call("archive_club_team", [team.id]), /draft Competition entry/i);

  await expectError(
    () => call("save_club_competition_entry", [1, JSON.stringify([
      { club_team_id: team.id, participants: [1, 2, 3] },
      { club_team_id: team.id, participants: [5, 6, 7] },
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

test("legacy save payloads remain valid and the canonical Club Team schema is rerunnable", async () => {
  const legacy = await call("save_club_competition_entry", [2, JSON.stringify([[1, 2]])]);
  assert.equal(legacy.status, "draft");
  const row = (await admin(`select club_team_id, club_team_name_snapshot
    from competition_entrants where club_competition_entry_id=2`)).rows[0];
  assert.equal(row.club_team_id, null);
  assert.equal(row.club_team_name_snapshot, null);

  const isolated = new PGlite();
  try {
    await installCanonicalDatabase(isolated);
    await isolated.exec(await sqlFile("club-teams"));
    const columns = await isolated.query(`select column_name
      from information_schema.columns
      where table_schema='public' and table_name='competition_entrants'
        and column_name in ('club_team_id','club_team_name_snapshot')
      order by column_name`);
    assert.deepEqual(columns.rows.map((column) => column.column_name), [
      "club_team_id",
      "club_team_name_snapshot",
    ]);
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
  } finally {
    await isolated.close();
  }
});

test("UI and schema keep Teams descriptive, Team-only, roster-free and dialog-driven", async () => {
  const [schema, editor, manager, frame, results, averages, concurrent] = await Promise.all([
    readFile(new URL("../database/club-teams.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/components/competition-entry-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/club-teams-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/club-page-frame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../database/competition-results.sql", import.meta.url), "utf8"),
    readFile(new URL("../database/competition-averages.sql", import.meta.url), "utf8"),
    readFile(new URL("../database/concurrent-shooting.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /club_team_id bigint/);
  assert.match(schema, /club_team_name_snapshot/);
  assert.doesNotMatch(schema, /club_team_members|club_team_roster|organisation_id.*club_teams/i);
  assert.match(editor, /Use existing Club Team/);
  assert.match(editor, /Continue without a persistent Team/);
  assert.match(editor, /Create new Club Team/);
  assert.doesNotMatch(editor, /copy.*roster|last roster/i);
  assert.match(manager, /ConfirmationDialog/);
  assert.doesNotMatch(manager, /window\.confirm|\bconfirm\s*\(/);
  assert.match(frame, /id: "teams", label: "Teams"/);
  assert.match(results, /shooting_score_source_id/);
  assert.doesNotMatch(averages, /club_team_id|club_team_name_snapshot/);
  assert.doesNotMatch(concurrent, /club_team_id|club_team_name_snapshot/);
});
