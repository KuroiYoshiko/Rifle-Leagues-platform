-- Shooter performance analytics over canonical, released physical score data.
-- Run after Competition Shooting Details and the complete Concurrent Shooting
-- migration chain. This migration adds no score storage or cached totals.
begin;

create or replace function public.get_my_shooter_analytics(
  p_season_id bigint default null,
  p_equipment_kind text default null,
  p_equipment_code text default null,
  p_equipment_custom_id bigint default null,
  p_position_mode text default null,
  p_position_code text default null,
  p_position_custom_id bigint default null,
  p_distance_mode text default null,
  p_distance_value numeric default null,
  p_distance_unit text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shooter_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_shooter_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_equipment_kind is null then
    if p_equipment_code is not null or p_equipment_custom_id is not null then
      raise exception 'Equipment filter is incomplete.' using errcode = '22023';
    end if;
  elsif p_equipment_kind = 'builtin' then
    if p_equipment_code is null or p_equipment_custom_id is not null then
      raise exception 'Built-in equipment filter is incomplete.' using errcode = '22023';
    end if;
  elsif p_equipment_kind = 'custom' then
    if p_equipment_code is not null or p_equipment_custom_id is null then
      raise exception 'Custom equipment filter is incomplete.' using errcode = '22023';
    end if;
  elsif p_equipment_kind = 'unspecified' then
    if p_equipment_code is not null or p_equipment_custom_id is not null then
      raise exception 'Unspecified equipment cannot include an identity.' using errcode = '22023';
    end if;
  else
    raise exception 'Choose a valid equipment filter.' using errcode = '22023';
  end if;

  if p_position_mode is null then
    if p_position_code is not null or p_position_custom_id is not null then
      raise exception 'Position/style filter is incomplete.' using errcode = '22023';
    end if;
  elsif p_position_mode = 'fixed' then
    if ((p_position_code is not null)::integer
      + (p_position_custom_id is not null)::integer) <> 1 then
      raise exception 'Fixed position/style needs one identity.' using errcode = '22023';
    end if;
  elsif p_position_mode in ('variable', 'not_applicable', 'unspecified') then
    if p_position_code is not null or p_position_custom_id is not null then
      raise exception 'This position/style state cannot include an identity.' using errcode = '22023';
    end if;
  else
    raise exception 'Choose a valid position/style filter.' using errcode = '22023';
  end if;

  if p_distance_mode is null then
    if p_distance_value is not null or p_distance_unit is not null then
      raise exception 'Distance filter is incomplete.' using errcode = '22023';
    end if;
  elsif p_distance_mode = 'fixed' then
    if p_distance_value is null or p_distance_value <= 0
      or p_distance_unit not in ('metres', 'yards', 'feet') then
      raise exception 'Fixed distance needs a positive value and valid unit.' using errcode = '22023';
    end if;
  elsif p_distance_mode in ('variable', 'not_applicable', 'unspecified') then
    if p_distance_value is not null or p_distance_unit is not null then
      raise exception 'This distance state cannot include a value or unit.' using errcode = '22023';
    end if;
  else
    raise exception 'Choose a valid distance filter.' using errcode = '22023';
  end if;

  with component_configuration as (
    select
      competition.id as competition_id,
      competition.sets_per_round,
      count(component.id)::integer as component_count,
      (competition.sets_per_round * count(component.id))::integer as expected_slot_count
    from public.competitions as competition
    left join public.competition_score_components as component
      on component.competition_id = competition.id
    group by competition.id, competition.sets_per_round
  ), source_recordings as (
    select
      source.id as source_id,
      count(value.id)::integer as recorded_slot_count
    from public.shooting_score_sources as source
    left join public.shooting_score_values as value
      on value.shooting_score_source_id = source.id
    where source.shooter_profile_id = v_shooter_id
    group by source.id
  ), visible_usages as (
    select
      source.id as source_id,
      usage.competition_id,
      usage.competition_round_id,
      competition.name as competition_name,
      competition.sets_per_round,
      competition.uses_x_score,
      competition.shooting_details_version,
      competition.equipment_type_code,
      competition.organisation_equipment_type_id,
      coalesce(equipment.display_name, custom_equipment.display_name) as equipment_label,
      round_row.round_number,
      round_row.deadline as round_end_date,
      season.id as season_id,
      season.name as season_name,
      organisation.name as organisation_name,
      series.name as series_name,
      configuration.component_count,
      configuration.expected_slot_count,
      recording.recorded_slot_count
    from public.shooting_score_sources as source
    join source_recordings as recording on recording.source_id = source.id
    join public.competition_score_usages as usage
      on usage.shooting_score_source_id = source.id
    join public.competitions as competition on competition.id = usage.competition_id
    join public.competition_rounds as round_row
      on round_row.id = usage.competition_round_id
     and round_row.competition_id = competition.id
    join public.competition_entrant_participants as participant
      on participant.id = usage.competition_entrant_participant_id
    join public.club_competition_entries as entry
      on entry.id = participant.club_competition_entry_id
     and entry.competition_id = competition.id
     and entry.status = 'submitted'
    join public.league_seasons as season
      on season.id = competition.league_season_id
    join public.organisations as organisation
      on organisation.id = season.organisation_id
    join component_configuration as configuration
      on configuration.competition_id = competition.id
    left join public.shooting_equipment_types as equipment
      on equipment.code = competition.equipment_type_code
    left join public.organisation_equipment_types as custom_equipment
      on custom_equipment.id = competition.organisation_equipment_type_id
     and custom_equipment.organisation_id = organisation.id
    left join public.competition_series as series
      on series.id = competition.competition_series_id
     and series.organisation_id = organisation.id
    where source.shooter_profile_id = v_shooter_id
      and organisation.status = 'active'
      and season.status in ('open', 'active', 'completed')
      and competition.status = 'published'
      and (statement_timestamp() at time zone 'UTC')::date > round_row.deadline
  ), complete_visible_usages as (
    select *
    from visible_usages
    where component_count > 0
      and recorded_slot_count = expected_slot_count
  ), filtered_visible_usages as (
    select usage.*
    from complete_visible_usages as usage
    where (p_season_id is null or usage.season_id = p_season_id)
      and (
        p_equipment_kind is null
        or (p_equipment_kind = 'builtin'
          and usage.equipment_type_code = p_equipment_code)
        or (p_equipment_kind = 'custom'
          and usage.organisation_equipment_type_id = p_equipment_custom_id)
        or (p_equipment_kind = 'unspecified'
          and usage.equipment_type_code is null
          and usage.organisation_equipment_type_id is null)
      )
      and (
        (p_position_mode is null and p_distance_mode is null)
        or exists (
          select 1
          from public.competition_score_components as component
          where component.competition_id = usage.competition_id
            and (
              p_position_mode is null
              or (p_position_mode = 'fixed'
                and component.shooting_position_mode = 'fixed'
                and component.shooting_position_code is not distinct from p_position_code
                and component.organisation_shooting_position_id is not distinct from p_position_custom_id)
              or (p_position_mode in ('variable', 'not_applicable')
                and component.shooting_position_mode = p_position_mode)
              or (p_position_mode = 'unspecified'
                and component.shooting_position_mode is null)
            )
            and (
              p_distance_mode is null
              or (p_distance_mode = 'fixed'
                and component.distance_mode = 'fixed'
                and component.distance_value = p_distance_value
                and component.distance_unit = p_distance_unit)
              or (p_distance_mode in ('variable', 'not_applicable')
                and component.distance_mode = p_distance_mode)
              or (p_distance_mode = 'unspecified'
                and component.distance_mode is null)
            )
        )
      )
  ), representatives as (
    select distinct on (usage.source_id) usage.*
    from filtered_visible_usages as usage
    order by usage.source_id, usage.round_end_date, usage.competition_id,
      usage.competition_round_id
  ), selected_components as (
    select
      representative.source_id,
      component.position,
      component.short_label,
      component.maximum_score,
      component.score_method,
      component.shooting_position_mode,
      component.shooting_position_code,
      component.organisation_shooting_position_id,
      case component.shooting_position_mode
        when 'fixed' then coalesce(position.display_name, custom_position.display_name)
        when 'variable' then 'Variable position/style'
        when 'not_applicable' then 'Position/style not applicable'
        else 'Position/style unspecified'
      end as position_label,
      component.distance_mode,
      component.distance_value,
      component.distance_unit
    from representatives as representative
    join public.competition_score_components as component
      on component.competition_id = representative.competition_id
    left join public.shooting_positions as position
      on position.code = component.shooting_position_code
    left join public.organisation_shooting_positions as custom_position
      on custom_position.id = component.organisation_shooting_position_id
    where (
        p_position_mode is null
        or (p_position_mode = 'fixed'
          and component.shooting_position_mode = 'fixed'
          and component.shooting_position_code is not distinct from p_position_code
          and component.organisation_shooting_position_id is not distinct from p_position_custom_id)
        or (p_position_mode in ('variable', 'not_applicable')
          and component.shooting_position_mode = p_position_mode)
        or (p_position_mode = 'unspecified'
          and component.shooting_position_mode is null)
      )
      and (
        p_distance_mode is null
        or (p_distance_mode = 'fixed'
          and component.distance_mode = 'fixed'
          and component.distance_value = p_distance_value
          and component.distance_unit = p_distance_unit)
        or (p_distance_mode in ('variable', 'not_applicable')
          and component.distance_mode = p_distance_mode)
        or (p_distance_mode = 'unspecified'
          and component.distance_mode is null)
      )
  ), component_payloads as (
    select source_id, jsonb_agg(jsonb_build_object(
      'label', coalesce(short_label, 'Component ' || position::text),
      'score_method', score_method,
      'position_mode', coalesce(shooting_position_mode, 'unspecified'),
      'position_label', position_label,
      'distance_mode', coalesce(distance_mode, 'unspecified'),
      'distance_value', distance_value,
      'distance_unit', distance_unit
    ) order by position) as components
    from selected_components
    group by source_id
  ), context_payloads as (
    select usage.source_id, jsonb_agg(jsonb_build_object(
      'competition', usage.competition_name,
      'round', 'Round ' || usage.round_number::text,
      'round_end_date', usage.round_end_date,
      'season', usage.season_name,
      'organisation', usage.organisation_name,
      'series', usage.series_name
    ) order by usage.round_end_date, usage.competition_name, usage.round_number) as contexts
    from filtered_visible_usages as usage
    group by usage.source_id
  ), point_values as (
    select
      representative.source_id,
      representative.round_end_date,
      representative.competition_name,
      representative.round_number,
      representative.season_name,
      representative.organisation_name,
      representative.series_name,
      representative.equipment_label,
      representative.uses_x_score,
      sum(value.achieved_score)::numeric(14, 2) as achieved_score,
      sum(component.maximum_score)::numeric(14, 2) as maximum_possible_score,
      case when representative.uses_x_score then sum(value.x_count) end as x_total
    from representatives as representative
    join selected_components as component on component.source_id = representative.source_id
    join public.shooting_score_values as value
      on value.shooting_score_source_id = representative.source_id
     and value.component_position = component.position
    group by representative.source_id, representative.round_end_date,
      representative.competition_name, representative.round_number,
      representative.season_name, representative.organisation_name,
      representative.series_name, representative.equipment_label,
      representative.uses_x_score
  ), points as (
    select
      pg_catalog.md5(v_shooter_id::text || ':' || point.source_id::text) as event_key,
      point.round_end_date,
      point.competition_name,
      'Round ' || point.round_number::text as round_label,
      point.season_name,
      point.organisation_name,
      point.series_name,
      coalesce(point.equipment_label, 'Unspecified equipment') as equipment_label,
      case when p_position_mode is not null or p_distance_mode is not null
        then 'filtered_components' else 'all_components' end as component_scope,
      point.achieved_score,
      point.maximum_possible_score,
      round(point.achieved_score / point.maximum_possible_score * 100, 2) as score_percentage,
      point.x_total,
      component_payload.components,
      context_payload.contexts,
      jsonb_array_length(context_payload.contexts) > 1 as shared
    from point_values as point
    join component_payloads as component_payload using (source_id)
    join context_payloads as context_payload using (source_id)
    where point.maximum_possible_score > 0
  ), numbered_points as (
    select points.*,
      row_number() over (order by round_end_date, event_key)::double precision as event_number
    from points
  ), statistics as (
    select
      count(*)::integer as physical_shoot_count,
      round(avg(score_percentage), 2) as mean_score_percentage,
      max(score_percentage) as best_score_percentage
    from points
  ), trend as (
    select
      count(*)::integer as point_count,
      regr_slope(score_percentage::double precision, event_number) as slope
    from numbered_points
  ), chart_window as (
    select * from points order by round_end_date desc, event_key desc limit 500
  ), recent_window as (
    select * from points order by round_end_date desc, event_key desc limit 20
  ), season_options as (
    select distinct season_id, season_name, organisation_name
    from complete_visible_usages
  ), equipment_options as (
    select distinct
      case
        when equipment_type_code is not null then 'builtin'
        when organisation_equipment_type_id is not null then 'custom'
        else 'unspecified'
      end as kind,
      equipment_type_code as code,
      organisation_equipment_type_id as custom_id,
      coalesce(equipment_label, 'Unspecified (legacy)') as label
    from complete_visible_usages
  ), position_options as (
    select distinct
      coalesce(component.shooting_position_mode, 'unspecified') as mode,
      component.shooting_position_code as code,
      component.organisation_shooting_position_id as custom_id,
      case component.shooting_position_mode
        when 'fixed' then coalesce(position.display_name, custom_position.display_name)
        when 'variable' then 'Variable position/style'
        when 'not_applicable' then 'Position/style not applicable'
        else 'Unspecified (legacy)'
      end as label
    from complete_visible_usages as usage
    join public.competition_score_components as component
      on component.competition_id = usage.competition_id
    left join public.shooting_positions as position
      on position.code = component.shooting_position_code
    left join public.organisation_shooting_positions as custom_position
      on custom_position.id = component.organisation_shooting_position_id
  ), distance_options as (
    select distinct
      coalesce(component.distance_mode, 'unspecified') as mode,
      component.distance_value as value,
      component.distance_unit as unit,
      case component.distance_mode
        when 'fixed' then
          pg_catalog.to_char(component.distance_value, 'FM999999999990.###') || ' ' || case component.distance_unit
            when 'metres' then 'm' when 'yards' then 'yd' when 'feet' then 'ft' end
        when 'variable' then 'Variable distance'
        when 'not_applicable' then 'Distance not applicable'
        else 'Unspecified (legacy)'
      end as label
    from complete_visible_usages as usage
    join public.competition_score_components as component
      on component.competition_id = usage.competition_id
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'physical_shoot_count', statistics.physical_shoot_count,
      'competition_count', (
        select count(distinct competition_id)::integer from filtered_visible_usages
      ),
      'best_score_percentage', statistics.best_score_percentage,
      'recent_score_percentage', (
        select score_percentage from points
        order by round_end_date desc, event_key desc limit 1
      ),
      'mean_score_percentage', statistics.mean_score_percentage,
      'trend_direction', case
        when trend.point_count < 2 then 'unavailable'
        when trend.slope * (trend.point_count - 1) > 0.5 then 'up'
        when trend.slope * (trend.point_count - 1) < -0.5 then 'down'
        else 'steady'
      end,
      'trend_change', case when trend.point_count < 2 then null
        else round((trend.slope * (trend.point_count - 1))::numeric, 2) end
    ),
    'component_scope', case when p_position_mode is not null or p_distance_mode is not null
      then 'filtered_components' else 'all_components' end,
    'chart_truncated', statistics.physical_shoot_count > 500,
    'chart_points', coalesce((select jsonb_agg(to_jsonb(chart_window) - 'source_id'
      order by round_end_date, event_key) from chart_window), '[]'::jsonb),
    'recent_scores', coalesce((select jsonb_agg(to_jsonb(recent_window) - 'source_id'
      order by round_end_date desc, event_key desc) from recent_window), '[]'::jsonb),
    'filter_options', jsonb_build_object(
      'seasons', coalesce((select jsonb_agg(jsonb_build_object(
        'id', season_id, 'label', season_name || ' · ' || organisation_name
      ) order by season_name, organisation_name, season_id) from season_options), '[]'::jsonb),
      'equipment', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', kind, 'code', code, 'custom_id', custom_id, 'label', label
      ) order by label, kind, code, custom_id) from equipment_options), '[]'::jsonb),
      'positions', coalesce((select jsonb_agg(jsonb_build_object(
        'mode', mode, 'code', code, 'custom_id', custom_id, 'label', label
      ) order by label, mode, code, custom_id) from position_options), '[]'::jsonb),
      'distances', coalesce((select jsonb_agg(jsonb_build_object(
        'mode', mode, 'value', value, 'unit', unit, 'label', label
      ) order by mode, value, unit, label) from distance_options), '[]'::jsonb)
    )
  ) into v_result
  from statistics cross join trend;

  return v_result;
end;
$$;

comment on function public.get_my_shooter_analytics(
  bigint, text, text, bigint, text, text, bigint, text, numeric, text
) is
  'Current-shooter analytics over complete canonical achieved scores with released-only Competition usages. Physical trends deduplicate by shooting_score_source; Competition participation remains Competition-specific.';

revoke execute on function public.get_my_shooter_analytics(
  bigint, text, text, bigint, text, text, bigint, text, numeric, text
) from public, anon, authenticated;
grant execute on function public.get_my_shooter_analytics(
  bigint, text, text, bigint, text, text, bigint, text, numeric, text
) to authenticated;

commit;
