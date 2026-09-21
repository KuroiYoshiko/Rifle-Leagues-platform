import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CANONICAL_FRESH_INSTALL_ORDER } from "./helpers/database-install-manifest.mjs";
import {
  assertCriticalReadContracts,
  assertDatabaseMetadataInvariants,
  loadProductionReadProjections,
  seedCriticalReadContractFixture,
} from "./helpers/critical-database-contracts.mjs";

const db = new PGlite();
const actors = {
  organisationOwner: "93000000-0000-4000-8000-000000000001",
  organisationManager: "93000000-0000-4000-8000-000000000002",
  clubOwner: "93000000-0000-4000-8000-000000000003",
  memberOne: "93000000-0000-4000-8000-000000000004",
  memberTwo: "93000000-0000-4000-8000-000000000005",
};
let projections;

function mainSql(name) {
  return execFileSync(
    "git",
    ["show", `main:database/${name}.sql`],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
}

async function installMainDatabase() {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    set timezone = 'UTC';
    create schema auth;
    grant usage on schema public,auth to anon,authenticated;
    create table auth.users(
      id uuid primary key,
      raw_user_meta_data jsonb default '{}',
      created_at timestamptz default now()
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  `);

  for (const name of CANONICAL_FRESH_INSTALL_ORDER) {
    try {
      await db.exec(mainSql(name));
    } catch (error) {
      throw new Error(`Main schema ${name}: ${error.message}`, { cause: error });
    }
  }
}

async function actor(name) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actors[name]]);
  await db.exec("set role authenticated");
}

async function call(name, params = []) {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(",");
  return (
    await db.query(`select public.${name}(${placeholders}) as data`, params)
  ).rows[0].data;
}

async function expectError(run, pattern) {
  await db.exec("savepoint expected_upgrade_error");
  try {
    await run();
    assert.fail("Expected the upgraded database operation to fail");
  } catch (error) {
    await db.exec(
      "rollback to savepoint expected_upgrade_error; release savepoint expected_upgrade_error",
    );
    assert.match(error.message, pattern);
  }
}

before(async () => {
  projections = await loadProductionReadProjections();
  await installMainDatabase();

  const beforeUpgrade = await db.query(`
    select
      to_regprocedure('public.delete_league_season(bigint,bigint)') is null
        as delete_missing,
      to_regprocedure('public.get_competition_publish_readiness(bigint,bigint,bigint)') is null
        as readiness_missing,
      to_regprocedure('private.competition_publication_readiness_errors(date,date,date,text,jsonb,integer,integer,date[])') is null
        as helper_missing
  `);
  assert.deepEqual(beforeUpgrade.rows[0], {
    delete_missing: true,
    readiness_missing: true,
    helper_missing: true,
  });

  const upgrade = await readFile(
    new URL(
      "../database/upgrades/2026-09-21_prelaunch-ux-polish.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(upgrade);
  await db.exec(upgrade);
  await seedCriticalReadContractFixture(db);
  await db.exec("reset role");
});

after(async () => db.close());

beforeEach(async () => {
  await db.exec("begin; reset role");
  for (const [name, id] of Object.entries(actors)) {
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [
      id,
      { first_name: name, last_name: "Upgrade tester" },
    ]);
  }
  await db.exec(`
    insert into public.organisations(id,name,slug,status)
      overriding system value values(100,'Upgrade County','upgrade-county','active');
    insert into public.league_seasons(
      id,organisation_id,name,slug,status,
      entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (100,100,'Empty Draft','empty-draft','draft',null,null,null,null),
      (101,100,'Draft With Competition','draft-with-competition','draft',null,null,null,null),
      (102,100,'Open Empty','open-empty','open',current_date-10,current_date+10,current_date+20,current_date+100),
      (103,100,'Unrelated Empty Draft','unrelated-empty-draft','draft',null,null,null,null),
      (104,100,'Concurrent Draft','concurrent-draft','draft',null,null,null,null),
      (105,100,'Entry Season','entry-season','open',current_date-10,current_date+10,current_date+20,current_date+100);
  `);
  await db.query(`
    insert into public.organisation_staff(organisation_id,user_id,role,status)
    values
      (100,$1,'owner','active'),
      (100,$2,'manager','active')
  `, [actors.organisationOwner, actors.organisationManager]);
  await db.exec(`
    insert into public.clubs(id,name,slug,status)
      overriding system value values(100,'Upgrade Club','upgrade-club','active');
  `);
  await db.query(`
    insert into public.club_memberships(id,club_id,user_id,role,status)
      overriding system value values
      (100,100,$1,'owner','active'),
      (101,100,$2,'member','active'),
      (102,100,$3,'member','active')
  `, [actors.clubOwner, actors.memberOne, actors.memberTwo]);
  await db.exec(`
    insert into public.competitions(
      id,league_season_id,name,slug,status,entry_format,team_size,
      scoring_method,maximum_score_per_round,shots_per_round,uses_x_score,
      number_of_rounds,entry_window_mode,start_date_mode,sets_per_round,
      ranking_method,local_scoring_enabled
    ) overriding system value values
      (100,101,'Incomplete Draft','incomplete-draft','draft','individual',1,
       'points_scored',100,10,false,1,'season_default','season_default',1,
       'aggregate',false),
      (101,105,'Published Pairs','published-pairs','draft','pairs',2,
       'points_scored',100,10,false,1,'season_default','season_default',1,
       'aggregate',false);
    insert into public.competition_score_components(
      competition_id,position,short_label,maximum_score,score_method
    ) values(101,1,'Score',100,'points_scored');
    insert into public.competition_rounds(
      competition_id,round_number,deadline
    ) values(101,1,current_date+40);
    update public.competitions set status='published' where id=101;
    insert into public.club_competition_entries(
      id,competition_id,club_id,status
    ) overriding system value values(100,101,100,'draft');
    insert into public.concurrent_shooting_groups(
      id,organisation_id,league_season_id,name,status
    ) overriding system value values(100,100,104,'Concurrent setup','draft');
  `);
  await actor("organisationOwner");
});

afterEach(async () => db.exec("rollback; reset role"));

test("the rerunnable upgrade satisfies current database metadata and read projections", async () => {
  await assertDatabaseMetadataInvariants(db, projections);
  await assertCriticalReadContracts(db, projections);

  await db.exec("reset role");
  const privileges = await db.query(`
    select
      has_function_privilege('authenticated','public.delete_league_season(bigint,bigint)','EXECUTE')
        as authenticated_delete,
      has_function_privilege('anon','public.delete_league_season(bigint,bigint)','EXECUTE')
        as anon_delete,
      has_function_privilege('authenticated','public.get_competition_publish_readiness(bigint,bigint,bigint)','EXECUTE')
        as authenticated_readiness,
      has_function_privilege('authenticated','private.competition_publication_readiness_errors(date,date,date,text,jsonb,integer,integer,date[])','EXECUTE')
        as authenticated_helper
  `);
  assert.deepEqual(privileges.rows[0], {
    authenticated_delete: true,
    anon_delete: false,
    authenticated_readiness: true,
    authenticated_helper: false,
  });
});

test("publication readiness and publication use the same upgraded validator", async () => {
  await actor("organisationOwner");
  const readiness = await call("get_competition_publish_readiness", [100, 101, 100]);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.requirements, [
    "Set a complete effective Competition entry window before publishing.",
    "Set an effective Competition Start before publishing.",
    "Add at least one Course of Fire score component before publishing.",
    "Set a Round End for every configured round before publishing.",
  ]);
  await expectError(
    () => call("publish_competition", [100, 101, 100]),
    /Set a complete effective Competition entry window before publishing/,
  );
});

test("ordinary Club members receive safe read-only context without seeing a draft entry", async () => {
  await actor("memberOne");
  const context = await db.query(
    "select * from public.get_competition_club_entry_context($1)",
    [101],
  );
  assert.equal(context.rows.length, 1);
  assert.equal(Number(context.rows[0].club_id), 100);
  assert.equal(context.rows[0].club_role, "member");
  assert.equal(context.rows[0].entry_id, null);
  assert.equal(context.rows[0].entry_status, null);
  assert.equal(context.rows[0].can_manage, false);
  assert.equal(context.rows[0].entry_window_state, "open");
});

test("Pair entry behavior remains operational through the upgraded function bodies", async () => {
  await actor("clubOwner");
  const pair = await call("create_club_team", [
    100,
    "Upgrade Pair",
    "pair",
    [100, 101],
  ]);
  const saved = await call("save_club_competition_entry", [
    100,
    [{ club_team_id: pair.id }],
  ]);
  assert.equal(saved.status, "draft");
  assert.equal(saved.entrant_count, 1);
  assert.equal(saved.participant_count, 2);
});

test("an active Organisation Owner can delete one eligible empty draft only", async () => {
  const deleted = await call("delete_league_season", [100, 100]);
  assert.equal(deleted.season_slug, "empty-draft");
  const remaining = await db.query(
    "select id from public.league_seasons where organisation_id=100 order by id",
  );
  assert.deepEqual(remaining.rows.map((row) => Number(row.id)), [101, 102, 103, 104, 105]);
  assert.equal(
    Number((await db.query("select count(*) as count from public.competitions where league_season_id in (101,105)")).rows[0].count),
    2,
  );
});

test("a draft Season containing a Competition cannot be deleted", async () => {
  await expectError(
    () => call("delete_league_season", [100, 101]),
    /containing Competitions cannot be deleted/,
  );
});

test("a non-draft Season cannot be deleted", async () => {
  await expectError(
    () => call("delete_league_season", [100, 102]),
    /Only a draft league season can be deleted/,
  );
});

test("an Organisation Manager cannot delete a Season", async () => {
  await actor("organisationManager");
  await expectError(
    () => call("delete_league_season", [100, 103]),
    /Only this organisation owner can delete/,
  );
});

test("Concurrent Shooting setup blocks otherwise-empty draft deletion", async () => {
  await expectError(
    () => call("delete_league_season", [100, 104]),
    /containing Concurrent Shooting setup cannot be deleted/,
  );
});
