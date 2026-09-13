import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderAggregateResultsRoute } from "./helpers/aggregate-ui-path.mjs";

const db = new PGlite();
const viewer = "00000000-0000-0000-0000-000000000001";

before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    set timezone = 'UTC';
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
  for (let rerun = 0; rerun < 2; rerun += 1) {
    for (const file of ["competition-results.sql", "competition-best-n-average-results.sql"]) {
      await db.exec(await readFile(new URL(`../database/${file}`, import.meta.url), "utf8"));
    }
  }
});

after(async () => db.close());
beforeEach(async () => {
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [viewer]);
});
afterEach(async () => db.exec("rollback; reset role"));

async function fixture({
  format = "individual",
  size = 1,
  mode = "points_scored",
  divisions = true,
  best = 2,
  totalRounds = 4,
  releasedRounds = 3,
  entrantCount: requestedEntrantCount,
} = {}) {
  await db.exec(`
    insert into organisations values(1,'active');
    insert into league_seasons values(1,1,'active');
    insert into clubs values(1,'Club A','active'),(2,'Club B','active');
    insert into club_competition_entries values(1,1,1,'submitted'),(2,1,2,'submitted');
  `);
  await db.query("insert into competitions values(1,1,'Best N Test','best-n-test','published',$1,$2,1,false,'best_n_average',$3)", [format, size, best]);
  await db.query("insert into competition_score_components values(1,1,1,'Ex100',100,$1)", [mode]);
  for (let round = 1; round <= totalRounds; round += 1) {
    const deadlineOffset = round <= releasedRounds
      ? -(releasedRounds - round + 1)
      : round - releasedRounds - 1;
    await db.query(
      "insert into competition_rounds values($1::bigint,1,$1::integer,current_date+$2::integer,null)",
      [round, deadlineOffset],
    );
  }
  if (divisions) await db.exec(`
    insert into competition_division_configs values(1,'published');
    insert into competition_divisions values(1,1,'Division 1',1),(2,1,'Division 2',2);
  `);
  const entrantCount = requestedEntrantCount ?? (format === "individual" ? 3 : 2);
  for (let entrant = 1; entrant <= entrantCount; entrant += 1) {
    const club = entrant % 2 + 1;
    await db.query("insert into competition_entrants values($1::bigint,$2,$1::integer)", [entrant, club]);
    if (divisions) await db.query("insert into competition_division_assignments values(1,$1,$2)", [entrant, entrant === 3 ? 2 : 1]);
    for (let slot = 1; slot <= size; slot += 1) {
      const participantId = entrant * 10 + slot;
      const profileId = `00000000-0000-0000-0000-${String(participantId).padStart(12, "0")}`;
      await db.query("insert into profiles values($1,$2,$3,'PRIVATE PHONE','PRIVATE ADDRESS')", [profileId, `Shooter ${entrant}`, `Slot ${slot}`]);
      await db.query("insert into club_memberships values($1,$2,$3,'active','member')", [participantId, club, profileId]);
      await db.query("insert into competition_entrant_participants values($1,$2,$3,$1,$4)", [participantId, entrant, club, slot]);
    }
  }
  return { entrantCount, format, size };
}

async function score(entrant, slot, round, achieved) {
  if (achieved == null) return;
  const participantId = entrant * 10 + slot;
  const sourceId = participantId * 10 + round;
  await db.query("insert into competition_score_usages values(1,$1,$2,$3)", [round, participantId, sourceId]);
  await db.query("insert into shooting_score_values(shooting_score_source_id,set_number,component_position,achieved_score,x_count) values($1,1,1,$2,null)", [sourceId, achieved]);
}

async function read(role = "anon", organisationId = 1) {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query("select public.get_competition_best_n_average_results($1,1,1) data", [organisationId])).rows[0].data;
  } finally {
    await db.exec("reset role").catch(() => {});
  }
}

const entrants = (data) => data.groups.flatMap((group) => group.entrants);

test("highest N complete released achieved scores form the live average", async () => {
  await fixture({ divisions: false });
  for (const [entrant, values] of [[1, [90, 100, 80, 99]], [2, [96, 95, 94, 10]], [3, [99, null, 89, 100]]]) {
    for (let round = 1; round <= 4; round += 1) await score(entrant, 1, round, values[round - 1]);
  }
  const data = await read();
  const rows = entrants(data);
  assert.equal(data.best_rounds_count, 2);
  assert.equal(data.released_round_count, 3);
  assert.deepEqual(rows.map((row) => [row.entrant_id, Number(row.qualifying_average), row.counted_rounds]), [
    [2, 95.5, 2], [1, 95, 2], [3, 94, 2],
  ]);
  assert.ok(rows.every((row) => row.ranking_eligible && row.required_complete_results === 2));
  const first = rows.find((row) => row.entrant_id === 1);
  assert.deepEqual(first.rounds.map((round) => [round.state, round.gun_score, round.counts_towards_average]), [
    ["scored", 90, true], ["scored", 100, true], ["scored", 80, false], ["pending", null, false],
  ]);
  assert.ok(rows.every((row) => row.rounds[3].state === "pending" && row.rounds[3].gun_score === null), "future score must not cross the release boundary");
});

test("NSR remains missing rather than zero and cannot manufacture eligibility", async () => {
  await fixture({ divisions: false });
  await score(1, 1, 1, 0);
  await score(2, 1, 1, 80);
  await db.query("insert into competition_score_usages values(1,1,31,311)");
  const data = await read();
  const byId = new Map(entrants(data).map((row) => [row.entrant_id, row]));
  assert.equal(Number(byId.get(1).qualifying_average), 0);
  assert.equal(byId.get(1).counted_rounds, 1);
  assert.equal(byId.get(1).ranking_eligible, false);
  assert.equal(byId.get(1).position, null);
  assert.equal(byId.get(3).qualifying_average, null);
  assert.equal(byId.get(3).rounds[0].state, "nsr");
  assert.equal(byId.get(3).nsr_rounds, 3);
});

test("Grace-like 4/8 high scores remain provisional after fully qualified entrants", async () => {
  await fixture({ divisions: false, best: 8, totalRounds: 10, releasedRounds: 10 });
  for (let round = 1; round <= 10; round += 1) {
    await score(1, 1, round, 85);
    await score(2, 1, round, 80);
    if (round <= 4) await score(3, 1, round, 99);
  }
  const rows = entrants(await read());
  assert.deepEqual(rows.map((row) => row.entrant_id), [1, 2, 3]);
  assert.deepEqual(rows.map((row) => [row.position, row.ranking_eligible]), [
    [1, true], [2, true], [null, false],
  ]);
  const dropout = rows[2];
  assert.equal(Number(dropout.qualifying_average), 99);
  assert.equal(dropout.scored_rounds, 4);
  assert.equal(dropout.required_complete_results, 8);
  assert.equal(dropout.nsr_rounds, 6);
  assert.equal(dropout.rounds.filter((round) => round.state === "nsr").length, 6);
  assert.ok(dropout.rounds.filter((round) => round.state === "nsr").every((round) => round.gun_score === null));
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  const { html } = await renderAggregateResultsRoute({ competition, readRpc: () => read() });
  const dropoutRow = html.match(/<tr data-entrant-row="3">([\s\S]*?)<\/tr>/)?.[1] ?? "";
  assert.match(dropoutRow, /aria-label="Not qualified"[^>]*>—<\/span>/);
  assert.match(dropoutRow, />99\.00</);
  assert.match(dropoutRow, />Not qualified</);
  assert.match(dropoutRow, />4\/8 required</);
});

test("before Best N Rounds release, every currently required result is needed", async () => {
  await fixture({ divisions: false, best: 8, totalRounds: 10, releasedRounds: 4 });
  for (let round = 1; round <= 4; round += 1) {
    await score(1, 1, round, 90);
    await score(3, 1, round, 80);
    if (round <= 3) await score(2, 1, round, 100);
  }
  const rows = entrants(await read());
  assert.equal(rows[0].entrant_id, 1);
  assert.equal(rows[1].entrant_id, 3);
  assert.equal(rows[2].entrant_id, 2);
  assert.ok(rows.slice(0, 2).every((row) => row.ranking_eligible && row.required_complete_results === 4));
  assert.deepEqual([rows[2].ranking_eligible, rows[2].position, rows[2].scored_rounds], [false, null, 3]);
});

test("exactly N qualifies; more than N still averages only the best N", async () => {
  await fixture({ divisions: false, best: 8, totalRounds: 10, releasedRounds: 10, entrantCount: 2 });
  for (let round = 1; round <= 8; round += 1) await score(1, 1, round, 80);
  for (let round = 1; round <= 10; round += 1) await score(2, 1, round, round <= 2 ? 10 : 90);
  const byId = new Map(entrants(await read()).map((row) => [row.entrant_id, row]));
  assert.deepEqual(
    [byId.get(1).ranking_eligible, byId.get(1).scored_rounds, byId.get(1).counted_rounds, Number(byId.get(1).qualifying_average)],
    [true, 8, 8, 80],
  );
  assert.deepEqual(
    [byId.get(2).ranking_eligible, byId.get(2).scored_rounds, byId.get(2).counted_rounds, Number(byId.get(2).qualifying_average)],
    [true, 10, 8, 90],
  );
});

test("exact Best N averages retain competition ranks 1, 2, 3=, 3=, 5 without X", async () => {
  await fixture({ divisions: false, best: 2, totalRounds: 3, releasedRounds: 3, entrantCount: 5 });
  const values = [100, 90, 80, 80, 70];
  for (let entrant = 1; entrant <= 5; entrant += 1) {
    for (let round = 1; round <= 3; round += 1) await score(entrant, 1, round, values[entrant - 1]);
  }
  const rows = entrants(await read());
  assert.deepEqual(rows.map((row) => [row.position, row.tied]), [
    [1, false], [2, false], [3, true], [3, true], [5, false],
  ]);
});

test("points-dropped input still ranks canonical achieved values, including Pair breakdowns", async () => {
  await fixture({ format: "pairs", size: 2, mode: "points_dropped", divisions: false });
  for (let round = 1; round <= 3; round += 1) {
    await score(1, 1, round, [90, 99, 80][round - 1]);
    await score(1, 2, round, [90, 99, 80][round - 1]);
    await score(2, 1, round, [95, 95, 95][round - 1]);
    await score(2, 2, round, [95, 95, 95][round - 1]);
  }
  const rows = entrants(await read());
  assert.deepEqual(rows.map((row) => [row.entrant_id, Number(row.qualifying_average)]), [[2, 190], [1, 189]]);
  assert.equal(rows[0].participants.length, 2);
  assert.equal(rows[0].participants[0].rounds[0].gun_score, 95);
  assert.ok(rows[0].participants.every((participant) => !Object.hasOwn(participant, "running_average")));
});

test("published divisions rank independently; draft allocations fail closed; no config is overall Results", async () => {
  await fixture();
  for (const [entrant, achieved] of [[1, 90], [2, 80], [3, 70]]) {
    await score(entrant, 1, 1, achieved);
    await score(entrant, 1, 2, achieved);
  }
  let data = await read();
  assert.deepEqual(data.groups.map((group) => [group.name, group.entrants[0].position]), [["Division 1", 1], ["Division 2", 1]]);
  await db.exec("update competition_division_configs set status='draft'");
  data = await read();
  assert.deepEqual(data, { status: "awaiting_divisions", rounds: [], groups: [] });
  assert.ok(!JSON.stringify(data).includes("Division 1"));
});

test("public context and ranking gates preserve the existing Results boundary", async () => {
  await fixture({ divisions: false });
  await db.exec("savepoint wrong_context");
  await assert.rejects(read("anon", 999), /context was not found/);
  await db.exec("rollback to savepoint wrong_context; reset role; release savepoint wrong_context");
  await db.exec("savepoint private_table");
  await db.exec("set role anon");
  await assert.rejects(db.query("select * from shooting_score_values"), /permission denied/);
  await db.exec("rollback to savepoint private_table; reset role; release savepoint private_table");
  await db.exec("update competitions set ranking_method='aggregate'");
  await db.exec("savepoint wrong_ranking");
  await assert.rejects(read(), /Best N Average ranking/);
  await db.exec("rollback to savepoint wrong_ranking; reset role; release savepoint wrong_ranking");
});

test("Competition page loads and prints Best N through the shared compact matrix", async () => {
  await fixture({ divisions: false });
  await score(1, 1, 1, 90); await score(1, 1, 2, 100);
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  const { html, call } = await renderAggregateResultsRoute({ competition, viewerId: null, readRpc: () => read() });
  assert.ok(call.url.endsWith("/rpc/get_competition_best_n_average_results"));
  assert.match(html, /data-ranking-method="best_n_average"/);
  assert.match(html, /Best 2 avg/);
  assert.match(html, /2\/2 required/);
  assert.match(html, /Print results/);
  assert.match(html, /data-print-document="true"/);
  assert.doesNotMatch(html, /Standings for this ranking method are not available yet/);
});
