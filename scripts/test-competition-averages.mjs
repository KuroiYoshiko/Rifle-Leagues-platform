import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";

// Full disposable canonical schema. No credentials, network, resets, or seeds.
const db = new PGlite();
const users = Object.fromEntries(
  ["owner", "manager", "member", "shooterB", "foreignOwner"].map((role, index) => [
    role,
    `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

before(async () => { await installCanonicalDatabase(db); });
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`begin;
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'Organisation One','organisation-one','active'),
      (2,'Organisation Two','organisation-two','active');
    insert into league_seasons(
      id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (1,1,'Old','old','active',current_date-330,current_date-320,current_date-300,current_date-250),
      (2,1,'Latest','latest','active',current_date-230,current_date-220,current_date-200,current_date-150),
      (3,1,'Target','target','active',current_date-130,current_date-120,current_date-100,current_date+50),
      (4,1,'Future','future','open',current_date+60,current_date+70,current_date+100,current_date+180),
      (5,1,'Later','later','draft',current_date+190,current_date+200,current_date+220,current_date+300),
      (6,2,'Foreign','foreign','active',current_date-130,current_date-120,current_date-100,current_date+50);
    insert into clubs(id,name,slug,status) overriding system value values
      (1,'Home Club','home-club','active'),(2,'Foreign Club','foreign-club','active');
  `);
  for (const user of Object.values(users)) {
    await db.query("insert into auth.users(id) values($1)", [user]);
  }
  await db.query(`insert into organisation_staff(organisation_id,user_id,role,status) values
    (1,$1,'owner','active'),(1,$2,'manager','active'),(2,$3,'owner','active')`,
  [users.owner, users.manager, users.foreignOwner]);
  await db.query(`insert into club_memberships(club_id,user_id,role,status) values
    (1,$1,'member','active'),(1,$2,'member','active'),(1,$3,'member','active')`,
  [users.member, users.shooterB, users.owner]);
  await db.query("insert into user_organisations(user_id,organisation_id) values($1,1)", [users.member]);
  await admin("update profiles set first_name='Primary',last_name='Shooter' where id=$1", [users.member]);
  await admin("update profiles set first_name='Second',last_name='Shooter' where id=$1", [users.shooterB]);
  await actor("owner");
});
afterEach(async () => { await db.exec("rollback; reset role"); });

async function actor(role) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [users[role] ?? ""]);
  await db.exec(`set role ${role === "anon" ? "anon" : "authenticated"}`);
}
async function admin(sql, params = []) {
  await db.exec("reset role");
  try { return await db.query(sql, params); }
  finally { await db.exec("set role authenticated"); }
}
async function flush() {
  await db.exec("set constraints all immediate; set constraints all deferred");
}
async function rejected(sql, params, pattern) {
  await db.exec("savepoint expected_failure");
  try { await assert.rejects(async () => { await db.query(sql, params); await flush(); }, pattern); }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}

async function addCompetition({
  season, name, maximum = 100, components = 1, mode = "points_scored",
  rounds = 3, published = true, unreleasedRound = null,
  entryFormat = "individual", teamSize = 1,
}) {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${season}`;
  const inserted = await admin(`insert into competitions(
      league_season_id,name,slug,status,entry_format,team_size,scoring_method,
      maximum_score_per_round,shots_per_round,uses_x_score,number_of_rounds,
      entry_window_mode,start_date_mode,sets_per_round,ranking_method
    ) values ($1,$2,$3,'draft',$7,$8,$4,$5,10,false,$6,
      'season_default','season_default',1,'aggregate') returning id`,
  [season, name, slug, mode, maximum, rounds, entryFormat, teamSize]);
  const competitionId = inserted.rows[0].id;
  const componentMaximum = maximum / components;
  for (let position = 1; position <= components; position += 1) {
    await admin(`insert into competition_score_components(
      competition_id,position,short_label,maximum_score,score_method
    ) values($1,$2,$3,$4,$5)`,
    [competitionId, position, `C${position}`, componentMaximum, mode]);
  }
  const seasonStart = (await admin(
    "select starts_at from league_seasons where id=$1", [season],
  )).rows[0].starts_at;
  for (let number = 1; number <= rounds; number += 1) {
    await admin(`insert into competition_rounds(competition_id,round_number,deadline)
      values($1,$2,$3::date + $2::integer + 2)`, [competitionId, number, seasonStart]);
  }
  if (unreleasedRound !== null) {
    await admin(`update competition_rounds set deadline=current_date
      where competition_id=$1 and round_number=$2`, [competitionId, unreleasedRound]);
  }
  if (published) await admin("update competitions set status='published' where id=$1", [competitionId]);
  await flush();
  return competitionId;
}

async function addParticipant(competitionId, shooter = "member", status = "submitted") {
  const entry = (await admin(`insert into club_competition_entries(
    competition_id,club_id,status,submitted_at
  ) values($1,1,$2,case when $2='submitted' then now() else null end) returning id`,
  [competitionId, status])).rows[0].id;
  const entrant = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position
  ) values($1,1) returning id`, [entry])).rows[0].id;
  const participant = (await admin(`insert into competition_entrant_participants(
    club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
  ) select $1,$2,membership.id,1 from club_memberships membership
    where membership.user_id=$3 returning id`, [entry, entrant, users[shooter]])).rows[0].id;
  return { entry, entrant, participant, shooterId: users[shooter] };
}

async function addGroupParticipants(competitionId, shooters) {
  const entry = (await admin(`insert into club_competition_entries(
    competition_id,club_id,status,submitted_at
  ) values($1,1,'submitted',now()) returning id`, [competitionId])).rows[0].id;
  const entrant = (await admin(`insert into competition_entrants(
    club_competition_entry_id,position
  ) values($1,1) returning id`, [entry])).rows[0].id;
  const participants = [];
  for (const [index, shooter] of shooters.entries()) {
    participants.push((await admin(`insert into competition_entrant_participants(
      club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number
    ) select $1,$2,membership.id,$3 from club_memberships membership
      where membership.user_id=$4 returning id`,
    [entry, entrant, index + 1, users[shooter]])).rows[0].id);
  }
  return { entry, entrant, participants };
}

async function addScore({ competition, participant, roundNumber, values, sourceId = null }) {
  const round = (await admin(`select id from competition_rounds
    where competition_id=$1 and round_number=$2`, [competition, roundNumber])).rows[0].id;
  let physicalSource = sourceId;
  if (physicalSource === null) {
    physicalSource = (await admin(`insert into shooting_score_sources(shooter_profile_id)
      select membership.user_id from competition_entrant_participants participant
      join club_memberships membership on membership.id=participant.club_membership_id
      where participant.id=$1 returning id`, [participant])).rows[0].id;
  }
  await admin(`insert into competition_score_usages(
    shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id
  ) values($1,$2,$3,$4)`, [physicalSource, competition, round, participant]);
  if (sourceId === null) {
    for (const [index, score] of values.entries()) {
      await admin(`insert into shooting_score_values(
        shooting_score_source_id,set_number,component_position,achieved_score
      ) values($1,1,$2,$3)`, [physicalSource, index + 1, score]);
    }
  }
  await flush();
  return physicalSource;
}

async function saveEnteredScore({ competition, season, participant, roundNumber, enteredScore }) {
  const round = (await admin(`select id from competition_rounds
    where competition_id=$1 and round_number=$2`, [competition, roundNumber])).rows[0].id;
  await db.query(`select public.save_individual_competition_round_scores(
    1,$1,$2,$3,null,$4
  )`, [season, competition, round, [{
    participant_id: participant,
    values: [{ set_number: 1, component_position: 1, entered_score: String(enteredScore), x_count: null }],
  }]]);
  await flush();
}

async function context(name = "Ex100", maximum = 100, organisation = 1) {
  return (await db.query("select public.create_average_context($1,$2,$3) data",
    [organisation, name, maximum])).rows[0].data;
}
async function policy(name = "Policy", strategy = "current_then_preceding", configuration = {
  minimum_current_scores: 2, minimum_preceding_scores: 2, fallback: "manual",
}, organisation = 1) {
  return (await db.query("select public.create_average_policy($1,$2,$3,$4) data",
    [organisation, name, strategy, configuration])).rows[0].data;
}
async function bind(competition, season, contextId, versionId, contributes = true, organisation = 1) {
  return db.query("select public.set_competition_average_settings($1,$2,$3,$4,$5,$6)",
    [organisation, season, competition, contextId, versionId, contributes]);
}
async function calculate(competition, season = 3) {
  return (await db.query("select public.calculate_competition_starting_averages(1,$1,$2) data",
    [season, competition])).rows[0].data;
}

test("Average Context is organisation-isolated and enforces strict same maximum without normalisation", async () => {
  const ex100 = await context();
  const manual = await policy("Manual", "manual", {});
  const compatible = await addCompetition({ season: 3, name: "Compatible", maximum: 100 });
  const ex200 = await addCompetition({ season: 3, name: "Incompatible", maximum: 200 });
  await bind(compatible, 3, ex100.id, manual.version_id);
  await rejected(
    "select public.set_competition_average_settings(1,3,$1,$2,$3,true)",
    [ex200, ex100.id, manual.version_id],
    /must exactly equal.*does not normalise/i,
  );

  await actor("foreignOwner");
  const foreignContext = await context("Foreign Ex100", 100, 2);
  const foreignPolicy = await policy("Foreign Manual", "manual", {}, 2);
  await rejected(
    "select public.set_competition_average_settings(2,6,$1,$2,$3,true)",
    [compatible, foreignContext.id, foreignPolicy.version_id],
    /Competition not found/i,
  );
  await actor("owner");
  await rejected(
    "select public.set_competition_average_settings(1,3,$1,$2,$3,true)",
    [compatible, foreignContext.id, foreignPolicy.version_id],
    /same Organisation/i,
  );
});

test("Policy versions validate an exact schema, are immutable, and future edits create a new version", async () => {
  const created = await policy();
  assert.equal(created.version_number, 1);
  await db.exec("reset role");
  await rejected("update average_policy_versions set configuration='{}'::jsonb where id=$1",
    [created.version_id], /immutable/i);
  await db.exec("set role authenticated");
  await rejected(
    "select public.create_average_policy_version(1,$1,'current_then_preceding',$2)",
    [created.id, { minimum_current_scores: 2, minimum_preceding_scores: 2, fallback: "manual", extra: true }],
    /requires exactly/i,
  );
  const next = (await db.query(
    "select public.create_average_policy_version(1,$1,'manual','{}'::jsonb) data", [created.id],
  )).rows[0].data;
  assert.equal(next.version_number, 2);
  assert.equal(next.strategy, "manual");
  assert.equal((await admin(
    "select strategy from average_policy_versions where id=$1", [created.version_id],
  )).rows[0].strategy, "current_then_preceding");
});

test("manual Policy returns manual-required and stores participant-owned provisional values per edition", async () => {
  const ex100 = await context();
  const manual = await policy("Manual", "manual", {});
  const firstTarget = await addCompetition({ season: 3, name: "Manual One" });
  const secondTarget = await addCompetition({ season: 4, name: "Manual Two" });
  const firstParticipant = await addParticipant(firstTarget);
  const secondParticipant = await addParticipant(secondTarget);
  await bind(firstTarget, 3, ex100.id, manual.version_id);
  await bind(secondTarget, 4, ex100.id, manual.version_id);

  const preview = await calculate(firstTarget);
  assert.equal(preview[0].manual_required, true);
  assert.equal(preview[0].policy_branch, "manual");
  assert.equal(preview[0].starting_average, null);
  await db.query("select public.set_manual_competition_starting_average(1,3,$1,$2,97.8,'Legacy card')",
    [firstTarget, firstParticipant.participant]);
  await db.query("select public.set_manual_competition_starting_average(1,4,$1,$2,96.4,null)",
    [secondTarget, secondParticipant.participant]);

  const snapshots = (await admin(`select competition_id,shooter_profile_id,starting_average,origin,status,
    qualifying_score_count,source_competition_id from competition_participant_starting_averages
    order by competition_id`)).rows;
  assert.deepEqual(snapshots.map(row => [row.competition_id, Number(row.starting_average), row.origin, row.status]), [
    [firstTarget, 97.8, "manual", "provisional"],
    [secondTarget, 96.4, "manual", "provisional"],
  ]);
  assert.ok(snapshots.every(row => row.shooter_profile_id === users.member));
  assert.ok(snapshots.every(row => row.qualifying_score_count === 0 && row.source_competition_id === null));
});

test("frozen Starting Average is protected from provisional mutation and recalculation", async () => {
  const ex100 = await context();
  const manual = await policy("Manual", "manual", {});
  const target = await addCompetition({ season: 3, name: "Frozen" });
  const participant = await addParticipant(target);
  await bind(target, 3, ex100.id, manual.version_id);
  await db.query("select public.set_manual_competition_starting_average(1,3,$1,$2,95,null)",
    [target, participant.participant]);
  await admin(`update competition_participant_starting_averages
    set status='frozen',frozen_at=clock_timestamp()
    where competition_entrant_participant_id=$1`, [participant.participant]);
  await rejected(
    "select public.set_manual_competition_starting_average(1,3,$1,$2,94,null)",
    [target, participant.participant], /Frozen Starting Averages/i,
  );
  const preview = await calculate(target);
  assert.equal(preview[0].starting_average, 95);
  assert.equal(preview[0].status, "frozen");
});

test("owner and manager may manage averages; follower/member, anonymous, and cross-Organisation callers are denied", async () => {
  const ownerContext = await context("Owner Context");
  const manual = await policy("Security Manual", "manual", {});
  const competition = await addCompetition({ season: 3, name: "Security Target" });
  const participant = await addParticipant(competition);
  await bind(competition, 3, ownerContext.id, manual.version_id);
  await actor("manager");
  await context("Manager Context");
  for (const role of ["member", "foreignOwner"]) {
    await actor(role);
    await rejected("select public.create_average_context(1,'Denied',100)", [], /permission/i);
    await rejected("select public.calculate_competition_starting_averages(1,3,$1)",
      [competition], /permission/i);
    await rejected(`select public.set_manual_competition_starting_average(
      1,3,$1,$2,90,null
    )`, [competition, participant.participant], /permission/i);
    assert.equal((await db.query("select id from average_contexts")).rows.length, 0);
  }
  await actor("anon");
  await rejected("select public.create_average_context(1,'Denied',100)", [], /permission denied/i);
  await rejected("select * from public.average_contexts", [], /permission denied/i);
});

test("current_then_preceding uses all scores from exactly one chronological Competition", async () => {
  const ex100 = await context();
  const calculatedPolicy = await policy();
  const oldCompetition = await addCompetition({ season: 1, name: "Old History" });
  const currentCompetition = await addCompetition({
    season: 2, name: "Latest Dropped", mode: "points_dropped",
  });
  const targetCompetition = await addCompetition({ season: 3, name: "Target Average" });
  const oldParticipant = await addParticipant(oldCompetition);
  const currentParticipant = await addParticipant(currentCompetition);
  const targetParticipant = await addParticipant(targetCompetition);
  await bind(oldCompetition, 1, ex100.id, calculatedPolicy.version_id);
  await bind(currentCompetition, 2, ex100.id, calculatedPolicy.version_id);
  await bind(targetCompetition, 3, ex100.id, calculatedPolicy.version_id);
  await admin(`update competitions set configuration_source_competition_id=$1,
    configuration_source_version='configuration-only' where id=$2`,
  [oldCompetition, targetCompetition]);

  await addScore({ competition: oldCompetition, participant: oldParticipant.participant, roundNumber: 1, values: [80] });
  await addScore({ competition: oldCompetition, participant: oldParticipant.participant, roundNumber: 2, values: [82] });
  // Exercise real points-dropped entry: 10 dropped persists as 90 achieved.
  await saveEnteredScore({
    competition: currentCompetition, season: 2, participant: currentParticipant.participant,
    roundNumber: 1, enteredScore: 10,
  });

  const preceding = await calculate(targetCompetition);
  assert.deepEqual({
    average: preceding[0].starting_average,
    branch: preceding[0].policy_branch,
    count: preceding[0].qualifying_score_count,
    source: preceding[0].source_competition_id,
  }, { average: 81, branch: "preceding", count: 2, source: oldCompetition });
  assert.notEqual(preceding[0].source_competition_id, currentCompetition);

  // 6 dropped persists as 94 achieved; Average arithmetic remains achieved-score only.
  await saveEnteredScore({
    competition: currentCompetition, season: 2, participant: currentParticipant.participant,
    roundNumber: 2, enteredScore: 6,
  });
  const current = await calculate(targetCompetition);
  assert.deepEqual({
    average: current[0].starting_average,
    branch: current[0].policy_branch,
    count: current[0].qualifying_score_count,
    source: current[0].source_competition_id,
  }, { average: 92, branch: "current", count: 2, source: currentCompetition });
  assert.notEqual(current[0].starting_average, 86.5, "must not mix current and preceding scores");
  const provenance = (await admin(`select achieved_score_at_calculation,competition_id
    from starting_average_score_sources order by achieved_score_at_calculation`)).rows;
  assert.deepEqual(provenance.map(row => [Number(row.achieved_score_at_calculation), row.competition_id]), [
    [90, currentCompetition], [94, currentCompetition],
  ]);
  assert.equal((await admin(`select competition_entrant_participant_id from
    competition_participant_starting_averages`)).rows[0].competition_entrant_participant_id,
  targetParticipant.participant);
});

test("current_then_preceding falls back to manual when neither exact edition reaches its configured minimum", async () => {
  const ex100 = await context();
  const strictPolicy = await policy("Strict", "current_then_preceding", {
    minimum_current_scores: 3, minimum_preceding_scores: 3, fallback: "manual",
  });
  const oldCompetition = await addCompetition({ season: 1, name: "Sparse Old" });
  const currentCompetition = await addCompetition({ season: 2, name: "Sparse Latest" });
  const targetCompetition = await addCompetition({ season: 3, name: "Sparse Target" });
  const oldParticipant = await addParticipant(oldCompetition);
  const currentParticipant = await addParticipant(currentCompetition);
  await addParticipant(targetCompetition);
  for (const [competition, season] of [[oldCompetition, 1], [currentCompetition, 2], [targetCompetition, 3]]) {
    await bind(competition, season, ex100.id, strictPolicy.version_id);
  }
  for (const [roundNumber, score] of [[1, 70], [2, 72]]) {
    await addScore({ competition: oldCompetition, participant: oldParticipant.participant, roundNumber, values: [score] });
    await addScore({ competition: currentCompetition, participant: currentParticipant.participant, roundNumber, values: [score + 20] });
  }
  const preview = await calculate(targetCompetition);
  assert.equal(preview[0].manual_required, true);
  assert.equal(preview[0].policy_branch, "manual");
  assert.equal((await admin("select count(*)::int n from competition_participant_starting_averages")).rows[0].n, 0);
});

test("current_then_preceding does not skip a scoreless immediately preceding eligible Competition", async () => {
  const ex100 = await context();
  const calculatedPolicy = await policy();
  const thirdHistory = await addCompetition({ season: 1, name: "Third History" });
  const immediatePreceding = await addCompetition({ season: 1, name: "Immediate Gap" });
  const currentHistory = await addCompetition({ season: 2, name: "Current Sparse" });
  const target = await addCompetition({ season: 3, name: "No Skip Target" });
  const thirdParticipant = await addParticipant(thirdHistory);
  const currentParticipant = await addParticipant(currentHistory);
  await addParticipant(target);
  for (const [competition, season] of [
    [thirdHistory, 1], [immediatePreceding, 1], [currentHistory, 2], [target, 3],
  ]) await bind(competition, season, ex100.id, calculatedPolicy.version_id);
  await addScore({ competition: thirdHistory, participant: thirdParticipant.participant, roundNumber: 1, values: [80] });
  await addScore({ competition: thirdHistory, participant: thirdParticipant.participant, roundNumber: 2, values: [82] });
  await addScore({ competition: currentHistory, participant: currentParticipant.participant, roundNumber: 1, values: [95] });
  const preview = await calculate(target);
  assert.equal(preview[0].manual_required, true);
  assert.equal(preview[0].policy_branch, "manual");
});

test("Pair and Team participants own separate Starting Averages; no group historical average is persisted", async () => {
  const ex100 = await context();
  const manual = await policy("Pair Manual", "manual", {});
  const pairCompetition = await addCompetition({
    season: 3, name: "Pair Average", entryFormat: "pairs", teamSize: 2,
  });
  const pair = await addGroupParticipants(pairCompetition, ["member", "shooterB"]);
  await bind(pairCompetition, 3, ex100.id, manual.version_id);
  await db.query("select public.set_manual_competition_starting_average(1,3,$1,$2,91,null)",
    [pairCompetition, pair.participants[0]]);
  await db.query("select public.set_manual_competition_starting_average(1,3,$1,$2,87,null)",
    [pairCompetition, pair.participants[1]]);
  const snapshots = (await admin(`select competition_entrant_participant_id,starting_average
    from competition_participant_starting_averages order by competition_entrant_participant_id`)).rows;
  assert.deepEqual(snapshots.map(row => [row.competition_entrant_participant_id,Number(row.starting_average)]), [
    [pair.participants[0], 91], [pair.participants[1], 87],
  ]);

  const teamCompetition = await addCompetition({
    season: 4, name: "Team Average", entryFormat: "team", teamSize: 3,
  });
  const team = await addGroupParticipants(teamCompetition, ["member", "shooterB", "owner"]);
  await bind(teamCompetition, 4, ex100.id, manual.version_id);
  for (const [index, value] of [93, 89, 85].entries()) {
    await db.query("select public.set_manual_competition_starting_average(1,4,$1,$2,$3,null)",
      [teamCompetition, team.participants[index], value]);
  }
  assert.deepEqual((await admin(`select starting_average from competition_participant_starting_averages
    where competition_id=$1 order by competition_entrant_participant_id`, [teamCompetition])).rows
    .map(row => Number(row.starting_average)), [93, 89, 85]);
  assert.equal((await admin(`select count(*)::int n from information_schema.tables
    where table_schema='public' and table_name in ('pair_starting_averages','team_starting_averages')`)).rows[0].n, 0);
});

test("candidate primitive includes achieved zero and complete released canonical values only", async () => {
  const ex100 = await context();
  const calculatedPolicy = await policy();
  const history = await addCompetition({
    season: 3, name: "Candidate History", maximum: 100, components: 2, rounds: 6,
    mode: "points_dropped", unreleasedRound: 6,
  });
  const target = await addCompetition({
    season: 4, name: "Candidate Target", maximum: 100, components: 2,
  });
  const historicalParticipant = await addParticipant(history);
  await addParticipant(target);
  await bind(history, 3, ex100.id, calculatedPolicy.version_id);
  await bind(target, 4, ex100.id, calculatedPolicy.version_id);
  await addScore({ competition: history, participant: historicalParticipant.participant, roundNumber: 1, values: [0, 0] });
  await addScore({ competition: history, participant: historicalParticipant.participant, roundNumber: 2, values: [40] });
  // Round 3 has no usage: a missing released score is not a zero.
  await addScore({ competition: history, participant: historicalParticipant.participant, roundNumber: 4, values: [45, 45] });
  // Round 5 has no usage: after release this is NSR, not a zero.
  await addScore({ competition: history, participant: historicalParticipant.participant, roundNumber: 6, values: [50, 50] });

  const candidates = (await admin(`select shooting_score_source_id,achieved_score,maximum_score
    from private.shooter_historical_average_candidates($1,$2,$3)
    order by achieved_score`, [ex100.id, users.member, target])).rows;
  assert.deepEqual(candidates.map(row => [Number(row.achieved_score), Number(row.maximum_score)]), [
    [0, 100], [90, 100],
  ]);
});

test("candidate primitive deduplicates a reused physical source and credits its latest eligible usage", async () => {
  const ex100 = await context();
  const calculatedPolicy = await policy();
  const oldCompetition = await addCompetition({ season: 1, name: "Shared Old" });
  const currentCompetition = await addCompetition({ season: 2, name: "Shared Latest" });
  const target = await addCompetition({ season: 3, name: "Shared Target" });
  const oldParticipant = await addParticipant(oldCompetition);
  const currentParticipant = await addParticipant(currentCompetition);
  await addParticipant(target);
  for (const [competition, season] of [[oldCompetition, 1], [currentCompetition, 2], [target, 3]]) {
    await bind(competition, season, ex100.id, calculatedPolicy.version_id);
  }
  const physicalSource = await addScore({
    competition: oldCompetition, participant: oldParticipant.participant, roundNumber: 1, values: [88],
  });
  await addScore({
    competition: currentCompetition, participant: currentParticipant.participant,
    roundNumber: 1, values: [], sourceId: physicalSource,
  });
  const candidates = (await admin(`select shooting_score_source_id,competition_id,achieved_score
    from private.shooter_historical_average_candidates($1,$2,$3)`,
  [ex100.id, users.member, target])).rows;
  assert.deepEqual(candidates.map(row => [row.shooting_score_source_id, row.competition_id, Number(row.achieved_score)]), [
    [physicalSource, currentCompetition, 88],
  ]);
});

test("Competition binding and contributes flag are authoritative; Series membership alone contributes nothing", async () => {
  const ex100 = await context();
  const calculatedPolicy = await policy();
  const history = await addCompetition({ season: 2, name: "Non-contributing" });
  const target = await addCompetition({ season: 3, name: "Binding Target" });
  const historicalParticipant = await addParticipant(history);
  await addParticipant(target);
  await bind(history, 2, ex100.id, calculatedPolicy.version_id, false);
  await bind(target, 3, ex100.id, calculatedPolicy.version_id);
  await addScore({ competition: history, participant: historicalParticipant.participant, roundNumber: 1, values: [90] });
  await addScore({ competition: history, participant: historicalParticipant.participant, roundNumber: 2, values: [92] });
  assert.equal((await calculate(target))[0].manual_required, true);

  const dates = (await admin("select (current_date+125)::text a,(current_date+145)::text b")).rows[0];
  const configuration = {
    name: "Unbound Series", description: "Identity only", entry_format: "individual", team_size: 1,
    sets_per_round: 1, shots_per_round: 10,
    score_components: [{ short_label: "Prone", maximum_score: 100, score_method: "points_scored" }],
    uses_x_score: false, number_of_rounds: 2, ranking_method: "aggregate", entry_fee: 0,
    entry_window_mode: "season_default", start_date_mode: "season_default",
    local_scoring_enabled: true, round_deadlines: [dates.a, dates.b],
  };
  const series = (await db.query("select public.create_competition_series(1,4,'Unbound Series',$1) data",
    [configuration])).rows[0].data;
  assert.equal((await admin(
    "select count(*)::int n from competition_average_settings where competition_id=$1", [series.id],
  )).rows[0].n, 0);
});

test("Series defaults copy immutable selections to first and continued editions without rewriting existing bindings", async () => {
  const ex100 = await context();
  const firstPolicy = await policy("Series Policy");
  const dates = (await admin(`select (current_date+125)::text a,(current_date+145)::text b,
    (current_date+245)::text c,(current_date+265)::text d`)).rows[0];
  const configuration = {
    name: "Series First", description: "First", entry_format: "individual", team_size: 1,
    sets_per_round: 1, shots_per_round: 10,
    score_components: [{ short_label: "Prone", maximum_score: 100, score_method: "points_scored" }],
    uses_x_score: false, number_of_rounds: 2, ranking_method: "aggregate", entry_fee: 0,
    entry_window_mode: "season_default", start_date_mode: "season_default",
    local_scoring_enabled: true, round_deadlines: [dates.a, dates.b],
  };
  const first = (await db.query(`select public.create_competition_series_with_average_defaults(
    1,4,'Average Series',$1,$2,$3
  ) data`, [configuration, ex100.id, firstPolicy.version_id])).rows[0].data;
  const nextVersion = (await db.query(`select public.create_average_policy_version(
    1,$1,'current_then_preceding',$2
  ) data`, [firstPolicy.id, {
    minimum_current_scores: 3, minimum_preceding_scores: 2, fallback: "manual",
  }])).rows[0].data;
  await db.query("select public.set_competition_series_average_defaults(1,$1,$2,$3)",
    [first.competition_series_id, ex100.id, nextVersion.id]);
  const firstBinding = (await admin(`select average_policy_version_id,contributes_to_history
    from competition_average_settings where competition_id=$1`, [first.id])).rows[0];
  assert.equal(firstBinding.average_policy_version_id, firstPolicy.version_id);
  assert.equal(firstBinding.contributes_to_history, true);

  const continued = (await db.query(`select public.continue_competition_series(
    1,5,$1,$2,$3,$4
  ) data`, [first.competition_series_id, first.id, first.configuration_version, {
    name: "Series Continued", round_deadlines: [dates.c, dates.d],
  }])).rows[0].data;
  const continuedBinding = (await admin(`select average_context_id,average_policy_version_id,
    contributes_to_history from competition_average_settings where competition_id=$1`,
  [continued.id])).rows[0];
  assert.deepEqual(continuedBinding, {
    average_context_id: ex100.id,
    average_policy_version_id: nextVersion.id,
    contributes_to_history: true,
  });
  assert.equal((await admin(`select average_policy_version_id from competition_average_settings
    where competition_id=$1`, [first.id])).rows[0].average_policy_version_id, firstPolicy.version_id);
  assert.equal(continued.configuration_source_competition_id, first.id);

  await actor("member");
  await rejected("select public.set_competition_series_average_defaults(1,$1,$2,$3)",
    [first.competition_series_id, ex100.id, firstPolicy.version_id], /permission/i);
});

test("historical corrections refresh provisional S/Av but never rewrite an already frozen snapshot", async () => {
  const ex100 = await context();
  const calculatedPolicy = await policy();
  const history = await addCompetition({ season: 2, name: "Corrected History" });
  const target = await addCompetition({ season: 3, name: "Correction Target" });
  const historicalParticipant = await addParticipant(history);
  const targetParticipant = await addParticipant(target);
  await bind(history, 2, ex100.id, calculatedPolicy.version_id);
  await bind(target, 3, ex100.id, calculatedPolicy.version_id);
  const firstSource = await addScore({
    competition: history, participant: historicalParticipant.participant, roundNumber: 1, values: [90],
  });
  const secondSource = await addScore({
    competition: history, participant: historicalParticipant.participant, roundNumber: 2, values: [94],
  });
  assert.equal((await calculate(target))[0].starting_average, 92);
  await admin("update shooting_score_values set achieved_score=80 where shooting_score_source_id=$1", [secondSource]);
  assert.equal((await calculate(target))[0].starting_average, 85);
  await admin(`update competition_participant_starting_averages
    set status='frozen',frozen_at=clock_timestamp()
    where competition_entrant_participant_id=$1`, [targetParticipant.participant]);
  await admin("update shooting_score_values set achieved_score=70 where shooting_score_source_id=$1", [firstSource]);
  const afterFreeze = await calculate(target);
  assert.equal(afterFreeze[0].starting_average, 85);
  assert.equal(afterFreeze[0].status, "frozen");
  assert.deepEqual((await admin(`select achieved_score_at_calculation from starting_average_score_sources
    order by achieved_score_at_calculation`)).rows.map(row => Number(row.achieved_score_at_calculation)), [80, 90]);
});

test("both additive Average SQL files rerun cleanly over the canonical deployed chain", async () => {
  const isolated = new PGlite();
  try {
    await installCanonicalDatabase(isolated);
    await isolated.exec(await sqlFile("competition-averages"));
    await isolated.exec(await sqlFile("competition-average-series-defaults"));
    assert.equal((await isolated.query(`select count(*)::int n from pg_catalog.pg_class
      where relname in ('average_contexts','average_policy_versions',
        'competition_participant_starting_averages','competition_series_average_defaults')`)).rows[0].n, 4);
  } finally {
    await isolated.close();
  }
});
