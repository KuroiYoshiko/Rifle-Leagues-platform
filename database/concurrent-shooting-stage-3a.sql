-- Run after database/concurrent-shooting-stage-2.sql.
-- Adds narrow Organisation-management reads and an atomic Draft mapping setter.
-- It does not change Concurrent Shooting scoring, lifecycle, or compatibility rules.

begin;

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
  order by member.competition_id
  limit 1;

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
      'compatible', v_reference is null or jsonb_array_length(mismatch.value) = 0,
      'compatibility_mismatches', mismatch.value,
      'has_course_of_fire', coalesce((signature.value ->> 'component_count')::integer, 0) > 0,
      'selectable', v_group.status = 'draft'
        and competition.status = 'published'
        and coalesce((signature.value ->> 'component_count')::integer, 0) > 0
        and (
          membership.concurrent_shooting_group_id is null
          or membership.concurrent_shooting_group_id = p_concurrent_shooting_group_id
        )
        and (v_reference is null or jsonb_array_length(mismatch.value) = 0)
    ) order by competition.name, competition.id)
    from public.competitions as competition
    left join public.concurrent_shooting_group_competitions as membership
      on membership.competition_id = competition.id
    left join public.concurrent_shooting_groups as existing_group
      on existing_group.id = membership.concurrent_shooting_group_id
    cross join lateral (
      select private.concurrent_shooting_compatibility_signature(competition.id) as value
    ) as signature
    cross join lateral (
      select case when v_reference is null then '[]'::jsonb
        else private.concurrent_shooting_compatibility_mismatches(v_reference, signature.value)
      end as value
    ) as mismatch
    where competition.league_season_id = v_group.league_season_id
  ), '[]'::jsonb);
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
  v_group public.concurrent_shooting_groups%rowtype;
  v_started boolean;
  v_has_provenance boolean;
begin
  v_group := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id
  );
  select exists (
    select 1
    from public.concurrent_shooting_group_competitions as member
    cross join lateral private.get_competition_effective_dates(member.competition_id) as effective
    where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and (effective.effective_starts_at is null or effective.effective_starts_at <= current_date)
  ) into v_started;
  select exists (
    select 1
    from public.shooting_score_sources as source
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = source.concurrent_shooting_round_id
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) or exists (
    select 1
    from public.concurrent_shooting_round_mappings as mapping
    join public.competition_score_usages as usage
      on usage.competition_id = mapping.competition_id
      and usage.competition_round_id = mapping.competition_round_id
    where mapping.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) into v_has_provenance;

  return jsonb_build_object(
    'can_cancel_activation', v_group.status = 'active' and not v_started and not v_has_provenance,
    'cancel_block_reason', case
      when v_group.status <> 'active' then 'not_active'
      when v_started then 'competition_started'
      when v_has_provenance then 'score_provenance'
      else null
    end,
    'has_score_provenance', v_has_provenance
  );
end;
$$;

create or replace function public.get_competition_concurrent_shooting_summary(
  p_organisation_id bigint,
  p_competition_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.set_concurrent_shooting_round_mapping(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_concurrent_shooting_round_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

comment on function public.get_concurrent_shooting_competition_candidates(bigint, bigint) is
  'Returns server-derived same-Season candidate availability and Course-of-Fire mismatch codes for an authorised Concurrent Shooting group.';
comment on function public.get_concurrent_shooting_group_lifecycle(bigint, bigint) is
  'Returns safe cancellation availability and its domain reason for an authorised Concurrent Shooting group.';
comment on function public.get_competition_concurrent_shooting_summary(bigint, bigint) is
  'Returns the Organisation-management Concurrent Shooting indicator for one Competition, or null when independent.';
comment on function public.set_concurrent_shooting_round_mapping(bigint, bigint, bigint, bigint, bigint) is
  'Atomically sets or removes one member Competition mapping for one Draft physical Concurrent Round.';

revoke execute on function public.get_concurrent_shooting_competition_candidates(bigint, bigint),
  public.get_concurrent_shooting_group_lifecycle(bigint, bigint),
  public.get_competition_concurrent_shooting_summary(bigint, bigint),
  public.set_concurrent_shooting_round_mapping(bigint, bigint, bigint, bigint, bigint)
  from public, anon;
grant execute on function public.get_concurrent_shooting_competition_candidates(bigint, bigint),
  public.get_concurrent_shooting_group_lifecycle(bigint, bigint),
  public.get_competition_concurrent_shooting_summary(bigint, bigint),
  public.set_concurrent_shooting_round_mapping(bigint, bigint, bigint, bigint, bigint)
  to authenticated;

commit;
