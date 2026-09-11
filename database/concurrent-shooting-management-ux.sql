-- Run after database/concurrent-shooting-physical-compatibility.sql.
-- Adds server-derived Draft readiness, pre-start candidate selection, an
-- idempotent exact-Round-number mapping convenience, and a narrow public-safe
-- shooting-details display projection. Existing mappings remain authoritative.

begin;

create or replace function public.add_concurrent_shooting_group_competition(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_competition_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

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
$$;

create or replace function public.map_matching_concurrent_shooting_round_numbers(
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
$$;

create or replace function public.get_concurrent_shooting_group_lifecycle(
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
$$;

create or replace function public.get_competition_shooting_display(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  competition_record public.competitions%rowtype;
  result jsonb;
begin
  select competition.* into competition_record
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  join public.organisations organisation on organisation.id = season.organisation_id
  where competition.id = p_competition_id
    and competition.league_season_id = p_league_season_id
    and season.organisation_id = p_organisation_id
    and (
      (organisation.status = 'active'
        and season.status in ('open', 'active', 'completed')
        and competition.status = 'published')
      or exists (
        select 1 from public.organisation_staff staff
        where staff.organisation_id = organisation.id
          and staff.user_id = (select auth.uid())
          and staff.role in ('owner', 'manager')
          and staff.status = 'active'
      )
    );
  if not found then
    raise exception 'Competition shooting details are not available.' using errcode = '42501';
  end if;

  if competition_record.shooting_details_version is distinct from 1 then
    return jsonb_build_object(
      'configured', false, 'equipment_name', null, 'components', '[]'::jsonb
    );
  end if;

  select jsonb_build_object(
    'configured', true,
    'equipment_name', coalesce(built_in_equipment.display_name, custom_equipment.display_name),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'component_id', component.id,
        'position_mode', component.shooting_position_mode,
        'position_name', case component.shooting_position_mode
          when 'fixed' then coalesce(built_in_position.display_name, custom_position.display_name)
          when 'variable' then 'Variable'
          when 'not_applicable' then 'Not applicable'
          else null
        end,
        'distance_mode', component.distance_mode,
        'distance_value', component.distance_value,
        'distance_unit', component.distance_unit,
        'shots', component.shots
      ) order by component.position)
      from public.competition_score_components component
      left join public.shooting_positions built_in_position
        on built_in_position.code = component.shooting_position_code
      left join public.organisation_shooting_positions custom_position
        on custom_position.id = component.organisation_shooting_position_id
      where component.competition_id = competition_record.id
    ), '[]'::jsonb)
  ) into result
  from (select competition_record.equipment_type_code code) selected_equipment
  left join public.shooting_equipment_types built_in_equipment
    on built_in_equipment.code = selected_equipment.code
  left join public.organisation_equipment_types custom_equipment
    on custom_equipment.id = competition_record.organisation_equipment_type_id;
  return result;
end;
$$;

comment on function public.map_matching_concurrent_shooting_round_numbers(bigint, bigint) is
  'Idempotently persists exact common Round-number mappings for a Draft while preserving every conflicting manual mapping.';
comment on function public.get_concurrent_shooting_group_lifecycle(bigint, bigint) is
  'Returns server-derived activation and cancellation readiness for an authorised Concurrent Shooting group.';
comment on function public.get_competition_shooting_display(bigint, bigint, bigint) is
  'Returns only safe human-facing equipment and component physical details for public Competitions or contextual Organisation staff.';

revoke execute on function public.add_concurrent_shooting_group_competition(bigint, bigint, bigint),
  public.get_concurrent_shooting_competition_candidates(bigint, bigint),
  public.map_matching_concurrent_shooting_round_numbers(bigint, bigint),
  public.get_concurrent_shooting_group_lifecycle(bigint, bigint)
  from public, anon;
grant execute on function public.add_concurrent_shooting_group_competition(bigint, bigint, bigint),
  public.get_concurrent_shooting_competition_candidates(bigint, bigint),
  public.map_matching_concurrent_shooting_round_numbers(bigint, bigint),
  public.get_concurrent_shooting_group_lifecycle(bigint, bigint)
  to authenticated;

revoke execute on function public.get_competition_shooting_display(bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.get_competition_shooting_display(bigint, bigint, bigint)
  to anon, authenticated;

commit;
