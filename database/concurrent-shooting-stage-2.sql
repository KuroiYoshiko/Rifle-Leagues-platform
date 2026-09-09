-- Run after database/concurrent-shooting.sql.
-- Adds transactional shared score orchestration for Active Concurrent groups.
-- Existing unmapped scoring remains independent and is not backfilled.

begin;

create index if not exists concurrent_shooting_round_mappings_round_competition_idx
  on public.concurrent_shooting_round_mappings (
    concurrent_shooting_round_id, competition_id, competition_round_id
  );

create or replace function private.shooting_score_source_state(
  p_shooting_score_source_id bigint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
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
$$;

create or replace function private.require_concurrent_shooting_targets(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_concurrent_shooting_round_id bigint,
  p_shooter_profile_id uuid,
  p_shooting_score_source_id bigint,
  p_access_scope text,
  p_scoped_club_id bigint
)
returns table (
  competition_id bigint,
  competition_round_id bigint,
  competition_entrant_participant_id bigint,
  club_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.concurrent_shooting_participant_metadata(
  p_concurrent_shooting_round_id bigint,
  p_shooter_profile_id uuid,
  p_access_scope text,
  p_scoped_club_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.reconcile_concurrent_shooting_entry(
  p_club_competition_entry_id bigint,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.reconcile_concurrent_shooting_entry_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted'
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.reconcile_concurrent_shooting_entry(new.id, (select auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists reconcile_concurrent_shooting_entry
  on public.club_competition_entries;
create trigger reconcile_concurrent_shooting_entry
  after insert or update of status on public.club_competition_entries
  for each row execute function private.reconcile_concurrent_shooting_entry_trigger();

create or replace function public.reconcile_concurrent_shooting_entry(
  p_organisation_id bigint,
  p_club_competition_entry_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.get_individual_competition_score_entry(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint,
  p_club_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.validate_competition_score_batch(
  p_competition_id bigint,
  p_club_id bigint,
  p_sets_per_round integer,
  p_uses_x_score boolean,
  p_shots_per_round integer,
  p_scores jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.save_individual_competition_round_scores(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint,
  p_club_id bigint,
  p_scores jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

comment on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) is
  'Saves ordinary scores independently and Active Concurrent scores once per physical shooter/Round with atomic usage propagation, optimistic versions, global clear, and immutable audit.';

revoke execute on function private.shooting_score_source_state(bigint),
  private.require_concurrent_shooting_targets(bigint, bigint, bigint, uuid, bigint, text, bigint),
  private.concurrent_shooting_participant_metadata(bigint, uuid, text, bigint),
  private.reconcile_concurrent_shooting_entry(bigint, uuid),
  private.validate_competition_score_batch(bigint, bigint, integer, boolean, integer, jsonb),
  private.reconcile_concurrent_shooting_entry_trigger()
  from public, anon, authenticated;

revoke execute on function public.reconcile_concurrent_shooting_entry(bigint, bigint)
  from public, anon;
grant execute on function public.reconcile_concurrent_shooting_entry(bigint, bigint)
  to authenticated;

revoke execute on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) from public, anon;
grant execute on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) to authenticated;

revoke execute on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) from public, anon;
grant execute on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) to authenticated;

commit;
