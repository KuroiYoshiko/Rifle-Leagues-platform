import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";

const db = new PGlite();
const actors = {
  owner: "92000000-0000-4000-8000-000000000001",
  manager: "92000000-0000-4000-8000-000000000002",
  outsider: "92000000-0000-4000-8000-000000000003",
};

before(async () => installCanonicalDatabase(db));
after(async () => db.close());

async function actor(name) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    actors[name] ?? "",
  ]);
  await db.exec("set role authenticated");
}

async function expectError(run, pattern) {
  await db.exec("savepoint expected_season_error");
  try {
    await run();
    assert.fail("Expected Season deletion to fail");
  } catch (error) {
    await db.exec(
      "rollback to savepoint expected_season_error; release savepoint expected_season_error",
    );
    assert.match(error.message, pattern);
  }
}

async function deleteSeason(seasonId) {
  return (
    await db.query(
      "select public.delete_league_season($1,$2) as data",
      [1, seasonId],
    )
  ).rows[0].data;
}

beforeEach(async () => {
  await db.exec("begin");
  for (const [name, id] of Object.entries(actors)) {
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [
      id,
      { first_name: name, last_name: "Season tester" },
    ]);
  }
  await db.exec(`
    insert into public.organisations(id,name,slug,status)
      overriding system value values(1,'County League','county-league','active');
    insert into public.league_seasons(
      id,organisation_id,name,slug,status
    ) overriding system value values
      (1,1,'Empty Draft','empty-draft','draft'),
      (2,1,'Draft With Competition','draft-with-competition','draft'),
      (3,1,'Open Empty','open-empty','open'),
      (4,1,'Draft With Concurrent History','draft-with-concurrent-history','draft');
  `);
  await db.query(`
    insert into public.organisation_staff(organisation_id,user_id,role,status)
    values
      (1,$1,'owner','active'),
      (1,$2,'manager','active')
  `, [actors.owner, actors.manager]);
  await db.exec(`
    insert into public.competitions(
      id,league_season_id,name,slug,status,entry_format,team_size,scoring_method,
      maximum_score_per_round,shots_per_round,uses_x_score,number_of_rounds,
      entry_window_mode,start_date_mode,sets_per_round,ranking_method,
      local_scoring_enabled
    ) overriding system value values(
      1,2,'Draft Competition','draft-competition','draft','individual',1,
      'points_scored',100,10,false,1,'season_default','season_default',1,
      'aggregate',false
    );
    insert into public.concurrent_shooting_groups(
      id,organisation_id,league_season_id,name,status
    ) overriding system value values(
      1,1,4,'Concurrent setup','draft'
    );
  `);
  await actor("owner");
});

afterEach(async () => db.exec("rollback; reset role"));

test("an active Organisation Owner can delete only the eligible empty draft Season", async () => {
  const result = await deleteSeason(1);
  assert.deepEqual(result, {
    id: 1,
    organisation_slug: "county-league",
    season_slug: "empty-draft",
    status: "draft",
  });

  const seasons = await db.query(
    "select id from public.league_seasons order by id",
  );
  assert.deepEqual(seasons.rows.map((row) => Number(row.id)), [2, 3, 4]);
  assert.equal(
    Number((await db.query("select count(*) as count from public.competitions")).rows[0].count),
    1,
  );
});

test("a Season containing a Competition cannot be deleted", async () => {
  await expectError(() => deleteSeason(2), /containing Competitions cannot be deleted/);
  assert.equal(
    Number((await db.query("select count(*) as count from public.league_seasons where id=2")).rows[0].count),
    1,
  );
  assert.equal(
    Number((await db.query("select count(*) as count from public.competitions where league_season_id=2")).rows[0].count),
    1,
  );
});

test("a non-Draft Season cannot be deleted", async () => {
  await expectError(() => deleteSeason(3), /Only a draft league season can be deleted/);
  assert.equal(
    Number((await db.query("select count(*) as count from public.league_seasons where id=3")).rows[0].count),
    1,
  );
});

test("an Organisation Manager cannot delete a Season", async () => {
  await actor("manager");
  await expectError(() => deleteSeason(1), /Only this organisation owner can delete/);
  assert.equal(
    Number((await db.query("select count(*) as count from public.league_seasons where id=1")).rows[0].count),
    1,
  );
});

test("Concurrent Shooting setup blocks deletion even without a Competition", async () => {
  await expectError(() => deleteSeason(4), /containing Concurrent Shooting setup cannot be deleted/);
  assert.equal(
    Number((await db.query("select count(*) as count from public.league_seasons where id=4")).rows[0].count),
    1,
  );
});
