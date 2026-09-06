import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, before, after, beforeEach, afterEach } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  getCompetitionResultsRedirect,
  renderAggregateResultsRoute,
} from "./helpers/aggregate-ui-path.mjs";

// Disposable PostgreSQL only: no credentials, network, or application data.
// Minimal source-schema fixture; the production derivation and standings SQL
// run verbatim, including SECURITY DEFINER, context checks and EXECUTE grants.
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
async function readAnonymously(organisation = 1, season = 1, competition = 1) {
  await db.exec("set role anon");
  try {
    return (await db.query("select public.get_competition_aggregate_results($1,$2,$3) as data", [organisation, season, competition])).rows[0].data;
  } finally { await db.exec("reset role").catch(() => {}); }
}
const entrants = (data) => data.groups.flatMap((group) => group.entrants);
const firstPoints = (data) => entrants(data).map((entrant) => entrant.rounds[0].ranking_points);
const renderedEntrantRows = (html) => [...html.matchAll(/<tr data-entrant-row="(\d+)">([\s\S]*?)<\/tr>/g)]
  .map((match) => ({ entrantId: Number(match[1]), html: match[0] }));

// Exact Summer Pairs topology: two entrant rows, one Ex 200 component per
// participant. Contrast with the multi-component calculation fixtures below.
async function summerPairsRuntimeFixture() {
  await fixture({ format: "pairs", size: 2, mode: "points_dropped" });
  await db.exec(`
    update competitions set name='Summer Pairs 200', slug='summer-pairs-200';
    delete from competition_division_assignments where competition_entrant_id > 2;
    delete from competition_entrant_participants where competition_entrant_id > 2;
    delete from competition_entrants where id > 2;
    update competition_score_components set maximum_score=200;
    update shooting_score_values set achieved_score=case shooting_score_source_id
      when 111 then 199 when 121 then 198 when 211 then 198 when 221 then 198
      else 200 end;
  `);
}

test("actual Competition route -> Supabase SSR RPC -> SQL -> rendered cells: Summer Pairs 200", async () => {
  await summerPairsRuntimeFixture();
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  const { html, call } = await renderAggregateResultsRoute({ competition, readRpc: async parameters =>
    read(parameters.p_organisation_id, parameters.p_league_season_id, parameters.p_competition_id) });
  assert.deepEqual(entrants(call.payload).map(e => ({
    label: e.entrant_label, achieved: e.achieved_total, maximum: e.maximum_total,
    gun: e.rounds[0].gun_score, points: e.rounds[0].ranking_points, position: e.position,
  })), [
    { label: "Pair 1", achieved: 397, maximum: 400, gun: 3, points: 2, position: 1 },
    { label: "Pair 2", achieved: 396, maximum: 400, gun: 4, points: 1, position: 2 },
  ]);
  const renderedRows = renderedEntrantRows(html).map((row) => row.html);
  assert.equal(renderedRows.length, 2);
  assert.match(html, /<section id="results"/);
  assert.doesNotMatch(html, /Aggregate standings across released Rounds/);
  assert.doesNotMatch(html, /above each Round’s ranking points/);
  assert.doesNotMatch(html, /href="[^"]*\/results"/);
  for (const [index, row] of renderedRows.entries()) {
    assert.ok(row.includes(`Pair ${index + 1}`));
    assert.match(row, new RegExp(`>${index + 3}<span class="sr-only"> gun result`));
    assert.match(row, new RegExp(`data-total-cell="true"[\\s\\S]*?>${index + 3}<span class="sr-only"> total gun result`));
    assert.match(row, new RegExp(`>${2 - index} <span aria-hidden="true">pts</span><span class="sr-only">total aggregate ranking points`));
    assert.ok(!row.includes("397") && !row.includes("396"), "Must not render achieved totals");
    assert.match(row, />Pending</);
  }
});

test("historical Competition Results route redirects to the embedded Results anchor", async () => {
  assert.equal(
    await getCompetitionResultsRedirect({
      slug: "test-org",
      seasonSlug: "test-season",
      competitionSlug: "summer-pairs-200",
    }),
    "/organisations/test-org/leagues/test-season/competitions/summer-pairs-200#results",
  );
});

test("points-scored Total renders gun_total first and total_points in the Round-style badge", async () => {
  await maximum400Fixture("team", 4, "points_scored");
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  const { html, call } = await renderAggregateResultsRoute({ competition, readRpc: parameters =>
    read(parameters.p_organisation_id, parameters.p_league_season_id, parameters.p_competition_id) });
  const first = renderedEntrantRows(html)[0].html;
  const gunTotal = first.indexOf('>397<span class="sr-only"> total gun result');
  const rankingTotal = first.indexOf('>5 <span aria-hidden="true">pts</span><span class="sr-only">total aggregate ranking points');
  assert.ok(gunTotal >= 0 && rankingTotal > gunTotal, "Total must render achieved gun_total above total_points");
  assert.ok(!first.includes("Gun 397"));
  const winningTeam = entrants(call.payload)[0];
  assert.deepEqual(winningTeam.participants.map(participant => participant.gun_total), [97, 100, 100, 100]);
  const firstParticipant = html.match(/<tr data-participant-row="1">([\s\S]*?)<\/tr>/)[0];
  assert.match(firstParticipant, /data-participant-round="1"[\s\S]*?>97</);
  assert.match(firstParticipant, /data-participant-total="true"[\s\S]*?>97</);
});

test("live source totals reproduce 397/396 through the UI; corrected achieved totals yield 3/4", async () => {
  await summerPairsRuntimeFixture();
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  // The live diagnostic confirms stored achieved SUMS of 3 and 4. Use a
  // synthetic participant split (1+2 and 2+2), not copied personal data or a
  // fabricated RPC response. Every layer below consumes real canonical rows.
  await db.exec(`update shooting_score_values set achieved_score=case shooting_score_source_id
    when 111 then 1 when 121 then 2 when 211 then 2 when 221 then 2 end
    where shooting_score_source_id in (111,121,211,221)`);
  const readRpc = parameters => read(parameters.p_organisation_id, parameters.p_league_season_id, parameters.p_competition_id);
  const before = await renderAggregateResultsRoute({ competition, readRpc });
  assert.deepEqual(entrants(before.call.payload).map(e => [e.entrant_label, e.achieved_total, e.rounds[0].gun_score, e.total_points]), [
    ["Pair 2", 4, 396, 2], ["Pair 1", 3, 397, 1],
  ]);
  const rows = renderedEntrantRows(before.html).map((row) => row.html);
  assert.ok(rows[0].includes("Pair 2") && rows[0].includes('>396<span class="sr-only"> total gun result'));
  assert.ok(rows[1].includes("Pair 1") && rows[1].includes('>397<span class="sr-only"> total gun result'));

  // Model the canonical outcome of verified dropped-point entry: 1+2 dropped
  // becomes 199+198 achieved; 2+2 dropped becomes 198+198 achieved. This only
  // corrects fixture source data; no ranking implementation changes or caches.
  await db.exec(`update shooting_score_values set achieved_score=case shooting_score_source_id
    when 111 then 199 when 121 then 198 when 211 then 198 when 221 then 198 end
    where shooting_score_source_id in (111,121,211,221)`);
  const after = await renderAggregateResultsRoute({ competition, readRpc });
  assert.deepEqual(entrants(after.call.payload).map(e => [e.entrant_label, e.achieved_total, e.rounds[0].gun_score, e.total_points]), [
    ["Pair 1", 397, 3, 2], ["Pair 2", 396, 4, 1],
  ]);
  const correctedRows = renderedEntrantRows(after.html).map((row) => row.html);
  assert.ok(correctedRows[0].includes("Pair 1") && correctedRows[0].includes('>3<span class="sr-only"> total gun result'));
  assert.ok(correctedRows[1].includes("Pair 2") && correctedRows[1].includes('>4<span class="sr-only"> total gun result'));
  assert.ok(entrants(after.call.payload).every(e => e.rounds.slice(1).every(r => r.state === "pending" && r.gun_score === null)));
});

test("runtime diagnostic reports installed signatures, RPC payload and canonical source totals", async () => {
  await summerPairsRuntimeFixture();
  const diagnostic = (await readFile(new URL("../database/diagnostics/aggregate-runtime.sql", import.meta.url), "utf8"))
    .replace("'YOUR_SIGNED_IN_USER_UUID'", `'${viewer}'`)
    // The test already owns a rollback-only fixture transaction. Production
    // diagnostics keep their read-only transaction and temporary claim intact.
    .replace(/^begin;\r?\nset transaction read only;$/m, "")
    .replace(/^rollback;$/m, "");
  const resultSets = await db.exec(diagnostic);
  const inventory = resultSets.find(result => result.rows[0]?.installed_definition)?.rows;
  assert.ok(inventory.some(row => row.signature === "get_competition_aggregate_results(bigint,bigint,bigint)"));
  const result = resultSets.find(result => result.rows[0]?.rpc_payload)?.rows[0];
  assert.deepEqual(result.canonical_released_totals.map(e => [e.entrant_id, e.stored_achieved_sum, e.recorded_dropped_sum]), [[1, 397, 3], [2, 396, 4]]);
  assert.deepEqual(entrants(result.rpc_payload).map(e => [e.entrant_id, e.rounds[0].gun_score]), [[1, 3], [2, 4]]);
});

// A 400-point entrant Course of Fire with two components per participant.
// Keep the actual participant engine in the path for all three entry formats.
async function maximum400Fixture(format, size, mode = "points_dropped", x = false) {
  await fixture({ format, size, mode, x });
  const componentMaximum = 400 / (size * 2);
  await db.query("update competition_score_components set maximum_score=$1", [componentMaximum]);
  await db.query("insert into competition_score_components values (2,1,2,'B',$1,$2)", [componentMaximum, mode]);
  await db.query("update shooting_score_values set achieved_score=$1", [componentMaximum]);
  await db.query(`insert into shooting_score_values
    (shooting_score_source_id, set_number, component_position, achieved_score, x_count)
    select shooting_score_source_id, 1, 2, $1, x_count from shooting_score_values`, [componentMaximum]);
  // First released Round: entrants A/B achieve 397/396; C/D/E 395/394/393.
  await db.query(`update shooting_score_values as value
    set achieved_score = $1 - participant.competition_entrant_id - 2
    from competition_score_usages as usage
    join competition_entrant_participants as participant
      on participant.id = usage.competition_entrant_participant_id
    where usage.shooting_score_source_id = value.shooting_score_source_id
      and usage.competition_round_id = 1 and participant.slot_number = 1
      and value.component_position = 1`, [componentMaximum]);
}

for (const [format, size] of [["individual", 1], ["pairs", 2], ["team", 4]]) {
  for (const mode of ["points_dropped", "points_scored"]) {
    test(`${format} ${mode}: 397/400 beats 396/400 with component-derived gun results`, async () => {
      await maximum400Fixture(format, size, mode);
      const before = (await db.query("select * from shooting_score_values order by id")).rows;
      const data = await read();
      const [a, b] = entrants(data);
      assert.equal(data.display_scoring_mode, mode);
      assert.deepEqual([a.entrant_id, b.entrant_id], [1, 2]);
      assert.deepEqual([a.position, b.position], [1, 2]);
      assert.deepEqual([a.achieved_total, b.achieved_total], [397, 396]);
      assert.deepEqual([a.maximum_total, b.maximum_total], [400, 400]);
      const expectedGun = mode === "points_dropped" ? [3, 4] : [397, 396];
      assert.deepEqual([a.rounds[0].gun_score, b.rounds[0].gun_score], expectedGun);
      assert.deepEqual([a.gun_total, b.gun_total], expectedGun);
      assert.deepEqual(firstPoints(data), [5, 4, 3, 2, 1]);
      assert.ok(entrants(data).every(e => e.participants.length === size));
      assert.deepEqual((await db.query("select * from shooting_score_values order by id")).rows, before);
    });
  }
}

test("Pairs dropped: primary 3 beats 4 regardless of X; equal 3 uses higher X, then shares rank", async () => {
  await maximum400Fixture("pairs", 2, "points_dropped", true);
  let rows = entrants(await read());
  assert.deepEqual(rows.slice(0, 2).map(e => [e.entrant_id, e.gun_total, e.x_total]), [[1, 3, 4], [2, 4, 8]]);
  // B now also drops 3; its higher X resolves the primary gun tie.
  await db.exec("update shooting_score_values set achieved_score=97 where shooting_score_source_id=211 and component_position=1");
  rows = entrants(await read());
  assert.deepEqual(rows.slice(0, 2).map(e => [e.entrant_id, e.gun_total, e.total_points]), [[2, 3, 5], [1, 3, 4]]);
  await db.exec("update shooting_score_values set x_count=1 where shooting_score_source_id in (211,221)");
  rows = entrants(await read());
  assert.deepEqual(rows.slice(0, 3).map(e => [e.position, e.total_points, e.tied]), [[1, 5, true], [1, 5, true], [3, 3, false]]);
});

test("Pairs dropped: incomplete NSR and saved unreleased 400s never contribute", async () => {
  await maximum400Fixture("pairs", 2);
  await db.exec("delete from shooting_score_values where shooting_score_source_id=511 and component_position=2");
  const data = await read();
  assert.equal(data.released_round_count, 1);
  assert.deepEqual(firstPoints(data), [5, 4, 3, 2, 0]);
  const missing = entrants(data)[4];
  assert.deepEqual(missing.rounds[0], { round_id: 1, state: "nsr", gun_score: null, ranking_points: 0 });
  assert.equal(missing.gun_total, null);
  for (const entrant of entrants(data)) {
    assert.equal(entrant.scored_rounds, entrant.entrant_id === 5 ? 0 : 1);
    assert.deepEqual(entrant.rounds.slice(1), [2, 3].map(round_id => ({ round_id, state: "pending", gun_score: null, ranking_points: null })));
  }
  assert.deepEqual(entrants(data).slice(0, 2).map(e => [e.gun_total, e.total_points]), [[3, 5], [4, 4]]);
});

test("Pairs dropped: two released Rounds sum dropped gun totals, not achieved totals", async () => {
  await maximum400Fixture("pairs", 2);
  await db.exec(`
    update competition_rounds set deadline=deadline-1 where id=2;
    update shooting_score_values as value set achieved_score=100-participant.competition_entrant_id-4
    from competition_score_usages as usage
    join competition_entrant_participants as participant on participant.id=usage.competition_entrant_participant_id
    where usage.shooting_score_source_id=value.shooting_score_source_id
      and usage.competition_round_id=2 and participant.slot_number=1 and value.component_position=1;
  `);
  const data = await read();
  const [a, b] = entrants(data);
  assert.equal(data.released_round_count, 2);
  assert.deepEqual([a.rounds.slice(0, 2).map(r => r.gun_score), b.rounds.slice(0, 2).map(r => r.gun_score)], [[3, 5], [4, 6]]);
  assert.deepEqual([a.gun_total, b.gun_total], [8, 10]);
  assert.deepEqual([a.achieved_total, b.achieved_total], [792, 790]);
  assert.deepEqual([a.maximum_total, b.maximum_total], [800, 800]);
  assert.deepEqual([a.total_points, b.total_points], [10, 8]);
  assert.deepEqual([a.position, b.position], [1, 2]);
  assert.deepEqual(a.participants.map(participant => ({
    rounds: participant.rounds.slice(0, 2).map(round => round.gun_score),
    total: participant.gun_total,
  })), [
    { rounds: [3, 5], total: 8 },
    { rounds: [0, 0], total: 0 },
  ]);
});

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
  assert.deepEqual(Object.keys(entrants(data)[0].participants[0]).sort(), ["first_name", "last_name", "slot_number"]);
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  const { html } = await renderAggregateResultsRoute({ competition, readRpc: parameters =>
    read(parameters.p_organisation_id, parameters.p_league_season_id, parameters.p_competition_id) });
  assert.ok(html.includes("Shooter 1 Slot 1"));
  assert.ok(!html.includes("Released shooting results by participant"));
  assert.ok(!html.includes("data-participant-row"));
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
    assert.deepEqual(entrants(data)[0].participants[0], {
      first_name: "Shooter 1",
      last_name: "Slot 1",
      slot_number: 1,
      gun_total: 1,
      x_total: 1,
      rounds: [
        { round_id: 1, state: "scored", gun_score: 1, x_total: 1 },
        { round_id: 2, state: "pending", gun_score: null, x_total: null },
        { round_id: 3, state: "pending", gun_score: null, x_total: null },
      ],
    });
    assert.ok(entrants(data)[0].participants.every(participant =>
      participant.rounds.every(round => !Object.hasOwn(round, "ranking_points"))));

    const competition = (await db.query("select * from competitions where id=1")).rows[0];
    const { html } = await renderAggregateResultsRoute({ competition, readRpc: parameters =>
      read(parameters.p_organisation_id, parameters.p_league_season_id, parameters.p_competition_id) });
    assert.ok(html.includes(`Released shooting results by participant for ${format === "pairs" ? "Pair" : "Team"} 1.`));
    assert.equal([...html.matchAll(/<tr data-participant-row=/g)].length, 5 * size);
    const firstParticipant = html.match(/<tr data-participant-row="1">([\s\S]*?)<\/tr>/)[0];
    assert.ok(firstParticipant.includes("Shooter 1 Slot 1"));
    assert.match(firstParticipant, /data-participant-round="1"[\s\S]*?>1<[\s\S]*?>1 X</);
    assert.match(firstParticipant, /data-participant-total="true"[\s\S]*?>1<[\s\S]*?>1 X</);

    await db.exec("delete from shooting_score_values where shooting_score_source_id=111");
    data = await read();
    const incomplete = entrants(data).find((e) => e.entrant_id === 1);
    assert.equal(incomplete.rounds[0].state, "nsr");
    assert.equal(incomplete.gun_total, null);
    assert.equal(incomplete.x_total, null);
    assert.equal(incomplete.participants[0].rounds[0].state, "nsr");
    assert.equal(incomplete.participants[0].gun_total, null);
    assert.equal(incomplete.participants[1].rounds[0].gun_score, 1);
    assert.deepEqual(firstPoints(data), [5, 4, 3, 2, 0]);
  });
}

test("source correction automatically recomputes participant and entrant totals, points and order", async () => {
  await fixture({ format: "pairs", size: 2 });
  assert.equal(entrants(await read())[0].entrant_id, 1);
  await db.exec("update shooting_score_values set achieved_score=100 where shooting_score_source_id in (511,521)");
  const data = await read();
  assert.equal(entrants(data)[0].entrant_id, 5);
  assert.equal(entrants(data)[0].total_points, 5);
  assert.equal(entrants(data)[0].gun_total, 200);
  assert.deepEqual(entrants(data)[0].participants.map(participant => participant.gun_total), [100, 100]);
  assert.equal(entrants(data)[1].total_points, 4);
});

test("saved scores on deadline day and future Rounds never leak, even to organiser", async () => {
  await fixture({ format: "pairs", size: 2, x: true });
  const memberData = await read();
  await db.query("insert into organisation_staff values (1,$1,'active','manager')", [viewer]);
  assert.deepEqual(await read(), memberData);
  assert.deepEqual(memberData.rounds.map((r) => r.released), [true, false, false]);
  assert.equal(memberData.released_round_count, 1);
  for (const entrant of entrants(memberData)) {
    for (const cell of entrant.rounds.slice(1)) {
      assert.deepEqual(cell, { round_id: cell.round_id, state: "pending", gun_score: null, ranking_points: null, x_total: null });
    }
    for (const participant of entrant.participants) {
      for (const cell of participant.rounds.slice(1)) {
        assert.deepEqual(cell, { round_id: cell.round_id, state: "pending", gun_score: null, x_total: null });
      }
    }
  }
  assert.ok(!JSON.stringify(memberData).includes("88.12"));
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  const { html } = await renderAggregateResultsRoute({ competition, readRpc: parameters =>
    read(parameters.p_organisation_id, parameters.p_league_season_id, parameters.p_competition_id) });
  assert.ok(!html.includes("88.12"));
  const diagnostic = (await db.query("select public.get_competition_round_results(1,1,1) as data")).rows[0].data;
  assert.equal(diagnostic.rounds[1].entrants[0].participants[0].achieved_score, 88.12);
  // The same source is released automatically when its Round End has passed.
  await db.exec("update competition_rounds set deadline=deadline-1 where id=2");
  assert.equal((await read()).released_round_count, 2);
  const released = await read();
  assert.equal(entrants(released)[0].rounds[1].gun_score, 176.24);
  assert.equal(entrants(released)[0].participants[0].rounds[1].gun_score, 88.12);
});

test("Competition route renders public Results without authenticated controls", async () => {
  await summerPairsRuntimeFixture();
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  const publicView = await renderAggregateResultsRoute({
    competition,
    viewerId: null,
    readRpc: parameters => readAnonymously(
      parameters.p_organisation_id,
      parameters.p_league_season_id,
      parameters.p_competition_id,
    ),
  });
  assert.match(publicView.html, /<section id="results"/);
  assert.doesNotMatch(publicView.html, /data-entry-controls|data-lifecycle-actions|Competition management/);
  assert.match(publicView.html, /data-scoring-access="false"/);

  const authenticatedView = await renderAggregateResultsRoute({
    competition,
    readRpc: parameters => read(
      parameters.p_organisation_id,
      parameters.p_league_season_id,
      parameters.p_competition_id,
    ),
  });
  assert.match(authenticatedView.html, /data-entry-controls="true"/);
  assert.match(authenticatedView.html, /data-scoring-access="true"/);
});

test("anonymous viewers receive the same released-only Aggregate projection", async () => {
  await fixture({ format: "pairs", size: 2, x: true });
  const anonymous = await readAnonymously();
  const authenticated = await read();
  assert.deepEqual(anonymous, authenticated);
  assert.equal(anonymous.released_round_count, 1);
  assert.deepEqual(anonymous.rounds.map((round) => round.released), [true, false, false]);
  assert.equal(entrants(anonymous)[0].club_name.length > 0, true);
  assert.equal(entrants(anonymous)[0].participants.length, 2);
  assert.ok(!JSON.stringify(anonymous).includes("88.12"));
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
  await fixture({ format: "pairs", size: 2 });
  const data = await read();
  const json = JSON.stringify(data);
  for (const forbidden of [
    "PRIVATE", "phone", "address", "profile_id", "user_id", "participant_id",
    "shooting_score_source_id", "component_values", "achieved_score", "display_score",
    "x_total", "recorded_slot_count", "expected_slot_count",
  ]) {
    assert.ok(!json.includes(forbidden), forbidden);
  }
  assert.deepEqual(Object.keys(entrants(data)[0].participants[0]).sort(), [
    "first_name", "gun_total", "last_name", "rounds", "slot_number",
  ]);
  assert.deepEqual(Object.keys(entrants(data)[0].participants[0].rounds[0]).sort(), ["gun_score", "round_id", "state"]);
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

test("public context gates, source grants and management functions cannot be bypassed", async () => {
  await fixture();
  // Use savepoints because expected SQL errors otherwise abort the fixture transaction.
  async function denied(sql, code) {
    await db.exec("savepoint denial");
    await assert.rejects(db.exec(sql), (error) => error.code === code);
    await db.exec("rollback to savepoint denial");
  }
  assert.equal((await readAnonymously()).status, "ready");
  await denied("set role anon; select * from shooting_score_values", "42501");
  await denied("set role anon; select * from competition_score_usages", "42501");
  await denied("set role anon; select * from profiles", "42501");
  await denied("set role anon; select private.derive_competition_round_results(1,1,1,null,false)", "42501");
  await denied("set role anon; select public.get_competition_round_results(1,1,1)", "42501");
  await denied("set role authenticated; select * from shooting_score_values", "42501");
  await denied("set role authenticated; select private.derive_competition_round_results(1,1,1,null,false)", "42501");
  await denied("set role authenticated; select public.get_competition_round_results(1,1,1)", "42501");
  await denied("set role anon; select public.get_competition_aggregate_results(2,1,1)", "P0002");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  assert.equal((await read()).status, "ready");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [viewer]);
  await db.exec("update competitions set status='draft'");
  await denied("set role anon; select public.get_competition_aggregate_results(1,1,1)", "P0002");
  await db.exec("update competitions set status='published', ranking_method='gun_score'");
  await denied("set role anon; select public.get_competition_aggregate_results(1,1,1)", "22023");
});
