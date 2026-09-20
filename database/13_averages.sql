-- Canonical fresh-install schema: averages.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."average_contexts" (
  "id" bigint generated always as identity not null,
  "organisation_id" bigint not null,
  "name" text not null,
  "basis_maximum" numeric(10,2) not null,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid,
  "updated_by" uuid
);

create table "public"."average_policies" (
  "id" bigint generated always as identity not null,
  "organisation_id" bigint not null,
  "name" text not null,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid,
  "updated_by" uuid
);

create table "public"."average_policy_versions" (
  "id" bigint generated always as identity not null,
  "average_policy_id" bigint not null,
  "version_number" integer not null,
  "strategy" text not null,
  "configuration" jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "created_by" uuid
);

create table "public"."competition_average_settings" (
  "competition_id" bigint not null,
  "average_context_id" bigint not null,
  "average_policy_version_id" bigint not null,
  "contributes_to_history" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid,
  "updated_by" uuid
);

create table "public"."competition_participant_starting_averages" (
  "id" bigint generated always as identity not null,
  "competition_id" bigint not null,
  "competition_entrant_participant_id" bigint not null,
  "shooter_profile_id" uuid not null,
  "starting_average" numeric(14,6),
  "average_context_id" bigint not null,
  "average_policy_version_id" bigint not null,
  "origin" text not null,
  "status" text default 'provisional'::text not null,
  "calculated_at" timestamp with time zone default now() not null,
  "frozen_at" timestamp with time zone,
  "source_competition_id" bigint,
  "qualifying_score_count" integer default 0 not null,
  "manual_reason" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid,
  "updated_by" uuid
);

create table "public"."competition_series_average_defaults" (
  "competition_series_id" bigint not null,
  "average_context_id" bigint not null,
  "average_policy_version_id" bigint not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid,
  "updated_by" uuid
);

create table "public"."competition_starting_average_finalisations" (
  "competition_id" bigint not null,
  "starting_average_fingerprint" text not null,
  "participant_count" integer not null,
  "finalised_at" timestamp with time zone default now() not null,
  "finalised_by" uuid
);

create table "public"."starting_average_score_sources" (
  "id" bigint generated always as identity not null,
  "starting_average_id" bigint not null,
  "shooting_score_source_id" bigint,
  "competition_id" bigint,
  "round_id" bigint,
  "achieved_score_at_calculation" numeric(14,2) not null,
  "maximum_at_calculation" numeric(10,2) not null,
  "created_at" timestamp with time zone default now() not null
);

CREATE OR REPLACE FUNCTION private.average_context_competition_history(p_average_context_id bigint, p_before_competition_id bigint)
 RETURNS TABLE(competition_id bigint, effective_starts_at date, history_position integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with target as (
    select dates.effective_starts_at
    from public.competitions competition
    cross join lateral private.get_competition_effective_dates(competition.id) dates
    where competition.id = p_before_competition_id
  )
  select competition.id, dates.effective_starts_at,
    row_number() over (order by dates.effective_starts_at desc, competition.id desc)::integer
  from public.competition_average_settings average_setting
  join public.average_contexts context on context.id = average_setting.average_context_id
  join public.competitions competition on competition.id = average_setting.competition_id
  cross join lateral private.get_competition_effective_dates(competition.id) dates
  cross join target
  where average_setting.average_context_id = p_average_context_id
    and average_setting.contributes_to_history
    and competition.status = 'published'
    and competition.id <> p_before_competition_id
    and dates.effective_starts_at is not null
    and target.effective_starts_at is not null
    and dates.effective_starts_at < target.effective_starts_at
    and private.competition_average_shooter_maximum(competition.id) = context.basis_maximum
  order by dates.effective_starts_at desc, competition.id desc
$function$;

CREATE OR REPLACE FUNCTION private.block_starting_average_after_finalisation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1 from public.competition_starting_average_finalisations finalisation
    where finalisation.competition_id = new.competition_id
  ) then
    raise exception 'Starting Averages were finalised for this Competition.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_bound_competition_average_maximum()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  competition_id_to_check bigint;
  context_maximum numeric;
  actual_maximum numeric;
begin
  if tg_table_name = 'competition_score_components' then
    competition_id_to_check := case when tg_op = 'DELETE' then old.competition_id else new.competition_id end;
  else
    competition_id_to_check := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  select context.basis_maximum into context_maximum
  from public.competition_average_settings average_setting
  join public.average_contexts context on context.id = average_setting.average_context_id
  where average_setting.competition_id = competition_id_to_check;
  if not found then return null; end if;
  actual_maximum := private.competition_average_shooter_maximum(competition_id_to_check);
  if actual_maximum is null or actual_maximum is distinct from context_maximum then
    raise exception 'Bound Competition shooter maximum must continue to exactly equal its Average Context basis maximum.'
      using errcode = '22023';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_series_average_default_maximum()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  series_id_to_check bigint;
  context_maximum numeric;
begin
  if tg_table_name = 'competition_series_score_components' then
    series_id_to_check := case when tg_op = 'DELETE' then old.competition_series_id else new.competition_series_id end;
  else
    series_id_to_check := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  select context.basis_maximum into context_maximum
  from public.competition_series_average_defaults defaults
  join public.average_contexts context on context.id = defaults.average_context_id
  where defaults.competition_series_id = series_id_to_check;
  if not found then return null; end if;
  if private.competition_series_average_shooter_maximum(series_id_to_check)
    is distinct from context_maximum then
    raise exception 'Series with Average defaults must continue to exactly match its Context basis maximum.'
      using errcode = '22023';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.competition_average_shooter_maximum(p_competition_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select competition.sets_per_round * sum(component.maximum_score)
  from public.competitions competition
  join public.competition_score_components component on component.competition_id = competition.id
  where competition.id = p_competition_id
  group by competition.id, competition.sets_per_round
$function$;

CREATE OR REPLACE FUNCTION private.competition_series_average_shooter_maximum(p_competition_series_id bigint)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select series.sets_per_round * sum(component.maximum_score)
  from public.competition_series series
  join public.competition_series_score_components component
    on component.competition_series_id = series.id
  where series.id = p_competition_series_id
  group by series.id,series.sets_per_round
$function$;

CREATE OR REPLACE FUNCTION private.competition_starting_average_state(p_competition_id bigint)
 RETURNS TABLE(configured boolean, participant_count integer, snapshot_count integer, frozen_count integer, complete boolean, fingerprint text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_setting public.competition_average_settings%rowtype;
begin
  select * into v_setting from public.competition_average_settings setting
  where setting.competition_id = p_competition_id;

  if not found then
    return query
    select false, count(participant.id)::integer, 0, 0, false, null::text
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants participant
      on participant.club_competition_entry_id = entry.id
     and participant.competition_entrant_id = entrant.id
    where entry.competition_id = p_competition_id and entry.status = 'submitted';
    return;
  end if;

  return query
  with roster as (
    select participant.id as participant_id,
      membership.user_id as shooter_profile_id,
      snapshot.id as snapshot_id,
      snapshot.starting_average,
      snapshot.origin,
      snapshot.status,
      snapshot.calculated_at,
      snapshot.source_competition_id,
      snapshot.qualifying_score_count,
      snapshot.average_context_id,
      snapshot.average_policy_version_id
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants participant
      on participant.club_competition_entry_id = entry.id
     and participant.competition_entrant_id = entrant.id
    join public.club_memberships membership on membership.id = participant.club_membership_id
    left join public.competition_participant_starting_averages snapshot
      on snapshot.competition_entrant_participant_id = participant.id
     and snapshot.competition_id = p_competition_id
    where entry.competition_id = p_competition_id and entry.status = 'submitted'
  )
  select true, count(*)::integer, count(roster.snapshot_id)::integer,
    count(*) filter (where roster.status = 'frozen')::integer,
    count(*) > 0 and count(roster.snapshot_id) = count(*),
    pg_catalog.md5(
      v_setting.average_context_id::text || '|' ||
      v_setting.average_policy_version_id::text || '|' ||
      v_setting.contributes_to_history::text || '|' ||
      coalesce(string_agg(
        roster.participant_id::text || ':' || roster.shooter_profile_id::text || ':' ||
        coalesce(roster.snapshot_id::text, '-') || ':' ||
        coalesce(roster.starting_average::text, '-') || ':' ||
        coalesce(roster.origin, '-') || ':' ||
        coalesce(extract(epoch from roster.calculated_at)::text, '-') || ':' ||
        coalesce(roster.source_competition_id::text, '-') || ':' ||
        coalesce(roster.qualifying_score_count::text, '-') || ':' ||
        coalesce(roster.average_context_id::text, '-') || ':' ||
        coalesce(roster.average_policy_version_id::text, '-'),
        ',' order by roster.participant_id
      ), '')
    )
  from roster;
end;
$function$;

CREATE OR REPLACE FUNCTION private.copy_competition_series_average_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.competition_series_id is not null
    and new.competition_series_id is distinct from old.competition_series_id then
    insert into public.competition_average_settings(
      competition_id,average_context_id,average_policy_version_id,
      contributes_to_history,created_by,updated_by
    )
    select new.id,defaults.average_context_id,defaults.average_policy_version_id,
      true,coalesce((select auth.uid()),new.updated_by),coalesce((select auth.uid()),new.updated_by)
    from public.competition_series_average_defaults defaults
    where defaults.competition_series_id = new.competition_series_id
    on conflict (competition_id) do nothing;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.freeze_competition_starting_averages(p_competition_id bigint, p_actor_id uuid, p_require_division_review boolean)
 RETURNS TABLE(participant_count integer, finalised_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state record;
  v_finalisation public.competition_starting_average_finalisations%rowtype;
  v_reviewed_fingerprint text;
  v_now timestamptz := clock_timestamp();
begin
  perform setting.competition_id
  from public.competition_average_settings setting
  where setting.competition_id = p_competition_id for share;
  if not found then
    return query select 0, null::timestamptz;
    return;
  end if;

  perform entry.id from public.club_competition_entries entry
  where entry.competition_id = p_competition_id order by entry.id for update;
  perform participant.id
  from public.competition_entrant_participants participant
  join public.club_competition_entries entry
    on entry.id = participant.club_competition_entry_id
  where entry.competition_id = p_competition_id and entry.status = 'submitted'
  order by participant.id for update of participant;
  perform snapshot.id from public.competition_participant_starting_averages snapshot
  where snapshot.competition_id = p_competition_id order by snapshot.id for update;

  select * into v_state from private.competition_starting_average_state(p_competition_id);
  select * into v_finalisation
  from public.competition_starting_average_finalisations finalisation
  where finalisation.competition_id = p_competition_id;
  if found then
    if v_state.fingerprint is distinct from v_finalisation.starting_average_fingerprint
      or not v_state.complete or v_state.frozen_count <> v_state.participant_count then
      raise exception 'Finalised Starting Average state is inconsistent and requires administrator review.'
        using errcode = '22023';
    end if;
    return query select v_finalisation.participant_count, v_finalisation.finalised_at;
    return;
  end if;

  if not v_state.complete then
    raise exception 'Every submitted participant needs a Starting Average before finalisation.'
      using errcode = '22023';
  end if;

  if p_require_division_review then
    select config.reviewed_starting_average_fingerprint into v_reviewed_fingerprint
    from public.competition_division_configs config
    where config.competition_id = p_competition_id for update;
    if v_reviewed_fingerprint is null
      or v_reviewed_fingerprint is distinct from v_state.fingerprint then
      raise exception 'Starting Averages changed since this division layout was reviewed. Refresh, review, and save the draft again.'
        using errcode = '40001';
    end if;
  end if;

  update public.competition_participant_starting_averages snapshot
  set status = 'frozen', frozen_at = v_now, updated_by = p_actor_id
  where snapshot.competition_id = p_competition_id and snapshot.status = 'provisional';

  insert into public.competition_starting_average_finalisations(
    competition_id, starting_average_fingerprint, participant_count,
    finalised_at, finalised_by
  ) values (
    p_competition_id, v_state.fingerprint, v_state.participant_count,
    v_now, p_actor_id
  )
  returning competition_starting_average_finalisations.participant_count,
    competition_starting_average_finalisations.finalised_at
  into participant_count, finalised_at;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_average_context_basis()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.organisation_id is distinct from old.organisation_id
    or new.basis_maximum is distinct from old.basis_maximum then
    raise exception 'Average Context Organisation and basis maximum are immutable.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_average_policy_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Average Policy versions are immutable. Create a new version instead.' using errcode = '22023';
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_competition_average_setting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  changed boolean := tg_op = 'DELETE';
  target_competition_id bigint := old.competition_id;
begin
  if tg_op = 'UPDATE' then
    if new.competition_id is distinct from old.competition_id then
      raise exception 'Competition Average settings cannot be moved between Competitions.' using errcode = '22023';
    end if;
    changed := (new.average_context_id,new.average_policy_version_id,new.contributes_to_history)
      is distinct from (old.average_context_id,old.average_policy_version_id,old.contributes_to_history);
  end if;
  if changed and exists (
    select 1 from public.competition_participant_starting_averages snapshot
    where snapshot.competition_id = target_competition_id and snapshot.status = 'frozen'
  ) then
    raise exception 'Competition Average settings cannot change after a Starting Average is frozen.' using errcode = '22023';
  end if;
  if changed then
    delete from public.competition_participant_starting_averages snapshot
    where snapshot.competition_id = target_competition_id and snapshot.status = 'provisional';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := clock_timestamp(); return new; end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_frozen_starting_average()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status = 'frozen' then
    raise exception 'Frozen Starting Averages cannot be changed through the provisional lifecycle.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_starting_average_finalisation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Starting Average finalisation is immutable.' using errcode = '22023';
end;
$function$;

CREATE OR REPLACE FUNCTION private.record_competition_starting_average_review(p_competition_id bigint, p_fingerprint text, p_actor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state record;
begin
  select * into v_state from private.competition_starting_average_state(p_competition_id);
  if not v_state.configured then
    update public.competition_division_configs
    set reviewed_starting_average_fingerprint = null,
        reviewed_starting_averages_at = null,
        updated_by = p_actor_id
    where competition_id = p_competition_id;
    return;
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{32}$'
    or p_fingerprint is distinct from v_state.fingerprint then
    raise exception 'Starting Averages changed since this division layout was reviewed. Refresh, review, and save the draft again.'
      using errcode = '40001';
  end if;
  update public.competition_division_configs
  set reviewed_starting_average_fingerprint = v_state.fingerprint,
      reviewed_starting_averages_at = clock_timestamp(),
      updated_by = p_actor_id
  where competition_id = p_competition_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.resolve_competition_starting_average(p_target_competition_id bigint, p_shooter_profile_id uuid)
 RETURNS TABLE(starting_average numeric, policy_branch text, qualifying_score_count integer, source_competition_id bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  context_id bigint;
  strategy_name text;
  policy_configuration jsonb;
  current_competition_id bigint;
  preceding_competition_id bigint;
  score_count integer;
  score_average numeric;
begin
  select setting.average_context_id, version.strategy, version.configuration
  into context_id, strategy_name, policy_configuration
  from public.competition_average_settings setting
  join public.average_policy_versions version on version.id = setting.average_policy_version_id
  where setting.competition_id = p_target_competition_id;
  if not found then
    raise exception 'Competition does not have authoritative Average settings.' using errcode = '22023';
  end if;
  if strategy_name = 'manual' then
    return query select null::numeric, 'manual'::text, 0, null::bigint;
    return;
  end if;

  select history.competition_id into current_competition_id
  from private.average_context_competition_history(context_id,p_target_competition_id) history
  where history.history_position = 1;
  select history.competition_id into preceding_competition_id
  from private.average_context_competition_history(context_id,p_target_competition_id) history
  where history.history_position = 2;

  select count(*)::integer, round(avg(candidate.achieved_score),6)
  into score_count,score_average
  from private.shooter_historical_average_candidates(context_id,p_shooter_profile_id,p_target_competition_id) candidate
  where candidate.competition_id = current_competition_id;
  if score_count >= (policy_configuration->>'minimum_current_scores')::integer then
    return query select score_average,'current'::text,score_count,current_competition_id;
    return;
  end if;

  select count(*)::integer, round(avg(candidate.achieved_score),6)
  into score_count,score_average
  from private.shooter_historical_average_candidates(context_id,p_shooter_profile_id,p_target_competition_id) candidate
  where candidate.competition_id = preceding_competition_id;
  if score_count >= (policy_configuration->>'minimum_preceding_scores')::integer then
    return query select score_average,'preceding'::text,score_count,preceding_competition_id;
    return;
  end if;
  return query select null::numeric,'manual'::text,0,null::bigint;
end;
$function$;

CREATE OR REPLACE FUNCTION private.shooter_historical_average_candidates(p_average_context_id bigint, p_shooter_profile_id uuid, p_before_competition_id bigint)
 RETURNS TABLE(shooting_score_source_id bigint, competition_id bigint, round_id bigint, achieved_score numeric, maximum_score numeric, effective_starts_at date, round_number integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with target as (
    select dates.effective_starts_at
    from public.competitions competition
    cross join lateral private.get_competition_effective_dates(competition.id) dates
    where competition.id = p_before_competition_id
  ), raw_candidates as (
    select source.id as shooting_score_source_id,
      competition.id as competition_id,
      competition_round.id as round_id,
      values.recorded_achieved_score as achieved_score,
      config.shooter_maximum as maximum_score,
      dates.effective_starts_at,
      competition_round.round_number,
      row_number() over (
        partition by source.id
        order by dates.effective_starts_at desc, competition.id desc,
          competition_round.deadline desc, competition_round.round_number desc, usage.id desc
      ) as source_usage_order
    from public.competition_average_settings average_setting
    join public.average_contexts context on context.id = average_setting.average_context_id
    join public.competitions competition on competition.id = average_setting.competition_id
    cross join lateral private.get_competition_effective_dates(competition.id) dates
    join public.competition_score_usages usage on usage.competition_id = competition.id
    join public.competition_rounds competition_round
      on competition_round.id = usage.competition_round_id
     and competition_round.competition_id = competition.id
    join public.competition_entrant_participants participant
      on participant.id = usage.competition_entrant_participant_id
    join public.club_competition_entries entry
      on entry.id = participant.club_competition_entry_id
     and entry.competition_id = competition.id and entry.status = 'submitted'
    join public.club_memberships membership on membership.id = participant.club_membership_id
    join public.shooting_score_sources source
      on source.id = usage.shooting_score_source_id
     and source.shooter_profile_id = membership.user_id
    cross join target
    cross join lateral (
      select count(component.id)::integer as component_count,
        (competition.sets_per_round * count(component.id))::integer as expected_slot_count,
        competition.sets_per_round * sum(component.maximum_score) as shooter_maximum
      from public.competition_score_components component
      where component.competition_id = competition.id
    ) config
    cross join lateral (
      select count(score_value.id)::integer as recorded_slot_count,
        sum(score_value.achieved_score) as recorded_achieved_score
      from public.shooting_score_values score_value
      where score_value.shooting_score_source_id = source.id
    ) values
    where average_setting.average_context_id = p_average_context_id
      and average_setting.contributes_to_history
      and competition.status = 'published'
      and competition.id <> p_before_competition_id
      and dates.effective_starts_at is not null
      and target.effective_starts_at is not null
      and dates.effective_starts_at < target.effective_starts_at
      and (statement_timestamp() at time zone 'UTC')::date > competition_round.deadline
      and source.shooter_profile_id = p_shooter_profile_id
      and config.component_count > 0
      and values.recorded_slot_count = config.expected_slot_count
      and config.shooter_maximum = context.basis_maximum
  )
  select raw.shooting_score_source_id, raw.competition_id, raw.round_id,
    raw.achieved_score, raw.maximum_score, raw.effective_starts_at, raw.round_number
  from raw_candidates raw where raw.source_usage_order = 1
$function$;

CREATE OR REPLACE FUNCTION private.validate_average_policy_version_definition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if jsonb_typeof(new.configuration) <> 'object' then
    raise exception 'Average Policy configuration must be a JSON object.' using errcode = '22023';
  end if;
  if new.strategy = 'manual' then
    if new.configuration <> '{}'::jsonb then
      raise exception 'Manual Average Policy configuration must be empty.' using errcode = '22023';
    end if;
    return new;
  end if;
  if (select count(*) from jsonb_object_keys(new.configuration)) <> 3
    or not new.configuration ?& array['minimum_current_scores','minimum_preceding_scores','fallback']
    or jsonb_typeof(new.configuration->'minimum_current_scores') <> 'number'
    or jsonb_typeof(new.configuration->'minimum_preceding_scores') <> 'number'
    or (new.configuration->>'minimum_current_scores') !~ '^[1-9][0-9]{0,2}$'
    or (new.configuration->>'minimum_preceding_scores') !~ '^[1-9][0-9]{0,2}$'
    or (new.configuration->>'minimum_current_scores')::integer > 999
    or (new.configuration->>'minimum_preceding_scores')::integer > 999
    or new.configuration->>'fallback' <> 'manual'
  then
    raise exception 'current_then_preceding requires exactly positive integer minimum_current_scores, minimum_preceding_scores, and fallback=manual.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_average_setting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  competition_organisation_id bigint;
  context_organisation_id bigint;
  policy_organisation_id bigint;
  competition_maximum numeric;
  context_maximum numeric;
  context_archived_at timestamptz;
  policy_archived_at timestamptz;
begin
  select season.organisation_id, private.competition_average_shooter_maximum(competition.id)
  into competition_organisation_id, competition_maximum
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = new.competition_id;
  select context.organisation_id, context.basis_maximum, context.archived_at
  into context_organisation_id, context_maximum, context_archived_at
  from public.average_contexts context where context.id = new.average_context_id;
  select policy.organisation_id, policy.archived_at
  into policy_organisation_id, policy_archived_at
  from public.average_policy_versions version
  join public.average_policies policy on policy.id = version.average_policy_id
  where version.id = new.average_policy_version_id;
  if competition_organisation_id is null or context_organisation_id is null
    or policy_organisation_id is null then
    raise exception 'Competition, Average Context, or Average Policy version was not found.' using errcode = '23503';
  end if;
  if competition_organisation_id <> context_organisation_id
    or competition_organisation_id <> policy_organisation_id then
    raise exception 'Competition, Average Context, and Average Policy must belong to the same Organisation.' using errcode = '22023';
  end if;
  if context_archived_at is not null or policy_archived_at is not null then
    raise exception 'Archived Average Contexts or Policies cannot be selected for a Competition.' using errcode = '22023';
  end if;
  if competition_maximum is null or competition_maximum is distinct from context_maximum then
    raise exception 'Competition shooter maximum % must exactly equal Average Context basis maximum %. V1 does not normalise scores.',
      competition_maximum, context_maximum using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_series_average_default()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  series_organisation_id bigint;
  context_organisation_id bigint;
  policy_organisation_id bigint;
  series_maximum numeric;
  context_maximum numeric;
  context_archived_at timestamptz;
  policy_archived_at timestamptz;
begin
  select series.organisation_id,private.competition_series_average_shooter_maximum(series.id)
  into series_organisation_id,series_maximum
  from public.competition_series series where series.id = new.competition_series_id;
  select context.organisation_id,context.basis_maximum,context.archived_at
  into context_organisation_id,context_maximum,context_archived_at
  from public.average_contexts context where context.id = new.average_context_id;
  select policy.organisation_id,policy.archived_at
  into policy_organisation_id,policy_archived_at
  from public.average_policy_versions version
  join public.average_policies policy on policy.id = version.average_policy_id
  where version.id = new.average_policy_version_id;
  if series_organisation_id is null or context_organisation_id is null
    or policy_organisation_id is null then
    raise exception 'Series, Average Context, or Average Policy version was not found.' using errcode = '23503';
  end if;
  if series_organisation_id <> context_organisation_id
    or series_organisation_id <> policy_organisation_id then
    raise exception 'Series, Average Context, and Average Policy must belong to the same Organisation.' using errcode = '22023';
  end if;
  if context_archived_at is not null or policy_archived_at is not null then
    raise exception 'Archived Average Contexts or Policies cannot be selected as Series defaults.' using errcode = '22023';
  end if;
  if series_maximum is null or series_maximum is distinct from context_maximum then
    raise exception 'Series shooter maximum % must exactly equal Average Context basis maximum %. V1 does not normalise scores.',
      series_maximum,context_maximum using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_starting_average_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  participant_competition_id bigint;
  participant_shooter_id uuid;
  setting_context_id bigint;
  setting_policy_version_id bigint;
  context_maximum numeric;
begin
  select entry.competition_id, membership.user_id
  into participant_competition_id, participant_shooter_id
  from public.competition_entrant_participants participant
  join public.club_competition_entries entry on entry.id = participant.club_competition_entry_id
  join public.club_memberships membership on membership.id = participant.club_membership_id
  where participant.id = new.competition_entrant_participant_id;
  select setting.average_context_id, setting.average_policy_version_id, context.basis_maximum
  into setting_context_id, setting_policy_version_id, context_maximum
  from public.competition_average_settings setting
  join public.average_contexts context on context.id = setting.average_context_id
  where setting.competition_id = new.competition_id;
  if participant_competition_id is null or setting_context_id is null then
    raise exception 'Starting Average requires a participant and authoritative Competition Average settings.' using errcode = '22023';
  end if;
  if participant_competition_id <> new.competition_id
    or participant_shooter_id is distinct from new.shooter_profile_id then
    raise exception 'Starting Average participant, Competition, and shooter identity do not match.' using errcode = '22023';
  end if;
  if (new.average_context_id,new.average_policy_version_id)
    is distinct from (setting_context_id,setting_policy_version_id) then
    raise exception 'Starting Average must snapshot the Competition authoritative Context and Policy version.' using errcode = '22023';
  end if;
  if new.starting_average > context_maximum then
    raise exception 'Starting Average must be between zero and the Average Context basis maximum.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_competition_starting_averages(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid;
  setting public.competition_average_settings%rowtype;
  participant_row record;
  decision record;
  snapshot public.competition_participant_starting_averages%rowtype;
  snapshot_id bigint;
  items jsonb := '[]'::jsonb;
  snapshot_found boolean;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and competition.status = 'published'
    and season.id = p_league_season_id and season.organisation_id = p_organisation_id
  for update of competition;
  if not found then
    raise exception 'Published Competition not found in this Organisation and Season.' using errcode = '22023';
  end if;
  select * into setting from public.competition_average_settings average_setting
  where average_setting.competition_id = p_competition_id for share;
  if not found then
    raise exception 'Competition does not have authoritative Average settings.' using errcode = '22023';
  end if;

  for participant_row in
    select entrant_participant.id as participant_id,
      entrant_participant.competition_entrant_id as entrant_id,entrant_participant.slot_number,
      membership.user_id as shooter_profile_id,profile.first_name,profile.last_name
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants entrant_participant
      on entrant_participant.club_competition_entry_id = entry.id
     and entrant_participant.competition_entrant_id = entrant.id
    join public.club_memberships membership on membership.id = entrant_participant.club_membership_id
    join public.profiles profile on profile.id = membership.user_id
    where entry.competition_id = p_competition_id and entry.status = 'submitted'
    order by entrant.position,entrant_participant.slot_number,entrant_participant.id
  loop
    select * into decision from private.resolve_competition_starting_average(
      p_competition_id,participant_row.shooter_profile_id
    );
    select * into snapshot from public.competition_participant_starting_averages existing
    where existing.competition_entrant_participant_id = participant_row.participant_id for update;
    snapshot_found := found;

    if snapshot_found and snapshot.status = 'frozen' then
      null;
    elsif decision.policy_branch in ('current','preceding') then
      insert into public.competition_participant_starting_averages(
        competition_id,competition_entrant_participant_id,shooter_profile_id,
        starting_average,average_context_id,average_policy_version_id,
        origin,status,calculated_at,frozen_at,source_competition_id,
        qualifying_score_count,manual_reason,created_by,updated_by
      ) values (
        p_competition_id,participant_row.participant_id,participant_row.shooter_profile_id,
        decision.starting_average,setting.average_context_id,setting.average_policy_version_id,
        'calculated','provisional',clock_timestamp(),null,decision.source_competition_id,
        decision.qualifying_score_count,null,actor,actor
      )
      on conflict (competition_entrant_participant_id) do update
      set shooter_profile_id = excluded.shooter_profile_id,
          starting_average = excluded.starting_average,
          average_context_id = excluded.average_context_id,
          average_policy_version_id = excluded.average_policy_version_id,
          origin = excluded.origin,status = 'provisional',calculated_at = excluded.calculated_at,
          frozen_at = null,source_competition_id = excluded.source_competition_id,
          qualifying_score_count = excluded.qualifying_score_count,manual_reason = null,
          updated_by = actor
      returning * into snapshot;
      snapshot_id := snapshot.id;
      delete from public.starting_average_score_sources provenance
      where provenance.starting_average_id = snapshot_id;
      insert into public.starting_average_score_sources(
        starting_average_id,shooting_score_source_id,competition_id,round_id,
        achieved_score_at_calculation,maximum_at_calculation
      )
      select snapshot_id,candidate.shooting_score_source_id,candidate.competition_id,
        candidate.round_id,candidate.achieved_score,candidate.maximum_score
      from private.shooter_historical_average_candidates(
        setting.average_context_id,participant_row.shooter_profile_id,p_competition_id
      ) candidate
      where candidate.competition_id = decision.source_competition_id;
    elsif not (snapshot_found and snapshot.origin = 'manual') then
      insert into public.competition_participant_starting_averages(
        competition_id,competition_entrant_participant_id,shooter_profile_id,
        starting_average,average_context_id,average_policy_version_id,
        origin,status,calculated_at,frozen_at,source_competition_id,
        qualifying_score_count,manual_reason,created_by,updated_by
      ) values (
        p_competition_id,participant_row.participant_id,participant_row.shooter_profile_id,
        null,setting.average_context_id,setting.average_policy_version_id,
        'no_history','provisional',clock_timestamp(),null,null,0,null,actor,actor
      )
      on conflict (competition_entrant_participant_id) do update
      set shooter_profile_id = excluded.shooter_profile_id,
          starting_average = null,
          average_context_id = excluded.average_context_id,
          average_policy_version_id = excluded.average_policy_version_id,
          origin = 'no_history',status = 'provisional',calculated_at = excluded.calculated_at,
          frozen_at = null,source_competition_id = null,qualifying_score_count = 0,
          manual_reason = null,updated_by = actor
      returning * into snapshot;
      delete from public.starting_average_score_sources provenance
      where provenance.starting_average_id = snapshot.id;
    end if;

    items := items || jsonb_build_array(jsonb_build_object(
      'competition_entrant_participant_id',participant_row.participant_id,
      'competition_entrant_id',participant_row.entrant_id,
      'slot_number',participant_row.slot_number,
      'shooter_profile_id',participant_row.shooter_profile_id,
      'first_name',participant_row.first_name,'last_name',participant_row.last_name,
      'starting_average',snapshot.starting_average,
      'manual_required',false,
      'origin',snapshot.origin,
      'status',snapshot.status,
      'policy_branch',case when snapshot.status = 'frozen' and snapshot.origin = 'manual'
        then 'manual' else decision.policy_branch end,
      'qualifying_score_count',snapshot.qualifying_score_count,
      'source_competition_id',snapshot.source_competition_id
    ));
  end loop;
  return items;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_average_context(p_organisation_id bigint, p_name text, p_basis_maximum numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; context_id bigint;
begin
  actor := private.require_competition_author(p_organisation_id);
  insert into public.average_contexts(organisation_id,name,basis_maximum,created_by,updated_by)
  values (p_organisation_id,btrim(p_name),p_basis_maximum,actor,actor)
  returning id into context_id;
  return jsonb_build_object('id',context_id,'organisation_id',p_organisation_id,
    'name',btrim(p_name),'basis_maximum',p_basis_maximum);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_average_policy(p_organisation_id bigint, p_name text, p_strategy text, p_configuration jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; policy_id bigint; version_id bigint;
begin
  actor := private.require_competition_author(p_organisation_id);
  insert into public.average_policies(organisation_id,name,created_by,updated_by)
  values (p_organisation_id,btrim(p_name),actor,actor) returning id into policy_id;
  insert into public.average_policy_versions(
    average_policy_id,version_number,strategy,configuration,created_by
  ) values (policy_id,1,p_strategy,p_configuration,actor) returning id into version_id;
  return jsonb_build_object('id',policy_id,'name',btrim(p_name),'version_id',version_id,
    'version_number',1,'strategy',p_strategy,'configuration',p_configuration);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_average_policy_version(p_organisation_id bigint, p_average_policy_id bigint, p_strategy text, p_configuration jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; next_version integer; version_id bigint;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform policy.id from public.average_policies policy
  where policy.id = p_average_policy_id and policy.organisation_id = p_organisation_id
    and policy.archived_at is null for update;
  if not found then raise exception 'Active Average Policy not found in this Organisation.' using errcode = '22023'; end if;
  select coalesce(max(version.version_number),0)+1 into next_version
  from public.average_policy_versions version where version.average_policy_id = p_average_policy_id;
  insert into public.average_policy_versions(
    average_policy_id,version_number,strategy,configuration,created_by
  ) values (p_average_policy_id,next_version,p_strategy,p_configuration,actor)
  returning id into version_id;
  return jsonb_build_object('id',version_id,'average_policy_id',p_average_policy_id,
    'version_number',next_version,'strategy',p_strategy,'configuration',p_configuration);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_competition_series_with_average_defaults(p_organisation_id bigint, p_league_season_id bigint, p_series_name text, p_configuration jsonb, p_average_context_id bigint, p_average_policy_version_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if p_average_context_id is null or p_average_policy_version_id is null then
    raise exception 'Average Context and Average Policy version defaults are required.' using errcode = '22023';
  end if;
  result := public.create_competition_series(
    p_organisation_id,p_league_season_id,p_series_name,p_configuration
  );
  perform public.set_competition_series_average_defaults(
    p_organisation_id,(result->>'competition_series_id')::bigint,
    p_average_context_id,p_average_policy_version_id
  );
  perform public.set_competition_average_settings(
    p_organisation_id,p_league_season_id,(result->>'id')::bigint,
    p_average_context_id,p_average_policy_version_id,true
  );
  return result || jsonb_build_object('average_context_id',p_average_context_id,
    'average_policy_version_id',p_average_policy_version_id,'contributes_to_history',true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_competition_with_average_settings(p_organisation_id bigint, p_league_season_id bigint, p_configuration jsonb, p_average_context_id bigint, p_average_policy_version_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if p_average_context_id is null or p_average_policy_version_id is null then
    raise exception 'Average Context and Average Policy version are required.'
      using errcode = '22023';
  end if;

  result := private.save_series_competition(
    p_organisation_id,
    p_league_season_id,
    p_configuration
  );

  perform public.set_competition_average_settings(
    p_organisation_id,
    p_league_season_id,
    (result->>'id')::bigint,
    p_average_context_id,
    p_average_policy_version_id,
    true
  );

  return result || jsonb_build_object(
    'average_context_id', p_average_context_id,
    'average_policy_version_id', p_average_policy_version_id,
    'contributes_to_history', true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalise_competition_starting_averages(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
  v_result record;
begin
  select * into v_context from private.require_competition_division_manager(
    p_organisation_id, p_league_season_id, p_competition_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('competition-divisions:' || p_competition_id::text, 0)
  );
  if exists (select 1 from public.competition_division_configs config
    where config.competition_id = p_competition_id) then
    raise exception 'This Competition uses the division workflow. Publish divisions to finalise Starting Averages.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.competition_average_settings setting
    where setting.competition_id = p_competition_id) then
    raise exception 'This Competition does not have Starting Average setup.' using errcode = '22023';
  end if;
  select * into v_result from private.freeze_competition_starting_averages(
    p_competition_id, v_context.actor_id, false
  );
  return jsonb_build_object('status','frozen',
    'participant_count',v_result.participant_count,'finalised_at',v_result.finalised_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_division_average_projection(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
  v_state record;
  v_config public.competition_division_configs%rowtype;
  v_finalisation public.competition_starting_average_finalisations%rowtype;
  v_basis_maximum numeric;
  v_entrants jsonb;
begin
  select * into v_context from private.require_competition_division_manager(
    p_organisation_id, p_league_season_id, p_competition_id
  );
  select * into v_state from private.competition_starting_average_state(p_competition_id);
  select * into v_config from public.competition_division_configs config
  where config.competition_id = p_competition_id;
  select * into v_finalisation
  from public.competition_starting_average_finalisations finalisation
  where finalisation.competition_id = p_competition_id;
  select context.basis_maximum into v_basis_maximum
  from public.competition_average_settings setting
  join public.average_contexts context on context.id = setting.average_context_id
  where setting.competition_id = p_competition_id;

  if not v_state.configured then
    select coalesce(jsonb_agg(jsonb_build_object(
      'competition_entrant_id', entrant.id,
      'starting_average', null,
      'state', 'not_configured',
      'participants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'competition_entrant_participant_id', participant.id,
          'slot_number', participant.slot_number,
          'first_name', profile.first_name,
          'last_name', profile.last_name,
          'starting_average', null,
          'origin', null,
          'status', null,
          'state', 'not_configured'
        ) order by participant.slot_number, participant.id)
        from public.competition_entrant_participants participant
        join public.club_memberships membership on membership.id = participant.club_membership_id
        join public.profiles profile on profile.id = membership.user_id
        where participant.competition_entrant_id = entrant.id
          and participant.club_competition_entry_id = entry.id
      ), '[]'::jsonb)
    ) order by entrant.id), '[]'::jsonb) into v_entrants
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    where entry.competition_id = p_competition_id and entry.status = 'submitted';

    return jsonb_build_object(
      'configured', false,
      'basis_maximum', null,
      'current_fingerprint', null,
      'review_status', 'not_configured',
      'finalised_at', null,
      'entrants', v_entrants
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'competition_entrant_id', entrant.id,
    'starting_average', case when stats.participant_count > 0
      and stats.value_count = stats.participant_count
      then stats.starting_average else null end,
    'state', case
      when stats.participant_count > 0 and stats.snapshot_count = stats.participant_count
        and stats.frozen_count = stats.participant_count then 'frozen'
      when stats.participant_count > 0 and stats.snapshot_count = stats.participant_count
        and stats.value_count < stats.participant_count then 'no_average'
      when stats.participant_count > 0 and stats.snapshot_count = stats.participant_count then 'ready'
      else 'recalculation_required'
    end,
    'participants', stats.participants
  ) order by entrant.id), '[]'::jsonb) into v_entrants
  from public.club_competition_entries entry
  join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
  cross join lateral (
    select count(participant.id)::integer as participant_count,
      count(snapshot.id)::integer as snapshot_count,
      count(snapshot.starting_average)::integer as value_count,
      count(*) filter (where snapshot.status = 'frozen')::integer as frozen_count,
      avg(snapshot.starting_average) as starting_average,
      coalesce(jsonb_agg(jsonb_build_object(
        'competition_entrant_participant_id', participant.id,
        'slot_number', participant.slot_number,
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'starting_average', snapshot.starting_average,
        'origin', snapshot.origin,
        'status', snapshot.status,
        'state', case
          when snapshot.status = 'frozen' then 'frozen'
          when snapshot.origin = 'no_history' then 'no_average'
          when snapshot.id is not null then 'ready'
          else 'recalculation_required'
        end
      ) order by participant.slot_number, participant.id), '[]'::jsonb) as participants
    from public.competition_entrant_participants participant
    join public.club_memberships membership on membership.id = participant.club_membership_id
    join public.profiles profile on profile.id = membership.user_id
    left join public.competition_participant_starting_averages snapshot
      on snapshot.competition_entrant_participant_id = participant.id
     and snapshot.competition_id = p_competition_id
    where participant.competition_entrant_id = entrant.id
      and participant.club_competition_entry_id = entry.id
  ) stats
  where entry.competition_id = p_competition_id and entry.status = 'submitted';

  return jsonb_build_object(
    'configured', v_state.configured,
    'basis_maximum', v_basis_maximum,
    'current_fingerprint', v_state.fingerprint,
    'review_status', case
      when v_finalisation.competition_id is not null then 'finalised'
      when v_config.reviewed_starting_average_fingerprint is null then 'unreviewed'
      when v_config.reviewed_starting_average_fingerprint = v_state.fingerprint then 'current'
      else 'stale'
    end,
    'finalised_at', v_finalisation.finalised_at,
    'entrants', v_entrants
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_result_averages(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_include_starting_average boolean := false;
  v_entry_format text;
  v_result jsonb;
begin
  select competition.entry_format into v_entry_format
    from public.competitions as competition
    join public.league_seasons as season
      on season.id = competition.league_season_id
    join public.organisations as organisation
      on organisation.id = season.organisation_id
    where competition.id = p_competition_id
      and season.id = p_league_season_id
      and organisation.id = p_organisation_id
      and organisation.status = 'active'
      and season.status in ('open', 'active', 'completed')
      and competition.status = 'published'
      and competition.ranking_method in (
        'aggregate', 'best_n_average', 'gun_score', 'round_robin'
      );
  if not found then
    raise exception 'Published Competition result context was not found.'
      using errcode = 'P0002';
  end if;

  select v_entry_format = 'individual' or exists (
    select 1
    from public.organisation_staff as staff
    where staff.organisation_id = p_organisation_id
      and staff.user_id = (select auth.uid())
      and staff.status = 'active'
      and staff.role in ('owner', 'manager')
  ) into v_include_starting_average;

  with component_config as (
    select
      competition.id as competition_id,
      competition.sets_per_round,
      count(component.id)::integer as component_count,
      (
        competition.sets_per_round * count(component.id)
      )::integer as expected_slot_count
    from public.competitions as competition
    left join public.competition_score_components as component
      on component.competition_id = competition.id
    where competition.id = p_competition_id
    group by competition.id, competition.sets_per_round
  ), participant_roster as (
    select
      entrant.id as entrant_id,
      participant.id as participant_id,
      participant.slot_number,
      membership.user_id as shooter_profile_id
    from public.club_competition_entries as entry
    join public.competition_entrants as entrant
      on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants as participant
      on participant.club_competition_entry_id = entry.id
     and participant.competition_entrant_id = entrant.id
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
    where entry.competition_id = p_competition_id
      and entry.status = 'submitted'
  ), raw_candidates as (
    select
      roster.participant_id,
      competition_round.id as round_id,
      source.id as shooting_score_source_id,
      score_values.achieved_score,
      row_number() over (
        partition by
          roster.participant_id,
          competition_round.id,
          source.id
        order by usage.id desc
      ) as source_usage_order
    from participant_roster as roster
    join public.competition_score_usages as usage
      on usage.competition_id = p_competition_id
     and usage.competition_entrant_participant_id = roster.participant_id
    join public.competition_rounds as competition_round
      on competition_round.id = usage.competition_round_id
     and competition_round.competition_id = usage.competition_id
    join public.shooting_score_sources as source
      on source.id = usage.shooting_score_source_id
     and source.shooter_profile_id = roster.shooter_profile_id
    cross join component_config as config
    cross join lateral (
      select
        count(score_value.id)::integer as recorded_slot_count,
        sum(score_value.achieved_score) as achieved_score
      from public.shooting_score_values as score_value
      where score_value.shooting_score_source_id = source.id
    ) as score_values
    where config.component_count > 0
      and score_values.recorded_slot_count = config.expected_slot_count
      and (statement_timestamp() at time zone 'UTC')::date
        > competition_round.deadline
  ), running_averages as (
    select
      candidate.participant_id,
      avg(candidate.achieved_score) as running_average
    from raw_candidates as candidate
    where candidate.source_usage_order = 1
    group by candidate.participant_id
  )
  select jsonb_build_object(
    'participants', coalesce(jsonb_agg(
      jsonb_build_object(
        'entrant_id', roster.entrant_id,
        'slot_number', roster.slot_number,
        'running_average', running.running_average
      ) || case when v_include_starting_average then
        jsonb_build_object('starting_average', starting.starting_average)
      else '{}'::jsonb end
      order by roster.entrant_id, roster.slot_number, roster.participant_id
    ), '[]'::jsonb)
  ) into v_result
  from participant_roster as roster
  left join running_averages as running
    on running.participant_id = roster.participant_id
  left join public.competition_participant_starting_averages as starting
    on starting.competition_entrant_participant_id = roster.participant_id
   and starting.competition_id = p_competition_id
   and starting.status = 'frozen';

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_starting_average_management(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  participants jsonb;
  v_finalised_at timestamptz;
  v_division_status text;
begin
  perform private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;
  if not found then
    raise exception 'Competition not found in this Organisation and Season.'
      using errcode = '22023';
  end if;
  select finalisation.finalised_at into v_finalised_at
  from public.competition_starting_average_finalisations finalisation
  where finalisation.competition_id = p_competition_id;
  select config.status into v_division_status
  from public.competition_division_configs config
  where config.competition_id = p_competition_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'competition_entrant_participant_id', participant.id,
    'competition_entrant_id', participant.competition_entrant_id,
    'slot_number', participant.slot_number,
    'shooter_profile_id', membership.user_id,
    'first_name', profile.first_name,
    'last_name', profile.last_name,
    'starting_average', snapshot.starting_average,
    'origin', snapshot.origin,
    'status', snapshot.status,
    'qualifying_score_count', coalesce(snapshot.qualifying_score_count, 0),
    'source_competition_id', snapshot.source_competition_id,
    'source_competition_name', source_competition.name,
    'manual_reason', snapshot.manual_reason
  ) order by entrant.position, participant.slot_number, participant.id), '[]'::jsonb)
  into participants
  from public.club_competition_entries entry
  join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
  join public.competition_entrant_participants participant
    on participant.club_competition_entry_id = entry.id
   and participant.competition_entrant_id = entrant.id
  join public.club_memberships membership on membership.id = participant.club_membership_id
  join public.profiles profile on profile.id = membership.user_id
  left join public.competition_participant_starting_averages snapshot
    on snapshot.competition_entrant_participant_id = participant.id
  left join public.competitions source_competition
    on source_competition.id = snapshot.source_competition_id
  where entry.competition_id = p_competition_id and entry.status = 'submitted';

  return jsonb_build_object('participants',participants,
    'finalised_at',v_finalised_at,'division_status',v_division_status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_and_publish_competition_divisions_with_average_review(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb, p_starting_average_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.save_competition_division_draft_with_average_review(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_target_size, p_divisions, p_starting_average_fingerprint
  );
  return public.publish_competition_divisions(
    p_organisation_id, p_league_season_id, p_competition_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_competition_division_draft_with_average_review(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_target_size integer, p_divisions jsonb, p_starting_average_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
  v_result jsonb;
begin
  select * into v_context from private.require_competition_division_manager(
    p_organisation_id, p_league_season_id, p_competition_id
  );
  v_result := public.save_competition_division_draft(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_target_size, p_divisions
  );
  perform private.record_competition_starting_average_review(
    p_competition_id, p_starting_average_fingerprint, v_context.actor_id
  );
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_average_context_archived(p_organisation_id bigint, p_average_context_id bigint, p_archived boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; result jsonb;
begin
  actor := private.require_competition_author(p_organisation_id);
  if p_archived is null then raise exception 'Choose archive or restore.' using errcode = '22023'; end if;
  update public.average_contexts context
  set archived_at = case when p_archived then coalesce(context.archived_at,clock_timestamp()) else null end,
      updated_by = actor
  where context.id = p_average_context_id and context.organisation_id = p_organisation_id
  returning jsonb_build_object('id',context.id,'archived_at',context.archived_at) into result;
  if result is null then raise exception 'Average Context not found in this Organisation.' using errcode = '22023'; end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_average_policy_archived(p_organisation_id bigint, p_average_policy_id bigint, p_archived boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; result jsonb;
begin
  actor := private.require_competition_author(p_organisation_id);
  if p_archived is null then raise exception 'Choose archive or restore.' using errcode = '22023'; end if;
  update public.average_policies policy
  set archived_at = case when p_archived then coalesce(policy.archived_at,clock_timestamp()) else null end,
      updated_by = actor
  where policy.id = p_average_policy_id and policy.organisation_id = p_organisation_id
  returning jsonb_build_object('id',policy.id,'archived_at',policy.archived_at) into result;
  if result is null then raise exception 'Average Policy not found in this Organisation.' using errcode = '22023'; end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_competition_average_settings(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_average_context_id bigint, p_average_policy_version_id bigint, p_contributes_to_history boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and season.id = p_league_season_id
    and season.organisation_id = p_organisation_id for update of competition;
  if not found then raise exception 'Competition not found in this Organisation and Season.' using errcode = '22023'; end if;
  if p_contributes_to_history is null then
    raise exception 'Choose whether this Competition contributes to Average history.' using errcode = '22023';
  end if;
  insert into public.competition_average_settings(
    competition_id,average_context_id,average_policy_version_id,
    contributes_to_history,created_by,updated_by
  ) values (
    p_competition_id,p_average_context_id,p_average_policy_version_id,
    p_contributes_to_history,actor,actor
  )
  on conflict (competition_id) do update
  set average_context_id = excluded.average_context_id,
      average_policy_version_id = excluded.average_policy_version_id,
      contributes_to_history = excluded.contributes_to_history,
      updated_by = actor;
  return jsonb_build_object('competition_id',p_competition_id,
    'average_context_id',p_average_context_id,
    'average_policy_version_id',p_average_policy_version_id,
    'contributes_to_history',p_contributes_to_history);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_competition_series_average_defaults(p_organisation_id bigint, p_competition_series_id bigint, p_average_context_id bigint, p_average_policy_version_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform series.id from public.competition_series series
  where series.id = p_competition_series_id and series.organisation_id = p_organisation_id
  for update;
  if not found then raise exception 'Series not found in this Organisation.' using errcode = '22023'; end if;
  if (p_average_context_id is null) <> (p_average_policy_version_id is null) then
    raise exception 'Average Context and Average Policy version defaults must be set or cleared together.' using errcode = '22023';
  end if;
  if p_average_context_id is null then
    delete from public.competition_series_average_defaults defaults
    where defaults.competition_series_id = p_competition_series_id;
    return jsonb_build_object('competition_series_id',p_competition_series_id,
      'average_context_id',null,'average_policy_version_id',null);
  end if;
  insert into public.competition_series_average_defaults(
    competition_series_id,average_context_id,average_policy_version_id,created_by,updated_by
  ) values (
    p_competition_series_id,p_average_context_id,p_average_policy_version_id,actor,actor
  )
  on conflict (competition_series_id) do update
  set average_context_id = excluded.average_context_id,
      average_policy_version_id = excluded.average_policy_version_id,
      updated_by = actor;
  return jsonb_build_object('competition_series_id',p_competition_series_id,
    'average_context_id',p_average_context_id,
    'average_policy_version_id',p_average_policy_version_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_manual_competition_starting_average(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_entrant_participant_id bigint, p_starting_average numeric, p_manual_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid;
  setting public.competition_average_settings%rowtype;
  shooter_id uuid;
  basis_maximum numeric;
  decision record;
  snapshot public.competition_participant_starting_averages%rowtype;
  snapshot_origin text;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and competition.status = 'published'
    and season.id = p_league_season_id and season.organisation_id = p_organisation_id
  for update of competition;
  if not found then
    raise exception 'Published Competition not found in this Organisation and Season.' using errcode = '22023';
  end if;
  select * into setting from public.competition_average_settings average_setting
  where average_setting.competition_id = p_competition_id for share;
  if not found then
    raise exception 'Competition does not have authoritative Average settings.' using errcode = '22023';
  end if;
  select context.basis_maximum into basis_maximum
  from public.average_contexts context where context.id = setting.average_context_id;
  select membership.user_id into shooter_id
  from public.competition_entrant_participants participant
  join public.club_competition_entries entry on entry.id = participant.club_competition_entry_id
  join public.club_memberships membership on membership.id = participant.club_membership_id
  where participant.id = p_competition_entrant_participant_id
    and entry.competition_id = p_competition_id and entry.status = 'submitted';
  if shooter_id is null then
    raise exception 'Submitted Competition participant was not found.' using errcode = '22023';
  end if;
  if p_starting_average is not null and (p_starting_average < 0
    or p_starting_average > basis_maximum or p_starting_average <> round(p_starting_average,6)) then
    raise exception 'Manual Starting Average must be blank or a number from zero through the Context basis maximum, with at most six decimal places.'
      using errcode = '22023';
  end if;
  select * into decision from private.resolve_competition_starting_average(p_competition_id,shooter_id);
  if decision.policy_branch <> 'manual' then
    raise exception 'The active Average Policy can calculate this participant; manual input is not currently allowed.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.competition_participant_starting_averages existing
    where existing.competition_entrant_participant_id = p_competition_entrant_participant_id
      and existing.status = 'frozen'
  ) then
    raise exception 'Frozen Starting Averages cannot be changed through the provisional lifecycle.' using errcode = '22023';
  end if;
  snapshot_origin := case when p_starting_average is null then 'no_history' else 'manual' end;
  insert into public.competition_participant_starting_averages(
    competition_id,competition_entrant_participant_id,shooter_profile_id,
    starting_average,average_context_id,average_policy_version_id,
    origin,status,calculated_at,frozen_at,source_competition_id,
    qualifying_score_count,manual_reason,created_by,updated_by
  ) values (
    p_competition_id,p_competition_entrant_participant_id,shooter_id,
    p_starting_average,setting.average_context_id,setting.average_policy_version_id,
    snapshot_origin,'provisional',clock_timestamp(),null,null,0,
    case when p_starting_average is null then null else nullif(btrim(p_manual_reason),'') end,
    actor,actor
  )
  on conflict (competition_entrant_participant_id) do update
  set shooter_profile_id = excluded.shooter_profile_id,
      starting_average = excluded.starting_average,
      average_context_id = excluded.average_context_id,
      average_policy_version_id = excluded.average_policy_version_id,
      origin = excluded.origin,status = 'provisional',calculated_at = excluded.calculated_at,
      frozen_at = null,source_competition_id = null,qualifying_score_count = 0,
      manual_reason = excluded.manual_reason,updated_by = actor
  returning * into snapshot;
  delete from public.starting_average_score_sources provenance
  where provenance.starting_average_id = snapshot.id;
  return jsonb_build_object('id',snapshot.id,'competition_id',snapshot.competition_id,
    'competition_entrant_participant_id',snapshot.competition_entrant_participant_id,
    'shooter_profile_id',snapshot.shooter_profile_id,'starting_average',snapshot.starting_average,
    'origin',snapshot.origin,'status',snapshot.status,'manual_reason',snapshot.manual_reason);
end;
$function$;


commit;

