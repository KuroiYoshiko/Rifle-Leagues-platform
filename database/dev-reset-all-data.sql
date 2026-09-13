-- ============================================================================
-- DEVELOPMENT / STAGING ONLY
-- DESTRUCTIVE
-- NEVER RUN AGAINST PRODUCTION
-- ============================================================================
--
-- Purpose: remove every row from the Rifle Leagues application domain while
-- preserving exactly one existing Supabase Auth login. This is manual tooling,
-- not a migration, and must never be added to the canonical deployment chain.
--
-- Before running:
--   1. Copy this entire file into the Supabase SQL Editor.
--   2. In that copied text only, replace the zero UUID assigned to
--      v_keep_user_id with the existing developer/showcase Auth user's UUID.
--   3. Run the edited copy. Never save the real UUID in this repository.
--
-- The single multi-table TRUNCATE is intentional. All application tables that
-- participate in foreign keys are truncated together, so PostgreSQL verifies
-- the complete dependency set without CASCADE. TRUNCATE does not run row-level
-- DELETE triggers, which allows this explicit reset to clear immutable Average,
-- Round Robin, score provenance, and Concurrent history without weakening,
-- disabling, dropping, or recreating any production integrity trigger.
-- Identity sequences are deliberately not restarted.

begin;

do $reset$
declare
  v_keep_user_id constant uuid := '00000000-0000-0000-0000-000000000000';
  v_keep_identity_count_before bigint;
  v_keep_identity_count_after bigint;
  v_deleted_auth_users bigint;
  v_auth_users_remaining bigint;
  v_domain_rows_remaining bigint;
  v_storage_objects_owned_by_other_users bigint := 0;
  v_equipment_type_count bigint;
  v_position_count bigint;
  v_table_name text;
  v_missing_tables text[];
  v_domain_tables constant text[] := array[
    'shooting_score_change_events',
    'competition_score_usages',
    'shooting_score_values',
    'starting_average_score_sources',
    'competition_starting_average_finalisations',
    'competition_participant_starting_averages',
    'competition_series_average_defaults',
    'competition_average_settings',
    'average_policy_versions',
    'average_policies',
    'average_contexts',
    'competition_round_robin_fixtures',
    'competition_division_assignments',
    'competition_divisions',
    'competition_division_configs',
    'concurrent_shooting_round_mappings',
    'shooting_score_sources',
    'concurrent_shooting_rounds',
    'concurrent_shooting_group_competitions',
    'concurrent_shooting_groups',
    'competition_entrant_participants',
    'competition_entrants',
    'club_competition_entries',
    'competition_score_components',
    'competition_rounds',
    'competitions',
    'competition_series_score_components',
    'competition_series',
    'league_seasons',
    'club_information_cards',
    'club_memberships',
    'clubs',
    'organisation_information_cards',
    'organisation_equipment_types',
    'organisation_shooting_positions',
    'organisation_staff',
    'user_organisations',
    'organisations',
    'profiles'
  ];
begin
  if v_keep_user_id::text = repeat('0', 8) || '-0000-0000-0000-000000000000' then
    raise exception using
      message = 'RESET ABORTED: replace the zero v_keep_user_id UUID in your SQL Editor copy before running.',
      errcode = '22023';
  end if;

  if not exists (
    select 1 from auth.users as users where users.id = v_keep_user_id
  ) then
    raise exception using
      message = format(
        'RESET ABORTED: preserved Auth user %s does not exist.',
        v_keep_user_id
      ),
      errcode = '22023';
  end if;

  select count(*)
  into v_keep_identity_count_before
  from auth.identities as identities
  where identities.user_id = v_keep_user_id;

  if v_keep_identity_count_before = 0 then
    raise exception using
      message = format(
        'RESET ABORTED: preserved Auth user %s has no auth.identities row and may not be able to sign in.',
        v_keep_user_id
      ),
      errcode = '22023';
  end if;

  select array_agg(required_table order by required_table)
  into v_missing_tables
  from unnest(v_domain_tables) as required_table
  where pg_catalog.to_regclass(format('public.%I', required_table)) is null;

  if v_missing_tables is not null then
    raise exception using
      message = format(
        'RESET ABORTED: expected application tables are missing: %s.',
        array_to_string(v_missing_tables, ', ')
      ),
      errcode = '42P01';
  end if;

  -- Supabase documents that an Auth user owning Storage objects cannot be
  -- deleted. Fail before taking table locks so those objects can be removed
  -- through the Storage API or Dashboard instead of editing Storage internals.
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute $storage$
      select count(*)
      from storage.objects as objects
      where objects.owner_id is not null
        and objects.owner_id::text <> $1
    $storage$
    into v_storage_objects_owned_by_other_users
    using v_keep_user_id::text;

    if v_storage_objects_owned_by_other_users > 0 then
      raise exception using
        message = format(
          'RESET ABORTED: %s Storage object(s) are owned by disposable Auth users. Delete those objects through the Supabase Storage API or Dashboard, then rerun.',
          v_storage_objects_owned_by_other_users
        ),
        errcode = '23503';
    end if;
  end if;

  -- Every current tenant/application table is included in this one statement.
  -- No CASCADE means an unaccounted foreign-key dependent table makes the reset
  -- fail atomically instead of being silently emptied.
  truncate table
    public.shooting_score_change_events,
    public.competition_score_usages,
    public.shooting_score_values,
    public.starting_average_score_sources,
    public.competition_starting_average_finalisations,
    public.competition_participant_starting_averages,
    public.competition_series_average_defaults,
    public.competition_average_settings,
    public.average_policy_versions,
    public.average_policies,
    public.average_contexts,
    public.competition_round_robin_fixtures,
    public.competition_division_assignments,
    public.competition_divisions,
    public.competition_division_configs,
    public.concurrent_shooting_round_mappings,
    public.shooting_score_sources,
    public.concurrent_shooting_rounds,
    public.concurrent_shooting_group_competitions,
    public.concurrent_shooting_groups,
    public.competition_entrant_participants,
    public.competition_entrants,
    public.club_competition_entries,
    public.competition_score_components,
    public.competition_rounds,
    public.competitions,
    public.competition_series_score_components,
    public.competition_series,
    public.league_seasons,
    public.club_information_cards,
    public.club_memberships,
    public.clubs,
    public.organisation_information_cards,
    public.organisation_equipment_types,
    public.organisation_shooting_positions,
    public.organisation_staff,
    public.user_organisations,
    public.organisations,
    public.profiles;

  -- Direct auth.users deletion is a supported SQL-level operation in Supabase.
  -- Supabase-owned foreign keys cascade each unwanted user's identities,
  -- sessions, MFA records, and other owned Auth children. The preserved user's
  -- auth.users row and every one of its Auth-owned records are left untouched.
  delete from auth.users as users
  where users.id <> v_keep_user_id;
  get diagnostics v_deleted_auth_users = row_count;

  select count(*)
  into v_auth_users_remaining
  from auth.users;

  if v_auth_users_remaining <> 1
    or not exists (
      select 1 from auth.users as users where users.id = v_keep_user_id
    ) then
    raise exception using
      message = format(
        'RESET VALIDATION FAILED: expected only Auth user %s; found %s Auth user(s).',
        v_keep_user_id,
        v_auth_users_remaining
      ),
      errcode = '23514';
  end if;

  select count(*)
  into v_keep_identity_count_after
  from auth.identities as identities
  where identities.user_id = v_keep_user_id;

  if v_keep_identity_count_after <> v_keep_identity_count_before then
    raise exception using
      message = format(
        'RESET VALIDATION FAILED: preserved Auth identities changed from %s to %s.',
        v_keep_identity_count_before,
        v_keep_identity_count_after
      ),
      errcode = '23514';
  end if;

  v_domain_rows_remaining := 0;
  foreach v_table_name in array v_domain_tables loop
    execute format('select count(*) from public.%I', v_table_name)
      into strict v_auth_users_remaining;
    v_domain_rows_remaining := v_domain_rows_remaining + v_auth_users_remaining;

    if v_auth_users_remaining <> 0 then
      raise exception using
        message = format(
          'RESET VALIDATION FAILED: public.%I still contains %s row(s).',
          v_table_name,
          v_auth_users_remaining
        ),
        errcode = '23514';
    end if;
  end loop;

  select count(*) into v_equipment_type_count
  from public.shooting_equipment_types;
  select count(*) into v_position_count
  from public.shooting_positions;

  if not (
    array[
      'smallbore_rifle', 'fullbore_rifle', 'lightweight_sporting_rifle',
      'gallery_rifle', 'air_rifle', 'pistol', 'air_pistol', 'shotgun'
    ]::text[] <@ array(
      select equipment.code from public.shooting_equipment_types as equipment
    )
  ) then
    raise exception 'RESET VALIDATION FAILED: a built-in shooting equipment taxonomy row is missing.'
      using errcode = '23514';
  end if;

  if not (
    array['prone', 'standing', 'kneeling', 'benchrest']::text[] <@ array(
      select position.code from public.shooting_positions as position
    )
  ) then
    raise exception 'RESET VALIDATION FAILED: a built-in shooting position taxonomy row is missing.'
      using errcode = '23514';
  end if;

  raise notice 'Rifle Leagues development/staging reset succeeded.';
  raise notice 'Preserved Auth user: % (% identity row(s)).',
    v_keep_user_id, v_keep_identity_count_after;
  raise notice 'Deleted disposable Auth users: %.', v_deleted_auth_users;
  raise notice 'Remaining application-domain rows: %.', v_domain_rows_remaining;
  raise notice 'Preserved built-in taxonomy rows: % equipment type(s), % shooting position(s).',
    v_equipment_type_count, v_position_count;
end;
$reset$;

commit;
