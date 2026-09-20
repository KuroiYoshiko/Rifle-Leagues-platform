import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { generateIndividualDivisionDraft } from "../src/lib/competition-division-seeding.mjs";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";

// One deliberately small, connected fixture across the canonical schema. The
// detailed domain edge cases remain in their focused suites.
const db = new PGlite();
const users = Array.from({ length: 7 }, (_, index) =>
  `a1000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

let fixture;

before(async () => {
  await installCanonicalDatabase(db);
  fixture = await seedFixture();
});

after(async () => db.close());

async function asOwner() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [users[0]]);
  await db.exec("set role authenticated");
}

async function admin(sql, params = []) {
  await db.exec("reset role; savepoint critical_cross_feature_admin");
  try {
    const result = await db.query(sql, params);
    await db.exec("release savepoint critical_cross_feature_admin; set role authenticated");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint critical_cross_feature_admin; release savepoint critical_cross_feature_admin; set role authenticated");
    throw error;
  }
}

async function flush() {
  await db.exec("set constraints all immediate; set constraints all deferred");
}

async function call(name, params = []) {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(",");
  return (await db.query(`select public.${name}(${placeholders}) data`, params)).rows[0].data;
}

async function futureDates(count) {
  return (await admin(
    "select array_agg((current_date+30+value)::text order by value) dates from generate_series(1,$1::integer) value",
    [count],
  )).rows[0].dates;
}

async function createCompetition({
  name,
  entryFormat = "individual",
  teamSize = entryFormat === "individual" ? 1 : entryFormat === "pairs" ? 2 : 3,
  rankingMethod = "aggregate",
  rounds = 1,
  bestRoundsCount = null,
}) {
  return call("create_competition_with_shooting_details", [1, 1, JSON.stringify({
    name,
    description: `${name} critical cross-feature fixture`,
    entry_format: entryFormat,
    team_size: teamSize,
    sets_per_round: 1,
    shooting_details_version: 1,
    equipment_type_code: "smallbore_rifle",
    organisation_equipment_type_id: null,
    custom_equipment_type_name: null,
    score_components: [{
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
    }],
    uses_x_score: false,
    number_of_rounds: rounds,
    entry_fee: 0,
    entry_window_mode: "season_default",
    custom_entry_opens_at: null,
    custom_entry_closes_at: null,
    start_date_mode: "season_default",
    custom_starts_at: null,
    ranking_method: rankingMethod,
    best_rounds_count: bestRoundsCount,
    local_scoring_enabled: true,
    round_deadlines: await futureDates(rounds),
    round_shoot_by_dates: [],
  })]);
}

async function createEntry(competitionId) {
  return (await admin(
    "insert into club_competition_entries(competition_id,club_id,status) values($1,1,'draft') returning id",
    [competitionId],
  )).rows[0].id;
}

async function saveAndSubmit(entryId, entrants, { split = false } = {}) {
  const saved = await call("save_club_competition_entry", [entryId, JSON.stringify(entrants)]);
  assert.equal(saved.status, "draft");
  if (split) {
    const submitted = await call("submit_club_competition_entry", [entryId]);
    assert.equal(submitted.status, "submitted");
    return submitted;
  }
  const submitted = await call("save_and_submit_club_competition_entry", [entryId, JSON.stringify(entrants)]);
  assert.equal(submitted.status, "submitted");
  return submitted;
}

async function entryRoster(competitionId) {
  return (await admin(`select entrant.id entrant_id, entrant.position,
      entrant.club_team_id, entrant.club_team_name_snapshot,
      participant.id participant_id, participant.slot_number,
      participant.club_membership_id membership_id, membership.user_id
    from club_competition_entries entry
    join competition_entrants entrant on entrant.club_competition_entry_id=entry.id
    join competition_entrant_participants participant
      on participant.club_competition_entry_id=entry.id
     and participant.competition_entrant_id=entrant.id
    join club_memberships membership on membership.id=participant.club_membership_id
    where entry.competition_id=$1 and entry.status='submitted'
    order by entrant.position,participant.slot_number`, [competitionId])).rows;
}

async function scoreParticipant(competitionId, roundId, participantId, achieved) {
  const shooter = (await admin(`select membership.user_id
    from competition_entrant_participants participant
    join club_memberships membership on membership.id=participant.club_membership_id
    where participant.id=$1`, [participantId])).rows[0].user_id;
  const sourceId = (await admin(
    "insert into shooting_score_sources(shooter_profile_id) values($1) returning id",
    [shooter],
  )).rows[0].id;
  await admin(`insert into competition_score_usages(
      shooting_score_source_id,competition_id,competition_round_id,
      competition_entrant_participant_id
    ) values($1,$2,$3,$4)`, [sourceId, competitionId, roundId, participantId]);
  await admin(`insert into shooting_score_values(
      shooting_score_source_id,set_number,component_position,achieved_score,x_count
    ) values($1,1,1,$2,null)`, [sourceId, achieved]);
  return sourceId;
}

async function seedFixture() {
  await db.exec("begin");
  for (const [index, id] of users.entries()) {
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [
      id,
      { first_name: `Critical${index + 1}`, last_name: "Shooter" },
    ]);
  }
  await db.exec(`
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'Critical League','critical-league','active');
    insert into league_seasons(
      id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at
    ) overriding system value values
      (1,1,'Critical Season','critical-season','open',current_date-20,current_date+20,current_date+30,current_date+365);
    insert into clubs(id,name,slug,status) overriding system value values
      (1,'Critical Club','critical-club','active');
  `);
  await db.query(
    "insert into organisation_staff(organisation_id,user_id,role,status) values(1,$1,'owner','active')",
    [users[0]],
  );
  for (const [index, id] of users.entries()) {
    await db.query(`insert into club_memberships(
      id,club_id,user_id,role,status
    ) overriding system value values($1,1,$2,$3,'active')`, [
      index + 1,
      id,
      index === 0 ? "owner" : "member",
    ]);
  }
  await asOwner();

  const aggregate = await createCompetition({ name: "Critical Aggregate" });
  const concurrent = await createCompetition({ name: "Critical Concurrent" });
  const gun = await createCompetition({
    name: "Critical Gun Pair", entryFormat: "pairs", rankingMethod: "gun_score",
  });
  const bestN = await createCompetition({
    name: "Critical Best N Team", entryFormat: "team", teamSize: 3,
    rankingMethod: "best_n_average", rounds: 2, bestRoundsCount: 1,
  });
  const roundRobin = await createCompetition({
    name: "Critical Round Robin", entryFormat: "pairs", rankingMethod: "round_robin",
  });

  for (const competition of [aggregate, concurrent, gun, bestN, roundRobin]) {
    await call("publish_competition", [1, 1, competition.id]);
  }

  // The Individual path deliberately uses separate save and submit calls.
  const aggregateEntry = await createEntry(aggregate.id);
  await saveAndSubmit(aggregateEntry, [[1], [6]], { split: true });
  const concurrentEntry = await createEntry(concurrent.id);
  await saveAndSubmit(concurrentEntry, [[1]]);

  const pair = await call("create_club_team", [1, "Critical Pair", "pair", [1, 2]]);
  const team = await call("create_club_team", [1, "Critical Team", "team", [1, 2, 3]]);
  const gunEntry = await createEntry(gun.id);
  await saveAndSubmit(gunEntry, [{ club_team_id: pair.id, participants: [6, 7] }]);
  const bestNEntry = await createEntry(bestN.id);
  await saveAndSubmit(bestNEntry, [{ club_team_id: team.id, participants: [5, 6, 7] }]);
  const roundRobinEntry = await createEntry(roundRobin.id);
  await saveAndSubmit(roundRobinEntry, [[1, 2], [4, 5]]);

  const aggregateRoster = await entryRoster(aggregate.id);
  const gunRosterBefore = await entryRoster(gun.id);
  const bestNRosterBefore = await entryRoster(bestN.id);

  const context = await call("create_average_context", [1, "Critical Ex100", 100]);
  const policy = await call("create_average_policy", [1, "Critical Manual", "manual", {}]);
  await call("set_competition_average_settings", [
    1, 1, aggregate.id, context.id, policy.version_id, true,
  ]);
  await admin(`insert into competition_participant_starting_averages(
      competition_id,competition_entrant_participant_id,shooter_profile_id,
      starting_average,average_context_id,average_policy_version_id,
      origin,status,frozen_at,manual_reason
    ) values
      ($1,$2,$3,0,$6,$7,'manual','frozen',now(),'Explicit zero'),
      ($1,$4,$5,null,$6,$7,'no_history','frozen',now(),null)`, [
    aggregate.id,
    aggregateRoster[0].participant_id,
    aggregateRoster[0].user_id,
    aggregateRoster[1].participant_id,
    aggregateRoster[1].user_id,
    context.id,
    policy.version_id,
  ]);

  const averageProjection = await call("get_competition_division_average_projection", [1, 1, aggregate.id]);
  const automaticDraft = generateIndividualDivisionDraft(
    averageProjection.entrants.map((entrant) => ({
      id: entrant.competition_entrant_id,
      starting_average: entrant.starting_average,
      starting_average_state: entrant.state,
    })),
    2,
  );

  // Publish an explicitly reviewed, Competition-local Division. The null
  // entrant is manually placed after remaining unassigned in automatic seeding.
  await admin(`insert into competition_division_configs(
      competition_id,target_size,status,published_at,
      reviewed_starting_average_fingerprint,reviewed_starting_averages_at
    ) values($1,2,'published',now(),$2,now())`, [
    aggregate.id,
    averageProjection.current_fingerprint,
  ]);
  const aggregateDivisionId = (await admin(
    "insert into competition_divisions(competition_id,name,position) values($1,'Division 1',1) returning id",
    [aggregate.id],
  )).rows[0].id;
  for (const entrantId of [...new Set(aggregateRoster.map((row) => row.entrant_id))]) {
    await admin(`insert into competition_division_assignments(
      competition_entrant_id,competition_id,competition_division_id
    ) values($1,$2,$3)`, [entrantId, aggregate.id, aggregateDivisionId]);
  }

  const roundRobinRoster = await entryRoster(roundRobin.id);
  const roundRobinEntrants = [...new Set(roundRobinRoster.map((row) => row.entrant_id))];
  await admin("update league_seasons set entry_closes_at=current_date-1 where id=1");
  await call("save_competition_division_draft", [
    1, 1, roundRobin.id, 2,
    [{ name: "Division 1", entrant_ids: roundRobinEntrants }],
  ]);
  await call("publish_competition_divisions", [1, 1, roundRobin.id]);

  const group = await call("create_concurrent_shooting_group", [1, 1, "Critical Shared Shoot"]);
  await call("add_concurrent_shooting_group_competition", [1, group.id, aggregate.id]);
  await call("add_concurrent_shooting_group_competition", [1, group.id, concurrent.id]);
  const physicalRoundId = await call("create_concurrent_shooting_round", [1, group.id, 1, "Shared Round"]);
  const aggregateRound = (await admin(
    "select id from competition_rounds where competition_id=$1 and round_number=1",
    [aggregate.id],
  )).rows[0].id;
  const concurrentRound = (await admin(
    "select id from competition_rounds where competition_id=$1 and round_number=1",
    [concurrent.id],
  )).rows[0].id;
  await call("add_concurrent_shooting_round_mapping", [1, group.id, physicalRoundId, aggregate.id, aggregateRound]);
  await call("add_concurrent_shooting_round_mapping", [1, group.id, physicalRoundId, concurrent.id, concurrentRound]);
  await call("activate_concurrent_shooting_group", [1, group.id]);

  // Once entry/group setup is complete, start the Season and release the Rounds.
  await admin(`update league_seasons set status='active',
    entry_closes_at=current_date-10,starts_at=current_date-5 where id=1`);
  await admin("update competition_rounds set deadline=current_date-1,shoot_by_date=current_date-2");

  const scoreEntry = await call("get_individual_competition_score_entry", [
    1, 1, aggregate.id, aggregateRound, null,
  ]);
  const ownerParticipantId = aggregateRoster[0].participant_id;
  const individualScore = await call("save_individual_competition_round_scores", [
    1, 1, aggregate.id, aggregateRound, null,
    scoreEntry.participants.map((participant) => ({
      participant_id: participant.participant_id,
      source_version: participant.source_version,
      values: participant.values.map((value) => ({
        set_number: value.set_number,
        component_position: value.component_position,
        entered_score: String(participant.participant_id === ownerParticipantId ? 92 : 80),
        x_count: null,
      })),
    })),
  ]);
  assert.equal(individualScore.shared, true);
  assert.equal(individualScore.linked_usage_count, 3);

  for (const competition of [gun, bestN, roundRobin]) {
    const roster = await entryRoster(competition.id);
    const rounds = (await admin(
      "select id,round_number from competition_rounds where competition_id=$1 order by round_number",
      [competition.id],
    )).rows;
    for (const row of roster) {
      for (const round of rounds) {
        await scoreParticipant(
          competition.id,
          round.id,
          row.participant_id,
          75 + row.slot_number + row.position + round.round_number,
        );
      }
    }
  }
  await flush();

  await call("update_club_team", [pair.id, "Pair Now", "pair", [1, 4]]);
  await call("update_club_team", [team.id, "Team Now", "team", [1, 4, 5]]);

  return {
    competitions: { aggregate, concurrent, gun, bestN, roundRobin },
    aggregateRoster,
    gunRosterBefore,
    bestNRosterBefore,
    automaticDraft,
    pair,
    team,
  };
}

function entrants(data) {
  return data.groups.flatMap((group) => group.entrants);
}

test("all four Results paths are ready with canonical participant cardinalities", async () => {
  await asOwner();
  const { aggregate, gun, bestN, roundRobin } = fixture.competitions;
  const [aggregateData, gunData, bestNData, roundRobinData] = await Promise.all([
    call("get_competition_aggregate_results", [1, 1, aggregate.id]),
    call("get_competition_gun_score_results", [1, 1, gun.id]),
    call("get_competition_best_n_average_results", [1, 1, bestN.id]),
    call("get_competition_round_robin_results", [1, 1, roundRobin.id]),
  ]);
  for (const data of [aggregateData, gunData, bestNData, roundRobinData]) {
    assert.equal(data.status, "ready");
    assert.ok(entrants(data).length > 0);
  }
  assert.ok(entrants(aggregateData).every((entrant) => entrant.participants.length === 1));
  assert.ok(entrants(gunData).every((entrant) => entrant.participants.length === 2));
  assert.ok(entrants(bestNData).every((entrant) => entrant.participants.length === 3));
  assert.ok(entrants(roundRobinData).every((entrant) => entrant.participants.length === 2));
});

test("Individual entry and persistent Pair/Team submissions retain historical snapshots", async () => {
  await asOwner();
  assert.deepEqual(fixture.aggregateRoster.map((row) => row.membership_id), [1, 6]);

  const gunCurrent = await entryRoster(fixture.competitions.gun.id);
  const bestNCurrent = await entryRoster(fixture.competitions.bestN.id);
  assert.deepEqual(gunCurrent.map((row) => row.membership_id), fixture.gunRosterBefore.map((row) => row.membership_id));
  assert.deepEqual(bestNCurrent.map((row) => row.membership_id), fixture.bestNRosterBefore.map((row) => row.membership_id));
  assert.equal(gunCurrent[0].club_team_name_snapshot, "Critical Pair");
  assert.equal(bestNCurrent[0].club_team_name_snapshot, "Critical Team");

  const units = await call("get_club_teams", [1, false]);
  assert.equal(units.teams.find((unit) => unit.id === fixture.pair.id).name, "Pair Now");
  assert.equal(units.teams.find((unit) => unit.id === fixture.team.id).name, "Team Now");
});

test("Starting/Running Averages stay participant-owned and Division seeding distinguishes null from zero", async () => {
  await asOwner();
  const [averages, pairAverages, teamAverages] = await Promise.all([
    call("get_competition_result_averages", [1, 1, fixture.competitions.aggregate.id]),
    call("get_competition_result_averages", [1, 1, fixture.competitions.gun.id]),
    call("get_competition_result_averages", [1, 1, fixture.competitions.bestN.id]),
  ]);
  assert.equal(averages.participants.length, 2);
  const values = averages.participants.map((row) => ({
    starting: row.starting_average,
    running: row.running_average,
  }));
  assert.ok(values.some((row) => Number(row.starting) === 0 && Number(row.running) === 92));
  assert.ok(values.some((row) => row.starting === null && Number(row.running) === 80));
  assert.equal(Object.hasOwn(averages, "entrant_average"), false);
  assert.equal(pairAverages.participants.length, 2);
  assert.equal(teamAverages.participants.length, 3);
  assert.equal(Object.hasOwn(pairAverages, "entrants"), false);
  assert.equal(Object.hasOwn(teamAverages, "entrants"), false);

  assert.equal(fixture.automaticDraft.unseededEntrantIds.length, 1);
  assert.equal(fixture.automaticDraft.seededEntrantIds.length, 1);
  const zeroEntrant = fixture.aggregateRoster.find((row) => row.membership_id === 1).entrant_id;
  assert.deepEqual(fixture.automaticDraft.seededEntrantIds, [zeroEntrant]);

  const assignments = (await admin(`select assignment.competition_id,entrant.id entrant_id
    from competition_division_assignments assignment
    join competition_entrants entrant on entrant.id=assignment.competition_entrant_id
    where entrant.id=$1 order by assignment.competition_id`, [zeroEntrant])).rows;
  assert.deepEqual(assignments, [{ competition_id: fixture.competitions.aggregate.id, entrant_id: zeroEntrant }]);
});

test("Concurrent usages stay Competition-local while analytics counts the physical source once", async () => {
  await asOwner();
  const shared = (await admin(`select source.id,
      count(distinct usage.competition_id)::integer competition_count,
      count(*)::integer usage_count
    from shooting_score_sources source
    join competition_score_usages usage on usage.shooting_score_source_id=source.id
    where source.concurrent_shooting_round_id is not null
    group by source.id
    having count(distinct usage.competition_id)=2`)).rows;
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0], {
    id: shared[0].id,
    competition_count: 2,
    usage_count: 2,
  });

  const analytics = await call("get_my_shooter_analytics", [
    null, null, null, null, null, null, null, null, null, null, 1, false,
  ]);
  const sharedPoint = analytics.chart_points.find((point) => point.shared);
  assert.ok(sharedPoint);
  assert.deepEqual(
    sharedPoint.contexts.map((context) => context.competition).sort(),
    ["Critical Aggregate", "Critical Concurrent"],
  );
  assert.equal(new Set(analytics.chart_points.map((point) => point.event_key)).size, analytics.chart_points.length);
});

test("My Shooting and the shared Statistics/Overview analytics shape remain compatible", async () => {
  await asOwner();
  const myShooting = await call("get_my_shooting_competitions");
  assert.ok(Array.isArray(myShooting.competitions));
  assert.ok(myShooting.competitions.some((row) => row.competition.id === fixture.competitions.aggregate.id));
  assert.ok(myShooting.competitions.some((row) => row.competition.id === fixture.competitions.gun.id));
  assert.ok(myShooting.competitions.some((row) => row.competition.id === fixture.competitions.bestN.id));

  const analytics = await call("get_my_shooter_analytics", [
    null, null, null, null, null, null, null, null, null, null, 1, false,
  ]);
  assert.equal(typeof analytics.summary.physical_shoot_count, "number");
  assert.ok(Array.isArray(analytics.chart_points));
  assert.ok(Array.isArray(analytics.recent_scores));
  assert.ok(Array.isArray(analytics.history.items));
  assert.equal(analytics.history.page, 1);
  assert.ok(analytics.recent_scores.every((point) =>
    typeof point.event_key === "string" && typeof point.score_percentage === "number"));
  assert.ok(["up", "steady", "down", "unavailable"].includes(analytics.summary.trend_direction));
});
