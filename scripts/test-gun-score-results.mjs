import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { renderGunScoreResultsRoute } from "./helpers/aggregate-ui-path.mjs";

// Disposable PostgreSQL only. The production derivation and Gun Score RPC run
// verbatim against a minimal canonical score schema.
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
      sets_per_round integer, uses_x_score boolean, ranking_method text,
      best_rounds_count integer);
    create table competition_score_components(id bigint primary key,
      competition_id bigint, position integer, short_label text,
      maximum_score numeric, score_method text);
    create table competition_rounds(id bigint primary key,
      competition_id bigint, round_number integer, deadline date,
      shoot_by_date date);
    create table clubs(id bigint primary key, name text, status text);
    create table club_competition_entries(id bigint primary key,
      competition_id bigint, club_id bigint, status text);
    create table competition_entrants(id bigint primary key,
      club_competition_entry_id bigint, position integer);
    create table club_memberships(id bigint primary key, club_id bigint,
      user_id uuid, status text, role text);
    create table profiles(id uuid primary key, first_name text, last_name text,
      phone text, address text);
    create table competition_entrant_participants(id bigint primary key,
      competition_entrant_id bigint, club_competition_entry_id bigint,
      club_membership_id bigint, slot_number integer);
    create table competition_score_usages(competition_id bigint,
      competition_round_id bigint, competition_entrant_participant_id bigint,
      shooting_score_source_id bigint);
    create table shooting_score_values(
      id bigint generated always as identity primary key,
      shooting_score_source_id bigint, set_number integer,
      component_position integer, achieved_score numeric, x_count integer);
    create table competition_division_configs(
      competition_id bigint primary key, status text);
    create table competition_divisions(id bigint primary key,
      competition_id bigint, name text, position integer);
    create table competition_division_assignments(competition_id bigint,
      competition_entrant_id bigint, competition_division_id bigint);
    create table organisation_staff(organisation_id bigint, user_id uuid,
      status text, role text);
    alter table shooting_score_values enable row level security;
    alter table profiles enable row level security;
  `);

  for (let rerun = 0; rerun < 2; rerun++) {
    for (const file of [
      "competition-results.sql",
      "competition-gun-score-results.sql",
    ]) {
      await db.exec(
        await readFile(new URL(`../database/${file}`, import.meta.url), "utf8"),
      );
    }
  }
});

after(async () => db.close());
beforeEach(async () => {
  await db.exec("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [viewer]);
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});

async function fixture({
  format = "individual",
  size = 1,
  mode = "points_scored",
  x = false,
  divisions = true,
} = {}) {
  await db.exec(`
    insert into organisations values (1, 'active');
    insert into league_seasons values (1, 1, 'active');
    insert into clubs values
      (1, 'Club A', 'active'),
      (2, 'Club B', 'active');
    insert into club_competition_entries values
      (1,1,1,'submitted'),
      (2,1,2,'submitted');
  `);
  await db.query(
    "insert into competitions values (1,1,'Gun Test','gun-test','published',$1,$2,1,$3,'gun_score',null)",
    [format, size, x],
  );
  await db.query(
    "insert into competition_score_components values (1,1,1,'A',100,$1)",
    [mode],
  );
  await db.exec(`
    insert into competition_rounds values
      (1,1,1,(statement_timestamp() at time zone 'UTC')::date - 1,null),
      (2,1,2,(statement_timestamp() at time zone 'UTC')::date,
        (statement_timestamp() at time zone 'UTC')::date - 4),
      (3,1,3,(statement_timestamp() at time zone 'UTC')::date + 1,null);
  `);
  if (divisions) {
    await db.exec(`
      insert into competition_division_configs values (1,'published');
      insert into competition_divisions values (1,1,'Division 1',1);
    `);
  }

  for (let entrant = 1; entrant <= 4; entrant++) {
    const club = entrant % 2 + 1;
    await db.query(
      "insert into competition_entrants values ($1::bigint,$2,$1::integer)",
      [entrant, club],
    );
    if (divisions) {
      await db.query(
        "insert into competition_division_assignments values (1,$1,1)",
        [entrant],
      );
    }
    for (let slot = 1; slot <= size; slot++) {
      const participantId = entrant * 10 + slot;
      const uuid = `00000000-0000-0000-0000-${String(participantId).padStart(12, "0")}`;
      await db.query(
        "insert into profiles values ($1,$2,$3,'PRIVATE PHONE','PRIVATE ADDRESS')",
        [uuid, `Shooter ${entrant}`, `Slot ${slot}`],
      );
      await db.query(
        "insert into club_memberships values ($1,$2,$3,'active','member')",
        [participantId, club, uuid],
      );
      await db.query(
        "insert into competition_entrant_participants values ($1,$2,$3,$1,$4)",
        [participantId, entrant, club, slot],
      );
      for (let round = 1; round <= 3; round++) {
        const sourceId = participantId * 10 + round;
        const achieved = round === 1 ? 100 - entrant : 90 - entrant;
        await db.query(
          "insert into competition_score_usages values (1,$1,$2,$3)",
          [round, participantId, sourceId],
        );
        await db.query(
          `insert into shooting_score_values
            (shooting_score_source_id,set_number,component_position,achieved_score,x_count)
           values ($1,1,1,$2,$3)`,
          [sourceId, achieved, x ? entrant : null],
        );
      }
    }
  }
}

async function read(role = "authenticated", organisation = 1) {
  await db.exec(`set role ${role}`);
  try {
    return (
      await db.query(
        "select public.get_competition_gun_score_results($1,1,1) as data",
        [organisation],
      )
    ).rows[0].data;
  } finally {
    await db.exec("reset role").catch(() => {});
  }
}

const entrants = (data) => data.groups.flatMap((group) => group.entrants);

for (const mode of ["points_scored", "points_dropped"]) {
  test(`${mode}: accumulated released gun total directly determines rank`, async () => {
    await fixture({ mode });
    await db.exec("update competition_rounds set deadline=deadline-1 where id=2");
    const data = await read();
    const rows = entrants(data);
    assert.deepEqual(rows.map((entrant) => entrant.entrant_id), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((entrant) => entrant.position), [1, 2, 3, 4]);
    assert.deepEqual(
      rows.map((entrant) => entrant.gun_total),
      mode === "points_scored" ? [188, 186, 184, 182] : [12, 14, 16, 18],
    );
    assert.ok(rows.every((entrant) => !Object.hasOwn(entrant, "total_points")));
    assert.ok(rows.every((entrant) =>
      entrant.rounds.every((round) => !Object.hasOwn(round, "ranking_points")),
    ));
    assert.ok(!JSON.stringify(data).includes("x_total"));
  });
}

test("X breaks only equal primary gun totals and exact equality stays tied", async () => {
  await fixture({ x: true });
  await db.exec(`
    update shooting_score_values set x_count=100
      where shooting_score_source_id=211;
  `);
  let rows = entrants(await read());
  assert.deepEqual(rows.slice(0, 2).map((entrant) => entrant.entrant_id), [1, 2]);

  await db.exec(`
    update shooting_score_values set achieved_score=99
      where shooting_score_source_id=211;
  `);
  rows = entrants(await read());
  assert.deepEqual(rows.slice(0, 2).map((entrant) => entrant.entrant_id), [2, 1]);

  await db.exec(`
    update shooting_score_values set x_count=1
      where shooting_score_source_id=211;
  `);
  rows = entrants(await read());
  assert.deepEqual(
    rows.slice(0, 2).map((entrant) => [entrant.position, entrant.tied]),
    [[1, true], [1, true]],
  );
});

test("early scores stay Pending and excluded until the Round End has passed", async () => {
  await fixture({ format: "pairs", size: 2, x: true });
  await db.exec(`
    update shooting_score_values set achieved_score=88.12, x_count=77
      where shooting_score_source_id % 10 in (2,3);
  `);
  let data = await read();
  assert.equal(data.released_round_count, 1);
  assert.equal(entrants(data)[0].gun_total, 198);
  for (const entrant of entrants(data)) {
    assert.equal(entrant.scored_rounds, 1);
    assert.deepEqual(
      entrant.rounds.slice(1).map((round) => round.state),
      ["pending", "pending"],
    );
    assert.ok(entrant.rounds.slice(1).every((round) =>
      round.gun_score === null && round.x_total === null,
    ));
    assert.ok(entrant.participants.every((participant) =>
      participant.rounds.slice(1).every((round) =>
        round.state === "pending" && round.gun_score === null && round.x_total === null,
      ),
    ));
  }
  assert.ok(!JSON.stringify(data).includes("88.12"));
  assert.ok(!JSON.stringify(data).includes("77"));

  await db.exec("update competition_rounds set deadline=deadline-1 where id=2");
  data = await read();
  assert.equal(data.released_round_count, 2);
  assert.equal(entrants(data)[0].rounds[1].gun_score, 176.24);
});

test("released incomplete results become NSR without manufacturing source data", async () => {
  await fixture({ format: "pairs", size: 2, x: true });
  await db.exec("delete from shooting_score_values where shooting_score_source_id=111");
  const before = (
    await db.query("select count(*)::integer as count from shooting_score_values")
  ).rows[0].count;
  const data = await read();
  const incomplete = entrants(data).find((entrant) => entrant.entrant_id === 1);
  assert.equal(incomplete.rounds[0].state, "nsr");
  assert.equal(incomplete.rounds[0].gun_score, null);
  assert.equal(incomplete.gun_total, null);
  assert.equal(incomplete.nsr_rounds, 1);
  assert.equal(incomplete.participants[0].rounds[0].state, "nsr");
  assert.equal(incomplete.participants[1].rounds[0].state, "scored");
  assert.equal(incomplete.participants[1].rounds[0].gun_score, 99);
  assert.equal(
    (await db.query("select count(*)::integer as count from shooting_score_values"))
      .rows[0].count,
    before,
  );
});

test("NSR contributes no dropped value and does not add an attendance tie-break", async () => {
  await fixture({ mode: "points_dropped" });
  await db.exec(`
    update competition_rounds set deadline=deadline-1 where id=2;
    delete from shooting_score_values where shooting_score_source_id=112;
  `);
  const data = await read();
  const first = entrants(data)[0];
  assert.equal(first.entrant_id, 1);
  assert.equal(first.gun_total, 1);
  assert.equal(first.scored_rounds, 1);
  assert.equal(first.nsr_rounds, 1);
  assert.equal(first.rounds[1].state, "nsr");
  assert.equal(first.rounds[1].gun_score, null);
});

for (const [format, size] of [
  ["individual", 1],
  ["pairs", 2],
  ["team", 4],
]) {
  test(`${format}: entrant and participant gun totals use the shared derivation`, async () => {
    await fixture({ format, size, mode: "points_dropped", x: true });
    const row = entrants(await read())[0];
    assert.equal(row.entrant_format, format);
    assert.equal(row.gun_total, size);
    assert.equal(row.x_total, size);
    assert.equal(row.participants.length, size);
    if (format === "individual") {
      assert.deepEqual(Object.keys(row.participants[0]).sort(), [
        "first_name", "last_name", "slot_number",
      ]);
    } else {
      assert.ok(row.participants.every((participant) =>
        participant.gun_total === 1 && participant.x_total === 1,
      ));
    }
  });
}

test("published divisions rank independently; draft divisions fail closed", async () => {
  await fixture();
  await db.exec(`
    insert into competition_divisions values (2,1,'PRIVATE DRAFT NAME',2);
    update competition_division_assignments set competition_division_id=2
      where competition_entrant_id >= 3;
  `);
  let data = await read();
  assert.deepEqual(
    data.groups.map((group) => group.entrants.map((entrant) => entrant.position)),
    [[1, 2], [1, 2]],
  );
  await db.exec("update competition_division_configs set status='draft'");
  data = await read();
  assert.deepEqual(data, {
    status: "awaiting_divisions",
    rounds: [],
    groups: [],
  });
  assert.ok(!JSON.stringify(data).includes("PRIVATE DRAFT NAME"));
});

test("divisionless competitions use one standings table", async () => {
  await fixture({ divisions: false });
  const data = await read();
  assert.equal(data.groups.length, 1);
  assert.equal(data.groups[0].id, 0);
  assert.equal(data.groups[0].name, "Competition results");
});

test("anonymous Results expose the same narrow released projection", async () => {
  await fixture({ format: "team", size: 4, x: true });
  const anonymous = await read("anon");
  const authenticated = await read();
  assert.deepEqual(anonymous, authenticated);
  assert.equal(anonymous.released_round_count, 1);
  const json = JSON.stringify(anonymous);
  for (const forbidden of [
    "PRIVATE", "profile_id", "participant_id", "shooting_score_source_id",
    "component_values", "achieved_score", "display_score", "ranking_points",
    "total_points",
  ]) {
    assert.ok(!json.includes(forbidden), forbidden);
  }
  assert.ok(entrants(anonymous).every((entrant) =>
    entrant.rounds.slice(1).every((round) =>
      round.state === "pending" && round.gun_score === null,
    ),
  ));
});

test("Competition page renders Gun Score in the existing matrix without Aggregate badges", async () => {
  await fixture({ format: "pairs", size: 2, x: true });
  const competition = (await db.query("select * from competitions where id=1")).rows[0];
  const { html, call } = await renderGunScoreResultsRoute({
    competition,
    viewerId: null,
    readRpc: (parameters) => read(
      "anon",
      parameters.p_organisation_id,
    ),
  });
  assert.equal(call.url.endsWith("/rpc/get_competition_gun_score_results"), true);
  assert.match(html, /<section id="results"/);
  assert.match(html, /data-ranking-method="gun_score"/);
  assert.match(html, /Gun Score standings/);
  assert.match(html, /Released shooting results by participant for Pair 1/);
  assert.doesNotMatch(html, /aggregate ranking points/);
  assert.doesNotMatch(html, />pts</);
  assert.doesNotMatch(
    html,
    /data-entry-controls|data-lifecycle-actions|Competition management/,
  );
});

test("public context and ranking-method gates cannot be bypassed", async () => {
  await fixture();
  async function denied(sql, code) {
    await db.exec("savepoint denial");
    await assert.rejects(db.exec(sql), (error) => error.code === code);
    await db.exec("rollback to savepoint denial");
  }
  await denied(
    "set role anon; select public.get_competition_gun_score_results(2,1,1)",
    "P0002",
  );
  await denied("set role anon; select * from shooting_score_values", "42501");
  await denied(
    "set role anon; select private.derive_competition_round_results(1,1,1,null,false)",
    "42501",
  );
  await db.exec("update competitions set ranking_method='aggregate'");
  await denied(
    "set role anon; select public.get_competition_gun_score_results(1,1,1)",
    "22023",
  );
});
