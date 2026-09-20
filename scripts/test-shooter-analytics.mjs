import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";

const db = new PGlite();
const actors = {
  shooter: "70000000-0000-4000-8000-000000000001",
  other: "70000000-0000-4000-8000-000000000002",
  owner: "70000000-0000-4000-8000-000000000003",
};
let sequence = 0;

before(async () => installCanonicalDatabase(db, { concurrentShootingStage3a: true }));
after(async () => db.close());

async function actor(name) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actors[name] ?? ""]);
  await db.exec(`set role ${name === "anon" ? "anon" : "authenticated"}`);
}

async function admin(sql, params = []) {
  await db.exec("reset role; savepoint analytics_admin");
  try {
    const result = await db.query(sql, params);
    await db.exec("release savepoint analytics_admin; set role authenticated");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint analytics_admin; release savepoint analytics_admin; set role authenticated");
    throw error;
  }
}

async function flush() {
  await db.exec("set constraints all immediate; set constraints all deferred");
}

beforeEach(async () => {
  sequence = 0;
  await db.exec("begin");
  for (const id of Object.values(actors)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
  }
  await db.exec(`
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'Home Organisation','home-organisation','active'),
      (2,'Private Organisation','private-organisation','inactive');
    insert into league_seasons(
      id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (1,1,'Season One','season-one','active',current_date-200,current_date-190,current_date-180,current_date+30),
      (2,1,'Season Two','season-two','completed',current_date-500,current_date-490,current_date-480,current_date-250),
      (3,2,'Private Season','private-season','completed',current_date-500,current_date-490,current_date-480,current_date-250);
    insert into clubs(id,name,slug,status) overriding system value values
      (1,'Home Club','home-club','active'),
      (2,'Other Club','other-club','active');
  `);
  await db.query(`insert into organisation_staff(organisation_id,user_id,role,status)
    values(1,$1,'owner','active')`, [actors.owner]);
  await db.query(`insert into club_memberships(id,club_id,user_id,role,status) overriding system value values
    (1,1,$1,'member','active'),(2,2,$2,'member','active'),(3,1,$3,'member','active')`,
    [actors.shooter, actors.other, actors.owner]);
  // This legacy dashboard relation is intentionally irrelevant to analytics authorization.
  await db.query("insert into user_organisations(user_id,organisation_id) values($1,2)", [actors.shooter]);
  await actor("shooter");
});

afterEach(async () => db.exec("rollback; reset role"));

async function createCompetition({
  name,
  season = 1,
  membership = 1,
  deadlineOffset = -10,
  equipment = "air_rifle",
  usesX = false,
  sets = 1,
  legacy = false,
  components = [{
    label: "Score",
    maximum: 100,
    method: "points_scored",
    positionMode: "fixed",
    positionCode: "prone",
    distanceMode: "fixed",
    distanceValue: 50,
    distanceUnit: "metres",
    shots: 10,
  }],
} = {}) {
  sequence += 1;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${sequence}`;
  const maximum = components.reduce((total, component) => total + component.maximum, 0) * sets;
  const shots = components.reduce((total, component) => total + (component.shots ?? 10), 0) * sets;
  const method = components.every((component) => component.method === components[0].method)
    ? components[0].method
    : "points_scored";
  const competition = (await admin(`insert into competitions(
      league_season_id,name,slug,status,entry_format,team_size,scoring_method,
      maximum_score_per_round,shots_per_round,uses_x_score,number_of_rounds,
      entry_window_mode,custom_entry_opens_at,custom_entry_closes_at,
      start_date_mode,custom_starts_at,sets_per_round,ranking_method,
      shooting_details_version,equipment_type_code
    ) values($1,$2,$3,'draft','individual',1,$4,$5,$6,$7,1,
      'season_default',null,null,'season_default',null,$8,'aggregate',$9,$10)
    returning id`, [season, name, slug, method, maximum, shots, usesX, sets,
      legacy ? null : 1, legacy ? null : equipment])).rows[0].id;

  for (const [index, component] of components.entries()) {
    await admin(`insert into competition_score_components(
      competition_id,position,short_label,maximum_score,score_method,
      shooting_position_mode,shooting_position_code,distance_mode,distance_value,
      distance_unit,shots
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
      competition, index + 1, component.label, component.maximum, component.method,
      legacy ? null : component.positionMode,
      legacy ? null : component.positionMode === "fixed" ? component.positionCode : null,
      legacy ? null : component.distanceMode,
      legacy || component.distanceMode !== "fixed" ? null : component.distanceValue,
      legacy || component.distanceMode !== "fixed" ? null : component.distanceUnit,
      legacy ? null : component.shots ?? 10,
    ]);
  }
  const round = (await admin(`insert into competition_rounds(
    competition_id,round_number,deadline
  ) values($1,1,current_date+$2::integer) returning id`, [competition, deadlineOffset])).rows[0].id;
  await admin("update competitions set status='published' where id=$1", [competition]);
  const club = membership === 1 ? 1 : 2;
  const entry = (await admin(`insert into club_competition_entries(
    competition_id,club_id,status,submitted_at
  ) values($1,$2,'submitted',now()) returning id`, [competition, club])).rows[0].id;
  const entrant = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position
  ) values($1,1) returning id`, [entry])).rows[0].id;
  const participant = (await admin(`insert into competition_entrant_participants(
    club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
  ) values($1,$2,$3,1) returning id`, [entry, entrant, membership])).rows[0].id;
  await flush();
  return { competition, round, entry, entrant, participant, components, sets };
}

async function addScore(fixture, values, { source = null } = {}) {
  const shooter = fixture.participant && (await admin(`select membership.user_id
    from competition_entrant_participants participant
    join club_memberships membership on membership.id=participant.club_membership_id
    where participant.id=$1`, [fixture.participant])).rows[0].user_id;
  const sourceId = source ?? (await admin(
    "insert into shooting_score_sources(shooter_profile_id) values($1) returning id",
    [shooter],
  )).rows[0].id;
  await admin(`insert into competition_score_usages(
    shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id
  ) values($1,$2,$3,$4)`, [sourceId, fixture.competition, fixture.round, fixture.participant]);
  if (source === null) {
    for (const value of values) {
      await admin(`insert into shooting_score_values(
        shooting_score_source_id,set_number,component_position,achieved_score,x_count
      ) values($1,$2,$3,$4,$5)`, [sourceId, value.set, value.component, value.achieved, value.x ?? null]);
    }
  }
  await flush();
  return sourceId;
}

async function analytics(filters = {}) {
  const values = {
    season: null,
    equipmentKind: null,
    equipmentCode: null,
    equipmentCustomId: null,
    positionMode: null,
    positionCode: null,
    positionCustomId: null,
    distanceMode: null,
    distanceValue: null,
    distanceUnit: null,
    historyPage: 1,
    includeIfSeededToday: false,
    ...filters,
  };
  return (await db.query(`select public.get_my_shooter_analytics(
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
  ) data`, Object.values(values))).rows[0].data;
}

test("released complete scores appear with normalized achieved values and separate X data", async () => {
  const released = await createCompetition({ name: "Released", usesX: true });
  await addScore(released, [{ set: 1, component: 1, achieved: 87.5, x: 6 }]);
  const unreleased = await createCompetition({ name: "Inclusive deadline", deadlineOffset: 0 });
  await addScore(unreleased, [{ set: 1, component: 1, achieved: 99 }]);
  const partial = await createCompetition({
    name: "Partial",
    components: [
      { ...released.components[0], label: "A", maximum: 50 },
      { ...released.components[0], label: "B", maximum: 50 },
    ],
  });
  await addScore(partial, [{ set: 1, component: 1, achieved: 45 }]);

  const result = await analytics();
  assert.equal(result.summary.physical_shoot_count, 1);
  assert.equal(result.summary.competition_count, 1);
  assert.equal(result.chart_points[0].score_percentage, 87.5);
  assert.equal(result.chart_points[0].achieved_score, 87.5);
  assert.equal(result.chart_points[0].maximum_possible_score, 100);
  assert.equal(result.chart_points[0].x_total, 6);
  assert.equal(result.chart_points[0].round_end_date < new Date().toISOString().slice(0, 10), true);
  assert.equal(JSON.stringify(result).includes("Inclusive deadline"), false);
});

test("points-dropped entry semantics remain canonical achieved performance", async () => {
  const fixture = await createCompetition({
    name: "Points dropped",
    components: [{
      label: "Dropped",
      maximum: 100,
      method: "points_dropped",
      positionMode: "fixed",
      positionCode: "prone",
      distanceMode: "fixed",
      distanceValue: 50,
      distanceUnit: "metres",
      shots: 10,
    }],
  });
  // Canonical persistence stores achieved=97 after a UI entry of 3 dropped.
  await addScore(fixture, [{ set: 1, component: 1, achieved: 97 }]);
  const result = await analytics();
  assert.equal(result.chart_points[0].achieved_score, 97);
  assert.equal(result.chart_points[0].score_percentage, 97);
  assert.equal(result.chart_points[0].components[0].score_method, "points_dropped");
});

test("points-dropped Ex100 normalization makes 0 dropped 100% and 5 dropped 95%", async () => {
  const component = {
    label: "Dropped",
    maximum: 100,
    method: "points_dropped",
    positionMode: "fixed",
    positionCode: "prone",
    distanceMode: "fixed",
    distanceValue: 25,
    distanceUnit: "yards",
    shots: 10,
  };
  const perfect = await createCompetition({ name: "Zero dropped", deadlineOffset: -20, components: [component] });
  const fiveDropped = await createCompetition({ name: "Five dropped", deadlineOffset: -10, components: [component] });
  await addScore(perfect, [{ set: 1, component: 1, achieved: 100 }]);
  await addScore(fiveDropped, [{ set: 1, component: 1, achieved: 95 }]);

  const result = await analytics();
  assert.deepEqual(result.chart_points.map((point) => point.score_percentage), [100, 95]);
  assert.deepEqual(result.chart_points.map((point) => point.achieved_score), [100, 95]);
});

test("summary metrics and trend use chronological normalized physical scores", async () => {
  const earlier = await createCompetition({ name: "Earlier", deadlineOffset: -20 });
  await addScore(earlier, [{ set: 1, component: 1, achieved: 80 }]);
  const recent = await createCompetition({ name: "Recent", deadlineOffset: -5 });
  await addScore(recent, [{ set: 1, component: 1, achieved: 90 }]);

  const result = await analytics();
  assert.equal(result.summary.best_score_percentage, 90);
  assert.equal(result.summary.recent_score_percentage, 90);
  assert.equal(result.summary.mean_score_percentage, 85);
  assert.equal(result.summary.trend_direction, "up");
  assert.equal(result.summary.trend_change, 10);
  assert.deepEqual(result.chart_points.map((point) => point.competition_name), ["Earlier", "Recent"]);
});

test("one source reused by two Competitions counts once physically and twice for participation", async () => {
  const first = await createCompetition({ name: "Concurrent A" });
  const second = await createCompetition({ name: "Concurrent B", deadlineOffset: -8 });
  const unreleased = await createCompetition({ name: "Concurrent hidden", deadlineOffset: 0 });
  const source = await addScore(first, [{ set: 1, component: 1, achieved: 91 }]);
  await addScore(second, [], { source });
  await addScore(unreleased, [], { source });

  const result = await analytics();
  assert.equal(result.summary.physical_shoot_count, 1);
  assert.equal(result.summary.competition_count, 2);
  assert.equal(result.chart_points.length, 1);
  assert.equal(result.chart_points[0].shared, true);
  assert.deepEqual(result.chart_points[0].contexts.map((item) => item.competition), [
    "Concurrent A", "Concurrent B",
  ]);
  assert.equal(JSON.stringify(result).includes("Concurrent hidden"), false);
});

test("structured filters combine on the same component and preserve multi-component identity", async () => {
  const threePosition = await createCompetition({
    name: "Air three position",
    equipment: "air_rifle",
    sets: 2,
    components: [
      { label: "P", maximum: 40, method: "points_scored", positionMode: "fixed", positionCode: "prone", distanceMode: "fixed", distanceValue: 50, distanceUnit: "metres", shots: 4 },
      { label: "S", maximum: 30, method: "points_scored", positionMode: "fixed", positionCode: "standing", distanceMode: "fixed", distanceValue: 10, distanceUnit: "metres", shots: 3 },
      { label: "K", maximum: 30, method: "points_scored", positionMode: "fixed", positionCode: "kneeling", distanceMode: "fixed", distanceValue: 50, distanceUnit: "metres", shots: 3 },
    ],
  });
  await addScore(threePosition, [
    { set: 1, component: 1, achieved: 36 },
    { set: 1, component: 2, achieved: 21 },
    { set: 1, component: 3, achieved: 24 },
    { set: 2, component: 1, achieved: 38 },
    { set: 2, component: 2, achieved: 22 },
    { set: 2, component: 3, achieved: 25 },
  ]);
  const smallbore = await createCompetition({ name: "Smallbore prone", equipment: "smallbore_rifle" });
  await addScore(smallbore, [{ set: 1, component: 1, achieved: 95 }]);
  const otherSeason = await createCompetition({ name: "Old air", season: 2, deadlineOffset: -300 });
  await addScore(otherSeason, [{ set: 1, component: 1, achieved: 80 }]);

  const airProne50 = await analytics({
    equipmentKind: "builtin", equipmentCode: "air_rifle",
    positionMode: "fixed", positionCode: "prone",
    distanceMode: "fixed", distanceValue: 50, distanceUnit: "metres",
  });
  assert.equal(airProne50.component_scope, "filtered_components");
  assert.equal(airProne50.summary.physical_shoot_count, 2);
  const point = airProne50.chart_points.find((item) => item.competition_name === "Air three position");
  assert.equal(point.achieved_score, 74);
  assert.equal(point.maximum_possible_score, 80);
  assert.equal(point.score_percentage, 92.5);
  assert.deepEqual(point.components.map((component) => component.label), ["P"]);

  const impossibleCombination = await analytics({
    equipmentKind: "builtin", equipmentCode: "air_rifle",
    positionMode: "fixed", positionCode: "standing",
    distanceMode: "fixed", distanceValue: 50, distanceUnit: "metres",
  });
  assert.equal(impossibleCombination.summary.physical_shoot_count, 0);
  assert.equal((await analytics({ positionMode: "fixed", positionCode: "prone" })).summary.physical_shoot_count, 3);
  assert.equal((await analytics({ distanceMode: "fixed", distanceValue: 50, distanceUnit: "metres" })).summary.physical_shoot_count, 3);
  assert.equal((await analytics({ season: 2 })).summary.physical_shoot_count, 1);
  assert.equal((await analytics({ equipmentKind: "builtin", equipmentCode: "smallbore_rifle" })).summary.physical_shoot_count, 1);
});

test("variable, not-applicable and legacy-null physical states remain explicit", async () => {
  const variable = await createCompetition({
    name: "Variable",
    components: [{ label: "V", maximum: 100, method: "points_scored", positionMode: "variable", positionCode: null, distanceMode: "variable", distanceValue: null, distanceUnit: null, shots: 10 }],
  });
  await addScore(variable, [{ set: 1, component: 1, achieved: 70 }]);
  const notApplicable = await createCompetition({
    name: "Not applicable",
    components: [{ label: "N", maximum: 100, method: "points_scored", positionMode: "not_applicable", positionCode: null, distanceMode: "not_applicable", distanceValue: null, distanceUnit: null, shots: 10 }],
  });
  await addScore(notApplicable, [{ set: 1, component: 1, achieved: 75 }]);
  const legacy = await createCompetition({ name: "Legacy", legacy: true });
  await addScore(legacy, [{ set: 1, component: 1, achieved: 82 }]);

  assert.equal((await analytics({ positionMode: "variable", distanceMode: "variable" })).summary.physical_shoot_count, 1);
  assert.equal((await analytics({ positionMode: "not_applicable", distanceMode: "not_applicable" })).summary.physical_shoot_count, 1);
  const legacyResult = await analytics({
    equipmentKind: "unspecified", positionMode: "unspecified", distanceMode: "unspecified",
  });
  assert.equal(legacyResult.summary.physical_shoot_count, 1);
  assert.equal(legacyResult.chart_points[0].equipment_label, "Unspecified equipment");
  assert.equal(legacyResult.chart_points[0].components[0].position_mode, "unspecified");
});

test("discipline groups use structured physical identity rather than Competition display names", async () => {
  const compatibleA = await createCompetition({ name: "Postal Alpha", deadlineOffset: -30 });
  const compatibleB = await createCompetition({ name: "Postal Beta", deadlineOffset: -20 });
  const incompatible = await createCompetition({
    name: "Postal Alpha",
    season: 2,
    deadlineOffset: -300,
    equipment: "smallbore_rifle",
    components: [{
      label: "Score", maximum: 100, method: "points_scored",
      positionMode: "fixed", positionCode: "benchrest",
      distanceMode: "fixed", distanceValue: 25, distanceUnit: "yards", shots: 10,
    }],
  });
  await addScore(compatibleA, [{ set: 1, component: 1, achieved: 80 }]);
  await addScore(compatibleB, [{ set: 1, component: 1, achieved: 90 }]);
  await addScore(incompatible, [{ set: 1, component: 1, achieved: 95 }]);

  const result = await analytics();
  assert.equal(result.disciplines.length, 2);
  const air = result.disciplines.find((item) => item.equipment_label === "Air Rifle");
  assert.equal(air.physical_shoot_count, 2);
  assert.equal(air.average_score_percentage, 85);
  assert.equal(result.disciplines.find((item) => item.equipment_label === "Smallbore Rifle").physical_shoot_count, 1);
  assert.notEqual(result.disciplines[0].discipline_key, result.disciplines[1].discipline_key);
});

test("Season comparison uses canonical identity and respects the selected Season filter", async () => {
  const old = await createCompetition({ name: "Old Season", season: 2, deadlineOffset: -300 });
  const current = await createCompetition({ name: "Current Season", season: 1, deadlineOffset: -10 });
  await addScore(old, [{ set: 1, component: 1, achieved: 80 }]);
  await addScore(current, [{ set: 1, component: 1, achieved: 90 }]);

  const overall = await analytics();
  assert.deepEqual(new Set(overall.seasons.map((season) => season.season_id)), new Set([1, 2]));
  const currentComparison = overall.seasons.find((season) => season.season_id === 1);
  assert.equal(currentComparison.change_from_previous, 10);

  const filtered = await analytics({ season: 2 });
  assert.deepEqual(filtered.seasons.map((season) => season.season_id), [2]);
  assert.equal(filtered.seasons[0].change_from_previous, null);
  assert.equal(filtered.history.total_items, filtered.chart_points.length);
});

test("filtered canonical history paginates 10 physical sources without duplicates or omissions", async () => {
  for (let index = 0; index < 23; index += 1) {
    const equipment = index < 21 ? "air_rifle" : "smallbore_rifle";
    const fixture = await createCompetition({
      name: `History ${index + 1}`,
      deadlineOffset: -(index + 1),
      equipment,
    });
    await addScore(fixture, [{ set: 1, component: 1, achieved: 70 + index }]);
  }

  const filter = { equipmentKind: "builtin", equipmentCode: "air_rifle" };
  const pages = await Promise.all([
    analytics({ ...filter, historyPage: 1 }),
    analytics({ ...filter, historyPage: 2 }),
    analytics({ ...filter, historyPage: 3 }),
  ]);
  assert.deepEqual(pages.map((page) => page.history.items.length), [10, 10, 1]);
  assert.equal(pages[0].history.page_size, 10);
  assert.equal(pages[0].history.total_items, 21);
  assert.equal(pages[0].chart_points.length, 21);
  assert.ok(pages.flatMap((page) => page.history.items).every((point) => point.equipment_label === "Air Rifle"));
  const keys = pages.flatMap((page) => page.history.items.map((point) => point.event_key));
  assert.equal(new Set(keys).size, 21);
});

test("published Individual what-if inputs preserve the frozen roster and perform no Division mutation", async () => {
  const fixture = await createCompetition({ name: "Seeded today", deadlineOffset: -10 });
  const secondEntrant = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position
  ) values($1,2) returning id`, [fixture.entry])).rows[0].id;
  const secondParticipant = (await admin(`insert into competition_entrant_participants(
    club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
  ) values($1,$2,3,1) returning id`, [fixture.entry, secondEntrant])).rows[0].id;
  await addScore(fixture, [{ set: 1, component: 1, achieved: 99 }]);

  const context = (await admin(`insert into average_contexts(
    organisation_id,name,basis_maximum
  ) values(1,'Seed context',100) returning id`)).rows[0].id;
  const policy = (await admin(`insert into average_policies(
    organisation_id,name
  ) values(1,'Seed policy') returning id`)).rows[0].id;
  const version = (await admin(`insert into average_policy_versions(
    average_policy_id,version_number,strategy,configuration
  ) values($1,1,'manual','{}') returning id`, [policy])).rows[0].id;
  await admin(`insert into competition_average_settings(
    competition_id,average_context_id,average_policy_version_id
  ) values($1,$2,$3)`, [fixture.competition, context, version]);
  await admin(`insert into competition_participant_starting_averages(
    competition_id,competition_entrant_participant_id,shooter_profile_id,
    starting_average,average_context_id,average_policy_version_id,origin,status,frozen_at
  ) values
    ($1,$2,$3,80,$4,$5,'manual','frozen',now()),
    ($1,$6,$7,95,$4,$5,'manual','frozen',now())`, [
    fixture.competition, fixture.participant, actors.shooter, context, version,
    secondParticipant, actors.owner,
  ]);
  await admin(`insert into competition_division_configs(
    competition_id,target_size,status,published_at,
    reviewed_starting_average_fingerprint,reviewed_starting_averages_at
  ) values($1,2,'published',now(),'0123456789abcdef0123456789abcdef',now())`,
  [fixture.competition]);
  const division = (await admin(`insert into competition_divisions(
    competition_id,name,position
  ) values($1,'Division 1',1) returning id`, [fixture.competition])).rows[0].id;
  await admin(`insert into competition_division_assignments(
    competition_entrant_id,competition_id,competition_division_id
  ) values($1,$3,$4),($2,$3,$4)`, [fixture.entrant, secondEntrant, fixture.competition, division]);
  await flush();

  const before = (await admin(`select
    (select count(*)::integer from competition_division_assignments where competition_id=$1) assignments,
    (select count(*)::integer from competition_participant_starting_averages where competition_id=$1) snapshots`,
  [fixture.competition])).rows[0];
  const result = await analytics({ includeIfSeededToday: true });
  const candidate = result.if_seeded_today_inputs[0];
  assert.equal(candidate.own_entrant_id, fixture.entrant);
  assert.equal(candidate.target_size, 2);
  assert.equal(candidate.current_division_name, "Division 1");
  assert.equal(candidate.unavailable_reason, null);
  assert.deepEqual(candidate.entrants.map((entrant) => entrant.starting_average), [80, 95]);
  const after = (await admin(`select
    (select count(*)::integer from competition_division_assignments where competition_id=$1) assignments,
    (select count(*)::integer from competition_participant_starting_averages where competition_id=$1) snapshots`,
  [fixture.competition])).rows[0];
  assert.deepEqual(after, before);
});

test("the RPC is current-shooter-only, excludes inactive contexts, and denies anonymous callers", async () => {
  const own = await createCompetition({ name: "Own released" });
  await addScore(own, [{ set: 1, component: 1, achieved: 88 }]);
  const privateFixture = await createCompetition({ name: "Inactive private", season: 3, deadlineOffset: -300 });
  await addScore(privateFixture, [{ set: 1, component: 1, achieved: 100 }]);

  const ownResult = await analytics();
  assert.equal(ownResult.summary.physical_shoot_count, 1);
  assert.equal(JSON.stringify(ownResult).includes("Inactive private"), false);

  await actor("other");
  assert.equal((await analytics()).summary.physical_shoot_count, 0);
  await actor("anon");
  await db.exec("savepoint anonymous_denial");
  try {
    await assert.rejects(() => db.query("select public.get_my_shooter_analytics()"), /permission denied/);
  } finally {
    await db.exec("rollback to savepoint anonymous_denial; release savepoint anonymous_denial");
  }
  await actor("shooter");

  const hardening = (await admin(`select
    procedure.prosecdef,
    procedure.provolatile,
    coalesce(procedure.proconfig,'{}') @> array['search_path=""'] as safe_path,
    has_function_privilege('authenticated', procedure.oid, 'execute') as authenticated_execute,
    has_function_privilege('anon', procedure.oid, 'execute') as anon_execute
  from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public' and procedure.proname='get_my_shooter_analytics'`)).rows[0];
  assert.deepEqual(hardening, {
    prosecdef: true,
    provolatile: "s",
    safe_path: true,
    authenticated_execute: true,
    anon_execute: false,
  });
});

test("one score has an unavailable trend and the analytics read model is rerunnable", async () => {
  const fixture = await createCompetition({ name: "One point" });
  await addScore(fixture, [{ set: 1, component: 1, achieved: 90 }]);
  assert.equal((await analytics()).summary.trend_direction, "unavailable");
  const isolated = new PGlite();
  try {
    await installCanonicalDatabase(isolated);
    await isolated.exec(await sqlFile("17_shooter_analytics"));
  } finally {
    await isolated.close();
  }
});
