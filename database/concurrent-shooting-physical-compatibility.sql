-- Concurrent Shooting physical compatibility upgrade. Run after
-- competition-shooting-details.sql and the existing Concurrent Shooting
-- Stage 1, Stage 2, and Stage 3A migrations. This replaces helper/function
-- definitions additively; the deployed Stage 1 migration is not rewritten.

begin;

alter table public.concurrent_shooting_groups
  drop constraint if exists concurrent_shooting_groups_lifecycle_value;
alter table public.concurrent_shooting_groups
  add constraint concurrent_shooting_groups_lifecycle_value check (
    (status = 'draft' and compatibility_version is null
      and compatibility_signature is null and activated_at is null
      and archived_at is null)
    or (status = 'active' and compatibility_version in (1, 2)
      and compatibility_signature is not null and activated_at is not null
      and archived_at is null)
    or (status = 'archived' and compatibility_version in (1, 2)
      and compatibility_signature is not null and activated_at is not null
      and archived_at is not null)
  );

create or replace function private.concurrent_shooting_compatibility_signature(
  p_competition_id bigint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
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
$$;

create or replace function private.concurrent_shooting_compatibility_mismatches(
  p_reference jsonb,
  p_candidate jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
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
$$;

create or replace function private.require_concurrent_member_physical_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.competition_has_complete_shooting_details(new.competition_id) then
    raise exception 'Physical shooting details required before this Competition is eligible for Concurrent Shooting.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists require_concurrent_member_physical_details
  on public.concurrent_shooting_group_competitions;
create trigger require_concurrent_member_physical_details
  before insert or update of competition_id
  on public.concurrent_shooting_group_competitions
  for each row execute function private.require_concurrent_member_physical_details();

create or replace function public.get_concurrent_shooting_competition_candidates(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      'selectable', group_record.status = 'draft'
        and competition.status = 'published'
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
$$;

create or replace function private.protect_active_concurrent_competition_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

drop trigger if exists protect_active_concurrent_competition_configuration
  on public.competitions;
create trigger protect_active_concurrent_competition_configuration
  before update of sets_per_round, shots_per_round, uses_x_score,
    shooting_details_version, equipment_type_code, organisation_equipment_type_id
  on public.competitions
  for each row execute function private.protect_active_concurrent_competition_configuration();

create or replace function public.activate_concurrent_shooting_group(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function private.concurrent_shooting_compatibility_signature(bigint),
  private.concurrent_shooting_compatibility_mismatches(jsonb, jsonb),
  private.require_concurrent_member_physical_details(),
  private.protect_active_concurrent_competition_configuration()
  from public, anon, authenticated;
revoke execute on function public.get_concurrent_shooting_competition_candidates(bigint, bigint)
  from public, anon;
grant execute on function public.get_concurrent_shooting_competition_candidates(bigint, bigint)
  to authenticated;
revoke execute on function public.activate_concurrent_shooting_group(bigint, bigint)
  from public, anon;
grant execute on function public.activate_concurrent_shooting_group(bigint, bigint)
  to authenticated;

comment on function private.concurrent_shooting_compatibility_signature(bigint) is
  'Version 2 exact physical/scoring signature. Ranking, entry format, team size, Round count, Series, and Average Context are deliberately excluded.';
comment on function public.get_concurrent_shooting_competition_candidates(bigint, bigint) is
  'Returns physical Concurrent eligibility; legacy Competitions without complete structured details are explicitly ineligible.';

commit;
