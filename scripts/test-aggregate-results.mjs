import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, before, after, beforeEach, afterEach } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Disposable PostgreSQL only: no credentials, network, or application data.
// Minimal source-schema fixture; the production derivation and standings SQL
// run verbatim, including SECURITY DEFINER, auth checks and EXECUTE grants.
const db = new PGlite();
const viewer = "00000000-0000-0000-0000-000000000001";
before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema private;
    grant usage on schema public, auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table organisations(id bigint primary key, status text);
    create table league_seasons(id bigint primary key, organisation_id bigint, status text);
    create table competitions(id bigint primary key, league_season_id bigint,
      name text, slug text, status text, entry_format text, team_size integer,
      sets_per_round integer, uses_x_score boolean, ranking_method text, best_rounds_count integer);
    create table competition_score_components(id bigint primary key, competition_id bigint,
      position integer, short_label text, maximum_score numeric, score_method text);
    create table competition_rounds(id bigint primary key, competition_id bigint,
      round_number integer, deadline date, shoot_by_date date);
    create table clubs(id bigint primary key, name text, status text);
    create table club_competition_entries(id bigint primary key, competition_id bigint, club_id bigint, status text);
    create table competition_entrants(id bigint primary key, club_competition_entry_id bigint, position integer);
    create table club_memberships(id bigint primary key, club_id bigint, user_id uuid, status text, role text);
    create table profiles(id uuid primary key, first_name text, last_name text, phone text, address text);
    create table competition_entrant_participants(id bigint primary key, competition_entrant_id bigint,
      club_competition_entry_id bigint, club_membership_id bigint, slot_number integer);
    create table competition_score_usages(competition_id bigint, competition_round_id bigint,
      competition_entrant_participant_id bigint, shooting_score_source_id bigint);
    create table shooting_score_values(id bigint generated always as identity primary key,
      shooting_score_source_id bigint, set_number integer, component_position integer,
      achieved_score numeric, x_count integer);
    create table competition_division_configs(competition_id bigint primary key, status text);
    create table competition_divisions(id bigint primary key, competition_id bigint, name text, position integer);
    create table competition_division_assignments(competition_id bigint, competition_entrant_id bigint, competition_division_id bigint);
    create table organisation_staff(organisation_id bigint, user_id uuid, status text, role text);
    alter table shooting_score_values enable row level security;
    alter table profiles enable row level security;
  `);
  for (let rerun = 0; rerun < 2; rerun++) {
    for (const file of ["competition-results.sql", "competition-aggregate-results.sql"]) {
      await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), "utf8"));
    }
  }
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [viewer]);
});
afterEach(async () => { await db.exec("rollback; reset role"); });

async function fixture({ format = "individual", size = 1, mode = "points_scored", x = false, divisions = true } = {}) {
  await db.exec(`
    insert into organisations values (1, 'active');
    insert into league_seasons values (1, 1, 'active');
    insert into clubs values (1, 'Club A', 'active'), (2, 'Club B', 'active');
    insert into club_competition_entries values (1,1,1,'submitted'), (2,1,2,'submitted');
  `);
  await db.query("insert into competitions values (1,1,'Test','test','published',$1,$2,1,$3,'aggregate',null)", [format, size, x]);
  await db.query("insert into competition_score_components values (1,1,1,'A',100,$1)", [mode]);
  await db.exec(`
    insert into competition_rounds values
      (1,1,1,(statement_timestamp() at time zone 'UTC')::date - 1,null),
      (2,1,2,(statement_timestamp() at time zone 'UTC')::date,(statement_timestamp() at time zone 'UTC')::date - 2),
      (3,1,3,(statement_timestamp() at time zone 'UTC')::date + 1,null);
  `);
  if (divisions) await db.exec(`
    insert into competition_division_configs values (1,'published');
    insert into competition_divisions values (1,1,'Division 1',1);
  `);
  for (let entrant = 1; entrant <= 5; entrant++) {
    const club = entrant % 2 + 1;
    await db.query("insert into competition_entrants values ($1::bigint,$2,$1::integer)", [entrant, club]);
    if (divisions) await db.query("insert into competition_division_assignments values (1,$1,1)", [entrant]);
    for (let slot = 1; slot <= size; slot++) {
      const id = entrant * 10 + slot;
      const uuid = `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
      await db.query("insert into profiles values ($1,$2,$3,'PRIVATE PHONE','PRIVATE ADDRESS')", [uuid, `Shooter ${entrant}`, `Slot ${slot}`]);
      await db.query("insert into club_memberships values ($1,$2,$3,'active','member')", [id, club, uuid]);
      await db.query("insert into competition_entrant_participants values ($1,$2,$3,$1,$4)", [id, entrant, club, slot]);
      for (let round = 1; round <= 3; round++) {
        const source = id * 10 + round;
        await db.query("insert into competition_score_usages values (1,$1,$2,$3)", [round, id, source]);
        await db.query("insert into shooting_score_values (shooting_score_source_id,set_number,component_position,achieved_score,x_count) values ($1,1,1,$2,$3)", [source, round === 1 ? 100 - entrant : 88.12, x ? entrant : null]);
      }
    }
  }
}

async function read(organisation = 1, season = 1, competition = 1) {
  await db.exec("set role authenticated");
  try {
    return (await db.query("select public.get_competition_aggregate_results($1,$2,$3) as data", [organisation, season, competition])).rows[0].data;
  } finally { await db.exec("reset role").catch(() => {}); }
}
const entrants = (data) => data.groups.flatMap((group) => group.entrants);
const firstPoints = (data) => entrants(data).map((entrant) => entrant.rounds[0].ranking_points);

test("five entrants: 5..1 points; Individual rows and scored gun totals", async () => {
  await fixture();
  const data = await read();
  assert.deepEqual(firstPoints(data), [5, 4, 3, 2, 1]);
  assert.deepEqual(entrants(data).map((e) => e.position), [1, 2, 3, 4, 5]);
  assert.deepEqual(entrants(data).map((e) => e.gun_total), [99, 98, 97, 96, 95]);
  assert.equal(entrants(data)[0].participants[0].first_name, "Shooter 1");
  assert.equal(entrants(data)[0].entrant_format, "individual");
  assert.equal(entrants(data)[0].maximum_total, 100);
  assert.equal(entrants(data)[0].scored_rounds, 1);
});

test("NSR is derived after release; N includes missing entrants; no source writes", async () => {
  await fixture();
  await db.exec("delete from shooting_score_values where shooting_score_source_id = 511");
  const before = (await db.query("select count(*) from shooting_score_values")).rows;
  const data = await read();
  assert.deepEqual(firstPoints(data), [5, 4, 3, 2, 0]);
  assert.deepEqual(entrants(data)[4].rounds[0], { round_id: 1, state: "nsr", gun_score: null, ranking_points: 0 });
  assert.equal(entrants(data)[4].gun_total, null);
  assert.deepEqual((await db.query("select count(*) from shooting_score_values")).rows, before);
});

test("equal gun results share competition rank and points: 5,5,3,2,1", async () => {
  await fixture();
  await db.exec("update shooting_score_values set achieved_score=99 where shooting_score_source_id=211");
  const data = await read();
  assert.deepEqual(firstPoints(data), [5, 5, 3, 2, 1]);
  assert.deepEqual(entrants(data).map((e) => e.position), [1, 1, 3, 4, 5]);
  assert.deepEqual(entrants(data).slice(0, 2).map((e) => [e.entrant_id, e.tied]), [[1, true], [2, true]]);
  assert.deepEqual(await read(), data);
});

test("Points dropped display uses maximum minus achieved; strongest still earns 5", async () => {
  await fixture({ mode: "points_dropped" });
  const data = await read();
  assert.deepEqual(firstPoints(data), [5, 4, 3, 2, 1]);
  assert.deepEqual(entrants(data).map((e) => e.rounds[0].gun_score), [1, 2, 3, 4, 5]);
  assert.deepEqual(entrants(data).map((e) => e.gun_total), [1, 2, 3, 4, 5]);
});

test("X resolves equal Round gun results; equal X preserves ties", async () => {
  await fixture({ x: true });
  await db.exec("update shooting_score_values set achieved_score=99 where shooting_score_source_id=211");
  let data = await read();
  assert.deepEqual(entrants(data).slice(0, 2).map((e) => e.entrant_id), [2, 1]);
  assert.equal(entrants(data)[0].rounds[0].x_total, 2);
  await db.exec("update shooting_score_values set x_count=1 where shooting_score_source_id=211");
  data = await read();
  assert.deepEqual(firstPoints(data), [5, 5, 3, 2, 1]);
  assert.equal(entrants(data)[0].tied, true);
});

for (const [format, size] of [["pairs", 2], ["team", 4]]) {
  test(`${format}: one entrant row, combined gun/X, inspectable names, partial entrant becomes NSR`, async () => {
    await fixture({ format, size, x: true, mode: "points_dropped" });
    let data = await read();
    assert.equal(entrants(data).length, 5);
    assert.equal(entrants(data)[0].participants.length, size);
    assert.equal(entrants(data)[0].gun_total, size);
    assert.equal(entrants(data)[0].x_total, size);
    assert.equal(entrants(data)[0].entrant_label, format === "pairs" ? "Pair 1" : "Team 1");
    await db.exec("delete from shooting_score_values where shooting_score_source_id=111");
    data = await read();
    const incomplete = entrants(data).find((e) => e.entrant_id === 1);
    assert.equal(incomplete.rounds[0].state, "nsr");
    assert.equal(incomplete.gun_total, null);
    assert.equal(incomplete.x_total, null);
    assert.deepEqual(firstPoints(data), [5, 4, 3, 2, 0]);
  });
}

test("source correction automatically recomputes Round points, totals and order", async () => {
  await fixture();
  assert.equal(entrants(await read())[0].entrant_id, 1);
  await db.exec("update shooting_score_values set achieved_score=100 where shooting_score_source_id=511");
  const data = await read();
  assert.equal(entrants(data)[0].entrant_id, 5);
  assert.equal(entrants(data)[0].total_points, 5);
  assert.equal(entrants(data)[0].gun_total, 100);
  assert.equal(entrants(data)[1].total_points, 4);
});

test("saved scores on deadline day and future Rounds never leak, even to organiser", async () => {
  await fixture({ x: true });
  const memberData = await read();
  await db.query("insert into organisation_staff values (1,$1,'active','manager')", [viewer]);
  assert.deepEqual(await read(), memberData);
  assert.deepEqual(memberData.rounds.map((r) => r.released), [true, false, false]);
  assert.equal(memberData.released_round_count, 1);
  for (const entrant of entrants(memberData)) {
    for (const cell of entrant.rounds.slice(1)) {
      assert.deepEqual(cell, { round_id: cell.round_id, state: "pending", gun_score: null, ranking_points: null, x_total: null });
    }
  }
  assert.ok(!JSON.stringify(memberData).includes("88.12"));
  const diagnostic = (await db.query("select public.get_competition_round_results(1,1,1) as data")).rows[0].data;
  assert.equal(diagnostic.rounds[1].entrants[0].achieved_score, 88.12);
  // The same source is released automatically when its Round End has passed.
  await db.exec("update competition_rounds set deadline=deadline-1 where id=2");
  assert.equal((await read()).released_round_count, 2);
  assert.equal(entrants(await read())[0].rounds[1].gun_score, 88.12);
});

test("published divisions isolate N and placements across clubs", async () => {
  await fixture();
  await db.exec(`
    insert into competition_divisions values (2,1,'Division 2',2);
    update competition_division_assignments set competition_division_id=2 where competition_entrant_id>=4;
  `);
  const data = await read();
  assert.deepEqual(data.groups.map((g) => g.entrants.map((e) => e.total_points)), [[3, 2, 1], [2, 1]]);
  assert.deepEqual(new Set(entrants(data).map((e) => e.club_name)), new Set(["Club A", "Club B"]));
});

test("no divisions supports an ungrouped table; draft and incomplete allocations fail closed", async () => {
  await fixture({ divisions: false });
  assert.equal((await read()).groups[0].id, 0);
  assert.deepEqual(firstPoints(await read()), [5, 4, 3, 2, 1]);
  await db.exec("insert into competition_division_configs values (1,'draft')");
  assert.deepEqual(await read(), { status: "awaiting_divisions", rounds: [], groups: [] });
  await db.exec("update competition_division_configs set status='published'");
  assert.equal((await read()).status, "awaiting_divisions");
});

test("API excludes private/profile/source fields; disabled X is omitted", async () => {
  await fixture();
  const data = await read();
  const json = JSON.stringify(data);
  for (const forbidden of ["PRIVATE", "phone", "address", "profile_id", "component_values", "achieved_score", "x_total", "recorded_slot_count"]) {
    assert.ok(!json.includes(forbidden), forbidden);
  }
  assert.deepEqual(Object.keys(entrants(data)[0].participants[0]).sort(), ["first_name", "last_name", "slot_number"]);
});

for (const mode of ["points_scored", "points_dropped"]) {
  test(`${mode}: equal total ranking points resolve by gun aggregate, then X`, async () => {
    await fixture({ mode, x: true });
    await db.exec(`
      update competition_rounds set deadline=deadline-1 where id=2;
      update shooting_score_values set achieved_score=case shooting_score_source_id
        when 112 then 95 when 212 then 100 when 312 then 94 when 412 then 93 when 512 then 92 end,
        x_count=0 where shooting_score_source_id % 10=2;
    `);
    // A: 5+4=9, achieved 194; B: 4+5=9, achieved 198.
    let data = await read();
    assert.deepEqual(entrants(data).slice(0, 2).map((e) => [e.entrant_id, e.total_points]), [[2, 9], [1, 9]]);
    assert.equal(entrants(data)[0].gun_total, mode === "points_scored" ? 198 : 2);
    // Equal gun aggregates (197) leave X to decide overall order.
    await db.exec(`
      update shooting_score_values set achieved_score=98, x_count=5 where shooting_score_source_id=112;
      update shooting_score_values set achieved_score=99 where shooting_score_source_id=212;
    `);
    data = await read();
    assert.deepEqual(entrants(data).slice(0, 2).map((e) => e.entrant_id), [1, 2]);
    // Equal overall X preserves the tie, independently of differing Round X.
    await db.exec("update shooting_score_values set x_count=4 where shooting_score_source_id=212");
    assert.deepEqual(entrants(await read()).slice(0, 2).map((e) => [e.position, e.tied]), [[1, true], [1, true]]);
  });
}

test("dropped overall gun comparison excludes NSR maximums when attendance differs", async () => {
  await fixture({ mode: "points_dropped" });
  await db.exec(`
    update competition_rounds set deadline=deadline-1 where id=2;
    update shooting_score_values set achieved_score=case shooting_score_source_id
      when 111 then 100 when 211 then 95 when 311 then 99 when 411 then 98 when 511 then 97 end
      where shooting_score_source_id % 10=1;
    delete from shooting_score_values where shooting_score_source_id=112;
    update shooting_score_values set achieved_score=case shooting_score_source_id
      when 212 then 96 when 312 then 97 when 412 then 95 when 512 then 94 end
      where shooting_score_source_id % 10=2;
  `);
  // A: one scored Round earns 5; B: 1+4=5. A's 0 dropped beats B's 9.
  const rows = entrants(await read()).filter((e) => [1, 2].includes(e.entrant_id));
  assert.deepEqual(rows.map((e) => [e.entrant_id, e.total_points, e.gun_total]), [[1, 5, 0], [2, 5, 9]]);
});

test("multi-set mixed course derives normalized totals and withholds incomplete slots", async () => {
  await fixture();
  await db.exec(`
    update competitions set sets_per_round=2;
    insert into competition_score_components values (2,1,2,'B',50,'points_dropped');
    insert into shooting_score_values(shooting_score_source_id,set_number,component_position,achieved_score,x_count)
      select shooting_score_source_id, 1, 2, 40.25, null from competition_score_usages;
    insert into shooting_score_values(shooting_score_source_id,set_number,component_position,achieved_score,x_count)
      select shooting_score_source_id, 2, component_position, achieved_score, null
      from shooting_score_values where set_number=1;
  `);
  let data = await read();
  assert.equal(data.display_scoring_mode, "mixed");
  assert.equal(entrants(data)[0].gun_total, 278.5);
  assert.equal(entrants(data)[0].maximum_total, 300);
  assert.deepEqual(firstPoints(data), [5, 4, 3, 2, 1]);
  await db.exec("delete from shooting_score_values where shooting_score_source_id=111 and set_number=2 and component_position=2");
  data = await read();
  assert.equal(entrants(data).find((e) => e.entrant_id===1).rounds[0].state, "nsr");
});

test("zero is a complete gun result; all-NSR and all-pending standings remain tied", async () => {
  await fixture();
  await db.exec("update shooting_score_values set achieved_score=0 where shooting_score_source_id=511");
  assert.equal(entrants(await read())[4].rounds[0].ranking_points, 1);
  await db.exec("delete from shooting_score_values");
  let data = await read();
  assert.ok(entrants(data).every((e) => e.total_points === 0 && e.position === 1 && e.tied));
  assert.ok(entrants(data).every((e) => e.rounds[0].state === "nsr" && e.rounds[1].state === "pending"));
  await db.exec("update competition_rounds set deadline=(statement_timestamp() at time zone 'UTC')::date + 1");
  data = await read();
  assert.equal(data.released_round_count, 0);
  assert.ok(entrants(data).every((e) => e.rounds.every((r) => r.state === "pending" && r.ranking_points === null)));
});

test("auth/context gates, source grants and private derivation cannot be bypassed", async () => {
  await fixture();
  // Use savepoints because expected SQL errors otherwise abort the fixture transaction.
  async function denied(sql, code) {
    await db.exec("savepoint denial");
    await assert.rejects(db.exec(sql), (error) => error.code === code);
    await db.exec("rollback to savepoint denial");
  }
  await denied("set role anon; select public.get_competition_aggregate_results(1,1,1)", "42501");
  await denied("set role authenticated; select * from shooting_score_values", "42501");
  await denied("set role authenticated; select private.derive_competition_round_results(1,1,1,null,false)", "42501");
  await denied("set role authenticated; select public.get_competition_round_results(1,1,1)", "42501");
  await denied("set role authenticated; select public.get_competition_aggregate_results(2,1,1)", "P0002");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await denied("set role authenticated; select public.get_competition_aggregate_results(1,1,1)", "42501");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [viewer]);
  await db.exec("update competitions set status='draft'");
  await denied("set role authenticated; select public.get_competition_aggregate_results(1,1,1)", "P0002");
  await db.exec("update competitions set status='published', ranking_method='gun_score'");
  await denied("set role authenticated; select public.get_competition_aggregate_results(1,1,1)", "22023");
});
