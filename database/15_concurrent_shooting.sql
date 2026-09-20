-- Canonical fresh-install schema: concurrent shooting.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."concurrent_shooting_group_competitions" (
  "concurrent_shooting_group_id" bigint not null,
  "competition_id" bigint not null,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."concurrent_shooting_groups" (
  "id" bigint generated always as identity not null,
  "organisation_id" bigint not null,
  "league_season_id" bigint not null,
  "name" text not null,
  "status" text default 'draft'::text not null,
  "compatibility_version" integer,
  "compatibility_signature" jsonb,
  "activated_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."concurrent_shooting_round_mappings" (
  "concurrent_shooting_group_id" bigint not null,
  "concurrent_shooting_round_id" bigint not null,
  "competition_id" bigint not null,
  "competition_round_id" bigint not null,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."concurrent_shooting_rounds" (
  "id" bigint generated always as identity not null,
  "concurrent_shooting_group_id" bigint not null,
  "position" integer not null,
  "label" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."shooting_score_change_events" (
  "id" bigint generated always as identity not null,
  "shooting_score_source_id" bigint not null,
  "actor_id" uuid,
  "origin_competition_id" bigint,
  "origin_competition_round_id" bigint,
  "operation" text not null,
  "before_state" jsonb,
  "after_state" jsonb,
  "reason" text,
  "created_at" timestamp with time zone default now() not null
);

CREATE OR REPLACE FUNCTION private.concurrent_shooting_compatibility_mismatches(p_reference jsonb, p_candidate jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(item.field order by item.ordinal), '[]'::jsonb)
  from (values
    (1, 'physical_details',
      not coalesce((p_reference ->> 'physical_details_configured')::boolean, false)
      or not coalesce((p_candidate ->> 'physical_details_configured')::boolean, false)),
    (2, 'equipment', (p_reference -> 'equipment') is distinct from (p_candidate -> 'equipment')),
    (3, 'sets_per_round', (p_reference -> 'sets_per_round') is distinct from (p_candidate -> 'sets_per_round')),
    (4, 'component_count', (p_reference -> 'component_count') is distinct from (p_candidate -> 'component_count')),
    (5, 'components', (p_reference -> 'components') is distinct from (p_candidate -> 'components')),
    (6, 'component_positions', (p_reference -> 'component_positions') is distinct from (p_candidate -> 'component_positions')),
    (7, 'component_distances', (p_reference -> 'component_distances') is distinct from (p_candidate -> 'component_distances')),
    (8, 'component_shots', (p_reference -> 'component_shots') is distinct from (p_candidate -> 'component_shots')),
    (9, 'uses_x_score', (p_reference -> 'uses_x_score') is distinct from (p_candidate -> 'uses_x_score')),
    (10, 'shots_per_round', (p_reference -> 'shots_per_round') is distinct from (p_candidate -> 'shots_per_round')),
    (11, 'shooter_maximum', (p_reference -> 'shooter_maximum') is distinct from (p_candidate -> 'shooter_maximum'))
  ) item(ordinal, field, mismatched)
  where item.mismatched
$function$;

CREATE OR REPLACE FUNCTION private.concurrent_shooting_compatibility_signature(p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'version', 2,
    'physical_details_configured', private.competition_has_complete_shooting_details(competition.id),
    'equipment', jsonb_build_object(
      'equipment_type_code', competition.equipment_type_code,
      'organisation_equipment_type_id', competition.organisation_equipment_type_id
    ),
    'sets_per_round', competition.sets_per_round,
    'shots_per_round', to_jsonb(competition.shots_per_round),
    'uses_x_score', competition.uses_x_score,
    'component_count', count(component.id),
    'components', coalesce(jsonb_agg(jsonb_build_object(
      'position', component.position,
      'label', to_jsonb(component.short_label),
      'maximum_score', component.maximum_score,
      'score_method', component.score_method
    ) order by component.position) filter (where component.id is not null), '[]'::jsonb),
    'component_positions', coalesce(jsonb_agg(jsonb_build_object(
      'position', component.position,
      'mode', component.shooting_position_mode,
      'shooting_position_code', component.shooting_position_code,
      'organisation_shooting_position_id', component.organisation_shooting_position_id
    ) order by component.position) filter (where component.id is not null), '[]'::jsonb),
    'component_distances', coalesce(jsonb_agg(jsonb_build_object(
      'position', component.position,
      'mode', component.distance_mode,
      'value', component.distance_value,
      'unit', component.distance_unit
    ) order by component.position) filter (where component.id is not null), '[]'::jsonb),
    'component_shots', coalesce(jsonb_agg(jsonb_build_object(
      'position', component.position,
      'shots', component.shots
    ) order by component.position) filter (where component.id is not null), '[]'::jsonb),
    'shooter_maximum', competition.sets_per_round * coalesce(sum(component.maximum_score), 0)
  )
  from public.competitions competition
  left join public.competition_score_components component
    on component.competition_id = competition.id
  where competition.id = p_competition_id
  group by competition.id, competition.sets_per_round, competition.shots_per_round,
    competition.uses_x_score, competition.equipment_type_code,
    competition.organisation_equipment_type_id
$function$;

CREATE OR REPLACE FUNCTION private.concurrent_shooting_participant_metadata(p_concurrent_shooting_round_id bigint, p_shooter_profile_id uuid, p_access_scope text, p_scoped_club_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_source record;
  v_mapping record;
  v_match_count integer;
  v_match_club_id bigint;
  v_match_participant_id bigint;
  v_cutoff date;
  v_started boolean;
  v_target_editable boolean;
  v_can_edit boolean := true;
  v_status text;
  v_links jsonb := '[]'::jsonb;
begin
  select source.id, source.version, source.updated_at
  into v_source
  from public.shooting_score_sources as source
  where source.concurrent_shooting_round_id = p_concurrent_shooting_round_id
    and source.shooter_profile_id = p_shooter_profile_id;

  for v_mapping in
    select mapping.competition_id, competition.name as competition_name,
      mapping.competition_round_id, round_row.round_number,
      competition.local_scoring_enabled, competition.status as competition_status,
      season.status as season_status, round_row.deadline, round_row.shoot_by_date,
      effective.effective_starts_at
    from public.concurrent_shooting_round_mappings as mapping
    join public.competitions as competition on competition.id = mapping.competition_id
    join public.league_seasons as season on season.id = competition.league_season_id
    join public.competition_rounds as round_row on round_row.id = mapping.competition_round_id
    cross join lateral private.get_competition_effective_dates(competition.id) as effective
    where mapping.concurrent_shooting_round_id = p_concurrent_shooting_round_id
    order by mapping.competition_id
  loop
    select count(*)::integer, min(participant.id), min(entry.club_id)
    into v_match_count, v_match_participant_id, v_match_club_id
    from public.club_competition_entries as entry
    join public.competition_entrants as entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants as participant
      on participant.club_competition_entry_id = entry.id
      and participant.competition_entrant_id = entrant.id
    join public.club_memberships as membership on membership.id = participant.club_membership_id
    where entry.competition_id = v_mapping.competition_id
      and entry.status = 'submitted'
      and membership.user_id = p_shooter_profile_id;

    v_cutoff := coalesce(v_mapping.shoot_by_date, v_mapping.deadline);
    v_started := v_mapping.effective_starts_at is not null
      and current_date >= v_mapping.effective_starts_at;
    v_status := case
      when v_match_count = 0 then 'missing'
      when v_match_count > 1 then 'ambiguous'
      when p_access_scope = 'club' and v_match_club_id <> p_scoped_club_id then 'outside_club_scope'
      when exists (
        select 1 from public.competition_score_usages as usage
        where usage.competition_id = v_mapping.competition_id
          and usage.competition_round_id = v_mapping.competition_round_id
          and usage.competition_entrant_participant_id = v_match_participant_id
          and (
            v_source.id is null
            or usage.shooting_score_source_id <> v_source.id
          )
      ) then 'source_conflict'
      else 'matched'
    end;
    v_target_editable := case
      when v_match_count = 0 then true
      when v_match_count > 1 then false
      when v_mapping.competition_status <> 'published'
        or v_mapping.season_status not in ('open', 'active', 'completed')
        or not v_started then false
      when p_access_scope = 'organisation' then exists (
        select 1 from public.organisation_staff as staff
        join public.league_seasons as season on season.organisation_id = staff.organisation_id
        where staff.user_id = (select auth.uid())
          and staff.status = 'active' and staff.role in ('owner', 'manager')
          and season.id = (
            select competition.league_season_id from public.competitions as competition
            where competition.id = v_mapping.competition_id
          )
      )
      else v_match_club_id = p_scoped_club_id
        and v_mapping.local_scoring_enabled
        and current_date <= v_cutoff
        and exists (
          select 1 from public.club_memberships as actor_membership
          where actor_membership.club_id = p_scoped_club_id
            and actor_membership.user_id = (select auth.uid())
            and actor_membership.status = 'active'
            and actor_membership.role in ('owner', 'official')
        )
    end;
    if v_status in ('ambiguous', 'outside_club_scope', 'source_conflict')
      or not v_target_editable then
      v_can_edit := false;
    end if;
    v_links := v_links || jsonb_build_array(jsonb_build_object(
      'competition_id', v_mapping.competition_id,
      'competition_name', v_mapping.competition_name,
      'competition_round_id', v_mapping.competition_round_id,
      'round_number', v_mapping.round_number,
      'participant_match', v_status,
      'can_edit', v_target_editable and v_status in ('matched', 'missing')
    ));
  end loop;

  return jsonb_build_object(
    'shared', true,
    'source_version', v_source.version,
    'source_updated_at', v_source.updated_at,
    'can_edit_shared', v_can_edit,
    'linked_competitions', v_links
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.get_individual_competition_score_entry_base(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
  v_result jsonb;
  v_concurrent record;
begin
  select * into v_context
  from private.require_individual_score_entry_context(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_competition_round_id, p_club_id
  );

  select group_row.id as group_id, group_row.name as group_name,
    physical_round.id as physical_round_id, physical_round.label as physical_round_label
  into v_concurrent
  from public.concurrent_shooting_round_mappings as mapping
  join public.concurrent_shooting_rounds as physical_round
    on physical_round.id = mapping.concurrent_shooting_round_id
  join public.concurrent_shooting_groups as group_row
    on group_row.id = physical_round.concurrent_shooting_group_id
  where mapping.competition_id = p_competition_id
    and mapping.competition_round_id = p_competition_round_id
    and group_row.organisation_id = p_organisation_id
    and group_row.league_season_id = p_league_season_id
    and group_row.status = 'active';

  select jsonb_build_object(
    'access_scope', v_context.access_scope,
    'database_today', current_date,
    'can_edit', v_context.can_edit,
    'concurrent_shooting', case when v_concurrent.physical_round_id is null
      then jsonb_build_object('shared', false)
      else jsonb_build_object(
        'shared', true,
        'group_id', v_concurrent.group_id,
        'group_name', v_concurrent.group_name,
        'physical_round_id', v_concurrent.physical_round_id,
        'physical_round_label', v_concurrent.physical_round_label,
        'linked_competitions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'competition_id', linked.competition_id,
            'competition_name', linked_competition.name,
            'competition_round_id', linked.competition_round_id,
            'round_number', linked_round.round_number
          ) order by linked.competition_id)
          from public.concurrent_shooting_round_mappings as linked
          join public.competitions as linked_competition
            on linked_competition.id = linked.competition_id
          join public.competition_rounds as linked_round
            on linked_round.id = linked.competition_round_id
          where linked.concurrent_shooting_round_id = v_concurrent.physical_round_id
        ), '[]'::jsonb)
      )
    end,
    'competition', jsonb_build_object(
      'id', competition.id,
      'name', competition.name,
      'entry_format', competition.entry_format,
      'uses_x_score', competition.uses_x_score,
      'sets_per_round', competition.sets_per_round,
      'shots_per_round', competition.shots_per_round,
      'local_scoring_enabled', competition.local_scoring_enabled,
      'effective_starts_at', v_context.effective_starts_at,
      'started', v_context.competition_started
    ),
    'round', jsonb_build_object(
      'id', round_row.id,
      'round_number', round_row.round_number,
      'deadline', round_row.deadline,
      'shoot_by_date', round_row.shoot_by_date,
      'local_cutoff', v_context.local_cutoff,
      'local_cutoff_passed', v_context.local_cutoff_passed
    ),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', component.position,
        'short_label', component.short_label,
        'maximum_score', component.maximum_score,
        'score_method', component.score_method
      ) order by component.position)
      from public.competition_score_components as component
      where component.competition_id = competition.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id', participant.id,
        'entrant_id', entrant.id,
        'entrant_position', entrant.position,
        'club_id', club.id,
        'club_name', club.name,
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'source_version', source.version,
        'source_updated_at', source.updated_at,
        'shared', v_concurrent.physical_round_id is not null,
        'shared_metadata', case when v_concurrent.physical_round_id is null
          then jsonb_build_object(
            'shared', false,
            'source_version', source.version,
            'source_updated_at', source.updated_at,
            'can_edit_shared', v_context.can_edit,
            'linked_competitions', '[]'::jsonb
          )
          else private.concurrent_shooting_participant_metadata(
            v_concurrent.physical_round_id, membership.user_id,
            v_context.access_scope, p_club_id
          )
        end,
        'values', coalesce((
          select jsonb_agg(jsonb_build_object(
            'set_number', set_slot.set_number,
            'component_position', component.position,
            'entered_score', case
              when value.id is null then null
              when component.score_method = 'points_dropped'
                then component.maximum_score - value.achieved_score
              else value.achieved_score
            end,
            'x_count', case when competition.uses_x_score then value.x_count else null end
          ) order by set_slot.set_number, component.position)
          from generate_series(1, competition.sets_per_round) as set_slot(set_number)
          cross join public.competition_score_components as component
          left join public.shooting_score_values as value
            on value.shooting_score_source_id = usage.shooting_score_source_id
            and value.set_number = set_slot.set_number
            and value.component_position = component.position
          where component.competition_id = competition.id
        ), '[]'::jsonb)
      ) order by club.name, entry.id, entrant.position, participant.id)
      from public.club_competition_entries as entry
      join public.clubs as club on club.id = entry.club_id
      join public.competition_entrants as entrant
        on entrant.club_competition_entry_id = entry.id
      join public.competition_entrant_participants as participant
        on participant.competition_entrant_id = entrant.id
        and participant.club_competition_entry_id = entry.id
      join public.club_memberships as membership
        on membership.id = participant.club_membership_id
      join public.profiles as profile on profile.id = membership.user_id
      left join public.competition_score_usages as usage
        on usage.competition_id = competition.id
        and usage.competition_round_id = round_row.id
        and usage.competition_entrant_participant_id = participant.id
      left join public.shooting_score_sources as source
        on source.id = usage.shooting_score_source_id
      where entry.competition_id = competition.id
        and entry.status = 'submitted'
        and (p_club_id is null or entry.club_id = p_club_id)
    ), '[]'::jsonb)
  ) into v_result
  from public.competitions as competition
  join public.competition_rounds as round_row
    on round_row.competition_id = competition.id
  where competition.id = p_competition_id
    and round_row.id = p_competition_round_id;

  if v_result is null then
    raise exception 'Competition score-entry context was not found.' using errcode = 'P0002';
  end if;
  if v_concurrent.physical_round_id is not null and exists (
    select 1
    from public.club_competition_entries as entry
    join public.competition_entrant_participants as participant
      on participant.club_competition_entry_id = entry.id
    join public.club_memberships as membership on membership.id = participant.club_membership_id
    where entry.competition_id = p_competition_id
      and entry.status = 'submitted'
      and (p_club_id is null or entry.club_id = p_club_id)
      and not coalesce((private.concurrent_shooting_participant_metadata(
        v_concurrent.physical_round_id, membership.user_id,
        v_context.access_scope, p_club_id
      ) ->> 'can_edit_shared')::boolean, false)
  ) then
    v_result := jsonb_set(v_result, '{can_edit}', 'false'::jsonb);
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.prevent_shooting_score_change_event_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'Shooting score change events are immutable.' using errcode = '22023';
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_active_concurrent_competition_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_competition_id bigint;
begin
  if tg_table_name = 'competitions' then
    target_competition_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_competition_id := case when tg_op = 'DELETE'
      then old.competition_id else new.competition_id end;
  end if;
  if exists (
    select 1
    from public.concurrent_shooting_group_competitions member
    join public.concurrent_shooting_groups group_record
      on group_record.id = member.concurrent_shooting_group_id
    where member.competition_id = target_competition_id
      and group_record.status in ('active', 'archived')
  ) then
    if tg_table_name = 'competitions' then
      if (
        new.sets_per_round, new.shots_per_round, new.uses_x_score,
        new.shooting_details_version, new.equipment_type_code,
        new.organisation_equipment_type_id
      ) is distinct from (
        old.sets_per_round, old.shots_per_round, old.uses_x_score,
        old.shooting_details_version, old.equipment_type_code,
        old.organisation_equipment_type_id
      ) then
        raise exception 'Active or Archived Concurrent Shooting physical configuration is immutable.'
          using errcode = '22023';
      end if;
    else
      raise exception 'Active or Archived Concurrent Shooting score components are immutable.'
        using errcode = '22023';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_archived_concurrent_score_value()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source_id bigint := case when tg_op = 'DELETE'
    then old.shooting_score_source_id else new.shooting_score_source_id end;
begin
  if exists (
    select 1
    from public.shooting_score_sources as source
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = source.concurrent_shooting_round_id
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where source.id = source_id
      and group_row.status = 'archived'
  ) then
    raise exception 'Archived Concurrent score provenance is read-only.'
      using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_concurrent_score_usage_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source_concurrent_round_id bigint;
  mapped_concurrent_round_id bigint;
  mapped_group_status text;
begin
  if tg_op = 'DELETE' then
    select source.concurrent_shooting_round_id
    into source_concurrent_round_id
    from public.shooting_score_sources as source
    where source.id = old.shooting_score_source_id;

    if source_concurrent_round_id is not null then
      raise exception 'Concurrent score usage provenance is immutable and cannot be unlinked.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (
    new.shooting_score_source_id,
    new.competition_id,
    new.competition_round_id,
    new.competition_entrant_participant_id,
    new.created_by,
    new.created_at
  ) is not distinct from (
    old.shooting_score_source_id,
    old.competition_id,
    old.competition_round_id,
    old.competition_entrant_participant_id,
    old.created_by,
    old.created_at
  ) then
    return new;
  end if;

  select source.concurrent_shooting_round_id
  into source_concurrent_round_id
  from public.shooting_score_sources as source
  where source.id = new.shooting_score_source_id;

  if tg_op = 'UPDATE' and exists (
    select 1
    from public.shooting_score_sources as source
    where source.id in (old.shooting_score_source_id, new.shooting_score_source_id)
      and source.concurrent_shooting_round_id is not null
  ) then
    raise exception 'Concurrent score usage provenance is immutable and cannot be reassigned.'
      using errcode = '22023';
  end if;

  select mapping.concurrent_shooting_round_id, group_row.status
  into mapped_concurrent_round_id, mapped_group_status
  from public.concurrent_shooting_round_mappings as mapping
  join public.concurrent_shooting_rounds as physical_round
    on physical_round.id = mapping.concurrent_shooting_round_id
  join public.concurrent_shooting_groups as group_row
    on group_row.id = physical_round.concurrent_shooting_group_id
  where mapping.competition_id = new.competition_id
    and mapping.competition_round_id = new.competition_round_id
    and group_row.status in ('active', 'archived');

  if mapped_group_status = 'archived' then
    raise exception 'Archived Concurrent score provenance is read-only.'
      using errcode = '22023';
  end if;
  if mapped_group_status = 'active'
    and source_concurrent_round_id is distinct from mapped_concurrent_round_id then
    raise exception 'A mapped Concurrent Competition Round must use its physical Concurrent score source.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_concurrent_shooting_draft_child()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_group_id bigint;
  v_new_group_id bigint;
begin
  v_old_group_id := case when tg_op = 'INSERT' then null else old.concurrent_shooting_group_id end;
  v_new_group_id := case when tg_op = 'DELETE' then null else new.concurrent_shooting_group_id end;
  if v_old_group_id is not null and exists (
    select 1 from public.concurrent_shooting_groups
    where id = v_old_group_id and status <> 'draft'
  ) then
    raise exception 'Active or Archived Concurrent Shooting configuration is immutable.'
      using errcode = '22023';
  end if;
  if v_new_group_id is not null and exists (
    select 1 from public.concurrent_shooting_groups
    where id = v_new_group_id and status <> 'draft'
  ) then
    raise exception 'Concurrent Shooting membership and mappings may be changed only in Draft.'
      using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_concurrent_shooting_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a Draft Concurrent Shooting group can be deleted.' using errcode = '22023';
    end if;
    return old;
  end if;
  if old.status = 'archived' then
    raise exception 'Archived Concurrent Shooting groups are immutable.' using errcode = '22023';
  end if;
  if old.organisation_id is distinct from new.organisation_id
    or old.league_season_id is distinct from new.league_season_id then
    raise exception 'Concurrent Shooting Organisation and Season are immutable.' using errcode = '22023';
  end if;
  if old.status = 'active' and new.status in ('active', 'archived') and (
    old.compatibility_version is distinct from new.compatibility_version
    or old.compatibility_signature is distinct from new.compatibility_signature
    or old.activated_at is distinct from new.activated_at
    or old.name is distinct from new.name
  ) then
    raise exception 'Active Concurrent Shooting configuration is immutable.' using errcode = '22023';
  end if;
  if old.status = 'active' and new.status not in ('active', 'draft', 'archived') then
    raise exception 'Invalid Concurrent Shooting lifecycle transition.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_shooting_score_source_foundation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.concurrent_shooting_round_id is not null and not exists (
    select 1
    from public.concurrent_shooting_rounds as physical_round
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where physical_round.id = new.concurrent_shooting_round_id
      and group_row.status = 'active'
  ) then
    raise exception 'A score source may be associated only with an Active physical Concurrent Round.'
      using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.version < old.version then
    raise exception 'Shooting score source version cannot decrease.' using errcode = '22023';
  end if;
  if new.concurrent_shooting_round_id is distinct from old.concurrent_shooting_round_id
    and exists (
      select 1 from public.competition_score_usages as usage
      where usage.shooting_score_source_id = old.id
    ) then
    raise exception 'A used score source cannot be relinked to a physical Concurrent Round.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_used_score_source_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.concurrent_shooting_round_id is not null then
      raise exception 'A physical Concurrent score source cannot be deleted.'
        using errcode = '22023';
    end if;
    return old;
  end if;

  if old.concurrent_shooting_round_id is not null and exists (
    select 1
    from public.concurrent_shooting_rounds as physical_round
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where physical_round.id = old.concurrent_shooting_round_id
      and group_row.status = 'archived'
  ) then
    raise exception 'Archived Concurrent score provenance is read-only.'
      using errcode = '22023';
  end if;

  if (new.shooter_profile_id, new.concurrent_shooting_round_id)
    is distinct from (old.shooter_profile_id, old.concurrent_shooting_round_id)
    and (old.concurrent_shooting_round_id is not null
      or new.concurrent_shooting_round_id is not null) then
    raise exception 'A physical Concurrent score source cannot be reassigned to another shooter or physical Concurrent Round.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.reconcile_concurrent_shooting_entry(p_club_competition_entry_id bigint, p_actor_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entry record;
  v_physical_round_id bigint;
  v_candidate record;
  v_source_id bigint;
  v_match_count integer;
  v_existing_source_id bigint;
  v_attached_count integer := 0;
begin
  select entry.competition_id, entry.status, season.organisation_id,
    competition.league_season_id
  into v_entry
  from public.club_competition_entries as entry
  join public.competitions as competition on competition.id = entry.competition_id
  join public.league_seasons as season on season.id = competition.league_season_id
  where entry.id = p_club_competition_entry_id
  for update of entry;
  if not found or v_entry.status <> 'submitted' then
    raise exception 'A submitted Competition entry is required for Concurrent reconciliation.'
      using errcode = '22023';
  end if;

  -- Acquire every involved physical lock in ascending order before touching
  -- sources/usages, preventing opposite Round orders from deadlocking.
  for v_physical_round_id in
    select distinct mapping.concurrent_shooting_round_id
    from public.concurrent_shooting_round_mappings as mapping
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = mapping.concurrent_shooting_round_id
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where mapping.competition_id = v_entry.competition_id
      and group_row.status = 'active'
    order by mapping.concurrent_shooting_round_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'concurrent-score:' || v_physical_round_id::text, 0
    ));
  end loop;

  for v_candidate in
    select participant.id as participant_id, membership.user_id as shooter_profile_id,
      mapping.concurrent_shooting_round_id, mapping.competition_round_id
    from public.competition_entrant_participants as participant
    join public.club_memberships as membership on membership.id = participant.club_membership_id
    join public.concurrent_shooting_round_mappings as mapping
      on mapping.competition_id = v_entry.competition_id
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = mapping.concurrent_shooting_round_id
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
      and group_row.status = 'active'
    where participant.club_competition_entry_id = p_club_competition_entry_id
    order by mapping.concurrent_shooting_round_id, participant.id
  loop
    select count(*)::integer into v_match_count
    from public.club_competition_entries as entry
    join public.competition_entrant_participants as participant
      on participant.club_competition_entry_id = entry.id
    join public.club_memberships as membership on membership.id = participant.club_membership_id
    where entry.competition_id = v_entry.competition_id
      and entry.status = 'submitted'
      and membership.user_id = v_candidate.shooter_profile_id;
    if v_match_count > 1 then
      raise exception 'Concurrent reconciliation is ambiguous because a shooter appears more than once in this Competition.'
        using errcode = '22023';
    end if;

    select source.id into v_source_id
    from public.shooting_score_sources as source
    where source.concurrent_shooting_round_id = v_candidate.concurrent_shooting_round_id
      and source.shooter_profile_id = v_candidate.shooter_profile_id
    for update of source;
    if v_source_id is null then
      continue;
    end if;

    select usage.shooting_score_source_id into v_existing_source_id
    from public.competition_score_usages as usage
    where usage.competition_id = v_entry.competition_id
      and usage.competition_round_id = v_candidate.competition_round_id
      and usage.competition_entrant_participant_id = v_candidate.participant_id
    for update of usage;
    if v_existing_source_id is not null and v_existing_source_id <> v_source_id then
      raise exception 'Concurrent reconciliation found a target slot linked to a different source.'
        using errcode = '23505';
    end if;
    if v_existing_source_id is null then
      if exists (
        select 1 from public.competition_score_usages as usage
        where usage.shooting_score_source_id = v_source_id
          and usage.competition_id = v_entry.competition_id
      ) then
        raise exception 'Concurrent reconciliation found conflicting source provenance in this Competition.'
          using errcode = '23505';
      end if;
      insert into public.competition_score_usages (
        shooting_score_source_id, competition_id, competition_round_id,
        competition_entrant_participant_id, created_by, updated_by
      ) values (
        v_source_id, v_entry.competition_id, v_candidate.competition_round_id,
        v_candidate.participant_id, p_actor_id, p_actor_id
      );
      v_attached_count := v_attached_count + 1;
    end if;
  end loop;
  return v_attached_count;
end;
$function$;

CREATE OR REPLACE FUNCTION private.reconcile_concurrent_shooting_entry_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'submitted'
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.reconcile_concurrent_shooting_entry(new.id, (select auth.uid()));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.require_concurrent_member_physical_details()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.competition_has_complete_shooting_details(new.competition_id) then
    raise exception 'Physical shooting details required before this Competition is eligible for Concurrent Shooting.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.require_concurrent_shooting_group(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_owner_only boolean DEFAULT false, p_required_status text DEFAULT NULL::text)
 RETURNS concurrent_shooting_groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group public.concurrent_shooting_groups%rowtype;
begin
  perform private.require_competition_author(p_organisation_id, p_owner_only);
  select * into v_group
  from public.concurrent_shooting_groups as group_row
  where group_row.id = p_concurrent_shooting_group_id
    and group_row.organisation_id = p_organisation_id
  for update;
  if not found then
    raise exception 'Concurrent Shooting group not found in this Organisation.'
      using errcode = 'P0002';
  end if;
  if p_required_status is not null and v_group.status <> p_required_status then
    raise exception 'Concurrent Shooting group must be %.', p_required_status
      using errcode = '22023';
  end if;
  return v_group;
end;
$function$;

CREATE OR REPLACE FUNCTION private.require_concurrent_shooting_targets(p_organisation_id bigint, p_league_season_id bigint, p_concurrent_shooting_round_id bigint, p_shooter_profile_id uuid, p_shooting_score_source_id bigint, p_access_scope text, p_scoped_club_id bigint)
 RETURNS TABLE(competition_id bigint, competition_round_id bigint, competition_entrant_participant_id bigint, club_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mapping record;
  v_match_count integer;
  v_participant_id bigint;
  v_club_id bigint;
  v_context record;
  v_slot_source_id bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_access_scope not in ('organisation', 'club')
    or (p_access_scope = 'organisation' and p_scoped_club_id is not null)
    or (p_access_scope = 'club' and p_scoped_club_id is null) then
    raise exception 'Invalid shared score-entry scope.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.concurrent_shooting_rounds as physical_round
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where physical_round.id = p_concurrent_shooting_round_id
      and group_row.organisation_id = p_organisation_id
      and group_row.league_season_id = p_league_season_id
      and group_row.status = 'active'
  ) then
    raise exception 'Active Concurrent Shooting Round was not found.' using errcode = 'P0002';
  end if;

  for v_mapping in
    select mapping.competition_id, mapping.competition_round_id,
      competition.name as competition_name
    from public.concurrent_shooting_round_mappings as mapping
    join public.competitions as competition on competition.id = mapping.competition_id
    where mapping.concurrent_shooting_round_id = p_concurrent_shooting_round_id
    order by mapping.competition_id, mapping.competition_round_id
  loop
    select count(*)::integer, min(participant.id), min(entry.club_id)
    into v_match_count, v_participant_id, v_club_id
    from public.club_competition_entries as entry
    join public.competition_entrants as entrant
      on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants as participant
      on participant.club_competition_entry_id = entry.id
      and participant.competition_entrant_id = entrant.id
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
    where entry.competition_id = v_mapping.competition_id
      and entry.status = 'submitted'
      and membership.user_id = p_shooter_profile_id;

    if v_match_count > 1 then
      raise exception 'Shared score cannot be saved because shooter participation is ambiguous in linked Competition "%".',
        v_mapping.competition_name using errcode = '22023';
    end if;
    if v_match_count = 0 then
      if p_shooting_score_source_id is not null and exists (
        select 1 from public.competition_score_usages as usage
        where usage.shooting_score_source_id = p_shooting_score_source_id
          and usage.competition_id = v_mapping.competition_id
          and usage.competition_round_id = v_mapping.competition_round_id
      ) then
        raise exception 'Shared score provenance conflicts with the current submitted participants in linked Competition "%".',
          v_mapping.competition_name using errcode = '23514';
      end if;
      continue;
    end if;

    select * into v_context
    from private.require_individual_score_entry_context(
      p_organisation_id,
      p_league_season_id,
      v_mapping.competition_id,
      v_mapping.competition_round_id,
      case when p_access_scope = 'club' then p_scoped_club_id else null end
    );

    if not v_context.competition_started then
      raise exception 'Shared score cannot be edited because linked Competition "%" has not started.',
        v_mapping.competition_name using errcode = '22023';
    end if;
    if p_access_scope = 'club' and v_club_id <> p_scoped_club_id then
      raise exception 'Shared score requires Organisation scoring because a linked participant is outside this club scope.'
        using errcode = '42501';
    end if;
    if p_access_scope = 'club' and not v_context.can_edit then
      raise exception 'Shared score requires Organisation scoring because a linked Competition is outside local scoring authority or cutoff.'
        using errcode = '42501';
    end if;

    select usage.shooting_score_source_id into v_slot_source_id
    from public.competition_score_usages as usage
    where usage.competition_id = v_mapping.competition_id
      and usage.competition_round_id = v_mapping.competition_round_id
      and usage.competition_entrant_participant_id = v_participant_id
    for update of usage;

    if v_slot_source_id is not null and (
      p_shooting_score_source_id is null
      or v_slot_source_id <> p_shooting_score_source_id
    ) then
      raise exception 'A linked Competition participant/Round already points to a different score source.'
        using errcode = '23505';
    end if;
    if p_shooting_score_source_id is not null and exists (
      select 1 from public.competition_score_usages as usage
      where usage.shooting_score_source_id = p_shooting_score_source_id
        and usage.competition_id = v_mapping.competition_id
        and (
          usage.competition_round_id <> v_mapping.competition_round_id
          or usage.competition_entrant_participant_id <> v_participant_id
        )
    ) then
      raise exception 'Shared score source already has conflicting provenance in a linked Competition.'
        using errcode = '23505';
    end if;

    competition_id := v_mapping.competition_id;
    competition_round_id := v_mapping.competition_round_id;
    competition_entrant_participant_id := v_participant_id;
    club_id := v_club_id;
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.require_individual_score_entry_context(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(actor_id uuid, access_scope text, scoped_club_id bigint, competition_name text, uses_x_score boolean, sets_per_round integer, shots_per_round integer, effective_starts_at date, competition_started boolean, round_number integer, round_end date, shoot_by_date date, local_cutoff date, local_cutoff_passed boolean, can_edit boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_context record;
  v_access_scope text;
  v_local_authorised boolean := false;
  v_central_authorised boolean := false;
  v_started boolean;
  v_local_cutoff date;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select competition.name, competition.entry_format, competition.team_size,
    competition.local_scoring_enabled, competition.uses_x_score,
    competition.sets_per_round, competition.shots_per_round,
    competition.status as competition_status,
    season.status as season_status,
    effective.effective_starts_at,
    round.round_number, round.deadline, round.shoot_by_date
  into v_context
  from public.organisations as organisation
  join public.league_seasons as season
    on season.organisation_id = organisation.id
  join public.competitions as competition
    on competition.league_season_id = season.id
  join public.competition_rounds as round
    on round.competition_id = competition.id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
    and season.id = p_league_season_id
    and competition.id = p_competition_id
    and round.id = p_competition_round_id;

  if not found
    or v_context.competition_status <> 'published'
    or v_context.season_status not in ('open', 'active', 'completed') then
    raise exception 'Published Competition score-entry context was not found.'
      using errcode = 'P0002';
  end if;

  if v_context.entry_format not in ('individual', 'pairs', 'team') then
    raise exception 'This Competition participant format does not support score entry.'
      using errcode = '22023';
  end if;

  if p_club_id is null then
    select exists (
      select 1
      from public.organisation_staff as staff
      where staff.organisation_id = p_organisation_id
        and staff.user_id = v_actor_id
        and staff.status = 'active'
        and staff.role in ('owner', 'manager')
    ) into v_central_authorised;
    v_access_scope := 'organisation';
  else
    select exists (
      select 1
      from public.club_memberships as actor_membership
      join public.clubs as club
        on club.id = actor_membership.club_id
      join public.club_competition_entries as entry
        on entry.club_id = club.id
      where actor_membership.user_id = v_actor_id
        and actor_membership.club_id = p_club_id
        and actor_membership.status = 'active'
        and actor_membership.role in ('owner', 'official')
        and club.status = 'active'
        and entry.competition_id = p_competition_id
        and entry.status = 'submitted'
    ) into v_local_authorised;
    v_access_scope := 'club';
  end if;

  if (p_club_id is null and not v_central_authorised)
    or (p_club_id is not null and not v_local_authorised) then
    raise exception 'You do not have permission to manage scores in this exact scope.'
      using errcode = '42501';
  end if;

  -- Submitted entry composition is normally guaranteed by the entry RPC.
  -- Recheck it here so malformed legacy/service-role data cannot be treated as
  -- a complete Individual, Pair, or Team by either the read or save endpoint.
  if exists (
    select 1
    from public.club_competition_entries as entry
    where entry.competition_id = p_competition_id
      and entry.status = 'submitted'
      and (p_club_id is null or entry.club_id = p_club_id)
      and (
        not exists (
          select 1
          from public.competition_entrants as entrant
          where entrant.club_competition_entry_id = entry.id
        )
        or exists (
          select 1
          from public.competition_entrants as entrant
          where entrant.club_competition_entry_id = entry.id
            and (
              select count(*)
              from public.competition_entrant_participants as participant
              where participant.club_competition_entry_id = entry.id
                and participant.competition_entrant_id = entrant.id
            ) <> v_context.team_size
        )
      )
  ) then
    raise exception 'A submitted Competition entrant has an incomplete participant composition.'
      using errcode = '22023';
  end if;

  v_started := v_context.effective_starts_at is not null
    and current_date >= v_context.effective_starts_at;
  v_local_cutoff := coalesce(v_context.shoot_by_date, v_context.deadline);

  return query select
    v_actor_id,
    v_access_scope,
    p_club_id,
    v_context.name::text,
    v_context.uses_x_score::boolean,
    v_context.sets_per_round::integer,
    v_context.shots_per_round::integer,
    v_context.effective_starts_at::date,
    v_started,
    v_context.round_number::integer,
    v_context.deadline::date,
    v_context.shoot_by_date::date,
    v_local_cutoff,
    current_date > v_local_cutoff,
    case
      when v_access_scope = 'organisation' then v_started
      else v_started
        and v_context.local_scoring_enabled
        and current_date <= v_local_cutoff
    end;
end;
$function$;

CREATE OR REPLACE FUNCTION private.save_individual_competition_round_scores_base(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint, p_scores jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
  v_shooter record;
  v_slot record;
  v_target record;
  v_participant_id bigint;
  v_shooter_profile_id uuid;
  v_values jsonb;
  v_source_id bigint;
  v_source_version bigint;
  v_expected_version bigint;
  v_source_concurrent_round_id bigint;
  v_entered_score numeric(10, 2);
  v_achieved_score numeric(10, 2);
  v_x_count integer;
  v_physical_round_id bigint;
  v_before_state jsonb;
  v_after_state jsonb;
  v_operation text;
  v_is_blank boolean;
  v_created_source boolean;
  v_recorded_participant_count integer := 0;
  v_recorded_value_count integer := 0;
  v_linked_usage_count integer := 0;
  v_source_usage_count integer;
  v_shared_clear_count integer := 0;
  v_source_versions jsonb := '{}'::jsonb;
begin
  select * into v_context
  from private.require_individual_score_entry_context(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_competition_round_id, p_club_id
  );
  if not v_context.competition_started then
    raise exception 'Scores cannot be entered before the effective Competition Start.' using errcode = '22023';
  end if;
  if v_context.access_scope = 'club' and not v_context.can_edit then
    if not (select competition.local_scoring_enabled from public.competitions as competition
      where competition.id = p_competition_id) then
      raise exception 'This Competition uses organisation score entry only.' using errcode = '22023';
    end if;
    raise exception 'The local score-entry cutoff for this Round has passed.' using errcode = '22023';
  end if;

  perform private.validate_competition_score_batch(
    p_competition_id, p_club_id, v_context.sets_per_round,
    v_context.uses_x_score, v_context.shots_per_round, p_scores
  );

  select mapping.concurrent_shooting_round_id into v_physical_round_id
  from public.concurrent_shooting_round_mappings as mapping
  join public.concurrent_shooting_rounds as physical_round
    on physical_round.id = mapping.concurrent_shooting_round_id
  join public.concurrent_shooting_groups as group_row
    on group_row.id = physical_round.concurrent_shooting_group_id
  where mapping.competition_id = p_competition_id
    and mapping.competition_round_id = p_competition_round_id
    and group_row.status = 'active'
    and group_row.organisation_id = p_organisation_id
    and group_row.league_season_id = p_league_season_id;

  if v_physical_round_id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'competition-score:' || p_competition_id::text || ':' || p_competition_round_id::text, 0
    ));
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'concurrent-score:' || v_physical_round_id::text, 0
    ));
    perform mapping.competition_id
    from public.concurrent_shooting_round_mappings as mapping
    where mapping.concurrent_shooting_round_id = v_physical_round_id
    order by mapping.competition_id, mapping.competition_round_id
    for share of mapping;
  end if;

  for v_shooter in select item.value from jsonb_array_elements(p_scores) as item(value)
  loop
    v_participant_id := (v_shooter.value ->> 'participant_id')::bigint;
    v_values := v_shooter.value -> 'values';
    select membership.user_id into v_shooter_profile_id
    from public.competition_entrant_participants as participant
    join public.club_memberships as membership on membership.id = participant.club_membership_id
    where participant.id = v_participant_id;
    v_is_blank := not exists (
      select 1 from jsonb_array_elements(v_values) as slot(value)
      where jsonb_typeof(slot.value -> 'entered_score') <> 'null'
    );

    if v_physical_round_id is not null then
      select source.id, source.version into v_source_id, v_source_version
      from public.shooting_score_sources as source
      where source.concurrent_shooting_round_id = v_physical_round_id
        and source.shooter_profile_id = v_shooter_profile_id
      for update of source;

      if v_source_id is not null then
        if not (v_shooter.value ? 'source_version')
          or jsonb_typeof(v_shooter.value -> 'source_version') <> 'number'
          or (v_shooter.value ->> 'source_version')::bigint <> v_source_version then
          raise exception 'Shared score changed since this editor was loaded. Refresh before saving again.'
            using errcode = '40001';
        end if;
        v_expected_version := (v_shooter.value ->> 'source_version')::bigint;
      elsif v_shooter.value ? 'source_version'
        and jsonb_typeof(v_shooter.value -> 'source_version') = 'number' then
        raise exception 'Shared score state changed since this editor was loaded. Refresh before saving again.'
          using errcode = '40001';
      else
        v_expected_version := null;
      end if;

      -- Fully enumerate validation first. Any missing participant is ignored;
      -- ambiguity, authority, lifecycle, cutoff, or provenance failure aborts
      -- before canonical values are changed.
      perform target.competition_id
      from private.require_concurrent_shooting_targets(
        p_organisation_id, p_league_season_id, v_physical_round_id,
        v_shooter_profile_id, v_source_id, v_context.access_scope, p_club_id
      ) as target;

      if v_is_blank and v_source_id is null then
        v_source_versions := jsonb_set(
          v_source_versions, array[v_participant_id::text], 'null'::jsonb, true
        );
        continue;
      end if;

      v_created_source := v_source_id is null;
      if v_created_source then
        begin
          insert into public.shooting_score_sources (
            shooter_profile_id, concurrent_shooting_round_id,
            version, created_by, updated_by
          ) values (
            v_shooter_profile_id, v_physical_round_id, 1,
            v_context.actor_id, v_context.actor_id
          ) returning id, version into v_source_id, v_source_version;
        exception when unique_violation then
          raise exception 'Shared score was created concurrently. Refresh before saving again.'
            using errcode = '40001';
        end;
      end if;

      for v_target in
        select * from private.require_concurrent_shooting_targets(
          p_organisation_id, p_league_season_id, v_physical_round_id,
          v_shooter_profile_id, v_source_id, v_context.access_scope, p_club_id
        ) order by competition_id, competition_round_id
      loop
        insert into public.competition_score_usages (
          shooting_score_source_id, competition_id, competition_round_id,
          competition_entrant_participant_id, created_by, updated_by
        ) values (
          v_source_id, v_target.competition_id, v_target.competition_round_id,
          v_target.competition_entrant_participant_id,
          v_context.actor_id, v_context.actor_id
        ) on conflict (
          competition_id, competition_round_id, competition_entrant_participant_id
        ) do update set updated_by = excluded.updated_by
        where competition_score_usages.shooting_score_source_id = excluded.shooting_score_source_id;
      end loop;
      select count(*)::integer into v_source_usage_count
      from public.competition_score_usages as usage
      where usage.shooting_score_source_id = v_source_id;
      v_linked_usage_count := v_linked_usage_count + v_source_usage_count;

      v_before_state := case when v_created_source then null
        else private.shooting_score_source_state(v_source_id) end;
      if v_is_blank then
        delete from public.shooting_score_values as value
        where value.shooting_score_source_id = v_source_id;
        update public.shooting_score_sources as source
        set version = source.version + 1, updated_by = v_context.actor_id
        where source.id = v_source_id and source.version = v_expected_version
        returning source.version into v_source_version;
        if not found then
          raise exception 'Shared score changed since this editor was loaded. Refresh before saving again.'
            using errcode = '40001';
        end if;
        v_operation := 'clear';
        v_shared_clear_count := v_shared_clear_count + 1;
      else
        for v_slot in
          select slot.value, component.maximum_score, component.score_method
          from jsonb_array_elements(v_values) as slot(value)
          join public.competition_score_components as component
            on component.competition_id = p_competition_id
            and component.position = (slot.value ->> 'component_position')::integer
        loop
          if jsonb_typeof(v_slot.value -> 'entered_score') = 'null' then
            delete from public.shooting_score_values
            where shooting_score_source_id = v_source_id
              and set_number = (v_slot.value ->> 'set_number')::integer
              and component_position = (v_slot.value ->> 'component_position')::integer;
            continue;
          end if;
          v_entered_score := (v_slot.value ->> 'entered_score')::numeric(10, 2);
          v_achieved_score := case v_slot.score_method
            when 'points_dropped' then v_slot.maximum_score - v_entered_score
            else v_entered_score end;
          v_x_count := case when jsonb_typeof(v_slot.value -> 'x_count') = 'null' then null
            else (v_slot.value ->> 'x_count')::integer end;
          insert into public.shooting_score_values (
            shooting_score_source_id, set_number, component_position,
            achieved_score, x_count, created_by, updated_by
          ) values (
            v_source_id, (v_slot.value ->> 'set_number')::integer,
            (v_slot.value ->> 'component_position')::integer,
            v_achieved_score, v_x_count, v_context.actor_id, v_context.actor_id
          ) on conflict (shooting_score_source_id, set_number, component_position)
          do update set achieved_score = excluded.achieved_score,
            x_count = excluded.x_count, updated_by = excluded.updated_by;
          v_recorded_value_count := v_recorded_value_count + 1;
        end loop;
        if v_created_source then
          v_source_version := 1;
          v_operation := 'create';
        else
          update public.shooting_score_sources as source
          set version = source.version + 1, updated_by = v_context.actor_id
          where source.id = v_source_id and source.version = v_expected_version
          returning source.version into v_source_version;
          if not found then
            raise exception 'Shared score changed since this editor was loaded. Refresh before saving again.'
              using errcode = '40001';
          end if;
          v_operation := 'update';
        end if;
      end if;

      v_after_state := private.shooting_score_source_state(v_source_id);
      insert into public.shooting_score_change_events (
        shooting_score_source_id, actor_id, origin_competition_id,
        origin_competition_round_id, operation, before_state, after_state
      ) values (
        v_source_id, v_context.actor_id, p_competition_id,
        p_competition_round_id, v_operation, v_before_state, v_after_state
      );
      v_recorded_participant_count := v_recorded_participant_count + 1;
      v_source_versions := jsonb_set(
        v_source_versions, array[v_participant_id::text], to_jsonb(v_source_version), true
      );
      continue;
    end if;

    -- Ordinary, unmapped path: retain the established independent behavior.
    select usage.shooting_score_source_id, source.concurrent_shooting_round_id
    into v_source_id, v_source_concurrent_round_id
    from public.competition_score_usages as usage
    join public.shooting_score_sources as source on source.id = usage.shooting_score_source_id
    where usage.competition_id = p_competition_id
      and usage.competition_round_id = p_competition_round_id
      and usage.competition_entrant_participant_id = v_participant_id
    for update of usage, source;
    if v_source_concurrent_round_id is not null then
      raise exception 'Archived Concurrent score provenance is read-only.' using errcode = '22023';
    end if;
    if v_is_blank then
      if v_source_id is not null then
        delete from public.competition_score_usages
        where competition_id = p_competition_id
          and competition_round_id = p_competition_round_id
          and competition_entrant_participant_id = v_participant_id;
        delete from public.shooting_score_sources as source
        where source.id = v_source_id and not exists (
          select 1 from public.competition_score_usages as remaining_usage
          where remaining_usage.shooting_score_source_id = source.id
        );
      end if;
      v_source_versions := jsonb_set(
        v_source_versions, array[v_participant_id::text], 'null'::jsonb, true
      );
      continue;
    end if;
    if v_source_id is null then
      insert into public.shooting_score_sources (shooter_profile_id, created_by, updated_by)
      values (v_shooter_profile_id, v_context.actor_id, v_context.actor_id)
      returning id, version into v_source_id, v_source_version;
      insert into public.competition_score_usages (
        shooting_score_source_id, competition_id, competition_round_id,
        competition_entrant_participant_id, created_by, updated_by
      ) values (
        v_source_id, p_competition_id, p_competition_round_id,
        v_participant_id, v_context.actor_id, v_context.actor_id
      );
    else
      update public.shooting_score_sources set updated_by = v_context.actor_id
      where id = v_source_id returning version into v_source_version;
      update public.competition_score_usages set updated_by = v_context.actor_id
      where competition_id = p_competition_id
        and competition_round_id = p_competition_round_id
        and competition_entrant_participant_id = v_participant_id;
    end if;
    v_recorded_participant_count := v_recorded_participant_count + 1;
    for v_slot in
      select slot.value, component.maximum_score, component.score_method
      from jsonb_array_elements(v_values) as slot(value)
      join public.competition_score_components as component
        on component.competition_id = p_competition_id
        and component.position = (slot.value ->> 'component_position')::integer
    loop
      if jsonb_typeof(v_slot.value -> 'entered_score') = 'null' then
        delete from public.shooting_score_values
        where shooting_score_source_id = v_source_id
          and set_number = (v_slot.value ->> 'set_number')::integer
          and component_position = (v_slot.value ->> 'component_position')::integer;
        continue;
      end if;
      v_entered_score := (v_slot.value ->> 'entered_score')::numeric(10, 2);
      v_achieved_score := case v_slot.score_method
        when 'points_dropped' then v_slot.maximum_score - v_entered_score
        else v_entered_score end;
      v_x_count := case when jsonb_typeof(v_slot.value -> 'x_count') = 'null' then null
        else (v_slot.value ->> 'x_count')::integer end;
      insert into public.shooting_score_values (
        shooting_score_source_id, set_number, component_position,
        achieved_score, x_count, created_by, updated_by
      ) values (
        v_source_id, (v_slot.value ->> 'set_number')::integer,
        (v_slot.value ->> 'component_position')::integer,
        v_achieved_score, v_x_count, v_context.actor_id, v_context.actor_id
      ) on conflict (shooting_score_source_id, set_number, component_position)
      do update set achieved_score = excluded.achieved_score,
        x_count = excluded.x_count, updated_by = excluded.updated_by;
      v_recorded_value_count := v_recorded_value_count + 1;
    end loop;
    v_source_versions := jsonb_set(
      v_source_versions, array[v_participant_id::text], to_jsonb(v_source_version), true
    );
  end loop;

  return jsonb_build_object(
    'competition_id', p_competition_id,
    'competition_round_id', p_competition_round_id,
    'shared', v_physical_round_id is not null,
    'concurrent_shooting_round_id', v_physical_round_id,
    'recorded_participant_count', v_recorded_participant_count,
    'recorded_value_count', v_recorded_value_count,
    'linked_usage_count', v_linked_usage_count,
    'shared_clear_count', v_shared_clear_count,
    'globally_cleared', v_shared_clear_count > 0,
    'source_versions', v_source_versions
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.shooting_score_source_state(p_shooting_score_source_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'version', source.version,
    'values', coalesce((
      select jsonb_agg(jsonb_build_object(
        'set_number', value.set_number,
        'component_position', value.component_position,
        'achieved_score', value.achieved_score,
        'x_count', to_jsonb(value.x_count)
      ) order by value.set_number, value.component_position)
      from public.shooting_score_values as value
      where value.shooting_score_source_id = source.id
    ), '[]'::jsonb)
  )
  from public.shooting_score_sources as source
  where source.id = p_shooting_score_source_id
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_score_batch(p_competition_id bigint, p_club_id bigint, p_sets_per_round integer, p_uses_x_score boolean, p_shots_per_round integer, p_scores jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shooter record;
  v_values jsonb;
  v_component_count integer;
  v_expected_slot_count integer;
begin
  if p_scores is null or jsonb_typeof(p_scores) <> 'array' then
    raise exception 'Round scores must be supplied as a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_scores) > 20000 then
    raise exception 'A score-entry batch cannot contain more than 20,000 shooters.'
      using errcode = '22023';
  end if;
  select count(*)::integer into v_component_count
  from public.competition_score_components as component
  where component.competition_id = p_competition_id;
  if v_component_count = 0 then
    raise exception 'The Competition Course of Fire has no score components.' using errcode = '22023';
  end if;
  v_expected_slot_count := p_sets_per_round * v_component_count;

  if exists (
    select 1 from jsonb_array_elements(p_scores) as item(value)
    where case when jsonb_typeof(item.value) <> 'object' then true else
      not (item.value ?& array['participant_id', 'values'])
      or item.value - array['participant_id', 'values', 'source_version'] <> '{}'::jsonb
      or jsonb_typeof(item.value -> 'participant_id') <> 'number'
      or (item.value ->> 'participant_id') !~ '^[1-9][0-9]{0,17}$'
      or jsonb_typeof(item.value -> 'values') <> 'array'
      or (
        item.value ? 'source_version'
        and jsonb_typeof(item.value -> 'source_version') not in ('number', 'null')
      )
      or (
        item.value ? 'source_version'
        and jsonb_typeof(item.value -> 'source_version') = 'number'
        and (item.value ->> 'source_version') !~ '^[1-9][0-9]{0,17}$'
      )
    end
  ) then
    raise exception 'Every score row must identify one participant, optional source version, and a score-value list.'
      using errcode = '22023';
  end if;
  if (
    select count(distinct (item.value ->> 'participant_id')::bigint)
    from jsonb_array_elements(p_scores) as item(value)
  ) <> jsonb_array_length(p_scores) then
    raise exception 'Each participant may appear only once in a score-entry batch.' using errcode = '23505';
  end if;
  if jsonb_array_length(p_scores) <> (
    select count(*)
    from public.club_competition_entries as entry
    join public.competition_entrants as entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants as participant
      on participant.competition_entrant_id = entrant.id
      and participant.club_competition_entry_id = entry.id
    where entry.competition_id = p_competition_id
      and entry.status = 'submitted'
      and (p_club_id is null or entry.club_id = p_club_id)
  ) then
    raise exception 'The score-entry batch must contain every visible submitted Individual participant.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_scores) as item(value)
    where not exists (
      select 1
      from public.club_competition_entries as entry
      join public.competition_entrants as entrant on entrant.club_competition_entry_id = entry.id
      join public.competition_entrant_participants as participant
        on participant.competition_entrant_id = entrant.id
        and participant.club_competition_entry_id = entry.id
      where participant.id = (item.value ->> 'participant_id')::bigint
        and entry.competition_id = p_competition_id
        and entry.status = 'submitted'
        and (p_club_id is null or entry.club_id = p_club_id)
    )
  ) then
    raise exception 'A score row contains a participant outside this exact Competition scope.'
      using errcode = '22023';
  end if;

  for v_shooter in select item.value from jsonb_array_elements(p_scores) as item(value)
  loop
    v_values := v_shooter.value -> 'values';
    if jsonb_array_length(v_values) <> v_expected_slot_count then
      raise exception 'Every participant must contain every configured Set and score component.'
        using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_values) as slot(value)
      where case when jsonb_typeof(slot.value) <> 'object' then true else
        not (slot.value ?& array['set_number', 'component_position', 'entered_score', 'x_count'])
        or slot.value - array['set_number', 'component_position', 'entered_score', 'x_count'] <> '{}'::jsonb
        or jsonb_typeof(slot.value -> 'set_number') <> 'number'
        or (slot.value ->> 'set_number') !~ '^(?:[1-9]|[1-9][0-9]|100)$'
        or jsonb_typeof(slot.value -> 'component_position') <> 'number'
        or (slot.value ->> 'component_position') !~ '^(?:[1-9]|1[0-9]|20)$'
        or (
          jsonb_typeof(slot.value -> 'entered_score') <> 'null'
          and (jsonb_typeof(slot.value -> 'entered_score') <> 'string'
            or (slot.value ->> 'entered_score') !~ '^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$')
        )
        or (
          jsonb_typeof(slot.value -> 'x_count') <> 'null'
          and (jsonb_typeof(slot.value -> 'x_count') <> 'number'
            or (slot.value ->> 'x_count') !~ '^(?:0|[1-9][0-9]{0,3}|10000)$')
        )
        or (jsonb_typeof(slot.value -> 'entered_score') = 'null'
          and jsonb_typeof(slot.value -> 'x_count') <> 'null')
      end
    ) then
      raise exception 'A score value has an invalid Set, component, score, or X representation.'
        using errcode = '22023';
    end if;
    if (
      select count(distinct (
        (slot.value ->> 'set_number')::integer,
        (slot.value ->> 'component_position')::integer
      )) from jsonb_array_elements(v_values) as slot(value)
    ) <> v_expected_slot_count then
      raise exception 'Every Set/component slot must appear exactly once per participant.'
        using errcode = '23505';
    end if;
    if exists (
      select 1
      from generate_series(1, p_sets_per_round) as set_slot(set_number)
      cross join public.competition_score_components as component
      where component.competition_id = p_competition_id
        and not exists (
          select 1 from jsonb_array_elements(v_values) as slot(value)
          where (slot.value ->> 'set_number')::integer = set_slot.set_number
            and (slot.value ->> 'component_position')::integer = component.position
        )
    ) then
      raise exception 'The score-entry batch contains a Set or component outside the Course of Fire.'
        using errcode = '22023';
    end if;
    if not p_uses_x_score and exists (
      select 1 from jsonb_array_elements(v_values) as slot(value)
      where jsonb_typeof(slot.value -> 'x_count') <> 'null'
    ) then
      raise exception 'X values are not enabled for this Competition.' using errcode = '22023';
    end if;
    if p_shots_per_round is not null and (
      select coalesce(sum((slot.value ->> 'x_count')::integer), 0)
      from jsonb_array_elements(v_values) as slot(value)
      where jsonb_typeof(slot.value -> 'x_count') <> 'null'
    ) > p_shots_per_round then
      raise exception 'A shooter''s total X count cannot exceed the configured shots per Round.'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_values) as slot(value)
      join public.competition_score_components as component
        on component.competition_id = p_competition_id
        and component.position = (slot.value ->> 'component_position')::integer
      where jsonb_typeof(slot.value -> 'entered_score') <> 'null'
        and (slot.value ->> 'entered_score')::numeric > component.maximum_score
    ) then
      raise exception 'An entered score cannot exceed its Course of Fire component maximum.'
        using errcode = '22023';
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_concurrent_shooting_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group public.concurrent_shooting_groups%rowtype;
  v_competition record;
begin
  select * into v_group from public.concurrent_shooting_groups
  where id = new.concurrent_shooting_group_id;
  select season.organisation_id, competition.league_season_id
  into v_competition
  from public.competitions as competition
  join public.league_seasons as season on season.id = competition.league_season_id
  where competition.id = new.competition_id;
  if not found or v_competition.organisation_id <> v_group.organisation_id then
    raise exception 'Competition and Concurrent Shooting group must belong to the same Organisation.'
      using errcode = '22023';
  end if;
  if v_competition.league_season_id <> v_group.league_season_id then
    raise exception 'Concurrent Shooting V1 requires every Competition to use the same Season.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_shooting_score_change_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.origin_competition_round_id is not null and not exists (
    select 1 from public.competition_rounds as round_row
    where round_row.id = new.origin_competition_round_id
      and round_row.competition_id = new.origin_competition_id
  ) then
    raise exception 'Audit origin Round must belong to the origin Competition.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.activate_concurrent_shooting_group(p_organisation_id bigint, p_concurrent_shooting_group_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  group_record public.concurrent_shooting_groups%rowtype;
  actor uuid;
  reference_signature jsonb;
  candidate_signature jsonb;
  mismatches jsonb;
  reference_competition_id bigint;
  member_record record;
  member_count integer;
begin
  group_record := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, true, 'draft'
  );
  actor := auth.uid();
  select count(*)::integer, min(competition_id)
  into member_count, reference_competition_id
  from public.concurrent_shooting_group_competitions
  where concurrent_shooting_group_id = p_concurrent_shooting_group_id;
  if member_count < 2 then
    raise exception 'Activation requires at least two member Competitions.' using errcode = '22023';
  end if;
  reference_signature := private.concurrent_shooting_compatibility_signature(reference_competition_id);
  if coalesce((reference_signature ->> 'component_count')::integer, 0) < 1 then
    raise exception 'Member Competitions require a complete Course of Fire.' using errcode = '22023';
  end if;
  if not coalesce((reference_signature ->> 'physical_details_configured')::boolean, false) then
    raise exception 'Physical shooting details required before Concurrent Shooting activation.'
      using errcode = '22023';
  end if;

  for member_record in
    select competition.id, competition.name, competition.status,
      competition.league_season_id, season.organisation_id,
      effective.effective_starts_at
    from public.concurrent_shooting_group_competitions member
    join public.competitions competition on competition.id = member.competition_id
    join public.league_seasons season on season.id = competition.league_season_id
    cross join lateral private.get_competition_effective_dates(competition.id) effective
    where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    order by competition.id
    for update of competition
  loop
    if member_record.organisation_id <> p_organisation_id
      or member_record.league_season_id <> group_record.league_season_id then
      raise exception 'Every member Competition must belong to the group Organisation and Season.'
        using errcode = '22023';
    end if;
    if member_record.status <> 'published' then
      raise exception 'Competition "%" must be published before activation.', member_record.name
        using errcode = '22023';
    end if;
    if member_record.effective_starts_at is null
      or member_record.effective_starts_at <= current_date then
      raise exception 'Competition "%" has reached its effective start.', member_record.name
        using errcode = '22023';
    end if;
    candidate_signature := private.concurrent_shooting_compatibility_signature(member_record.id);
    mismatches := private.concurrent_shooting_compatibility_mismatches(
      reference_signature, candidate_signature
    );
    if jsonb_array_length(mismatches) > 0 then
      raise exception 'Competition "%" is not eligible for Concurrent Shooting. Mismatched fields: %',
        member_record.name, mismatches using errcode = '22023';
    end if;
  end loop;
  if not exists (
    select 1 from public.concurrent_shooting_rounds
    where concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) then
    raise exception 'Activation requires explicit physical Round mappings.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.concurrent_shooting_rounds physical_round
    left join public.concurrent_shooting_round_mappings mapping
      on mapping.concurrent_shooting_round_id = physical_round.id
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    group by physical_round.id
    having count(distinct mapping.competition_id) < 2
  ) then
    raise exception 'Every physical Concurrent Round must map at least two Competitions.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.concurrent_shooting_group_competitions member
    where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and not exists (
        select 1 from public.concurrent_shooting_round_mappings mapping
        where mapping.concurrent_shooting_group_id = member.concurrent_shooting_group_id
          and mapping.competition_id = member.competition_id
      )
  ) then
    raise exception 'Every member Competition must have at least one explicit Round mapping.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.concurrent_shooting_round_mappings mapping
    join public.competition_score_usages usage
      on usage.competition_id = mapping.competition_id
      and usage.competition_round_id = mapping.competition_round_id
    where mapping.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) then
    raise exception 'A mapped Competition Round already has score usage.' using errcode = '22023';
  end if;
  update public.concurrent_shooting_groups
  set status = 'active', compatibility_version = 2,
      compatibility_signature = reference_signature,
      activated_at = clock_timestamp(), updated_by = actor
  where id = p_concurrent_shooting_group_id;
  return jsonb_build_object(
    'id', p_concurrent_shooting_group_id,
    'status', 'active',
    'compatibility_version', 2,
    'compatibility_signature', reference_signature
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_concurrent_shooting_group_competition(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  group_record public.concurrent_shooting_groups%rowtype;
  actor uuid;
  signature jsonb;
  reference_signature jsonb;
  mismatches jsonb;
  effective_starts_at date;
begin
  group_record := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  actor := auth.uid();

  select effective.effective_starts_at
  into effective_starts_at
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  cross join lateral private.get_competition_effective_dates(competition.id) effective
  where competition.id = p_competition_id
    and competition.league_season_id = group_record.league_season_id
    and season.organisation_id = p_organisation_id;

  if not found then
    raise exception 'Competition must belong to this Organisation and Season.'
      using errcode = '22023';
  end if;
  if effective_starts_at is null or effective_starts_at <= current_date then
    raise exception 'Competition has already started. Concurrent Shooting must be configured before Competition Start.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.concurrent_shooting_group_competitions
    where competition_id = p_competition_id
  ) then
    raise exception 'Competition already belongs to a Concurrent Shooting group.'
      using errcode = '23505';
  end if;

  signature := private.concurrent_shooting_compatibility_signature(p_competition_id);
  select private.concurrent_shooting_compatibility_signature(member.competition_id)
  into reference_signature
  from public.concurrent_shooting_group_competitions member
  where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  order by member.competition_id
  limit 1;

  if reference_signature is not null then
    mismatches := private.concurrent_shooting_compatibility_mismatches(
      reference_signature, signature
    );
    if jsonb_array_length(mismatches) > 0 then
      raise exception 'Competition is not eligible for Concurrent Shooting. Mismatched fields: %', mismatches
        using errcode = '22023';
    end if;
  end if;

  insert into public.concurrent_shooting_group_competitions (
    concurrent_shooting_group_id, competition_id, created_by
  ) values (p_concurrent_shooting_group_id, p_competition_id, actor);

  return jsonb_build_object(
    'competition_id', p_competition_id,
    'compatibility_signature', signature
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_concurrent_shooting_round_mapping(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint, p_competition_round_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  insert into public.concurrent_shooting_round_mappings (
    concurrent_shooting_group_id, concurrent_shooting_round_id,
    competition_id, competition_round_id, created_by
  ) values (
    p_concurrent_shooting_group_id, p_concurrent_shooting_round_id,
    p_competition_id, p_competition_round_id, auth.uid()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_concurrent_shooting_group(p_organisation_id bigint, p_concurrent_shooting_group_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  physical_round_id bigint;
begin
  perform private.require_competition_author(p_organisation_id, true);
  if not exists (
    select 1 from public.concurrent_shooting_groups as group_row
    where group_row.id = p_concurrent_shooting_group_id
      and group_row.organisation_id = p_organisation_id
      and group_row.status = 'active'
  ) then
    raise exception 'Concurrent Shooting group must be active.' using errcode = '22023';
  end if;

  for physical_round_id in
    select physical_round.id
    from public.concurrent_shooting_rounds as physical_round
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    order by physical_round.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'concurrent-score:' || physical_round_id::text, 0
    ));
  end loop;

  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, true, 'active'
  );
  update public.concurrent_shooting_groups
  set status = 'archived', archived_at = clock_timestamp(),
    updated_by = (select auth.uid())
  where id = p_concurrent_shooting_group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_concurrent_shooting_group_activation(p_organisation_id bigint, p_concurrent_shooting_group_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  physical_round_id bigint;
begin
  perform private.require_competition_author(p_organisation_id, true);
  if not exists (
    select 1 from public.concurrent_shooting_groups as group_row
    where group_row.id = p_concurrent_shooting_group_id
      and group_row.organisation_id = p_organisation_id
      and group_row.status = 'active'
  ) then
    raise exception 'Concurrent Shooting group must be active.' using errcode = '22023';
  end if;

  for physical_round_id in
    select physical_round.id
    from public.concurrent_shooting_rounds as physical_round
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    order by physical_round.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'concurrent-score:' || physical_round_id::text, 0
    ));
  end loop;

  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, true, 'active'
  );
  if exists (
    select 1
    from public.concurrent_shooting_group_competitions as member
    cross join lateral private.get_competition_effective_dates(member.competition_id) as effective
    where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and (effective.effective_starts_at is null or effective.effective_starts_at <= current_date)
  ) then
    raise exception 'Activation cannot be cancelled after a member Competition has started.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.shooting_score_sources as source
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = source.concurrent_shooting_round_id
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) or exists (
    select 1 from public.concurrent_shooting_round_mappings as mapping
    join public.competition_score_usages as usage
      on usage.competition_id = mapping.competition_id
      and usage.competition_round_id = mapping.competition_round_id
    where mapping.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) then
    raise exception 'Activation cannot be cancelled after score provenance exists.'
      using errcode = '22023';
  end if;
  update public.concurrent_shooting_groups
  set status = 'draft', compatibility_version = null,
    compatibility_signature = null, activated_at = null,
    updated_by = (select auth.uid())
  where id = p_concurrent_shooting_group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_concurrent_shooting_group(p_organisation_id bigint, p_league_season_id bigint, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_id bigint;
begin
  v_actor := private.require_competition_author(p_organisation_id);
  if char_length(v_name) not between 2 and 160 then
    raise exception 'Concurrent Shooting group name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.league_seasons
    where id = p_league_season_id and organisation_id = p_organisation_id
  ) then
    raise exception 'Season not found in this Organisation.' using errcode = 'P0002';
  end if;
  insert into public.concurrent_shooting_groups (
    organisation_id, league_season_id, name, created_by, updated_by
  ) values (p_organisation_id, p_league_season_id, v_name, v_actor, v_actor)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'draft');
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_concurrent_shooting_round(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_position integer, p_label text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
  v_actor uuid;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  v_actor := auth.uid();
  insert into public.concurrent_shooting_rounds (
    concurrent_shooting_group_id, position, label, created_by, updated_by
  ) values (p_concurrent_shooting_group_id, p_position, v_label, v_actor, v_actor)
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_concurrent_shooting_round(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  delete from public.concurrent_shooting_rounds
  where id = p_concurrent_shooting_round_id
    and concurrent_shooting_group_id = p_concurrent_shooting_group_id;
  if not found then
    raise exception 'Physical Concurrent Round not found in this group.' using errcode = 'P0002';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_draft_concurrent_shooting_group(p_organisation_id bigint, p_concurrent_shooting_group_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  delete from public.concurrent_shooting_groups
  where id = p_concurrent_shooting_group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_concurrent_shooting_summary(p_organisation_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  perform private.require_competition_author(p_organisation_id);
  if not exists (
    select 1
    from public.competitions as competition
    join public.league_seasons as season on season.id = competition.league_season_id
    where competition.id = p_competition_id
      and season.organisation_id = p_organisation_id
  ) then
    raise exception 'Competition not found in this Organisation.' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'group_id', group_row.id,
    'group_name', group_row.name,
    'status', group_row.status,
    'activated_at', group_row.activated_at,
    'season_id', season.id,
    'season_name', season.name,
    'shared_round_count', (
      select count(*)
      from public.concurrent_shooting_round_mappings as mapping
      where mapping.concurrent_shooting_group_id = group_row.id
        and mapping.competition_id = p_competition_id
    ),
    'linked_competitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'competition_id', linked_competition.id,
        'name', linked_competition.name,
        'entry_format', linked_competition.entry_format
      ) order by linked_competition.name, linked_competition.id)
      from public.concurrent_shooting_group_competitions as linked_member
      join public.competitions as linked_competition
        on linked_competition.id = linked_member.competition_id
      where linked_member.concurrent_shooting_group_id = group_row.id
        and linked_member.competition_id <> p_competition_id
    ), '[]'::jsonb)
  ) into v_result
  from public.concurrent_shooting_group_competitions as member
  join public.concurrent_shooting_groups as group_row
    on group_row.id = member.concurrent_shooting_group_id
  join public.league_seasons as season on season.id = group_row.league_season_id
  where member.competition_id = p_competition_id
    and group_row.organisation_id = p_organisation_id;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_concurrent_shooting_competition_candidates(p_organisation_id bigint, p_concurrent_shooting_group_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  group_record public.concurrent_shooting_groups%rowtype;
  reference_signature jsonb;
begin
  group_record := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id
  );
  select private.concurrent_shooting_compatibility_signature(member.competition_id)
  into reference_signature
  from public.concurrent_shooting_group_competitions member
  where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  order by member.competition_id limit 1;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'competition_id', competition.id,
      'name', competition.name,
      'slug', competition.slug,
      'status', competition.status,
      'entry_format', competition.entry_format,
      'ranking_method', competition.ranking_method,
      'number_of_rounds', competition.number_of_rounds,
      'selected', coalesce(membership.concurrent_shooting_group_id = p_concurrent_shooting_group_id, false),
      'existing_group_id', membership.concurrent_shooting_group_id,
      'existing_group_name', existing_group.name,
      'existing_group_status', existing_group.status,
      'compatible', (signature.value ->> 'physical_details_configured')::boolean
        and (reference_signature is null or jsonb_array_length(mismatch.value) = 0),
      'compatibility_mismatches', mismatch.value,
      'has_course_of_fire', coalesce((signature.value ->> 'component_count')::integer, 0) > 0,
      'physical_details_configured', coalesce(
        (signature.value ->> 'physical_details_configured')::boolean, false
      ),
      'effective_starts_at', effective.effective_starts_at,
      'has_started', effective.effective_starts_at is null
        or effective.effective_starts_at <= current_date,
      'selectable', group_record.status = 'draft'
        and competition.status = 'published'
        and effective.effective_starts_at is not null
        and effective.effective_starts_at > current_date
        and coalesce((signature.value ->> 'component_count')::integer, 0) > 0
        and coalesce((signature.value ->> 'physical_details_configured')::boolean, false)
        and (membership.concurrent_shooting_group_id is null
          or membership.concurrent_shooting_group_id = p_concurrent_shooting_group_id)
        and (reference_signature is null or jsonb_array_length(mismatch.value) = 0)
    ) order by competition.name, competition.id)
    from public.competitions competition
    left join public.concurrent_shooting_group_competitions membership
      on membership.competition_id = competition.id
    left join public.concurrent_shooting_groups existing_group
      on existing_group.id = membership.concurrent_shooting_group_id
    cross join lateral private.get_competition_effective_dates(competition.id) effective
    cross join lateral (
      select private.concurrent_shooting_compatibility_signature(competition.id) value
    ) signature
    cross join lateral (
      select case when reference_signature is null
        then case when coalesce((signature.value ->> 'physical_details_configured')::boolean, false)
          then '[]'::jsonb else '["physical_details"]'::jsonb end
        else private.concurrent_shooting_compatibility_mismatches(reference_signature, signature.value)
      end value
    ) mismatch
    where competition.league_season_id = group_record.league_season_id
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_concurrent_shooting_group_lifecycle(p_organisation_id bigint, p_concurrent_shooting_group_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  group_record public.concurrent_shooting_groups%rowtype;
  reference_signature jsonb;
  started boolean;
  has_provenance boolean;
  activation_block_reasons jsonb := '[]'::jsonb;
begin
  group_record := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id
  );
  select exists (
    select 1
    from public.concurrent_shooting_group_competitions member
    cross join lateral private.get_competition_effective_dates(member.competition_id) effective
    where member.concurrent_shooting_group_id = group_record.id
      and (effective.effective_starts_at is null or effective.effective_starts_at <= current_date)
  ) into started;
  select exists (
    select 1 from public.shooting_score_sources source
    join public.concurrent_shooting_rounds physical_round
      on physical_round.id = source.concurrent_shooting_round_id
    where physical_round.concurrent_shooting_group_id = group_record.id
  ) or exists (
    select 1 from public.concurrent_shooting_round_mappings mapping
    join public.competition_score_usages usage
      on usage.competition_id = mapping.competition_id
      and usage.competition_round_id = mapping.competition_round_id
    where mapping.concurrent_shooting_group_id = group_record.id
  ) into has_provenance;

  if group_record.status = 'draft' then
    if (select count(*) from public.concurrent_shooting_group_competitions
      where concurrent_shooting_group_id = group_record.id) < 2 then
      activation_block_reasons := activation_block_reasons || '"member_count"'::jsonb;
    end if;
    if started then
      activation_block_reasons := activation_block_reasons || '"competition_started"'::jsonb;
    end if;
    if exists (
      select 1 from public.concurrent_shooting_group_competitions member
      join public.competitions competition on competition.id = member.competition_id
      where member.concurrent_shooting_group_id = group_record.id
        and competition.status <> 'published'
    ) then
      activation_block_reasons := activation_block_reasons || '"competition_not_published"'::jsonb;
    end if;
    select private.concurrent_shooting_compatibility_signature(member.competition_id)
    into reference_signature
    from public.concurrent_shooting_group_competitions member
    where member.concurrent_shooting_group_id = group_record.id
    order by member.competition_id limit 1;
    if reference_signature is not null and not coalesce(
      (reference_signature ->> 'physical_details_configured')::boolean, false
    ) then
      activation_block_reasons := activation_block_reasons || '"physical_details"'::jsonb;
    end if;
    if reference_signature is not null and exists (
      select 1 from public.concurrent_shooting_group_competitions member
      where member.concurrent_shooting_group_id = group_record.id
        and jsonb_array_length(private.concurrent_shooting_compatibility_mismatches(
          reference_signature,
          private.concurrent_shooting_compatibility_signature(member.competition_id)
        )) > 0
    ) then
      activation_block_reasons := activation_block_reasons || '"incompatible"'::jsonb;
    end if;
    if not exists (
      select 1 from public.concurrent_shooting_rounds
      where concurrent_shooting_group_id = group_record.id
    ) then
      activation_block_reasons := activation_block_reasons || '"rounds_missing"'::jsonb;
    elsif exists (
      select 1 from public.concurrent_shooting_rounds physical_round
      left join public.concurrent_shooting_round_mappings mapping
        on mapping.concurrent_shooting_round_id = physical_round.id
      where physical_round.concurrent_shooting_group_id = group_record.id
      group by physical_round.id
      having count(distinct mapping.competition_id) < 2
    ) then
      activation_block_reasons := activation_block_reasons || '"round_not_ready"'::jsonb;
    end if;
    if exists (
      select 1 from public.concurrent_shooting_group_competitions member
      where member.concurrent_shooting_group_id = group_record.id
        and not exists (
          select 1 from public.concurrent_shooting_round_mappings mapping
          where mapping.concurrent_shooting_group_id = group_record.id
            and mapping.competition_id = member.competition_id
        )
    ) then
      activation_block_reasons := activation_block_reasons || '"member_unmapped"'::jsonb;
    end if;
    if has_provenance then
      activation_block_reasons := activation_block_reasons || '"score_provenance"'::jsonb;
    end if;
  end if;

  return jsonb_build_object(
    'can_activate', group_record.status = 'draft'
      and jsonb_array_length(activation_block_reasons) = 0,
    'activation_block_reasons', activation_block_reasons,
    'can_cancel_activation', group_record.status = 'active'
      and not started and not has_provenance,
    'cancel_block_reason', case
      when group_record.status <> 'active' then 'not_active'
      when started then 'competition_started'
      when has_provenance then 'score_provenance'
      else null
    end,
    'has_score_provenance', has_provenance
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_concurrent_shooting_group_management(p_organisation_id bigint, p_concurrent_shooting_group_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group public.concurrent_shooting_groups%rowtype;
  v_reference jsonb;
begin
  v_group := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id
  );
  select private.concurrent_shooting_compatibility_signature(member.competition_id)
  into v_reference
  from public.concurrent_shooting_group_competitions as member
  where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  order by member.competition_id limit 1;
  return jsonb_build_object(
    'group', to_jsonb(v_group),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'competition_id', competition.id,
        'name', competition.name,
        'entry_format', competition.entry_format,
        'status', competition.status,
        'compatibility_signature', signature.value,
        'compatibility_mismatches', case when v_reference is null then '[]'::jsonb
          else private.concurrent_shooting_compatibility_mismatches(v_reference, signature.value) end
      ) order by competition.name, competition.id)
      from public.concurrent_shooting_group_competitions as member
      join public.competitions as competition on competition.id = member.competition_id
      cross join lateral (select private.concurrent_shooting_compatibility_signature(competition.id) as value) as signature
      where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    ), '[]'::jsonb),
    'physical_rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', physical_round.id,
        'position', physical_round.position,
        'label', physical_round.label,
        'mappings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'competition_id', mapping.competition_id,
            'competition_round_id', mapping.competition_round_id,
            'round_number', competition_round.round_number
          ) order by mapping.competition_id)
          from public.concurrent_shooting_round_mappings as mapping
          join public.competition_rounds as competition_round
            on competition_round.id = mapping.competition_round_id
          where mapping.concurrent_shooting_round_id = physical_round.id
        ), '[]'::jsonb)
      ) order by physical_round.position)
      from public.concurrent_shooting_rounds as physical_round
      where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_individual_competition_score_entry(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  archived_mapping record;
begin
  result := private.get_individual_competition_score_entry_base(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_competition_round_id, p_club_id
  );

  select group_row.id as group_id, group_row.name as group_name,
    physical_round.id as physical_round_id,
    physical_round.label as physical_round_label
  into archived_mapping
  from public.concurrent_shooting_round_mappings as mapping
  join public.concurrent_shooting_rounds as physical_round
    on physical_round.id = mapping.concurrent_shooting_round_id
  join public.concurrent_shooting_groups as group_row
    on group_row.id = physical_round.concurrent_shooting_group_id
  where mapping.competition_id = p_competition_id
    and mapping.competition_round_id = p_competition_round_id
    and group_row.organisation_id = p_organisation_id
    and group_row.league_season_id = p_league_season_id
    and group_row.status = 'archived';

  if found then
    result := jsonb_set(result, '{can_edit}', 'false'::jsonb);
    result := jsonb_set(result, '{concurrent_shooting}', jsonb_build_object(
      'shared', true,
      'archived', true,
      'group_id', archived_mapping.group_id,
      'group_name', archived_mapping.group_name,
      'physical_round_id', archived_mapping.physical_round_id,
      'physical_round_label', archived_mapping.physical_round_label,
      'linked_competitions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'competition_id', linked.competition_id,
          'competition_name', competition.name,
          'competition_round_id', linked.competition_round_id,
          'round_number', round_row.round_number
        ) order by linked.competition_id)
        from public.concurrent_shooting_round_mappings as linked
        join public.competitions as competition on competition.id = linked.competition_id
        join public.competition_rounds as round_row on round_row.id = linked.competition_round_id
        where linked.concurrent_shooting_round_id = archived_mapping.physical_round_id
      ), '[]'::jsonb)
    ));
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_concurrent_shooting_groups(p_organisation_id bigint, p_league_season_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_competition_author(p_organisation_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', group_row.id,
      'league_season_id', group_row.league_season_id,
      'name', group_row.name,
      'status', group_row.status,
      'member_count', (
        select count(*) from public.concurrent_shooting_group_competitions as member
        where member.concurrent_shooting_group_id = group_row.id
      ),
      'physical_round_count', (
        select count(*) from public.concurrent_shooting_rounds as physical_round
        where physical_round.concurrent_shooting_group_id = group_row.id
      )
    ) order by group_row.updated_at desc, group_row.id desc)
    from public.concurrent_shooting_groups as group_row
    where group_row.organisation_id = p_organisation_id
      and (p_league_season_id is null or group_row.league_season_id = p_league_season_id)
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.map_matching_concurrent_shooting_round_numbers(p_organisation_id bigint, p_concurrent_shooting_group_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  group_record public.concurrent_shooting_groups%rowtype;
  round_record record;
  physical_round_id bigint;
  matching_physical_count integer;
  next_position integer;
  inserted_mappings integer;
  created_rounds integer := 0;
  added_mappings integer := 0;
  preserved_conflicts integer := 0;
begin
  group_record := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  perform 1 from public.concurrent_shooting_groups
  where id = group_record.id for update;

  for round_record in
    select competition_round.round_number
    from public.concurrent_shooting_group_competitions member
    join public.competition_rounds competition_round
      on competition_round.competition_id = member.competition_id
    where member.concurrent_shooting_group_id = group_record.id
    group by competition_round.round_number
    having count(distinct member.competition_id) >= 2
    order by competition_round.round_number
  loop
    select count(distinct mapping.concurrent_shooting_round_id)::integer,
      min(mapping.concurrent_shooting_round_id)
    into matching_physical_count, physical_round_id
    from public.concurrent_shooting_round_mappings mapping
    join public.competition_rounds mapped_round
      on mapped_round.id = mapping.competition_round_id
    where mapping.concurrent_shooting_group_id = group_record.id
      and mapped_round.round_number = round_record.round_number;

    if matching_physical_count > 1 then
      preserved_conflicts := preserved_conflicts + 1;
      continue;
    end if;

    if matching_physical_count = 1 and exists (
      select 1
      from public.concurrent_shooting_round_mappings mapping
      join public.competition_rounds mapped_round
        on mapped_round.id = mapping.competition_round_id
      where mapping.concurrent_shooting_round_id = physical_round_id
        and mapped_round.round_number <> round_record.round_number
    ) then
      preserved_conflicts := preserved_conflicts + 1;
      continue;
    end if;

    if matching_physical_count = 0 then
      select coalesce(max(position), 0) + 1
      into next_position
      from public.concurrent_shooting_rounds
      where concurrent_shooting_group_id = group_record.id;
      if next_position > 100 then
        raise exception 'Concurrent Shooting supports at most 100 shared Rounds.'
          using errcode = '22023';
      end if;
      insert into public.concurrent_shooting_rounds (
        concurrent_shooting_group_id, position, label, created_by, updated_by
      ) values (
        group_record.id, next_position,
        'Matching Round ' || round_record.round_number,
        (select auth.uid()), (select auth.uid())
      ) returning id into physical_round_id;
      created_rounds := created_rounds + 1;
    end if;

    insert into public.concurrent_shooting_round_mappings (
      concurrent_shooting_group_id, concurrent_shooting_round_id,
      competition_id, competition_round_id, created_by
    )
    select group_record.id, physical_round_id, member.competition_id,
      competition_round.id, (select auth.uid())
    from public.concurrent_shooting_group_competitions member
    join public.competition_rounds competition_round
      on competition_round.competition_id = member.competition_id
      and competition_round.round_number = round_record.round_number
    where member.concurrent_shooting_group_id = group_record.id
      and not exists (
        select 1 from public.concurrent_shooting_round_mappings existing
        where existing.competition_round_id = competition_round.id
      )
      and not exists (
        select 1 from public.concurrent_shooting_round_mappings existing
        where existing.concurrent_shooting_round_id = physical_round_id
          and existing.competition_id = member.competition_id
      )
    order by member.competition_id
    on conflict do nothing;
    get diagnostics inserted_mappings = row_count;
    added_mappings := added_mappings + inserted_mappings;
  end loop;

  return jsonb_build_object(
    'created_round_count', created_rounds,
    'added_mapping_count', added_mappings,
    'preserved_manual_conflict_count', preserved_conflicts
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_concurrent_shooting_entry(p_organisation_id bigint, p_club_competition_entry_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_attached_count integer;
begin
  v_actor := private.require_competition_author(p_organisation_id);
  if not exists (
    select 1
    from public.club_competition_entries as entry
    join public.competitions as competition on competition.id = entry.competition_id
    join public.league_seasons as season on season.id = competition.league_season_id
    where entry.id = p_club_competition_entry_id
      and entry.status = 'submitted'
      and season.organisation_id = p_organisation_id
  ) then
    raise exception 'Submitted Competition entry not found in this Organisation.' using errcode = 'P0002';
  end if;
  v_attached_count := private.reconcile_concurrent_shooting_entry(
    p_club_competition_entry_id, v_actor
  );
  return jsonb_build_object(
    'entry_id', p_club_competition_entry_id,
    'attached_usage_count', v_attached_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_concurrent_shooting_group_competition(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_competition_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  delete from public.concurrent_shooting_group_competitions
  where concurrent_shooting_group_id = p_concurrent_shooting_group_id
    and competition_id = p_competition_id;
  if not found then
    raise exception 'Competition is not a member of this Concurrent Shooting group.'
      using errcode = 'P0002';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_concurrent_shooting_round_mapping(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  delete from public.concurrent_shooting_round_mappings
  where concurrent_shooting_group_id = p_concurrent_shooting_group_id
    and concurrent_shooting_round_id = p_concurrent_shooting_round_id
    and competition_id = p_competition_id;
  if not found then
    raise exception 'Concurrent Shooting Round mapping not found.' using errcode = 'P0002';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rename_concurrent_shooting_group(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  v_actor := auth.uid();
  if char_length(v_name) not between 2 and 160 then
    raise exception 'Concurrent Shooting group name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;
  update public.concurrent_shooting_groups
  set name = v_name, updated_by = v_actor
  where id = p_concurrent_shooting_group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_individual_competition_round_scores(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_competition_round_id bigint, p_club_id bigint, p_scores jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform 1
  from private.require_individual_score_entry_context(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_competition_round_id, p_club_id
  );
  if exists (
    select 1
    from public.concurrent_shooting_round_mappings as mapping
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = mapping.concurrent_shooting_round_id
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where mapping.competition_id = p_competition_id
      and mapping.competition_round_id = p_competition_round_id
      and group_row.organisation_id = p_organisation_id
      and group_row.league_season_id = p_league_season_id
      and group_row.status = 'archived'
  ) then
    raise exception 'Archived Concurrent score provenance is read-only.'
      using errcode = '22023';
  end if;
  return private.save_individual_competition_round_scores_base(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_competition_round_id, p_club_id, p_scores
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_concurrent_shooting_round_mapping(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_competition_id bigint, p_competition_round_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  if not exists (
    select 1
    from public.concurrent_shooting_rounds as physical_round
    join public.concurrent_shooting_group_competitions as member
      on member.concurrent_shooting_group_id = physical_round.concurrent_shooting_group_id
    where physical_round.id = p_concurrent_shooting_round_id
      and physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and member.competition_id = p_competition_id
  ) then
    raise exception 'Shared physical Round or member Competition was not found in this Draft.'
      using errcode = 'P0002';
  end if;
  if p_competition_round_id is null then
    delete from public.concurrent_shooting_round_mappings
    where concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and concurrent_shooting_round_id = p_concurrent_shooting_round_id
      and competition_id = p_competition_id;
    return;
  end if;
  if not exists (
    select 1 from public.competition_rounds as competition_round
    where competition_round.id = p_competition_round_id
      and competition_round.competition_id = p_competition_id
  ) then
    raise exception 'Competition Round does not belong to this member Competition.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.concurrent_shooting_round_mappings as mapping
    where mapping.concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and mapping.competition_id = p_competition_id
      and mapping.competition_round_id = p_competition_round_id
      and mapping.concurrent_shooting_round_id <> p_concurrent_shooting_round_id
  ) then
    raise exception 'That Competition Round is already mapped to another shared physical Round.'
      using errcode = '23505';
  end if;

  delete from public.concurrent_shooting_round_mappings
  where concurrent_shooting_group_id = p_concurrent_shooting_group_id
    and concurrent_shooting_round_id = p_concurrent_shooting_round_id
    and competition_id = p_competition_id;
  insert into public.concurrent_shooting_round_mappings (
    concurrent_shooting_group_id, concurrent_shooting_round_id,
    competition_id, competition_round_id, created_by
  ) values (
    p_concurrent_shooting_group_id, p_concurrent_shooting_round_id,
    p_competition_id, p_competition_round_id, (select auth.uid())
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_concurrent_shooting_round(p_organisation_id bigint, p_concurrent_shooting_group_id bigint, p_concurrent_shooting_round_id bigint, p_position integer, p_label text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  update public.concurrent_shooting_rounds
  set position = p_position,
    label = nullif(btrim(coalesce(p_label, '')), ''),
    updated_by = auth.uid()
  where id = p_concurrent_shooting_round_id
    and concurrent_shooting_group_id = p_concurrent_shooting_group_id;
  if not found then
    raise exception 'Physical Concurrent Round not found in this group.' using errcode = 'P0002';
  end if;
end;
$function$;


commit;

