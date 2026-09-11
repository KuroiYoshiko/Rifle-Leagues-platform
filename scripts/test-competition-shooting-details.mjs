import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";

const db = new PGlite();
const owner = "31000000-0000-4000-8000-000000000001";
const manager = "31000000-0000-4000-8000-000000000002";
const foreignOwner = "31000000-0000-4000-8000-000000000003";

before(async () => installCanonicalDatabase(db, { concurrentShootingStage3a: true }));
after(async () => db.close());

beforeEach(async () => {
  await db.exec(`begin;
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'Organisation One','organisation-one','active'),
      (2,'Organisation Two','organisation-two','active');
    insert into league_seasons(
      id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (1,1,'Season One','season-one','draft',current_date+1,current_date+10,current_date+20,current_date+100),
      (2,1,'Season Two','season-two','draft',current_date+1,current_date+10,current_date+20,current_date+100),
      (3,2,'Foreign Season','foreign-season','draft',current_date+1,current_date+10,current_date+20,current_date+100);
  `);
  for (const id of [owner, manager, foreignOwner]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
  }
  await db.query(`insert into organisation_staff(organisation_id,user_id,role,status) values
    (1,$1,'owner','active'),(1,$2,'manager','active'),(2,$3,'owner','active')`,
  [owner, manager, foreignOwner]);
  await become(owner);
});

afterEach(async () => db.exec("rollback; reset role"));

async function become(userId) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec("set role authenticated");
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

async function rejected(sql, params, pattern) {
  await db.exec("savepoint expected_failure");
  try {
    await assert.rejects(async () => {
      await db.query(sql, params);
      await db.exec("set constraints all immediate; set constraints all deferred");
    }, pattern);
  } finally {
    await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
  }
}

function component(overrides = {}) {
  return {
    short_label: "P",
    maximum_score: 100,
    score_method: "points_scored",
    shooting_position_mode: "fixed",
    shooting_position_code: "prone",
    organisation_shooting_position_id: null,
    custom_shooting_position_name: null,
    distance_mode: "fixed",
    distance_value: 50,
    distance_unit: "metres",
    shots: 10,
    ...overrides,
  };
}

function configuration(name, overrides = {}) {
  return {
    name,
    description: null,
    entry_format: "individual",
    team_size: 1,
    sets_per_round: 1,
    shooting_details_version: 1,
    equipment_type_code: "smallbore_rifle",
    organisation_equipment_type_id: null,
    custom_equipment_type_name: null,
    score_components: [component()],
    uses_x_score: false,
    number_of_rounds: 2,
    entry_fee: 0,
    entry_window_mode: "season_default",
    custom_entry_opens_at: null,
    custom_entry_closes_at: null,
    start_date_mode: "season_default",
    custom_starts_at: null,
    ranking_method: "aggregate",
    best_rounds_count: null,
    local_scoring_enabled: true,
    round_deadlines: [],
    round_shoot_by_dates: [],
    ...overrides,
  };
}

async function create(name, overrides = {}, org = 1, season = 1) {
  const values = configuration(name, overrides);
  if (values.round_deadlines.length === 0) {
    values.round_deadlines = (await db.query(
      "select array_agg((current_date+20+value)::text order by value) dates from generate_series(1,$1::integer) value",
      [values.number_of_rounds],
    )).rows[0].dates;
  }
  return (await db.query(
    "select public.create_competition_with_shooting_details($1,$2,$3::jsonb) data",
    [org, season, JSON.stringify(values)],
  )).rows[0].data;
}

test("built-in equipment and positions have stable analytics codes", async () => {
  const equipment = (await db.query(
    "select code,display_name from shooting_equipment_types order by sort_order",
  )).rows;
  const positions = (await db.query(
    "select code,display_name from shooting_positions order by sort_order",
  )).rows;
  assert.deepEqual(equipment.map((row) => row.code), [
    "smallbore_rifle", "fullbore_rifle", "lightweight_sporting_rifle",
    "gallery_rifle", "air_rifle", "pistol", "air_pistol", "shotgun",
  ]);
  assert.deepEqual(positions.map((row) => row.code), [
    "prone", "standing", "kneeling", "benchrest",
  ]);
});

test("custom equipment normalises, reuses, and remains Organisation-scoped", async () => {
  const first = await create("Custom equipment A", {
    equipment_type_code: null,
    custom_equipment_type_name: " Sniper   Rifle ",
  });
  const second = await create("Custom equipment B", {
    equipment_type_code: null,
    custom_equipment_type_name: "sniper rifle",
  });
  const rows = (await db.query(
    "select id,display_name,normalized_name from organisation_equipment_types where organisation_id=1",
  )).rows;
  assert.deepEqual(rows.map((row) => [row.display_name, row.normalized_name]), [
    ["Sniper Rifle", "sniper rifle"],
  ]);
  const ids = (await db.query(
    "select organisation_equipment_type_id from competitions where id in ($1,$2) order by id",
    [first.id, second.id],
  )).rows.map((row) => row.organisation_equipment_type_id);
  assert.equal(ids[0], ids[1]);
  const reused = await create("Custom equipment reused", {
    equipment_type_code: null,
    organisation_equipment_type_id: ids[0],
  });
  assert.equal((await db.query(
    "select organisation_equipment_type_id from competitions where id=$1", [reused.id],
  )).rows[0].organisation_equipment_type_id, ids[0]);

  await become(foreignOwner);
  await create("Foreign custom equipment", {
    equipment_type_code: null,
    custom_equipment_type_name: "SNIPER RIFLE",
  }, 2, 3);
  assert.equal((await db.query("select count(*)::int n from organisation_equipment_types")).rows[0].n, 1);
  await become(owner);
  assert.equal((await db.query("select count(*)::int n from organisation_equipment_types")).rows[0].n, 1);
  await rejected(
    "select public.create_competition_with_shooting_details(1,1,$1::jsonb)",
    [JSON.stringify(configuration("Cross Organisation equipment", {
      equipment_type_code: null,
      organisation_equipment_type_id: 2,
    }))],
    /not found in this Organisation/,
  );
});

test("custom position normalises once and can be reused by multiple components", async () => {
  const created = await create("Custom positions", {
    score_components: [
      component({
        short_label: "A", shooting_position_code: null,
        custom_shooting_position_name: " Supported   Standing ",
      }),
      component({
        short_label: "B", shooting_position_code: null,
        custom_shooting_position_name: "SUPPORTED STANDING",
      }),
    ],
  });
  const custom = (await db.query(
    "select id,display_name,normalized_name from organisation_shooting_positions",
  )).rows;
  assert.equal(custom.length, 1);
  assert.deepEqual([custom[0].display_name, custom[0].normalized_name], [
    "Supported Standing", "supported standing",
  ]);
  const positionIds = (await db.query(
    "select organisation_shooting_position_id from competition_score_components where competition_id=$1 order by position",
    [created.id],
  )).rows.map((row) => row.organisation_shooting_position_id);
  assert.equal(positionIds[0], positionIds[1]);

  await become(foreignOwner);
  await create("Foreign custom position", {
    score_components: [component({
      shooting_position_code: null,
      custom_shooting_position_name: "SUPPORTED STANDING",
    })],
  }, 2, 3);
  assert.equal((await db.query(
    "select count(*)::int n from organisation_shooting_positions",
  )).rows[0].n, 1);
  await become(owner);
  assert.equal((await db.query(
    "select count(*)::int n from organisation_shooting_positions",
  )).rows[0].n, 1);
  await rejected(
    "select public.create_competition_with_shooting_details(1,1,$1::jsonb)",
    [JSON.stringify(configuration("Cross Organisation position", {
      score_components: [component({
        shooting_position_code: null,
        organisation_shooting_position_id: 2,
      })],
    }))],
    /not found in this Organisation/,
  );
});

test("safe shooting display resolves built-in and Organisation custom labels without internal codes", async () => {
  const builtIn = await create("Built-in display");
  const custom = await create("Custom display", {
    equipment_type_code: null,
    custom_equipment_type_name: "Water Pistol",
    score_components: [component({
      short_label: "50m",
      shooting_position_code: null,
      custom_shooting_position_name: "Supported Standing",
      distance_value: 50,
      distance_unit: "metres",
      shots: 20,
    })],
  });
  const builtInDisplay = (await db.query(
    "select public.get_competition_shooting_display(1,1,$1) data", [builtIn.id],
  )).rows[0].data;
  assert.equal(builtInDisplay.equipment_name, "Smallbore Rifle");
  assert.equal(builtInDisplay.components[0].position_name, "Prone");
  const customDisplay = (await db.query(
    "select public.get_competition_shooting_display(1,1,$1) data", [custom.id],
  )).rows[0].data;
  assert.equal(customDisplay.equipment_name, "Water Pistol");
  assert.deepEqual(customDisplay.components[0], {
    component_id: customDisplay.components[0].component_id,
    position_mode: "fixed",
    position_name: "Supported Standing",
    distance_mode: "fixed",
    distance_value: 50,
    distance_unit: "metres",
    shots: 20,
  });
  assert.doesNotMatch(JSON.stringify(customDisplay), /smallbore_rifle|organisation_equipment_type_id/);

  await become(foreignOwner);
  await rejected(
    "select public.get_competition_shooting_display(1,1,$1)", [custom.id],
    /not available|permission/i,
  );
  await become(owner);
});

test("legacy shooting display stays explicitly unconfigured", async () => {
  const legacy = (await db.query(`select public.create_competition(
    1,1,'Legacy display',null,'individual',1,10,false,1,0,
    'season_default',null,null,'season_default',null,1,
    '[{"short_label":"P","maximum_score":100,"score_method":"points_scored"}]'::jsonb,
    'aggregate',null,true,array[current_date+30],array[]::date[]
  ) data`)).rows[0].data;
  assert.deepEqual((await db.query(
    "select public.get_competition_shooting_display(1,1,$1) data", [legacy.id],
  )).rows[0].data, { configured: false, equipment_name: null, components: [] });
});

test("distance modes retain exact values/units and reject invalid combinations", async () => {
  const created = await create("Distance modes", {
    score_components: [
      component({ short_label: "M", distance_value: 50.25, distance_unit: "metres" }),
      component({ short_label: "Y", distance_value: 100, distance_unit: "yards" }),
      component({ short_label: "F", distance_value: 75, distance_unit: "feet" }),
      component({ short_label: "V", distance_mode: "variable", distance_value: null, distance_unit: null }),
      component({ short_label: "N", distance_mode: "not_applicable", distance_value: null, distance_unit: null }),
    ],
  });
  const rows = (await db.query(
    "select distance_mode,distance_value::text,distance_unit from competition_score_components where competition_id=$1 order by position",
    [created.id],
  )).rows;
  assert.deepEqual(rows, [
    { distance_mode: "fixed", distance_value: "50.250", distance_unit: "metres" },
    { distance_mode: "fixed", distance_value: "100.000", distance_unit: "yards" },
    { distance_mode: "fixed", distance_value: "75.000", distance_unit: "feet" },
    { distance_mode: "variable", distance_value: null, distance_unit: null },
    { distance_mode: "not_applicable", distance_value: null, distance_unit: null },
  ]);
  for (const bad of [
    component({ distance_value: 0 }),
    component({ distance_value: -1 }),
    component({ distance_mode: "variable", distance_value: 50, distance_unit: "metres" }),
  ]) {
    await rejected(
      "select public.create_competition_with_shooting_details(1,1,$1::jsonb)",
      [JSON.stringify(configuration(`Bad distance ${Math.random()}`, { score_components: [bad] }))],
      /distance|check constraint/i,
    );
  }
});

test("component shots derive the only editable Round total and publication requires completeness", async () => {
  const dewar = await create("Double Dewar", {
    sets_per_round: 2,
    score_components: [
      component({ short_label: "50m", shots: 20 }),
      component({ short_label: "100yd", distance_value: 100, distance_unit: "yards", shots: 20 }),
    ],
  });
  assert.equal((await db.query(
    "select shots_per_round from competitions where id=$1", [dewar.id],
  )).rows[0].shots_per_round, 80);

  const incomplete = await create("Incomplete draft", {
    equipment_type_code: null,
    score_components: [component({
      shooting_position_mode: null,
      shooting_position_code: null,
      distance_mode: null,
      distance_value: null,
      distance_unit: null,
      shots: null,
    })],
  });
  assert.equal((await db.query(
    "select shots_per_round from competitions where id=$1", [incomplete.id],
  )).rows[0].shots_per_round, null);
  await rejected(
    "select public.publish_competition(1,1,$1)", [incomplete.id],
    /Physical shooting details required/,
  );
  await rejected(
    "select public.create_competition_with_shooting_details(1,1,$1::jsonb)",
    [JSON.stringify(configuration("No shots", { score_components: [component({ shots: 0 })] }))],
    /Shots|check constraint/i,
  );
});

test("Series identity stores physical details and Continue Series copies them exactly", async () => {
  const first = (await db.query(
    "select public.create_competition_series(1,1,'Dewar Series',$1::jsonb) data",
    [JSON.stringify(configuration("Dewar First", {
      score_components: [
        component({ short_label: "50m", shots: 20 }),
        component({ short_label: "100yd", distance_value: 100, distance_unit: "yards", shots: 20 }),
      ],
    }))],
  )).rows[0].data;
  const continued = (await db.query(
    "select public.continue_competition_series(1,2,$1,$2,$3,$4::jsonb) data",
    [first.competition_series_id, first.id, first.configuration_version, JSON.stringify({
      name: "Dewar Second", description: null, entry_fee: 0,
      uses_x_score: false, number_of_rounds: 3, local_scoring_enabled: true,
      entry_window_mode: "season_default", custom_entry_opens_at: null,
      custom_entry_closes_at: null, start_date_mode: "season_default",
      custom_starts_at: null, ranking_method: "gun_score", best_rounds_count: null,
      round_deadlines: [], round_shoot_by_dates: [],
    })],
  )).rows[0].data;
  const parents = (await admin(
    "select shooting_details_version,equipment_type_code,shots_per_round from competition_series where id=$1",
    [first.competition_series_id],
  )).rows[0];
  assert.deepEqual(parents, {
    shooting_details_version: 1, equipment_type_code: "smallbore_rifle", shots_per_round: 40,
  });
  const sourceComponents = (await admin(
    "select shooting_position_mode,shooting_position_code,distance_mode,distance_value,distance_unit,shots from competition_score_components where competition_id=$1 order by position",
    [first.id],
  )).rows;
  const continuedComponents = (await admin(
    "select shooting_position_mode,shooting_position_code,distance_mode,distance_value,distance_unit,shots from competition_score_components where competition_id=$1 order by position",
    [continued.id],
  )).rows;
  assert.deepEqual(continuedComponents, sourceComponents);
  assert.equal((await admin("select ranking_method from competitions where id=$1", [continued.id])).rows[0].ranking_method, "gun_score");
});

test("legacy rows are not backfilled and still publish normally", async () => {
  const legacy = (await db.query(`select public.create_competition(
    1,1,'Legacy',null,'individual',1,10,false,1,0,
    'season_default',null,null,'season_default',null,1,
    '[{"short_label":"P","maximum_score":100,"score_method":"points_scored"}]'::jsonb,
    'aggregate',null,true,array[current_date+30],array[]::date[]
  ) data`)).rows[0].data;
  await db.query("select public.publish_competition(1,1,$1)", [legacy.id]);
  const row = (await admin(
    "select shooting_details_version,equipment_type_code,organisation_equipment_type_id,shots_per_round from competitions where id=$1",
    [legacy.id],
  )).rows[0];
  assert.deepEqual(row, {
    shooting_details_version: null,
    equipment_type_code: null,
    organisation_equipment_type_id: null,
    shots_per_round: 10,
  });
  assert.deepEqual((await admin(
    "select shooting_position_mode,distance_mode,shots from competition_score_components where competition_id=$1",
    [legacy.id],
  )).rows[0], { shooting_position_mode: null, distance_mode: null, shots: null });
});

test("published structured details and active Concurrent definitions remain locked", async () => {
  const a = await create("Lock A");
  const b = await create("Lock B");
  await db.query("select public.publish_competition(1,1,$1)", [a.id]);
  await db.query("select public.publish_competition(1,1,$1)", [b.id]);
  await rejected(
    "select public.update_competition_shooting_details_draft(1,1,$1,$2::jsonb)",
    [a.id, JSON.stringify(configuration("Changed"))], /Only a draft Competition/,
  );
  const group = (await db.query(
    "select public.create_concurrent_shooting_group(1,1,'Locked physical shoot') data",
  )).rows[0].data;
  await db.query("select public.add_concurrent_shooting_group_competition(1,$1,$2)", [group.id, a.id]);
  await db.query("select public.add_concurrent_shooting_group_competition(1,$1,$2)", [group.id, b.id]);
  const physicalId = (await db.query(
    "select public.create_concurrent_shooting_round(1,$1,1,null) id", [group.id],
  )).rows[0].id;
  for (const competition of [a, b]) {
    const roundId = (await admin(
      "select id from competition_rounds where competition_id=$1 and round_number=1", [competition.id],
    )).rows[0].id;
    await db.query(
      "select public.add_concurrent_shooting_round_mapping(1,$1,$2,$3,$4)",
      [group.id, physicalId, competition.id, roundId],
    );
  }
  await db.query("select public.activate_concurrent_shooting_group(1,$1)", [group.id]);
  await assert.rejects(
    () => admin("update competition_score_components set shots=11 where competition_id=$1", [a.id]),
    /Concurrent Shooting score components are immutable/,
  );
});
