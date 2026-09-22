import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { before, after, test } from "node:test";
import postgres from "postgres";
import { CANONICAL_FRESH_INSTALL_ORDER } from "./helpers/database-install-manifest.mjs";
import { sqlFile } from "./helpers/canonical-database.mjs";

const ownerId = "30000000-0000-4000-8000-000000000001";
const shooterId = "30000000-0000-4000-8000-000000000002";
const databaseName = "rifle_leagues_race_test";
const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl || process.env.TEST_DATABASE_DISPOSABLE !== "1") {
  throw new Error(
    "Set TEST_DATABASE_URL to an empty disposable local PostgreSQL database " +
    "and TEST_DATABASE_DISPOSABLE=1 before running this dedicated race suite.",
  );
}

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch {
  throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL for a disposable local database.");
}
if (
  !["postgres:", "postgresql:"].includes(parsedUrl.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname) ||
  parsedUrl.pathname !== `/${databaseName}` ||
  parsedUrl.search || parsedUrl.hash
) {
  throw new Error(
    `Race tests accept only a direct localhost PostgreSQL URL for ${databaseName}.`,
  );
}

function connection() {
  return postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 20,
  });
}

const setup = connection();
let fixtureNumber = 0;

async function installSchema() {
  const [preflight] = await setup`
    select current_database() as database_name,
      (select rolsuper from pg_roles where rolname = current_user) as is_superuser,
      (select count(*)::integer from pg_class as relation
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname in ('public', 'auth')
          and relation.relkind in ('r', 'p', 'v', 'm')) as existing_objects
  `;
  assert.equal(preflight.database_name, databaseName);
  assert.equal(preflight.is_superuser, true, "Schema installation needs a disposable superuser");
  assert.equal(preflight.existing_objects, 0, "The disposable test database must be empty");

  await setup.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
    set timezone = 'UTC';
    create schema auth;
    grant usage on schema public, auth to anon, authenticated;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb default '{}',
      created_at timestamptz default now()
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `).simple();
  for (const name of CANONICAL_FRESH_INSTALL_ORDER) {
    try {
      await setup.unsafe(await sqlFile(name)).simple();
    } catch (error) {
      throw new Error(`Canonical SQL installation failed at ${name} (${error.code ?? "unknown"}).`,
        { cause: error });
    }
  }

  await setup`insert into auth.users(id) values (${ownerId}::uuid), (${shooterId}::uuid)`;
  await setup`insert into organisations(name, slug, status)
    values ('Race Test Organisation', 'race-test-organisation', 'active')`;
  await setup`insert into organisation_staff(organisation_id, user_id, role, status)
    values (1, ${ownerId}::uuid, 'owner', 'active')`;
  await setup`insert into clubs(name, slug, status)
    values ('Race Test Club', 'race-test-club', 'active')`;
  await setup`insert into club_memberships(club_id, user_id, role, status)
    values (1, ${shooterId}::uuid, 'member', 'active')`;
  await setup`select set_config('request.jwt.claim.sub', ${ownerId}, false)`;
}

async function createEntry(competitionId, submitted) {
  const [{ id: entryId }] = await setup`
    insert into club_competition_entries(competition_id, club_id, status)
    values (${competitionId}, 1, 'draft') returning id::integer
  `;
  const [{ id: entrantId }] = await setup`
    insert into competition_entrants(club_competition_entry_id, position)
    values (${entryId}, 1) returning id::integer
  `;
  const [{ id: participantId }] = await setup`
    insert into competition_entrant_participants(
      club_competition_entry_id, competition_entrant_id, club_membership_id, slot_number
    ) select ${entryId}, ${entrantId}, id, 1 from club_memberships
      where club_id = 1 and user_id = ${shooterId}::uuid returning id::integer
  `;
  if (submitted) {
    await setup`update club_competition_entries
      set status = 'submitted', submitted_at = now() where id = ${entryId}`;
  }
  return { entryId, participantId };
}

async function fixture(lateEntry) {
  fixtureNumber += 1;
  const [{ id: seasonId }] = await setup`
    insert into league_seasons(
      organisation_id, name, slug, status,
      entry_opens_at, entry_closes_at, starts_at, ends_at
    ) values (
      1, ${`Race Season ${fixtureNumber}`}, ${`race-season-${fixtureNumber}`}, 'draft',
      current_date + 1, current_date + 10, current_date + 20, current_date + 365
    ) returning id::integer
  `;
  const competitions = [];
  const entries = [];
  for (let index = 0; index < 2; index += 1) {
    const configuration = {
      name: `Race ${fixtureNumber} Competition ${index + 1}`,
      description: null,
      entry_format: "individual",
      team_size: 1,
      sets_per_round: 1,
      shooting_details_version: 1,
      equipment_type_code: "smallbore_rifle",
      organisation_equipment_type_id: null,
      custom_equipment_type_name: null,
      score_components: [{
        short_label: "P", maximum_score: 100, score_method: "points_scored",
        shooting_position_mode: "fixed", shooting_position_code: "prone",
        organisation_shooting_position_id: null,
        distance_mode: "fixed", distance_value: 50, distance_unit: "metres",
        shots: 10,
      }],
      uses_x_score: false,
      number_of_rounds: 1,
      entry_fee: 0,
      entry_window_mode: "season_default",
      custom_entry_opens_at: null,
      custom_entry_closes_at: null,
      start_date_mode: "season_default",
      custom_starts_at: null,
      ranking_method: "aggregate",
      best_rounds_count: null,
      local_scoring_enabled: true,
      round_deadlines: [(await setup`select (current_date + 30)::text as deadline`)[0].deadline],
      round_shoot_by_dates: [],
    };
    const [{ data: competition }] = await setup`
      select public.create_competition_with_shooting_details(
        1, ${seasonId}, ${JSON.stringify(configuration)}::jsonb
      ) as data
    `;
    await setup`select public.publish_competition(1, ${seasonId}, ${competition.id})`;
    const [{ id: roundId }] = await setup`
      select id::integer from competition_rounds
      where competition_id = ${competition.id} and round_number = 1
    `;
    competitions.push({ id: Number(competition.id), roundId });
    entries.push(await createEntry(competition.id, !lateEntry || index === 0));
  }

  const [{ data: group }] = await setup`
    select public.create_concurrent_shooting_group(
      1, ${seasonId}, ${`Race Group ${fixtureNumber}`}
    ) as data
  `;
  for (const competition of competitions) {
    await setup`select public.add_concurrent_shooting_group_competition(
      1, ${group.id}, ${competition.id}
    )`;
  }
  const [{ physical_id: physicalId }] = await setup`
    select public.create_concurrent_shooting_round(1, ${group.id}, 1, 'Race Round')::integer
      as physical_id
  `;
  for (const competition of competitions) {
    await setup`select public.add_concurrent_shooting_round_mapping(
      1, ${group.id}, ${physicalId}, ${competition.id}, ${competition.roundId}
    )`;
  }
  await setup`select public.activate_concurrent_shooting_group(1, ${group.id})`;
  // This moves the fixture to scoring time. Public entry submission is closed at
  // this point; the late-entry cases transition a prepared draft directly, so
  // the production AFTER UPDATE reconciliation trigger is exercised.
  await setup`update league_seasons set status = 'active',
    entry_opens_at = current_date - 30, entry_closes_at = current_date - 10,
    starts_at = current_date - 5 where id = ${seasonId}`;
  return { seasonId, competitions, entries, physicalId };
}

function scorePayload(participantId, score, sourceVersion = null) {
  return JSON.stringify([{
    participant_id: participantId,
    source_version: sourceVersion,
    values: [{
      set_number: 1, component_position: 1,
      entered_score: String(score), x_count: null,
    }],
  }]);
}

async function saveScore(sql, fixtureData, score, sourceVersion = null) {
  const competition = fixtureData.competitions[0];
  const [{ data }] = await sql`
    select public.save_individual_competition_round_scores(
      1, ${fixtureData.seasonId}, ${competition.id}, ${competition.roundId},
      null, ${scorePayload(fixtureData.entries[0].participantId, score, sourceVersion)}::jsonb
    ) as data
  `;
  return data;
}

async function transactionSession(sql, actor = null) {
  await sql`begin`;
  await sql`set local lock_timeout = '10s'`;
  await sql`set local statement_timeout = '20s'`;
  if (actor) {
    await sql`select set_config('request.jwt.claim.sub', ${actor}, true)`;
    await sql`set local role authenticated`;
  } else {
    await sql`select set_config('request.jwt.claim.sub', ${ownerId}, true)`;
  }
  return (await sql`select pg_backend_pid() as pid`)[0].pid;
}

async function waitForAdvisoryBlock(observer, waiterPid, holderPid, pending) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const [{ blocked, holder_blocks: holderBlocks }] = await observer`
      select exists (
        select 1 from pg_locks where pid = ${waiterPid}
          and locktype = 'advisory' and not granted
      ) as blocked,
      ${holderPid}::integer = any(pg_blocking_pids(${waiterPid})) as holder_blocks
    `;
    if (blocked && holderBlocks) {
      assert.equal(pending.settled, false, "The competing operation resumed too early");
      return;
    }
    if (pending.settled) {
      const outcome = await pending.promise;
      throw new Error(`The competing operation completed before the advisory wait (${outcome.error?.code ?? "no error"}).`);
    }
    await delay(25);
  }
  throw new Error("The competing operation did not wait on the expected PostgreSQL advisory lock.");
}

function startObserved(query) {
  const pending = { settled: false, promise: null };
  pending.promise = query.execute().then(
    (value) => ({ value }),
    (error) => ({ error }),
  ).then((outcome) => {
    pending.settled = true;
    return outcome;
  });
  return pending;
}

async function sessions(callback) {
  const a = connection();
  const b = connection();
  const observer = connection();
  try {
    const [aPid, bPid, observerPid] = await Promise.all([
      a`select pg_backend_pid() as pid`,
      b`select pg_backend_pid() as pid`,
      observer`select pg_backend_pid() as pid`,
    ]);
    assert.equal(new Set([aPid[0].pid, bPid[0].pid, observerPid[0].pid]).size, 3);
    await callback({ a, b, observer });
  } finally {
    await Promise.allSettled([a`rollback`, b`rollback`]);
    await Promise.all([a.end(), b.end(), observer.end()]);
  }
}

async function assertPhysicalState(fixtureData, expectedScore, expectedVersion) {
  const sources = await setup`
    select id::integer, concurrent_shooting_round_id::integer as physical_id,
      shooter_profile_id, version::integer
    from shooting_score_sources where concurrent_shooting_round_id = ${fixtureData.physicalId}
  `;
  assert.equal(sources.length, 1, "Exactly one physical score source must exist");
  assert.equal(sources[0].physical_id, fixtureData.physicalId);
  assert.equal(sources[0].shooter_profile_id, shooterId);
  assert.equal(sources[0].version, expectedVersion);

  const [{ usage_count: totalSourceUsages }] = await setup`
    select count(*)::integer as usage_count from competition_score_usages
    where shooting_score_source_id = ${sources[0].id}
  `;
  assert.equal(totalSourceUsages, 2, "The source must have no foreign usage");

  const usages = await setup`
    select usage.shooting_score_source_id::integer as source_id,
      usage.competition_id::integer, usage.competition_round_id::integer as round_id,
      usage.competition_entrant_participant_id::integer as participant_id,
      mapping.concurrent_shooting_round_id::integer as mapped_physical_id,
      membership.user_id as participant_shooter_id
    from competition_score_usages as usage
    join competition_entrant_participants as participant
      on participant.id = usage.competition_entrant_participant_id
    join club_memberships as membership on membership.id = participant.club_membership_id
    left join concurrent_shooting_round_mappings as mapping
      on mapping.competition_id = usage.competition_id
      and mapping.competition_round_id = usage.competition_round_id
    where usage.competition_id in (${fixtureData.competitions[0].id}, ${fixtureData.competitions[1].id})
    order by usage.competition_id
  `;
  assert.equal(usages.length, 2, "Both linked Competitions need exactly one usage");
  for (let index = 0; index < 2; index += 1) {
    assert.deepEqual(usages[index], {
      source_id: sources[0].id,
      competition_id: fixtureData.competitions[index].id,
      round_id: fixtureData.competitions[index].roundId,
      participant_id: fixtureData.entries[index].participantId,
      mapped_physical_id: fixtureData.physicalId,
      participant_shooter_id: shooterId,
    });
  }

  const values = await setup`
    select shooting_score_source_id::integer as source_id,
      set_number, component_position, achieved_score::integer as score, x_count
    from shooting_score_values where shooting_score_source_id = ${sources[0].id}
  `;
  assert.deepEqual(values, [{
    source_id: sources[0].id,
    set_number: 1,
    component_position: 1,
    score: expectedScore,
    x_count: null,
  }], "The physical score value must exist exactly once");
}

before(installSchema);
after(async () => setup.end());

test("score save first, late entry reconciliation waits and attaches", async () => {
  const data = await fixture(true);
  await sessions(async ({ a, b, observer }) => {
    const aPid = await transactionSession(a, ownerId);
    const saved = await saveScore(a, data, 91);
    assert.equal(saved.shared, true);
    const bPid = await transactionSession(b);
    const pending = startObserved(b`
      update club_competition_entries set status = 'submitted', submitted_at = now()
      where id = ${data.entries[1].entryId} returning id
    `);
    await waitForAdvisoryBlock(observer, bPid, aPid, pending);
    await a`commit`;
    const outcome = await pending.promise;
    if (outcome.error) throw outcome.error;
    assert.equal(outcome.value.length, 1);
    await b`commit`;
  });
  await assertPhysicalState(data, 91, 1);
});

test("entry reconciliation first, score save waits and attaches both usages", async () => {
  const data = await fixture(true);
  await sessions(async ({ a, b, observer }) => {
    const bPid = await transactionSession(b);
    await b`update club_competition_entries
      set status = 'submitted', submitted_at = now()
      where id = ${data.entries[1].entryId}`;
    const aPid = await transactionSession(a, ownerId);
    const pending = startObserved(a`
      select public.save_individual_competition_round_scores(
        1, ${data.seasonId}, ${data.competitions[0].id}, ${data.competitions[0].roundId},
        null, ${scorePayload(data.entries[0].participantId, 92)}::jsonb
      ) as data
    `);
    await waitForAdvisoryBlock(observer, aPid, bPid, pending);
    await b`commit`;
    const outcome = await pending.promise;
    if (outcome.error) throw outcome.error;
    assert.equal(outcome.value[0].data.shared, true);
    await a`commit`;
  });
  await assertPhysicalState(data, 92, 1);
});

test("two stale score writers create one source and reject the losing writer", async () => {
  const data = await fixture(false);
  await sessions(async ({ a, b, observer }) => {
    const aPid = await transactionSession(a, ownerId);
    await saveScore(a, data, 99);
    const bPid = await transactionSession(b, ownerId);
    const pending = startObserved(b`
      select public.save_individual_competition_round_scores(
        1, ${data.seasonId}, ${data.competitions[0].id}, ${data.competitions[0].roundId},
        null, ${scorePayload(data.entries[0].participantId, 98)}::jsonb
      ) as data
    `);
    await waitForAdvisoryBlock(observer, bPid, aPid, pending);
    await a`commit`;
    const outcome = await pending.promise;
    assert.equal(outcome.error?.code, "40001");
    assert.match(outcome.error.message, /Shared score .* changed since this editor was loaded/);
    await b`rollback`;
  });
  await assertPhysicalState(data, 99, 1);
});
