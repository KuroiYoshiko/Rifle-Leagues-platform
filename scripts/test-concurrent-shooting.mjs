import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";

const db = new PGlite();
const actors = Object.fromEntries(
  ["owner", "manager", "normal", "foreignOwner"].map((role, index) => [
    role,
    `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

before(async () => installCanonicalDatabase(db, { concurrentShooting: true }));
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`begin;
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'Organisation One','organisation-one','active'),
      (2,'Organisation Two','organisation-two','active');
    insert into league_seasons(
      id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (1,1,'Season One','season-one','draft',current_date+1,current_date+10,current_date+20,current_date+365),
      (2,1,'Season Two','season-two','draft',current_date+1,current_date+10,current_date+20,current_date+365),
      (3,2,'Foreign Season','foreign-season','draft',current_date+1,current_date+10,current_date+20,current_date+365);
    insert into clubs(id,name,slug,status) overriding system value values
      (1,'Test Club','test-club','active');
  `);
  for (const id of Object.values(actors)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
  }
  await db.query(`insert into organisation_staff(organisation_id,user_id,role,status) values
    (1,$1,'owner','active'),(1,$2,'manager','active'),(2,$3,'owner','active')`,
  [actors.owner, actors.manager, actors.foreignOwner]);
  await db.query("insert into club_memberships(club_id,user_id,role,status) values(1,$1,'member','active')", [actors.normal]);
  await db.query("insert into user_organisations(user_id,organisation_id) values($1,1)", [actors.normal]);
  await actor("owner");
});
afterEach(async () => db.exec("rollback; reset role"));

async function actor(role) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actors[role] ?? ""]);
  await db.exec(`set role ${role === "anon" ? "anon" : "authenticated"}`);
}

async function admin(sql, params = []) {
  await db.exec("reset role");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("set role authenticated");
  }
}

async function flush() {
  await db.exec("set constraints all immediate; set constraints all deferred");
}

async function rejected(sql, params, pattern) {
  await db.exec("savepoint expected_failure");
  try {
    await assert.rejects(async () => {
      await db.query(sql, params);
      await flush();
    }, pattern);
  } finally {
    await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
  }
}

async function adminRejected(sql, params, pattern) {
  await db.exec("reset role; savepoint expected_admin_failure");
  try {
    await assert.rejects(async () => {
      await db.query(sql, params);
      await flush();
    }, pattern);
  } finally {
    await db.exec("rollback to savepoint expected_admin_failure; release savepoint expected_admin_failure; set role authenticated");
  }
}

async function futureDates(count, offset = 30) {
  return (await admin(
    "select array_agg((current_date+$2::integer+value)::text order by value) dates from generate_series(1,$1::integer) value",
    [count, offset],
  )).rows[0].dates;
}

async function createCompetition({
  org = 1,
  season = 1,
  name,
  entryFormat = "individual",
  teamSize = entryFormat === "individual" ? 1 : entryFormat === "pairs" ? 2 : 4,
  setsPerRound = 1,
  shotsPerRound = 10,
  usesX = false,
  rounds = 2,
  components = [{ short_label: "P", maximum_score: 100, score_method: "points_scored" }],
} = {}) {
  const deadlines = await futureDates(rounds);
  return (await db.query(`select public.create_competition(
      $1,$2,$3,null,$4,$5,$6,$7,$8,0,
      'season_default',null,null,'season_default',null,$9,$10,
      'aggregate',null,true,$11,array[]::date[]
    ) data`, [org, season, name, entryFormat, teamSize, shotsPerRound, usesX,
    rounds, setsPerRound, components, deadlines])).rows[0].data;
}

async function publish(competition, { org = 1, season = 1 } = {}) {
  await db.query("select public.publish_competition($1,$2,$3)", [org, season, competition.id]);
  await flush();
}

async function createGroup(name = "Concurrent group", { org = 1, season = 1 } = {}) {
  return (await db.query(
    "select public.create_concurrent_shooting_group($1,$2,$3) data",
    [org, season, name],
  )).rows[0].data;
}

async function add(group, competition, org = 1) {
  return (await db.query(
    "select public.add_concurrent_shooting_group_competition($1,$2,$3) data",
    [org, group.id, competition.id],
  )).rows[0].data;
}

async function physicalRound(group, position = 1, label = null) {
  return (await db.query(
    "select public.create_concurrent_shooting_round(1,$1,$2,$3) id",
    [group.id, position, label],
  )).rows[0].id;
}

async function competitionRound(competition, number) {
  return (await admin(
    "select id from competition_rounds where competition_id=$1 and round_number=$2",
    [competition.id, number],
  )).rows[0].id;
}

async function map(group, physicalId, competition, number) {
  await db.query(
    "select public.add_concurrent_shooting_round_mapping(1,$1,$2,$3,$4)",
    [group.id, physicalId, competition.id, await competitionRound(competition, number)],
  );
}

async function prepareValidGroup({ formats = ["individual", "pairs"], rounds = [2, 2] } = {}) {
  const competitions = [];
  for (let index = 0; index < formats.length; index += 1) {
    competitions.push(await createCompetition({
      name: `Competition ${index + 1}`,
      entryFormat: formats[index],
      rounds: rounds[index],
    }));
  }
  const group = await createGroup();
  for (const competition of competitions) await add(group, competition);
  const physicalId = await physicalRound(group, 1, "Opening shoot");
  for (const competition of competitions) await map(group, physicalId, competition, 1);
  return { group, competitions, physicalId };
}

test("owner and manager prepare Draft groups; ordinary and cross-Organisation actors are rejected", async () => {
  const ownerGroup = await createGroup("Owner group");
  await db.query("select public.rename_concurrent_shooting_group(1,$1,'Owner renamed')", [ownerGroup.id]);
  await actor("manager");
  const managerGroup = await createGroup("Manager group");
  assert.equal(managerGroup.status, "draft");
  await db.query("select public.rename_concurrent_shooting_group(1,$1,'Manager renamed')", [managerGroup.id]);
  const groups = (await db.query(
    "select public.list_concurrent_shooting_groups(1,1) data",
  )).rows[0].data;
  assert.equal(groups.some((item) => item.id === managerGroup.id), true);
  const details = (await db.query(
    "select public.get_concurrent_shooting_group_management(1,$1) data", [managerGroup.id],
  )).rows[0].data;
  assert.equal(details.group.name, "Manager renamed");
  await db.query("select public.delete_draft_concurrent_shooting_group(1,$1)", [managerGroup.id]);
  assert.equal((await admin(
    "select count(*)::int n from concurrent_shooting_groups where id=$1", [managerGroup.id],
  )).rows[0].n, 0);

  await actor("normal");
  await rejected(
    "select public.create_concurrent_shooting_group(1,1,'Denied')",
    [], /contextual Organisation author permission/,
  );
  await rejected("select * from public.concurrent_shooting_groups", [], /permission denied/);

  await actor("foreignOwner");
  await rejected(
    "select public.rename_concurrent_shooting_group(1,$1,'Foreign edit')",
    [ownerGroup.id], /contextual Organisation author permission/,
  );
  await actor("anon");
  await rejected(
    "select public.list_concurrent_shooting_groups(1,null)", [], /permission denied/,
  );
});

test("management surfaces are hardened SECURITY DEFINER RPCs and all foundation tables deny direct API access", async () => {
  const unsafe = (await admin(`select procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname like '%concurrent_shooting%'
      and (not procedure.prosecdef or not coalesce(procedure.proconfig,'{}') @> array['search_path=""'])`)).rows;
  assert.deepEqual(unsafe, []);
  const tables = [
    "concurrent_shooting_groups",
    "concurrent_shooting_group_competitions",
    "concurrent_shooting_rounds",
    "concurrent_shooting_round_mappings",
    "shooting_score_change_events",
  ];
  for (const table of tables) {
    const security = (await admin(`select class.relrowsecurity rls,
      has_table_privilege('authenticated',$1,'select') can_select,
      has_table_privilege('authenticated',$1,'insert') can_insert
      from pg_class class join pg_namespace namespace on namespace.oid=class.relnamespace
      where namespace.nspname='public' and class.relname=$2`, [`public.${table}`, table])).rows[0];
    assert.deepEqual(security, { rls: true, can_select: false, can_insert: false });
  }
});

test("one Competition belongs to at most one group and existing data is not linked", async () => {
  const competition = await createCompetition({ name: "Single member" });
  const first = await createGroup("First group");
  const second = await createGroup("Second group");
  await add(first, competition);
  await rejected(
    "select public.add_concurrent_shooting_group_competition(1,$1,$2)",
    [second.id, competition.id], /already belongs/,
  );
  assert.equal((await admin(
    "select count(*)::int n from concurrent_shooting_group_competitions",
  )).rows[0].n, 1);
  assert.equal((await admin(
    "select count(*)::int n from shooting_score_sources where concurrent_shooting_round_id is not null",
  )).rows[0].n, 0);
});

test("strict compatibility accepts identical formats and rejects every approved identity mismatch", async () => {
  const base = await createCompetition({ name: "Base" });
  const identical = await createCompetition({ name: "Identical", entryFormat: "team", teamSize: 3 });
  const group = await createGroup();
  const accepted = await add(group, base);
  await add(group, identical);
  assert.equal(accepted.compatibility_signature.version, 1);
  assert.equal(accepted.compatibility_signature.shooter_maximum, 100);

  const mismatchCases = [
    ["Same Ex different shape", { components: [
      { short_label: "P", maximum_score: 50, score_method: "points_scored" },
      { short_label: "S", maximum_score: 50, score_method: "points_scored" },
    ] }, /components/],
    ["Label mismatch", { components: [
      { short_label: "K", maximum_score: 100, score_method: "points_scored" },
    ] }, /components/],
    ["Method mismatch", { components: [
      { short_label: "P", maximum_score: 100, score_method: "points_dropped" },
    ] }, /components/],
    ["X mismatch", { usesX: true }, /uses_x_score/],
    ["Shots mismatch", { shotsPerRound: 20 }, /shots_per_round/],
    ["Sets mismatch", { setsPerRound: 2 }, /sets_per_round/],
  ];
  for (const [name, values, error] of mismatchCases) {
    const candidate = await createCompetition({ name, ...values });
    await rejected(
      "select public.add_concurrent_shooting_group_competition(1,$1,$2)",
      [group.id, candidate.id], error,
    );
  }
});

test("same Organisation and Season are enforced while Individual, Pair and Team can share", async () => {
  const formats = ["individual", "pairs", "team"];
  const competitions = [];
  for (const format of formats) {
    competitions.push(await createCompetition({
      name: `${format} Competition`, entryFormat: format,
      teamSize: format === "team" ? 4 : undefined,
    }));
  }
  const group = await createGroup();
  for (const competition of competitions) await add(group, competition);
  assert.equal((await admin(
    "select count(*)::int n from concurrent_shooting_group_competitions where concurrent_shooting_group_id=$1",
    [group.id],
  )).rows[0].n, 3);

  const otherSeason = await createCompetition({ season: 2, name: "Other Season" });
  await rejected(
    "select public.add_concurrent_shooting_group_competition(1,$1,$2)",
    [group.id, otherSeason.id], /Organisation and Season/,
  );
  await actor("foreignOwner");
  const foreign = await createCompetition({ org: 2, season: 3, name: "Foreign" });
  await actor("owner");
  await rejected(
    "select public.add_concurrent_shooting_group_competition(1,$1,$2)",
    [group.id, foreign.id], /Organisation and Season/,
  );
});

test("Round mapping is explicit, permits unequal round counts, and enforces one-to-one slots", async () => {
  const { group, competitions, physicalId } = await prepareValidGroup({ rounds: [3, 2] });
  assert.equal((await admin(
    "select count(*)::int n from concurrent_shooting_round_mappings where concurrent_shooting_group_id=$1",
    [group.id],
  )).rows[0].n, 2);
  const secondPhysical = await physicalRound(group, 2);
  await rejected(
    "select public.add_concurrent_shooting_round_mapping(1,$1,$2,$3,$4)",
    [group.id, physicalId, competitions[0].id, await competitionRound(competitions[0], 2)],
    /duplicate key/,
  );
  await rejected(
    "select public.add_concurrent_shooting_round_mapping(1,$1,$2,$3,$4)",
    [group.id, secondPhysical, competitions[0].id, await competitionRound(competitions[0], 1)],
    /duplicate key/,
  );
  await map(group, secondPhysical, competitions[0], 2);
  assert.equal((await admin(
    "select count(*)::int n from concurrent_shooting_round_mappings where concurrent_shooting_round_id=$1",
    [secondPhysical],
  )).rows[0].n, 1);
  for (const competition of competitions) await publish(competition);
  await rejected(
    "select public.activate_concurrent_shooting_group(1,$1)",
    [group.id], /at least two Competitions/,
  );
});

test("activation is owner-only, atomic, and requires published unstarted mapped Competitions", async () => {
  const { group, competitions } = await prepareValidGroup();
  await rejected(
    "select public.activate_concurrent_shooting_group(1,$1)",
    [group.id], /must be published/,
  );
  for (const competition of competitions) await publish(competition);
  await actor("manager");
  await rejected(
    "select public.activate_concurrent_shooting_group(1,$1)",
    [group.id], /contextual Organisation author permission/,
  );
  await actor("owner");
  const activated = (await db.query(
    "select public.activate_concurrent_shooting_group(1,$1) data", [group.id],
  )).rows[0].data;
  assert.equal(activated.status, "active");
  assert.equal(activated.compatibility_version, 1);
  assert.equal((await admin(
    "select compatibility_signature->>'version' version from concurrent_shooting_groups where id=$1",
    [group.id],
  )).rows[0].version, "1");
});

test("activation rejects started Competitions and mapped score usages", async () => {
  const started = await prepareValidGroup();
  for (const competition of started.competitions) await publish(competition);
  await admin("update league_seasons set starts_at=current_date where id=1");
  await rejected(
    "select public.activate_concurrent_shooting_group(1,$1)",
    [started.group.id], /effective start/,
  );

  await admin("update league_seasons set starts_at=current_date+20 where id=1");
  const competition = started.competitions[0];
  const roundId = await competitionRound(competition, 1);
  const entryId = (await admin(
    "insert into club_competition_entries(competition_id,club_id,status,submitted_at) values($1,1,'submitted',now()) returning id",
    [competition.id],
  )).rows[0].id;
  const entrantId = (await admin(
    "insert into competition_entrants(club_competition_entry_id,position) values($1,1) returning id",
    [entryId],
  )).rows[0].id;
  const participantId = (await admin(`insert into competition_entrant_participants(
      club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
    ) select $1,$2,id,1 from club_memberships where user_id=$3 returning id`,
  [entryId, entrantId, actors.normal])).rows[0].id;
  const sourceId = (await admin(
    "insert into shooting_score_sources(shooter_profile_id) values($1) returning id",
    [actors.normal],
  )).rows[0].id;
  await admin(`insert into competition_score_usages(
    shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id
  ) values($1,$2,$3,$4)`, [sourceId, competition.id, roundId, participantId]);
  await flush();
  await rejected(
    "select public.activate_concurrent_shooting_group(1,$1)",
    [started.group.id], /already has score usage/,
  );
});

test("active configuration blocks relinking, Return to Draft, delete and Course-of-Fire mutation; archive preserves it", async () => {
  const { group, competitions, physicalId } = await prepareValidGroup();
  for (const competition of competitions) await publish(competition);
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [group.id]);
  await rejected(
    "select public.remove_concurrent_shooting_round_mapping(1,$1,$2,$3)",
    [group.id, physicalId, competitions[0].id], /must be draft/,
  );
  await rejected(
    "select public.return_competition_to_draft(1,1,$1)",
    [competitions[0].id], /participation/,
  );
  await rejected(
    "select public.delete_competition(1,1,$1)",
    [competitions[0].id], /participation/,
  );
  await adminRejected(
    "update competition_score_components set short_label='Changed' where competition_id=$1",
    [competitions[0].id], /Concurrent Shooting score components are immutable/,
  );
  await db.query("select public.archive_concurrent_shooting_group(1,$1)", [group.id]);
  const row = (await admin(
    "select status,compatibility_signature is not null signature_kept from concurrent_shooting_groups where id=$1",
    [group.id],
  )).rows[0];
  assert.deepEqual(row, { status: "archived", signature_kept: true });
  assert.equal((await admin(
    "select count(*)::int n from concurrent_shooting_round_mappings where concurrent_shooting_group_id=$1",
    [group.id],
  )).rows[0].n, 2);
});

test("only the owner can cancel/archive and cancellation is allowed only before provenance", async () => {
  const first = await prepareValidGroup();
  for (const competition of first.competitions) await publish(competition);
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [first.group.id]);
  await actor("manager");
  await rejected(
    "select public.cancel_concurrent_shooting_group_activation(1,$1)",
    [first.group.id], /contextual Organisation author permission/,
  );
  await rejected(
    "select public.archive_concurrent_shooting_group(1,$1)",
    [first.group.id], /contextual Organisation author permission/,
  );
  await actor("owner");
  await db.query("select public.cancel_concurrent_shooting_group_activation(1,$1)", [first.group.id]);
  assert.equal((await admin(
    "select status from concurrent_shooting_groups where id=$1", [first.group.id],
  )).rows[0].status, "draft");

  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [first.group.id]);
  await admin(
    "insert into shooting_score_sources(shooter_profile_id,concurrent_shooting_round_id) values($1,$2)",
    [actors.normal, first.physicalId],
  );
  await rejected(
    "select public.cancel_concurrent_shooting_group_activation(1,$1)",
    [first.group.id], /score provenance exists/,
  );
});

test("ordinary and Concurrent source foundations coexist with unique shooter occurrence and monotonic versions", async () => {
  const ordinaryCompetition = await createCompetition({ name: "Ordinary scoring" });
  await publish(ordinaryCompetition);
  await admin("update league_seasons set status='active' where id=1");
  await admin(
    "update competitions set start_date_mode='custom',custom_starts_at=current_date-1 where id=$1",
    [ordinaryCompetition.id],
  );
  const entryId = (await admin(
    "insert into club_competition_entries(competition_id,club_id,status,submitted_at) values($1,1,'submitted',now()) returning id",
    [ordinaryCompetition.id],
  )).rows[0].id;
  const entrantId = (await admin(
    "insert into competition_entrants(club_competition_entry_id,position) values($1,1) returning id",
    [entryId],
  )).rows[0].id;
  const participantId = (await admin(`insert into competition_entrant_participants(
      club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
    ) select $1,$2,id,1 from club_memberships where user_id=$3 returning id`,
  [entryId, entrantId, actors.normal])).rows[0].id;
  await db.query(
    "select public.save_individual_competition_round_scores(1,1,$1,$2,null,$3)",
    [ordinaryCompetition.id, await competitionRound(ordinaryCompetition, 1), [{
      participant_id: participantId,
      values: [{ set_number: 1, component_position: 1, entered_score: "99", x_count: null }],
    }]],
  );
  await flush();
  const ordinary = (await admin(`select source.* from shooting_score_sources source
    join competition_score_usages usage on usage.shooting_score_source_id=source.id
    where usage.competition_id=$1`, [ordinaryCompetition.id])).rows[0];
  assert.equal(ordinary.concurrent_shooting_round_id, null);
  assert.equal(ordinary.version, 1);

  const { group, competitions, physicalId } = await prepareValidGroup();
  for (const competition of competitions) await publish(competition);
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [group.id]);
  await admin(
    "insert into shooting_score_sources(shooter_profile_id,concurrent_shooting_round_id,version) values($1,$2,3)",
    [actors.normal, physicalId],
  );
  await adminRejected(
    "insert into shooting_score_sources(shooter_profile_id,concurrent_shooting_round_id) values($1,$2)",
    [actors.normal, physicalId], /duplicate key/,
  );
  await adminRejected(
    "update shooting_score_sources set version=2 where concurrent_shooting_round_id=$1",
    [physicalId], /version cannot decrease/,
  );
  await admin(
    "update shooting_score_sources set version=4 where concurrent_shooting_round_id=$1",
    [physicalId],
  );
});

test("score change events are generic, append-only, origin-validated and unavailable to normal actors", async () => {
  const sourceId = (await admin(
    "insert into shooting_score_sources(shooter_profile_id) values($1) returning id",
    [actors.normal],
  )).rows[0].id;
  const competition = await createCompetition({ name: "Audit origin" });
  const roundId = await competitionRound(competition, 1);
  const eventId = (await admin(`insert into shooting_score_change_events(
      shooting_score_source_id,actor_id,origin_competition_id,origin_competition_round_id,
      operation,before_state,after_state,reason
    ) values($1,$2,$3,$4,'update','{"values":[]}','{"values":[{"score":99}]}','Correction') returning id`,
  [sourceId, actors.owner, competition.id, roundId])).rows[0].id;

  await adminRejected(
    "update shooting_score_change_events set reason='Rewrite' where id=$1",
    [eventId], /immutable/,
  );
  await adminRejected(
    "delete from shooting_score_change_events where id=$1",
    [eventId], /immutable/,
  );
  const other = await createCompetition({ name: "Wrong audit origin" });
  await adminRejected(`insert into shooting_score_change_events(
      shooting_score_source_id,origin_competition_id,origin_competition_round_id,
      operation,after_state
    ) values($1,$2,$3,'create','{}')`,
  [sourceId, other.id, roundId], /origin Round/);

  await actor("normal");
  await rejected("select * from shooting_score_change_events", [], /permission denied/);
  await rejected(`insert into shooting_score_change_events(
      shooting_score_source_id,operation,after_state
    ) values($1,'create','{}')`, [sourceId], /permission denied/);
});

test("the additive migration is rerunnable", async () => {
  const rerun = new PGlite();
  try {
    await installCanonicalDatabase(rerun);
    const sql = await sqlFile("concurrent-shooting");
    await rerun.exec(sql);
    await rerun.exec(sql);
    assert.equal((await rerun.query(
      "select count(*)::int n from information_schema.tables where table_schema='public' and table_name like 'concurrent_shooting%'",
    )).rows[0].n, 4);
  } finally {
    await rerun.close();
  }
});
