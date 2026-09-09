import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";
import {
  loadModule,
  renderAggregateResultsRoute,
} from "./helpers/aggregate-ui-path.mjs";

const db = new PGlite();
const users = Object.fromEntries(
  ["owner", "alpha", "zero", "partial", "missing", "nsr"].map((name, index) => [
    name,
    `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

before(async () => installCanonicalDatabase(db));
after(async () => db.close());

beforeEach(async () => {
  await db.exec(`begin;
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'Running Average Org','running-average-org','active');
    insert into league_seasons(
      id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (1,1,'Season','season','active',current_date-60,current_date-50,current_date-40,current_date+60);
    insert into clubs(id,name,slug,status) overriding system value values
      (1,'Home Club','home-club','active');
  `);
  for (const [name, id] of Object.entries(users)) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "update profiles set first_name=$1,last_name='Shooter' where id=$2",
      [name[0].toUpperCase() + name.slice(1), id],
    );
    await db.query(
      "insert into club_memberships(club_id,user_id,role,status) values(1,$1,'member','active')",
      [id],
    );
  }
  await db.query(
    "insert into organisation_staff(organisation_id,user_id,role,status) values(1,$1,'owner','active')",
    [users.owner],
  );
  await actor("owner");
});

afterEach(async () => {
  await db.exec("rollback; reset role");
});

async function actor(name) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [users[name] ?? ""]);
  await db.exec(`set role ${name === "anon" ? "anon" : "authenticated"}`);
}

async function admin(sql, parameters = []) {
  await db.exec("reset role");
  let succeeded = false;
  try {
    const result = await db.query(sql, parameters);
    succeeded = true;
    return result;
  } finally {
    if (succeeded) await db.exec("set role authenticated");
  }
}

async function rejected(sql, parameters, pattern) {
  await db.exec("savepoint expected_failure");
  try {
    await assert.rejects(db.query(sql, parameters), pattern);
  } finally {
    await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
  }
}

async function addCompetition({
  name,
  mode = "points_scored",
  ranking = "aggregate",
  deadlines = [-5],
} = {}) {
  const competition = (await admin(`insert into competitions(
      league_season_id,name,slug,status,entry_format,team_size,scoring_method,
      maximum_score_per_round,shots_per_round,uses_x_score,number_of_rounds,
      entry_window_mode,start_date_mode,sets_per_round,ranking_method
    ) values(1,$1,$2,'draft','individual',1,$3,100,10,false,$4,
      'season_default','season_default',1,$5) returning id`, [
    name,
    name.toLowerCase().replaceAll(" ", "-"),
    mode,
    deadlines.length,
    ranking,
  ])).rows[0].id;
  for (const [position, label] of ["A", "B"].entries()) {
    await admin(`insert into competition_score_components(
      competition_id,position,short_label,maximum_score,score_method
    ) values($1,$2,$3,50,$4)`, [competition, position + 1, label, mode]);
  }
  const rounds = [];
  for (const [index, offset] of deadlines.entries()) {
    rounds.push((await admin(`insert into competition_rounds(
      competition_id,round_number,deadline
    ) values($1,$2,current_date+$3::integer) returning id`, [
      competition,
      index + 1,
      offset,
    ])).rows[0].id);
  }
  await admin("update competitions set status='published' where id=$1", [competition]);
  return { competition, rounds };
}

async function addParticipant(competition, shooter, position) {
  const entry = (await admin(`insert into club_competition_entries(
    competition_id,club_id,status,submitted_at
  ) values($1,1,'submitted',now())
    on conflict (competition_id,club_id) do update
      set status='submitted',submitted_at=excluded.submitted_at
    returning id`, [competition])).rows[0].id;
  const entrant = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position
  ) values($1,$2) returning id`, [entry, position])).rows[0].id;
  const participant = (await admin(`insert into competition_entrant_participants(
    club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
  ) select $1,$2,membership.id,1 from club_memberships as membership
    where membership.user_id=$3 returning id`, [entry, entrant, users[shooter]])).rows[0].id;
  return { entrant, participant, shooter: users[shooter] };
}

async function addScore(fixture, participant, roundIndex, values) {
  const source = (await admin(
    "insert into shooting_score_sources(shooter_profile_id) values($1) returning id",
    [participant.shooter],
  )).rows[0].id;
  await admin(`insert into competition_score_usages(
    shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id
  ) values($1,$2,$3,$4)`, [
    source,
    fixture.competition,
    fixture.rounds[roundIndex],
    participant.participant,
  ]);
  for (const [index, value] of values.entries()) {
    await admin(`insert into shooting_score_values(
      shooting_score_source_id,set_number,component_position,achieved_score
    ) values($1,1,$2,$3)`, [source, index + 1, value]);
  }
  return source;
}

async function averages(fixture, role = "anon") {
  await actor(role);
  return (await db.query(
    "select public.get_competition_result_averages(1,1,$1) data",
    [fixture.competition],
  )).rows[0].data;
}

function averageFor(data, participant) {
  return data.participants.find((row) => row.entrant_id === participant.entrant);
}

async function configureAndFreezeStartingAverages(fixture, alpha) {
  await actor("owner");
  const context = (await db.query(
    "select public.create_average_context(1,'Ex100',100) data",
  )).rows[0].data;
  const policy = (await db.query(
    "select public.create_average_policy(1,'Manual','manual','{}'::jsonb) data",
  )).rows[0].data;
  await db.query(
    "select public.set_competition_average_settings(1,1,$1,$2,$3,true)",
    [fixture.competition, context.id, policy.version_id],
  );
  await db.query(
    "select public.calculate_competition_starting_averages(1,1,$1)",
    [fixture.competition],
  );
  await db.query(
    "select public.set_manual_competition_starting_average(1,1,$1,$2,88,null)",
    [fixture.competition, alpha.participant],
  );
  await db.query(
    "select public.finalise_competition_starting_averages(1,1,$1)",
    [fixture.competition],
  );
}

test("R/Av uses complete released canonical achieved scores, preserves precision and includes zero", async () => {
  const fixture = await addCompetition({
    name: "Core Running Average",
    deadlines: [-5, -4, -3, 0, 10],
  });
  const alpha = await addParticipant(fixture.competition, "alpha", 1);
  const zero = await addParticipant(fixture.competition, "zero", 2);
  const partial = await addParticipant(fixture.competition, "partial", 3);
  const missing = await addParticipant(fixture.competition, "missing", 4);
  const nsr = await addParticipant(fixture.competition, "nsr", 5);
  await configureAndFreezeStartingAverages(fixture, alpha);

  assert.equal(averageFor(await averages(fixture), alpha).running_average, null);
  const firstSource = await addScore(fixture, alpha, 0, [49, 49]);
  assert.equal(averageFor(await averages(fixture), alpha).running_average, 98);
  await addScore(fixture, alpha, 1, [48, 48]);
  await addScore(fixture, alpha, 2, [49, 50]);
  await addScore(fixture, alpha, 3, [50, 50]);
  await addScore(fixture, alpha, 4, [40, 40]);
  await addScore(fixture, zero, 0, [0, 0]);
  await addScore(fixture, partial, 0, [50]);
  const nsrSource = (await admin(
    "insert into shooting_score_sources(shooter_profile_id) values($1) returning id",
    [nsr.shooter],
  )).rows[0].id;
  await admin(`insert into competition_score_usages(
    shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id
  ) values($1,$2,$3,$4)`, [
    nsrSource,
    fixture.competition,
    fixture.rounds[0],
    nsr.participant,
  ]);

  const publicData = await averages(fixture);
  assert.ok(Math.abs(averageFor(publicData, alpha).running_average - (293 / 3)) < 1e-12);
  assert.equal(averageFor(publicData, zero).running_average, 0);
  assert.equal(averageFor(publicData, partial).running_average, null);
  assert.equal(averageFor(publicData, missing).running_average, null);
  assert.equal(averageFor(publicData, nsr).running_average, null);
  assert.ok(publicData.participants.every((row) => !("starting_average" in row)));

  const standingsBefore = (await db.query(
    "select public.get_competition_aggregate_results(1,1,$1) data",
    [fixture.competition],
  )).rows[0].data;
  await averages(fixture);
  const standingsAfter = (await db.query(
    "select public.get_competition_aggregate_results(1,1,$1) data",
    [fixture.competition],
  )).rows[0].data;
  assert.deepEqual(standingsAfter, standingsBefore, "informational R/Av must not mutate Aggregate ranking");

  const startingAverageBeforeCorrection = (await admin(`select *
    from competition_participant_starting_averages
    where competition_entrant_participant_id=$1`, [alpha.participant])).rows[0];
  const provenanceBeforeCorrection = (await admin(`select *
    from starting_average_score_sources
    where starting_average_id=$1 order by id`, [startingAverageBeforeCorrection.id])).rows;
  const finalisationBeforeCorrection = (await admin(`select *
    from competition_starting_average_finalisations
    where competition_id=$1`, [fixture.competition])).rows[0];

  await admin(
    "update shooting_score_values set achieved_score=45 where shooting_score_source_id=$1 and component_position=1",
    [firstSource],
  );
  const corrected = await averages(fixture, "owner");
  assert.ok(Math.abs(averageFor(corrected, alpha).running_average - (289 / 3)) < 1e-12);
  assert.equal(averageFor(corrected, alpha).starting_average, 88);
  assert.equal(averageFor(corrected, zero).starting_average, null);
  assert.equal(averageFor(corrected, zero).running_average, 0);
  const frozen = (await admin(`select starting_average,status
    from competition_participant_starting_averages
    where competition_entrant_participant_id=$1`, [alpha.participant])).rows[0];
  assert.deepEqual({ starting_average: Number(frozen.starting_average), status: frozen.status },
    { starting_average: 88, status: "frozen" });
  assert.deepEqual((await admin(`select *
    from competition_participant_starting_averages
    where competition_entrant_participant_id=$1`, [alpha.participant])).rows[0],
  startingAverageBeforeCorrection, "R/Av correction must not rewrite the frozen S/Av snapshot");
  assert.deepEqual((await admin(`select *
    from starting_average_score_sources
    where starting_average_id=$1 order by id`, [startingAverageBeforeCorrection.id])).rows,
  provenanceBeforeCorrection, "R/Av correction must not rewrite S/Av provenance");
  assert.deepEqual((await admin(`select *
    from competition_starting_average_finalisations
    where competition_id=$1`, [fixture.competition])).rows[0],
  finalisationBeforeCorrection, "R/Av correction must not rewrite S/Av finalisation");
});

test("points-dropped entry contributes its converted canonical achieved score", async () => {
  const fixture = await addCompetition({ name: "Dropped Running Average", mode: "points_dropped" });
  const participant = await addParticipant(fixture.competition, "alpha", 1);
  await actor("owner");
  await db.query(`select public.save_individual_competition_round_scores(
    1,1,$1,$2,null,$3
  )`, [fixture.competition, fixture.rounds[0], [{
    participant_id: participant.participant,
    values: [
      { set_number: 1, component_position: 1, entered_score: "2", x_count: null },
      { set_number: 1, component_position: 2, entered_score: "2", x_count: null },
    ],
  }]]);
  const data = await averages(fixture);
  assert.equal(averageFor(data, participant).running_average, 96);
  assert.equal(Number((await admin(`select sum(value.achieved_score) achieved
    from shooting_score_values as value
    join competition_score_usages as usage
      on usage.shooting_score_source_id=value.shooting_score_source_id
    where usage.competition_id=$1`, [fixture.competition])).rows[0].achieved), 96);
});

test("source scope and usage constraints prevent duplicate counting", async () => {
  const fixture = await addCompetition({ name: "Source Scope", deadlines: [-2] });
  const participant = await addParticipant(fixture.competition, "alpha", 1);
  const source = await addScore(fixture, participant, 0, [50, 50]);
  await db.exec("reset role");
  await db.exec("savepoint duplicate_usage");
  await assert.rejects(db.query(`insert into competition_score_usages(
    shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id
  ) values($1,$2,$3,$4)`, [source, fixture.competition, fixture.rounds[0], participant.participant]), /unique/i);
  await db.exec("rollback to savepoint duplicate_usage; release savepoint duplicate_usage");
  await db.exec("set role authenticated");
  assert.equal(averageFor(await averages(fixture), participant).running_average, 100);
});

test("safe projection rejects wrong or draft contexts and keeps S/Av staff-only", async () => {
  const fixture = await addCompetition({ name: "Security Running Average" });
  const participant = await addParticipant(fixture.competition, "alpha", 1);
  await configureAndFreezeStartingAverages(fixture, participant);
  await addScore(fixture, participant, 0, [50, 50]);
  assert.ok(!("starting_average" in averageFor(await averages(fixture), participant)));
  assert.equal(averageFor(await averages(fixture, "owner"), participant).starting_average, 88);

  await actor("anon");
  await rejected(
    "select public.get_competition_result_averages(2,1,$1)",
    [fixture.competition],
    /context was not found/i,
  );
  await admin("update competitions set status='draft' where id=$1", [fixture.competition]);
  await rejected(
    "select public.get_competition_result_averages(1,1,$1)",
    [fixture.competition],
    /context was not found/i,
  );
});

test("result merge and compact UX show Individual and Pair participant R/Av without changing ranking fields", async () => {
  const averagesModule = await loadModule("src/lib/competition-result-averages.ts", {
    "@/lib/supabase/server": { createClient: async () => null },
  });
  const results = {
    status: "ready",
    display_scoring_mode: "points_scored",
    uses_x_score: false,
    released_round_count: 1,
    rounds: [{ id: 1, round_number: 1, deadline: "2025-01-01", released: true }],
    groups: [{ id: 0, name: "Competition results", entrants: [{
      entrant_id: 10, entrant_format: "pairs", entrant_label: "Pair 1", club_name: "Home Club",
      position: 1, tied: false, total_points: 2, scored_rounds: 1,
      achieved_total: 195, maximum_total: 200, gun_total: 195,
      rounds: [{ round_id: 1, state: "scored", gun_score: 195, ranking_points: 2 }],
      participants: [
        { first_name: "Alpha", last_name: "Shooter", slot_number: 1, gun_total: 98, rounds: [] },
        { first_name: "Zero", last_name: "Shooter", slot_number: 2, gun_total: 97, rounds: [] },
      ],
    }] }],
  };
  const enriched = averagesModule.addAveragesToCompetitionResults(results, { participants: [
    { entrant_id: 10, slot_number: 1, running_average: 98, starting_average: 99 },
    { entrant_id: 10, slot_number: 2, running_average: 97.25, starting_average: null },
  ] });
  assert.deepEqual(enriched.groups[0].entrants[0].participants.map((row) => [
    row.starting_average,
    row.running_average,
  ]), [[99, 98], [null, 97.25]]);
  assert.deepEqual({
    position: enriched.groups[0].entrants[0].position,
    total_points: enriched.groups[0].entrants[0].total_points,
    gun_total: enriched.groups[0].entrants[0].gun_total,
  }, { position: 1, total_points: 2, gun_total: 195 });

  const competition = {
    id: 10, name: "Pair Results", slug: "pair-results", status: "published",
    ranking_method: "aggregate", entry_format: "pairs", team_size: 2,
  };
  const { html } = await renderAggregateResultsRoute({
    competition,
    viewerId: null,
    readRpc: async () => results,
    readAveragesRpc: async () => ({ participants: [
      { entrant_id: 10, slot_number: 1, running_average: 98 },
      { entrant_id: 10, slot_number: 2, running_average: 97.25 },
    ] }),
  });
  assert.match(html, /R\/Av 98\.00/);
  assert.match(html, /R\/Av 97\.25/);
  assert.doesNotMatch(html, /S\/Av/);

  const individualResults = structuredClone(results);
  individualResults.groups[0].entrants[0].entrant_format = "individual";
  individualResults.groups[0].entrants[0].entrant_label = "Alpha Shooter";
  individualResults.groups[0].entrants[0].participants = [
    { first_name: "Alpha", last_name: "Shooter", slot_number: 1, gun_total: 98, rounds: [] },
  ];
  const individualCompetition = {
    ...competition,
    name: "Individual Results",
    slug: "individual-results",
    entry_format: "individual",
    team_size: 1,
  };
  const { html: individualHtml } = await renderAggregateResultsRoute({
    competition: individualCompetition,
    readRpc: async () => individualResults,
    readAveragesRpc: async () => ({ participants: [
      { entrant_id: 10, slot_number: 1, running_average: 97.6666666667, starting_average: 88 },
    ] }),
  });
  assert.match(individualHtml, /S\/Av 88\.00/);
  assert.match(individualHtml, /R\/Av 97\.67/);

  const sql = await readFile(new URL("../database/competition-averages-stage-3.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /create or replace function public\.get_competition_(aggregate|gun_score|round_robin)_results/i);
  assert.doesNotMatch(sql, /\brank\s*\(/i);
});
