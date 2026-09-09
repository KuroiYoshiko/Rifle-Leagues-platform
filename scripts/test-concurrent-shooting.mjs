import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";

const db = new PGlite();
const actors = Object.fromEntries(
  [
    "owner", "manager", "normal", "foreignOwner", "clubOwner",
    "clubOfficial", "shooter2", "shooter3", "shooter4",
  ].map((role, index) => [
    role,
    `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

before(async () => installCanonicalDatabase(db, { concurrentShootingStage2: true }));
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
      (1,'Test Club','test-club','active'),(2,'Second Club','second-club','active');
  `);
  for (const id of Object.values(actors)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
  }
  await db.query(`insert into organisation_staff(organisation_id,user_id,role,status) values
    (1,$1,'owner','active'),(1,$2,'manager','active'),(2,$3,'owner','active')`,
  [actors.owner, actors.manager, actors.foreignOwner]);
  await db.query(`insert into club_memberships(club_id,user_id,role,status) values
    (1,$1,'member','active'),(2,$1,'member','active'),
    (1,$2,'owner','active'),(1,$3,'official','active'),
    (1,$4,'member','active'),(1,$5,'member','active'),(1,$6,'member','active'),
    (2,$4,'member','active'),(2,$5,'member','active'),(2,$6,'member','active')`,
  [actors.normal, actors.clubOwner, actors.clubOfficial,
    actors.shooter2, actors.shooter3, actors.shooter4]);
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
  await db.exec("reset role; savepoint admin_operation");
  try {
    const result = await db.query(sql, params);
    await db.exec("release savepoint admin_operation; set role authenticated");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint admin_operation; release savepoint admin_operation; set role authenticated");
    throw error;
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
  localScoring = true,
  components = [{ short_label: "P", maximum_score: 100, score_method: "points_scored" }],
} = {}) {
  const deadlines = await futureDates(rounds);
  return (await db.query(`select public.create_competition(
      $1,$2,$3,null,$4,$5,$6,$7,$8,0,
      'season_default',null,null,'season_default',null,$9,$10,
      'aggregate',null,$12,$11,array[]::date[]
    ) data`, [org, season, name, entryFormat, teamSize, shotsPerRound, usesX,
    rounds, setsPerRound, components, deadlines, localScoring])).rows[0].data;
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

let stage2FixtureSequence = 0;

async function addSubmittedEntrant(competition, shooterIds, club = 1) {
  const entryId = (await admin(
    "insert into club_competition_entries(competition_id,club_id,status) values($1,$2,'draft') returning id",
    [competition.id, club],
  )).rows[0].id;
  const entrantId = (await admin(
    "insert into competition_entrants(club_competition_entry_id,position) values($1,1) returning id",
    [entryId],
  )).rows[0].id;
  const participantIds = [];
  for (const [index, shooterId] of shooterIds.entries()) {
    participantIds.push((await admin(`insert into competition_entrant_participants(
        club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
      ) select $1,$2,id,$3 from club_memberships
        where club_id=$4 and user_id=$5 returning id`,
    [entryId, entrantId, index + 1, club, shooterId])).rows[0].id);
  }
  await admin(
    "update club_competition_entries set status='submitted',submitted_at=now() where id=$1",
    [entryId],
  );
  await flush();
  return { entryId, entrantId, participantIds };
}

async function createStage2Group({
  formats = ["individual", "individual"],
  rosters = [[actors.normal], [actors.normal]],
  localScoring = [true, true],
} = {}) {
  stage2FixtureSequence += 1;
  const competitions = [];
  const entries = [];
  for (let index = 0; index < formats.length; index += 1) {
    const format = formats[index];
    const competition = await createCompetition({
      name: `Stage 2 ${stage2FixtureSequence}-${index + 1}`,
      entryFormat: format,
      teamSize: format === "individual" ? 1 : format === "pairs" ? 2 : 4,
      localScoring: localScoring[index],
    });
    competitions.push(competition);
    await publish(competition);
    entries.push(await addSubmittedEntrant(competition, rosters[index]));
  }
  const group = await createGroup(`Stage 2 group ${stage2FixtureSequence}`);
  for (const competition of competitions) await add(group, competition);
  const physicalId = await physicalRound(group, 1, `Physical ${stage2FixtureSequence}`);
  for (const competition of competitions) await map(group, physicalId, competition, 1);
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [group.id]);
  return { group, competitions, entries, physicalId };
}

async function startSeason() {
  await admin(`update league_seasons set status='active',
    entry_opens_at=current_date-30,entry_closes_at=current_date-10,
    starts_at=current_date-5 where id=1`);
}

async function scoreEntry(competition, clubId = null) {
  return (await db.query(
    "select public.get_individual_competition_score_entry(1,1,$1,$2,$3) data",
    [competition.id, await competitionRound(competition, 1), clubId],
  )).rows[0].data;
}

function scorePayload(data, participantId, enteredScore, sourceVersion) {
  return data.participants.map((participant) => ({
    participant_id: participant.participant_id,
    source_version:
      participant.participant_id === participantId && sourceVersion !== undefined
        ? sourceVersion
        : participant.source_version,
    values: participant.values.map((value) => ({
      set_number: value.set_number,
      component_position: value.component_position,
      entered_score:
        participant.participant_id === participantId
          ? enteredScore === null ? null : String(enteredScore)
          : value.entered_score === null ? null : String(value.entered_score),
      x_count: value.x_count,
    })),
  }));
}

async function saveScore(competition, participantId, enteredScore, {
  clubId = null,
  sourceVersion,
  data,
} = {}) {
  const read = data ?? await scoreEntry(competition, clubId);
  const result = (await db.query(
    "select public.save_individual_competition_round_scores(1,1,$1,$2,$3,$4) data",
    [competition.id, await competitionRound(competition, 1), clubId,
      scorePayload(read, participantId, enteredScore, sourceVersion)],
  )).rows[0].data;
  await flush();
  return result;
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
    ) select $1,$2,id,1 from club_memberships where club_id=1 and user_id=$3 returning id`,
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
    ) select $1,$2,id,1 from club_memberships where club_id=1 and user_id=$3 returning id`,
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

test("Stage 2 keeps unmapped scoring independent and preserves ordinary clear semantics", async () => {
  const competition = await createCompetition({ name: "Stage 2 ordinary" });
  await publish(competition);
  const entry = await addSubmittedEntrant(competition, [actors.normal]);
  await startSeason();
  const saved = await saveScore(competition, entry.participantIds[0], 97);
  assert.equal(saved.shared, false);
  const source = (await admin(`select source.id,source.concurrent_shooting_round_id
    from shooting_score_sources source join competition_score_usages usage
      on usage.shooting_score_source_id=source.id
    where usage.competition_id=$1`, [competition.id])).rows[0];
  assert.equal(source.concurrent_shooting_round_id, null);
  assert.equal((await admin(
    "select count(*)::int n from shooting_score_change_events where shooting_score_source_id=$1",
    [source.id],
  )).rows[0].n, 0);
  await saveScore(competition, entry.participantIds[0], null);
  assert.equal((await admin(
    "select count(*)::int n from shooting_score_sources where id=$1", [source.id],
  )).rows[0].n, 0);
});

test("shared create stores one source/value and works through Individual, Pair, and Team combinations", async () => {
  const cases = [
    { formats: ["individual", "individual"], rosters: [[actors.normal], [actors.normal]] },
    { formats: ["individual", "pairs"], rosters: [[actors.normal], [actors.normal, actors.shooter2]] },
    { formats: ["individual", "team"], rosters: [[actors.normal], [actors.normal, actors.shooter2, actors.shooter3, actors.shooter4]] },
    { formats: ["pairs", "team"], rosters: [[actors.normal, actors.shooter2], [actors.normal, actors.shooter2, actors.shooter3, actors.shooter4]] },
  ];
  const fixtures = [];
  for (const values of cases) fixtures.push(await createStage2Group(values));
  await startSeason();

  for (const fixture of fixtures) {
    const result = await saveScore(
      fixture.competitions[0], fixture.entries[0].participantIds[0], 99,
    );
    assert.equal(result.shared, true);
    assert.equal(result.linked_usage_count, 2);
    const sources = (await admin(`select source.id,source.version
      from shooting_score_sources source
      where source.concurrent_shooting_round_id=$1 and source.shooter_profile_id=$2`,
    [fixture.physicalId, actors.normal])).rows;
    assert.equal(sources.length, 1);
    assert.equal((await admin(
      "select count(*)::int n from competition_score_usages where shooting_score_source_id=$1",
      [sources[0].id],
    )).rows[0].n, 2);
    assert.equal((await admin(
      "select count(*)::int n from shooting_score_values where shooting_score_source_id=$1",
      [sources[0].id],
    )).rows[0].n, 1);
    const throughSecond = await scoreEntry(fixture.competitions[1]);
    const matched = throughSecond.participants.find(
      (participant) => participant.participant_id === fixture.entries[1].participantIds[0],
    );
    assert.equal(matched.values[0].entered_score, 99);
    assert.equal(matched.source_version, 1);
    assert.equal(matched.shared_metadata.can_edit_shared, true);
  }
});

test("participant resolution skips absence and fails closed on duplicate stable-shooter matches", async () => {
  const absent = await createStage2Group({
    rosters: [[actors.normal], [actors.shooter2]],
  });
  await startSeason();
  await saveScore(absent.competitions[0], absent.entries[0].participantIds[0], 96);
  const sourceId = (await admin(
    "select id from shooting_score_sources where concurrent_shooting_round_id=$1 and shooter_profile_id=$2",
    [absent.physicalId, actors.normal],
  )).rows[0].id;
  assert.equal((await admin(
    "select count(*)::int n from competition_score_usages where shooting_score_source_id=$1",
    [sourceId],
  )).rows[0].n, 1);

  await admin(`update league_seasons set status='draft',entry_opens_at=current_date+1,
    entry_closes_at=current_date+10,starts_at=current_date+20 where id=1`);
  const a = await createCompetition({ name: "Ambiguous A" });
  const b = await createCompetition({ name: "Ambiguous B" });
  await publish(a); await publish(b);
  const aEntry = await addSubmittedEntrant(a, [actors.normal]);
  await addSubmittedEntrant(b, [actors.normal], 1);
  await addSubmittedEntrant(b, [actors.normal], 2);
  const group = await createGroup("Ambiguous group");
  await add(group, a); await add(group, b);
  const physicalId = await physicalRound(group);
  await map(group, physicalId, a, 1); await map(group, physicalId, b, 1);
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [group.id]);
  await startSeason();
  const read = await scoreEntry(a);
  await rejected(
    "select public.save_individual_competition_round_scores(1,1,$1,$2,null,$3)",
    [a.id, await competitionRound(a, 1), scorePayload(read, aEntry.participantIds[0], 95)],
    /participation is ambiguous/,
  );
  assert.equal((await admin(
    "select count(*)::int n from shooting_score_sources where concurrent_shooting_round_id=$1",
    [physicalId],
  )).rows[0].n, 0);
});

test("shared corrections use optimistic versions, update both Competitions, audit, and clear globally", async () => {
  const fixture = await createStage2Group();
  await startSeason();
  await saveScore(fixture.competitions[0], fixture.entries[0].participantIds[0], 99);
  const staleRead = await scoreEntry(fixture.competitions[0]);
  const secondRead = await scoreEntry(fixture.competitions[1]);
  const corrected = await saveScore(
    fixture.competitions[1], fixture.entries[1].participantIds[0], 98,
    { data: secondRead },
  );
  assert.equal(corrected.source_versions[String(fixture.entries[1].participantIds[0])], 2);
  const source = (await admin(
    "select * from shooting_score_sources where concurrent_shooting_round_id=$1 and shooter_profile_id=$2",
    [fixture.physicalId, actors.normal],
  )).rows[0];
  assert.equal(source.version, 2);
  assert.equal(Number((await admin(
    "select achieved_score from shooting_score_values where shooting_score_source_id=$1",
    [source.id],
  )).rows[0].achieved_score), 98);
  await rejected(
    "select public.save_individual_competition_round_scores(1,1,$1,$2,null,$3)",
    [fixture.competitions[0].id, await competitionRound(fixture.competitions[0], 1),
      scorePayload(staleRead, fixture.entries[0].participantIds[0], 97)],
    /changed since this editor was loaded/,
  );
  assert.equal((await scoreEntry(fixture.competitions[0])).participants[0].values[0].entered_score, 98);

  const fresh = await scoreEntry(fixture.competitions[0]);
  const cleared = await saveScore(
    fixture.competitions[0], fixture.entries[0].participantIds[0], null, { data: fresh },
  );
  assert.equal(cleared.globally_cleared, true);
  assert.equal(cleared.shared_clear_count, 1);
  assert.equal((await admin(
    "select count(*)::int n from shooting_score_values where shooting_score_source_id=$1", [source.id],
  )).rows[0].n, 0);
  assert.equal((await admin(
    "select count(*)::int n from competition_score_usages where shooting_score_source_id=$1", [source.id],
  )).rows[0].n, 2);
  assert.equal((await admin(
    "select version from shooting_score_sources where id=$1", [source.id],
  )).rows[0].version, 3);
  const events = (await admin(`select operation,actor_id,origin_competition_id,
      origin_competition_round_id,before_state,after_state
    from shooting_score_change_events where shooting_score_source_id=$1 order by id`,
  [source.id])).rows;
  assert.deepEqual(events.map((event) => event.operation), ["create", "update", "clear"]);
  assert.equal(events[0].actor_id, actors.owner);
  assert.equal(events[1].origin_competition_id, fixture.competitions[1].id);
  assert.equal(events[1].before_state.values[0].achieved_score, 99);
  assert.equal(events[1].after_state.values[0].achieved_score, 98);
  assert.deepEqual(events[2].after_state.values, []);
});

test("club scoring succeeds only with authority across every linked usage", async () => {
  const valid = await createStage2Group();
  const cutoff = await createStage2Group();
  const organisationOnly = await createStage2Group({ localScoring: [true, false] });
  await startSeason();
  await admin(
    "update competition_rounds set deadline=current_date-1 where competition_id=$1",
    [cutoff.competitions[1].id],
  );
  await actor("clubOwner");
  const validResult = await saveScore(
    valid.competitions[0], valid.entries[0].participantIds[0], 94, { clubId: 1 },
  );
  assert.equal(validResult.linked_usage_count, 2);
  const cutoffRead = await scoreEntry(cutoff.competitions[0], 1);
  await rejected(
    "select public.save_individual_competition_round_scores(1,1,$1,$2,1,$3)",
    [cutoff.competitions[0].id, await competitionRound(cutoff.competitions[0], 1),
      scorePayload(cutoffRead, cutoff.entries[0].participantIds[0], 93)],
    /outside local scoring authority or cutoff/,
  );
  const orgOnlyRead = await scoreEntry(organisationOnly.competitions[0], 1);
  await rejected(
    "select public.save_individual_competition_round_scores(1,1,$1,$2,1,$3)",
    [organisationOnly.competitions[0].id,
      await competitionRound(organisationOnly.competitions[0], 1),
      scorePayload(orgOnlyRead, organisationOnly.entries[0].participantIds[0], 92)],
    /outside local scoring authority or cutoff/,
  );
  assert.equal((await admin(`select count(*)::int n from shooting_score_sources
    where concurrent_shooting_round_id in ($1,$2)`,
  [cutoff.physicalId, organisationOnly.physicalId])).rows[0].n, 0);
});

test("late Team entry submission reconciles an existing source without duplication", async () => {
  const individual = await createCompetition({ name: "Late Individual" });
  const team = await createCompetition({ name: "Late Team", entryFormat: "team", teamSize: 4 });
  await publish(individual); await publish(team);
  const individualEntry = await addSubmittedEntrant(individual, [actors.normal]);
  const group = await createGroup("Late group");
  await add(group, individual); await add(group, team);
  const physicalId = await physicalRound(group);
  await map(group, physicalId, individual, 1); await map(group, physicalId, team, 1);
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [group.id]);
  await startSeason();
  await saveScore(individual, individualEntry.participantIds[0], 91);
  const sourceId = (await admin(
    "select id from shooting_score_sources where concurrent_shooting_round_id=$1",
    [physicalId],
  )).rows[0].id;
  const late = await addSubmittedEntrant(
    team, [actors.normal, actors.shooter2, actors.shooter3, actors.shooter4], 2,
  );
  assert.equal((await admin(
    "select count(*)::int n from shooting_score_sources where concurrent_shooting_round_id=$1",
    [physicalId],
  )).rows[0].n, 1);
  assert.equal((await admin(`select shooting_score_source_id from competition_score_usages
    where competition_id=$1 and competition_entrant_participant_id=$2`,
  [team.id, late.participantIds[0]])).rows[0].shooting_score_source_id, sourceId);
  await actor("manager");
  assert.equal((await db.query(
    "select public.reconcile_concurrent_shooting_entry(1,$1) data", [late.entryId],
  )).rows[0].data.attached_usage_count, 0);
  await actor("normal");
  await rejected(
    "select public.reconcile_concurrent_shooting_entry(1,$1)",
    [late.entryId], /contextual Organisation author permission/,
  );
});

test("late reconciliation rejects ambiguous shooters and conflicting target sources", async () => {
  const a = await createCompetition({ name: "Reconcile A" });
  const b = await createCompetition({ name: "Reconcile B" });
  await publish(a); await publish(b);
  const aEntry = await addSubmittedEntrant(a, [actors.normal]);
  const group = await createGroup("Reconcile group");
  await add(group, a); await add(group, b);
  const physicalId = await physicalRound(group);
  await map(group, physicalId, a, 1); await map(group, physicalId, b, 1);
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [group.id]);
  await startSeason();
  await saveScore(a, aEntry.participantIds[0], 90);
  await addSubmittedEntrant(b, [actors.normal], 1);

  const draftEntry = (await admin(
    "insert into club_competition_entries(competition_id,club_id,status) values($1,2,'draft') returning id",
    [b.id],
  )).rows[0].id;
  const draftEntrant = (await admin(
    "insert into competition_entrants(club_competition_entry_id,position) values($1,1) returning id",
    [draftEntry],
  )).rows[0].id;
  await admin(`insert into competition_entrant_participants(
      club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
    ) select $1,$2,id,1 from club_memberships where club_id=2 and user_id=$3`,
  [draftEntry, draftEntrant, actors.normal]);
  await adminRejected(
    "update club_competition_entries set status='submitted',submitted_at=now() where id=$1",
    [draftEntry], /appears more than once/,
  );

  const conflictA = await createCompetition({ name: "Conflict A" });
  const conflictB = await createCompetition({ name: "Conflict B" });
  await admin(`update league_seasons set status='draft',entry_opens_at=current_date+1,
    entry_closes_at=current_date+10,starts_at=current_date+20 where id=1`);
  await publish(conflictA); await publish(conflictB);
  const conflictAEntry = await addSubmittedEntrant(conflictA, [actors.shooter2]);
  const conflictBEntry = await addSubmittedEntrant(conflictB, [actors.shooter2]);
  const conflictGroup = await createGroup("Conflict group");
  await add(conflictGroup, conflictA); await add(conflictGroup, conflictB);
  const conflictPhysical = await physicalRound(conflictGroup);
  await map(conflictGroup, conflictPhysical, conflictA, 1);
  await map(conflictGroup, conflictPhysical, conflictB, 1);
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [conflictGroup.id]);
  await startSeason();
  await admin("alter table competition_score_usages disable trigger user");
  const unrelated = (await admin(
    "insert into shooting_score_sources(shooter_profile_id) values($1) returning id",
    [actors.shooter2],
  )).rows[0].id;
  await admin(`insert into competition_score_usages(
    shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id
  ) values($1,$2,$3,$4)`, [unrelated, conflictB.id,
    await competitionRound(conflictB, 1), conflictBEntry.participantIds[0]]);
  await admin("alter table competition_score_usages enable trigger user");
  const conflictRead = await scoreEntry(conflictA);
  await rejected(
    "select public.save_individual_competition_round_scores(1,1,$1,$2,null,$3)",
    [conflictA.id, await competitionRound(conflictA, 1),
      scorePayload(conflictRead, conflictAEntry.participantIds[0], 89)],
    /different score source/,
  );
});

test("Competition-specific release and R/Av remain usage-scoped for one shared source", async () => {
  const fixture = await createStage2Group();
  await startSeason();
  await saveScore(fixture.competitions[0], fixture.entries[0].participantIds[0], 88);
  await admin(
    "update competition_rounds set deadline=current_date-1 where competition_id=$1",
    [fixture.competitions[0].id],
  );
  await admin(
    "update competition_rounds set deadline=current_date+1 where competition_id=$1",
    [fixture.competitions[1].id],
  );
  await actor("anon");
  const released = (await db.query(
    "select public.get_competition_aggregate_results(1,1,$1) data",
    [fixture.competitions[0].id],
  )).rows[0].data;
  const pending = (await db.query(
    "select public.get_competition_aggregate_results(1,1,$1) data",
    [fixture.competitions[1].id],
  )).rows[0].data;
  const releasedRound = released.groups.flatMap((item) => item.entrants)[0].rounds[0];
  const pendingRound = pending.groups.flatMap((item) => item.entrants)[0].rounds[0];
  assert.equal(releasedRound.state, "scored");
  assert.equal(releasedRound.gun_score, 88);
  assert.equal(pendingRound.state, "pending");
  assert.equal(pendingRound.gun_score, null);

  await actor("owner");
  await admin(
    "update competition_rounds set deadline=current_date-1 where competition_id=$1",
    [fixture.competitions[1].id],
  );
  for (let index = 0; index < 2; index += 1) {
    const averages = (await db.query(
      "select public.get_competition_result_averages(1,1,$1) data",
      [fixture.competitions[index].id],
    )).rows[0].data;
    assert.equal(averages.participants[0].running_average, 88);
  }
});

test("one shared source is deduplicated within an Average Context and frozen S/Av survives correction", async () => {
  const fixture = await createStage2Group();
  const target = await createCompetition({ name: "Shared SAv target", rounds: 1 });
  await admin(`update competitions set start_date_mode='custom',
    custom_starts_at=current_date+10 where id=$1`, [target.id]);
  await publish(target);
  const targetEntry = await addSubmittedEntrant(target, [actors.normal]);
  await startSeason();
  await saveScore(fixture.competitions[0], fixture.entries[0].participantIds[0], 88);
  await admin(
    "update competition_rounds set deadline=current_date-1 where competition_id=any($1::bigint[])",
    [fixture.competitions.map((competition) => competition.id)],
  );

  const context = (await db.query(
    "select public.create_average_context(1,'Shared source context',100) data",
  )).rows[0].data;
  const policy = (await db.query(`select public.create_average_policy(
      1,'One source policy','current_then_preceding',$1::jsonb
    ) data`, [JSON.stringify({
    minimum_current_scores: 1,
    minimum_preceding_scores: 1,
    fallback: "manual",
  })])).rows[0].data;
  for (const competition of [...fixture.competitions, target]) {
    await db.query(`select public.set_competition_average_settings(
      1,1,$1,$2,$3,true
    )`, [competition.id, context.id, policy.version_id]);
  }
  await db.query(
    "select public.calculate_competition_starting_averages(1,1,$1)", [target.id],
  );
  const before = (await admin(`select * from competition_participant_starting_averages
    where competition_entrant_participant_id=$1`, [targetEntry.participantIds[0]])).rows[0];
  const provenanceBefore = (await admin(`select * from starting_average_score_sources
    where starting_average_id=$1 order by id`, [before.id])).rows;
  assert.equal(Number(before.starting_average), 88);
  assert.equal(before.qualifying_score_count, 1);
  assert.equal(provenanceBefore.length, 1);
  await db.query(
    "select public.finalise_competition_starting_averages(1,1,$1)", [target.id],
  );
  const frozenBefore = (await admin(`select * from competition_participant_starting_averages
    where id=$1`, [before.id])).rows[0];

  const fresh = await scoreEntry(fixture.competitions[1]);
  await saveScore(
    fixture.competitions[1], fixture.entries[1].participantIds[0], 87, { data: fresh },
  );
  await db.query(
    "select public.calculate_competition_starting_averages(1,1,$1)", [target.id],
  );
  assert.deepEqual((await admin(`select * from competition_participant_starting_averages
    where id=$1`, [before.id])).rows[0], frozenBefore);
  assert.deepEqual((await admin(`select * from starting_average_score_sources
    where starting_average_id=$1 order by id`, [before.id])).rows, provenanceBefore);
});

test("the additive migration is rerunnable", async () => {
  const rerun = new PGlite();
  try {
    await installCanonicalDatabase(rerun);
    const sql = await sqlFile("concurrent-shooting");
    const stage2 = await sqlFile("concurrent-shooting-stage-2");
    await rerun.exec(sql);
    await rerun.exec(sql);
    await rerun.exec(stage2);
    await rerun.exec(stage2);
    assert.equal((await rerun.query(
      "select count(*)::int n from information_schema.tables where table_schema='public' and table_name like 'concurrent_shooting%'",
    )).rows[0].n, 4);
  } finally {
    await rerun.close();
  }
});
