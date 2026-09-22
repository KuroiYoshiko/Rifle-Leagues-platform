import assert from "node:assert/strict";
import { loadModule } from "./aggregate-ui-path.mjs";

export const CRITICAL_CONTRACT_USER_ID = "c1000000-0000-4000-8000-000000000001";

const supabaseDependency = {
  createClient: async () => {
    throw new Error("The projection contract test does not create a Supabase client.");
  },
};

export async function loadProductionReadProjections() {
  const dependencies = { "@/lib/supabase/server": supabaseDependency };
  const [organisations, seasons, competitions] = await Promise.all([
    loadModule("src/lib/organisations.ts", dependencies),
    loadModule("src/lib/league-seasons.ts", dependencies),
    loadModule("src/lib/competitions.ts", dependencies),
  ]);

  return {
    organisationColumns: organisations.organisationColumns,
    leagueSeasonColumns: seasons.leagueSeasonColumns,
    competitionColumns: competitions.competitionColumns,
    competitionRoundColumns: competitions.competitionRoundColumns,
    competitionScoreComponentColumns:
      competitions.competitionScoreComponentColumns,
  };
}

function competitionConfiguration(name, entryFormat, teamSize) {
  return {
    name,
    description: `${name} read-contract fixture`,
    entry_format: entryFormat,
    team_size: teamSize,
    sets_per_round: 1,
    shooting_details_version: 1,
    equipment_type_code: "smallbore_rifle",
    organisation_equipment_type_id: null,
    custom_equipment_type_name: null,
    score_components: [
      {
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
      },
    ],
    uses_x_score: false,
    number_of_rounds: 2,
    entry_fee: 0,
    entry_window_mode: "season_default",
    custom_entry_opens_at: null,
    custom_entry_closes_at: null,
    start_date_mode: "season_default",
    custom_starts_at: null,
    ranking_method: "aggregate",
    best_rounds_count: null,
    local_scoring_enabled: true,
    round_deadlines: ["2099-02-01", "2099-03-01"],
    round_shoot_by_dates: [],
  };
}

export async function seedCriticalReadContractFixture(db) {
  await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [
    CRITICAL_CONTRACT_USER_ID,
    { first_name: "Critical", last_name: "Reader" },
  ]);
  await db.exec(`
    insert into public.organisations(
      id, name, slug, short_name, description, about_content, website,
      contact_email, organisation_type, address, postcode, telephone, status
    ) overriding system value values (
      1, 'Contract Organisation', 'contract-organisation', 'Contract',
      'Organisation projection fixture', 'About fixture',
      'https://contract.invalid', 'contact@contract.invalid',
      'county_association', '1 Contract Street', 'CT1 1CT', '01000000000',
      'active'
    );
    insert into public.league_seasons(
      id, organisation_id, name, description, slug, status,
      entry_opens_at, entry_closes_at, starts_at, ends_at
    ) overriding system value values (
      1, 1, 'Contract Season', 'Season projection fixture', 'contract-season',
      'draft', '2098-11-01', '2098-12-01', '2099-01-01', '2099-12-31'
    );
    insert into public.clubs(id,name,slug,status)
      overriding system value values(1,'Contract Club','contract-club','active');
  `);
  await db.query(`
    insert into public.organisation_staff(organisation_id,user_id,role,status)
    values(1,$1,'owner','active')
  `, [CRITICAL_CONTRACT_USER_ID]);
  await db.query(`
    insert into public.club_memberships(club_id,user_id,role,status)
    values(1,$1,'owner','active')
  `, [CRITICAL_CONTRACT_USER_ID]);

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    CRITICAL_CONTRACT_USER_ID,
  ]);
  await db.exec("set role authenticated");

  for (const [name, format, teamSize] of [
    ["Individual Contract", "individual", 1],
    ["Pair Contract", "pairs", 2],
    ["Team Contract", "team", 3],
  ]) {
    await db.query(
      "select public.create_competition_with_shooting_details(1,1,$1::jsonb)",
      [competitionConfiguration(name, format, teamSize)],
    );
  }
}

async function selectProjection(db, table, projection, where = "true") {
  return db.query(`select ${projection} from public.${table} where ${where}`);
}

export async function assertCriticalReadContracts(db, projections) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    CRITICAL_CONTRACT_USER_ID,
  ]);
  await db.exec("set role authenticated");

  const organisations = await selectProjection(
    db,
    "organisations",
    projections.organisationColumns,
    "id=1",
  );
  assert.equal(organisations.rows.length, 1, "Organisation Overview read failed");
  assert.equal(organisations.rows[0].about_content, "About fixture");

  const seasons = await selectProjection(
    db,
    "league_seasons",
    projections.leagueSeasonColumns,
    "organisation_id=1",
  );
  assert.equal(seasons.rows.length, 1, "Organisation Seasons read failed");
  assert.equal(seasons.rows[0].description, "Season projection fixture");

  const competitions = await selectProjection(
    db,
    "competitions",
    projections.competitionColumns,
    "league_season_id=1",
  );
  assert.equal(competitions.rows.length, 3, "Season Competition list read failed");
  assert.deepEqual(
    competitions.rows.map((competition) => competition.entry_format).sort(),
    ["individual", "pairs", "team"],
  );

  for (const entryFormat of ["individual", "pairs", "team"]) {
    const details = await selectProjection(
      db,
      "competitions",
      projections.competitionColumns,
      `league_season_id=1 and entry_format='${entryFormat}'`,
    );
    assert.equal(details.rows.length, 1, `${entryFormat} Competition detail read failed`);
    assert.equal(details.rows[0].shooting_details_version, 1);
  }

  const individual = competitions.rows.find(
    (competition) => competition.entry_format === "individual",
  );
  assert.ok(individual);

  const rounds = await selectProjection(
    db,
    "competition_rounds",
    projections.competitionRoundColumns,
    `competition_id=${individual.id}`,
  );
  assert.equal(rounds.rows.length, 2, "Competition Rounds read failed");
  assert.ok(rounds.rows.every((round) => round.shoot_by_date === null));

  const components = await selectProjection(
    db,
    "competition_score_components",
    projections.competitionScoreComponentColumns,
    `competition_id=${individual.id}`,
  );
  assert.equal(components.rows.length, 1, "Course of Fire read failed");
  assert.equal(components.rows[0].shooting_position_code, "prone");
  assert.equal(components.rows[0].distance_unit, "metres");

  const shootingDisplay = (
    await db.query(
      "select public.get_competition_shooting_display(1,1,$1) as data",
      [individual.id],
    )
  ).rows[0].data;
  assert.equal(shootingDisplay.configured, true);
  assert.equal(shootingDisplay.equipment_name, "Smallbore Rifle");
  assert.equal(shootingDisplay.components.length, 1);

  const clubTeams = (
    await db.query("select public.get_club_teams(1,false) as data")
  ).rows[0].data;
  assert.equal(clubTeams.club_id, 1);
  assert.ok(Array.isArray(clubTeams.teams));

  const clubOperations = await db.query(
    "select * from public.get_club_operational_summaries(1,7)",
  );
  assert.equal(clubOperations.rows.length, 1);
  assert.equal(clubOperations.rows[0].club_id, 1);

  const myShooting = (
    await db.query("select public.get_my_shooting_competitions() as data")
  ).rows[0].data;
  assert.ok(Array.isArray(myShooting.competitions));

  const analytics = (
    await db.query("select public.get_my_shooter_analytics() as data")
  ).rows[0].data;
  assert.equal(typeof analytics, "object");
  assert.ok(analytics !== null && !Array.isArray(analytics));

  return { individualCompetitionId: individual.id };
}

const CRITICAL_RPC_SIGNATURES = Object.freeze({
  delete_league_season: [
    "p_organisation_id bigint, p_league_season_id bigint",
  ],
  get_club_operational_summaries: [
    "p_club_id bigint, p_warning_days integer",
  ],
  get_club_teams: ["p_club_id bigint, p_include_archived boolean"],
  get_competition_aggregate_results: [
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint",
  ],
  get_competition_best_n_average_results: [
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint",
  ],
  get_competition_gun_score_results: [
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint",
  ],
  get_competition_publish_readiness: [
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint",
  ],
  get_competition_result_averages: [
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint",
  ],
  get_competition_round_robin_results: [
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint",
  ],
  get_competition_shooting_display: [
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint",
  ],
  get_my_shooter_analytics: [
    "p_season_id bigint, p_equipment_kind text, p_equipment_code text, p_equipment_custom_id bigint, p_position_mode text, p_position_code text, p_position_custom_id bigint, p_distance_mode text, p_distance_value numeric, p_distance_unit text, p_history_page integer, p_include_if_seeded_today boolean",
  ],
  get_my_shooting_competitions: [""],
  save_and_submit_club_competition_entry: [
    "p_club_competition_entry_id bigint, p_entrants jsonb",
  ],
  save_club_competition_entry: [
    "p_club_competition_entry_id bigint, p_entrants jsonb",
  ],
  submit_club_competition_entry: ["p_club_competition_entry_id bigint"],
});

const INTENTIONAL_PUBLIC_OVERLOADS = Object.freeze({
  create_competition: [
    "p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[]",
    "p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[]",
  ],
  create_league_season: [
    "p_organisation_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date",
    "p_organisation_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_description text",
  ],
  update_competition: [
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[], p_status text",
    "p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[], p_status text",
  ],
  update_league_season: [
    "p_organisation_id bigint, p_league_season_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_status text",
    "p_organisation_id bigint, p_league_season_id bigint, p_name text, p_entry_opens_at date, p_entry_closes_at date, p_starts_at date, p_ends_at date, p_status text, p_description text",
  ],
});

const ANON_EXECUTABLE_RPCS = Object.freeze([
  "public.get_competition_aggregate_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)",
  "public.get_competition_best_n_average_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)",
  "public.get_competition_gun_score_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)",
  "public.get_competition_result_averages(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)",
  "public.get_competition_round_robin_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)",
  "public.get_competition_shooting_display(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)",
  "public.get_public_club_results_catalog(p_club_slug text, p_query text, p_offset integer, p_limit integer)",
  "public.get_public_results_catalog(p_organisation_slug text, p_season_slug text, p_competition_slug text, p_query text, p_offset integer, p_limit integer)",
]);

const AUTHENTICATED_COLUMN_WRITES = Object.freeze([
  "club_memberships.club_id:INSERT",
  "club_memberships.status:UPDATE",
  "club_memberships.user_id:INSERT",
  "profiles.address:UPDATE",
  "profiles.county:UPDATE",
  "profiles.first_name:UPDATE",
  "profiles.last_name:UPDATE",
  "profiles.phone_number:UPDATE",
  "profiles.postcode:UPDATE",
  "profiles.title:UPDATE",
  "profiles.town:UPDATE",
  "user_organisations.organisation_id:INSERT",
  "user_organisations.user_id:INSERT",
]);

export async function assertGlobalDatabaseSecurityInvariants(db) {
  await db.exec("reset role");

  const tablesWithoutRls = await db.query(`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
    order by c.relname
  `);
  assert.deepEqual(
    tablesWithoutRls.rows,
    [],
    "A public application table does not have RLS enabled",
  );

  const anonTablePrivileges = await db.query(`
    select c.relname as table_name, privilege.name as privilege
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privilege(name)
    where n.nspname='public' and c.relkind='r'
      and has_table_privilege('anon',c.oid,privilege.name)
    order by c.relname, privilege.name
  `);
  assert.deepEqual(
    anonTablePrivileges.rows,
    [],
    "anon gained direct table DML",
  );

  const anonColumnPrivileges = await db.query(`
    select table_name, column_name, privilege_type
    from information_schema.column_privileges
    where table_schema='public' and grantee='anon'
      and privilege_type in ('SELECT','INSERT','UPDATE')
    order by table_name,column_name,privilege_type
  `);
  assert.deepEqual(
    anonColumnPrivileges.rows,
    [],
    "anon gained direct column DML",
  );

  const authenticatedTableWrites = await db.query(`
    select c.relname as table_name, privilege.name as privilege
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    cross join (values ('INSERT'),('UPDATE'),('DELETE')) privilege(name)
    where n.nspname='public' and c.relkind='r'
      and has_table_privilege('authenticated',c.oid,privilege.name)
    order by c.relname, privilege.name
  `);
  assert.deepEqual(
    authenticatedTableWrites.rows.map(
      (row) => `${row.table_name}:${row.privilege}`,
    ),
    ["user_organisations:DELETE"],
    "authenticated gained an unintended table-level write grant",
  );

  const authenticatedColumnWrites = await db.query(`
    select table_name, column_name, privilege_type
    from information_schema.column_privileges
    where table_schema='public' and grantee='authenticated'
      and privilege_type in ('INSERT','UPDATE')
    order by table_name,column_name,privilege_type
  `);
  assert.deepEqual(
    authenticatedColumnWrites.rows.map(
      (row) => `${row.table_name}.${row.column_name}:${row.privilege_type}`,
    ),
    AUTHENTICATED_COLUMN_WRITES,
    "authenticated gained an unintended direct column write grant",
  );

  const exposedPrivateFunctions = await db.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    where p.pronamespace='private'::regnamespace and p.prokind='f'
      and (
        has_function_privilege('anon',p.oid,'EXECUTE')
        or has_function_privilege('authenticated',p.oid,'EXECUTE')
        or has_function_privilege('service_role',p.oid,'EXECUTE')
      )
    order by p.proname,arguments
  `);
  assert.deepEqual(
    exposedPrivateFunctions.rows,
    [],
    "A private-schema function is executable by an API role",
  );

  const anonFunctions = await db.query(`
    select format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) as signature,
    p.provolatile,
    pg_get_functiondef(p.oid) ~* '\\m(insert|update|delete|truncate)\\M' as contains_write
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and has_function_privilege('anon',p.oid,'EXECUTE')
    order by signature
  `);
  assert.deepEqual(
    anonFunctions.rows.map((row) => row.signature),
    ANON_EXECUTABLE_RPCS,
    "The anon-executable RPC allow-list changed",
  );
  assert.ok(
    anonFunctions.rows.every(
      (row) => ["s", "i"].includes(row.provolatile) && !row.contains_write,
    ),
    "An anon-executable RPC is volatile or contains a write statement",
  );
}

export async function assertDatabaseMetadataInvariants(db, projections) {
  await db.exec("reset role");

  await assertGlobalDatabaseSecurityInvariants(db);

  const criticalNames = Object.keys(CRITICAL_RPC_SIGNATURES);
  const functions = await db.query(`
    select p.proname,
      pg_get_function_identity_arguments(p.oid) as arguments,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
    from pg_proc p
    where p.pronamespace='public'::regnamespace
      and p.proname = any($1::text[])
    order by p.proname, arguments
  `, [criticalNames]);
  const actualCritical = Object.fromEntries(
    criticalNames.map((name) => [
      name,
      functions.rows
        .filter((fn) => fn.proname === name)
        .map((fn) => fn.arguments),
    ]),
  );
  assert.deepEqual(actualCritical, CRITICAL_RPC_SIGNATURES);
  assert.ok(
    functions.rows.every((fn) => fn.authenticated_execute),
    "A critical public RPC lost authenticated EXECUTE",
  );

  const overloads = await db.query(`
    select p.proname,
      array_agg(pg_get_function_identity_arguments(p.oid)
        order by pg_get_function_identity_arguments(p.oid)) as signatures
    from pg_proc p
    where p.pronamespace='public'::regnamespace
      and p.prokind='f'
    group by p.proname
    having count(*) > 1
    order by p.proname
  `);
  assert.deepEqual(
    Object.fromEntries(overloads.rows.map((row) => [row.proname, row.signatures])),
    INTENTIONAL_PUBLIC_OVERLOADS,
    "Unexpected PostgREST-visible public function overload",
  );

  const insecureDefiners = await db.query(`
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f'
      and p.prosecdef
      and n.nspname in ('public','private')
      and not (
        coalesce(p.proconfig,array[]::text[])
        @> array['search_path=""']
      )
    order by n.nspname,p.proname,arguments
  `);
  assert.deepEqual(
    insecureDefiners.rows,
    [],
    "SECURITY DEFINER function does not use an empty search_path",
  );

  const lockingReadOnlyFunctions = await db.query(`
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where p.prokind='f'
      and p.provolatile in ('s','i')
      and n.nspname in ('public','private')
      and pg_get_functiondef(p.oid) ~* 'for[[:space:]]+(share|update)'
    order by n.nspname,p.proname,arguments
  `);
  assert.deepEqual(
    lockingReadOnlyFunctions.rows,
    [],
    "A STABLE/IMMUTABLE function contains a row-locking clause",
  );

  for (const [table, projection] of [
    ["organisations", projections.organisationColumns],
    ["league_seasons", projections.leagueSeasonColumns],
    ["competitions", projections.competitionColumns],
    ["competition_rounds", projections.competitionRoundColumns],
    ["competition_score_components", projections.competitionScoreComponentColumns],
  ]) {
    for (const column of projection.split(",").map((value) => value.trim())) {
      const privilege = await db.query(
        "select has_column_privilege('authenticated',$1,$2,'SELECT') as allowed",
        [`public.${table}`, column],
      );
      assert.equal(
        privilege.rows[0].allowed,
        true,
        `authenticated lost SELECT on public.${table}.${column}`,
      );
    }
  }
}
