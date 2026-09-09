import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase } from "./helpers/canonical-database.mjs";

const fixture = await readFile(
  new URL("../database/development-averages-fixture.sql", import.meta.url),
  "utf8",
);

test("development Average fixture runs twice and produces deterministic smoke cases", async () => {
  const db = new PGlite();
  try {
    await installCanonicalDatabase(db);
    await db.exec("alter table auth.users add column email text unique");

    const people = [
      ["10000000-0000-4000-8000-000000000001", "basildon.demo01@example.com", "Eleanor", "Hughes"],
      ["10000000-0000-4000-8000-000000000002", "basildon.demo02@example.com", "Oliver", "Bennett"],
      ["10000000-0000-4000-8000-000000000004", "basildon.demo04@example.com", "George", "Foster"],
      ["10000000-0000-4000-8000-000000000005", "basildon.demo05@example.com", "Sophie", "Turner"],
      ["10000000-0000-4000-8000-000000000006", "basildon.demo06@example.com", "Harry", "Collins"],
      ["10000000-0000-4000-8000-000000000007", "basildon.demo07@example.com", "Isla", "Morgan"],
    ];
    for (const [id, email, firstName, lastName] of people) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [id, email]);
      await db.query("update profiles set first_name=$2,last_name=$3 where id=$1", [id, firstName, lastName]);
    }
    await db.exec(`
      insert into organisations(id,name,slug,status) overriding system value values
        (1,'Eastern Region Shooting Association','eastern-region-shooting-association','active');
      insert into organisation_staff(organisation_id,user_id,role,status) values
        (1,'10000000-0000-4000-8000-000000000001','owner','active'),
        (1,'10000000-0000-4000-8000-000000000002','manager','active');
      insert into clubs(id,name,slug,status) overriding system value values
        (1,'Basildon Rifle and Pistol Club','basildon-rifle-and-pistol-club','active');
      insert into club_memberships(club_id,user_id,role,status)
      select 1,id,'member','active' from auth.users;
    `);

    await db.exec(fixture);
    await db.exec(fixture);

    const target = (await db.query(`select competition.id competition_id,season.id season_id
      from competitions competition join league_seasons season on season.id=competition.league_season_id
      where competition.slug='average-test-individual-target'`)).rows[0];
    const pairTarget = (await db.query(`select competition.id competition_id
      from competitions competition where competition.slug='average-test-pairs-target'`)).rows[0];
    assert.equal((await db.query(`select count(*)::int n from competition_participant_starting_averages
      where competition_id in ($1,$2)`, [target.competition_id, pairTarget.competition_id])).rows[0].n, 0);

    const branches = await db.query(`select profile.first_name,
        decision.policy_branch,decision.starting_average,decision.qualifying_score_count
      from profiles profile
      cross join lateral private.resolve_competition_starting_average($1,profile.id) decision
      where profile.id in (
        '10000000-0000-4000-8000-000000000004',
        '10000000-0000-4000-8000-000000000005',
        '10000000-0000-4000-8000-000000000006'
      ) order by profile.first_name`, [target.competition_id]);
    assert.deepEqual(branches.rows.map((row) => [row.first_name, row.policy_branch,
      row.starting_average === null ? null : Number(row.starting_average), row.qualifying_score_count]), [
      ["George", "current", 98, 2],
      ["Harry", "manual", null, 0],
      ["Sophie", "preceding", 95, 2],
    ]);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [people[0][0]]);
    await db.exec("set role authenticated");
    await db.query("select public.calculate_competition_starting_averages(1,$1,$2)",
      [target.season_id, target.competition_id]);
    await db.query("select public.calculate_competition_starting_averages(1,$1,$2)",
      [target.season_id, pairTarget.competition_id]);
    const projection = (await db.query(`select public.get_competition_division_average_projection(
      1,$1,$2
    ) data`, [target.season_id, pairTarget.competition_id])).rows[0].data;
    const completePair = projection.entrants.find((entrant) => entrant.participants
      .some((participant) => participant.first_name === "George"));
    const incompletePair = projection.entrants.find((entrant) => entrant.participants
      .some((participant) => participant.first_name === "Harry"));
    assert.equal(completePair.starting_average, 96.5);
    assert.equal(completePair.state, "ready");
    assert.equal(incompletePair.starting_average, null);
    assert.equal(incompletePair.state, "no_average");
  } finally {
    await db.close();
  }
});
