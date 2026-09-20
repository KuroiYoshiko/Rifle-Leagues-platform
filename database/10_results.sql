-- Canonical fresh-install schema: results.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

CREATE OR REPLACE FUNCTION private.competition_entrant_label(p_entry_format text, p_position integer, p_club_team_name_snapshot text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_entry_format
    when 'individual' then 'Individual ' || p_position::text
    when 'pairs' then coalesce(nullif(p_club_team_name_snapshot, ''), 'Pair ' || p_position::text)
    else coalesce(nullif(p_club_team_name_snapshot, ''), 'Team ' || p_position::text)
  end
$function$;

CREATE OR REPLACE FUNCTION private.derive_competition_round_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint, p_released_only boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  -- The private function is not executable by API roles. Its one public
  -- wrapper always passes released_only=true; diagnostic/management callers
  -- still require an authenticated identity before unreleased values can be
  -- derived.
  if (select auth.uid()) is null and not p_released_only then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  with component_config as (
    select
      competition.id as competition_id,
      competition.sets_per_round,
      competition.uses_x_score,
      count(component.id)::integer as component_count,
      (
        competition.sets_per_round * count(component.id)
      )::integer as expected_slot_count,
      coalesce(
        competition.sets_per_round * sum(component.maximum_score),
        0::numeric
      ) as shooter_maximum,
      case
        when count(component.id) > 0
          and count(distinct component.score_method) = 1
        then min(component.score_method)
        else 'mixed'
      end as display_scoring_mode
    from public.competitions as competition
    left join public.competition_score_components as component
      on component.competition_id = competition.id
    where competition.id = p_competition_id
    group by competition.id, competition.sets_per_round,
      competition.uses_x_score
  ), submitted_entrants as (
    select
      entry.competition_id,
      entry.id as club_competition_entry_id,
      entrant.id as entrant_id,
      entrant.position as entrant_position,
      (to_jsonb(entrant) ->> 'club_team_id')::bigint as club_team_id,
      to_jsonb(entrant) ->> 'club_team_name_snapshot' as club_team_name_snapshot,
      club.id as club_id,
      club.name as club_name
    from public.club_competition_entries as entry
    join public.competition_entrants as entrant
      on entrant.club_competition_entry_id = entry.id
    join public.clubs as club
      on club.id = entry.club_id
    where entry.competition_id = p_competition_id
      and entry.status = 'submitted'
      and (
        p_club_id is null
        or entry.club_id = p_club_id
      )
  ), entrant_round_base as (
    select
      submitted_entrant.*,
      competition_round.id as round_id,
      competition_round.round_number,
      competition_round.deadline,
      competition_round.shoot_by_date
    from submitted_entrants as submitted_entrant
    cross join public.competition_rounds as competition_round
    where competition_round.competition_id = p_competition_id
  ), participant_base as (
    select
      entrant_round.*,
      participant.id as participant_id,
      participant.slot_number,
      membership.user_id as shooter_profile_id,
      profile.first_name,
      profile.last_name,
      usage.shooting_score_source_id
    from entrant_round_base as entrant_round
    join public.competition_entrant_participants as participant
      on participant.competition_entrant_id = entrant_round.entrant_id
     and participant.club_competition_entry_id =
       entrant_round.club_competition_entry_id
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
    join public.profiles as profile
      on profile.id = membership.user_id
    left join public.competition_score_usages as usage
      on usage.competition_id = entrant_round.competition_id
     and usage.competition_round_id = entrant_round.round_id
     and usage.competition_entrant_participant_id = participant.id
     -- Gate the source join, not just displayed totals: partial slots and X
     -- values must never enter the ordinary Results projection before release.
     and (not p_released_only or
       (statement_timestamp() at time zone 'UTC')::date > entrant_round.deadline)
  ), participant_aggregates as (
    select
      participant.*,
      config.component_count,
      config.expected_slot_count,
      config.shooter_maximum,
      config.display_scoring_mode,
      config.uses_x_score,
      slot_values.recorded_slot_count,
      slot_values.recorded_achieved_score,
      slot_values.recorded_x_total,
      slot_values.component_values,
      (
        config.component_count > 0
        and slot_values.recorded_slot_count = config.expected_slot_count
      ) as is_complete
    from participant_base as participant
    cross join component_config as config
    cross join lateral (
      select
        count(score_value.id)::integer as recorded_slot_count,
        sum(score_value.achieved_score) as recorded_achieved_score,
        sum(score_value.x_count) as recorded_x_total,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'set_number', set_slot.set_number,
              'component_position', component.position,
              'short_label', component.short_label,
              'score_method', component.score_method,
              'maximum_possible_score', component.maximum_score,
              'is_present', score_value.id is not null,
              'achieved_score', score_value.achieved_score,
              'display_score', case
                when score_value.id is null then null
                when component.score_method = 'points_dropped'
                  then component.maximum_score - score_value.achieved_score
                else score_value.achieved_score
              end
            ) || case
              when config.uses_x_score
                then jsonb_build_object('x_count', score_value.x_count)
              else '{}'::jsonb
            end
            order by set_slot.set_number, component.position
          ) filter (where component.id is not null),
          '[]'::jsonb
        ) as component_values
      from generate_series(1, config.sets_per_round)
        as set_slot(set_number)
      cross join public.competition_score_components as component
      left join public.shooting_score_values as score_value
        on score_value.shooting_score_source_id =
          participant.shooting_score_source_id
       and score_value.set_number = set_slot.set_number
       and score_value.component_position = component.position
      where component.competition_id = p_competition_id
    ) as slot_values
  ), participant_results as (
    select
      participant.*,
      case when participant.is_complete
        then participant.recorded_achieved_score
      end as achieved_score,
      case
        when not participant.is_complete then null
        when participant.display_scoring_mode = 'points_dropped'
          then participant.shooter_maximum
            - participant.recorded_achieved_score
        when participant.display_scoring_mode = 'points_scored'
          then participant.recorded_achieved_score
      end as display_score,
      case when participant.is_complete
        then participant.recorded_x_total
      end as x_total
    from participant_aggregates as participant
  ), entrant_aggregates as (
    select
      entrant_round.competition_id,
      entrant_round.round_id,
      entrant_round.round_number,
      entrant_round.deadline,
      entrant_round.shoot_by_date,
      entrant_round.club_competition_entry_id,
      entrant_round.entrant_id,
      entrant_round.entrant_position,
      entrant_round.club_team_id,
      entrant_round.club_team_name_snapshot,
      entrant_round.club_id,
      entrant_round.club_name,
      competition.entry_format,
      competition.team_size as expected_participant_count,
      config.uses_x_score,
      config.display_scoring_mode,
      (
        competition.team_size * config.shooter_maximum
      ) as maximum_possible_score,
      count(participant.participant_id)::integer as participant_count,
      coalesce(
        count(participant.participant_id) = competition.team_size
        and bool_and(participant.is_complete),
        false
      ) as is_complete,
      sum(participant.achieved_score) as participant_achieved_total,
      sum(participant.x_total) as participant_x_total,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'participant_id', participant.participant_id,
            'shooter_profile_id', participant.shooter_profile_id,
            'slot_number', participant.slot_number,
            'first_name', participant.first_name,
            'last_name', participant.last_name,
            'completeness', case when participant.is_complete
              then 'complete' else 'incomplete' end,
            'recorded_slot_count', participant.recorded_slot_count,
            'expected_slot_count', participant.expected_slot_count,
            'achieved_score', participant.achieved_score,
            'maximum_possible_score', participant.shooter_maximum,
            'display_score', participant.display_score,
            'display_scoring_mode', participant.display_scoring_mode,
            'component_values', participant.component_values
          ) || case
            when config.uses_x_score
              then jsonb_build_object('x_total', participant.x_total)
            else '{}'::jsonb
          end
          order by participant.slot_number, participant.participant_id
        ) filter (where participant.participant_id is not null),
        '[]'::jsonb
      ) as participants
    from entrant_round_base as entrant_round
    join public.competitions as competition
      on competition.id = entrant_round.competition_id
    cross join component_config as config
    left join participant_results as participant
      on participant.entrant_id = entrant_round.entrant_id
     and participant.round_id = entrant_round.round_id
    group by
      entrant_round.competition_id,
      entrant_round.round_id,
      entrant_round.round_number,
      entrant_round.deadline,
      entrant_round.shoot_by_date,
      entrant_round.club_competition_entry_id,
      entrant_round.entrant_id,
      entrant_round.entrant_position,
      entrant_round.club_team_id,
      entrant_round.club_team_name_snapshot,
      entrant_round.club_id,
      entrant_round.club_name,
      competition.entry_format,
      competition.team_size,
      config.uses_x_score,
      config.display_scoring_mode,
      config.shooter_maximum
  ), entrant_results as (
    select
      entrant.*,
      case when entrant.is_complete
        then entrant.participant_achieved_total
      end as achieved_score,
      case
        when not entrant.is_complete then null
        when entrant.display_scoring_mode = 'points_dropped'
          then entrant.maximum_possible_score
            - entrant.participant_achieved_total
        when entrant.display_scoring_mode = 'points_scored'
          then entrant.participant_achieved_total
      end as display_score,
      case when entrant.is_complete
        then entrant.participant_x_total
      end as x_total,
      division_assignment.division
    from entrant_aggregates as entrant
    left join lateral (
      select jsonb_build_object(
        'id', division.id,
        'name', division.name,
        'position', division.position
      ) as division
      from public.competition_division_configs as division_config
      join public.competition_division_assignments as assignment
        on assignment.competition_id = division_config.competition_id
       and assignment.competition_entrant_id = entrant.entrant_id
      join public.competition_divisions as division
        on division.id = assignment.competition_division_id
       and division.competition_id = assignment.competition_id
      where division_config.competition_id = entrant.competition_id
        and division_config.status = 'published'
    ) as division_assignment on true
  )
  select jsonb_build_object(
    'access_scope', case when p_club_id is null then 'organisation' else 'club' end,
    'scoped_club_id', p_club_id,
    'competition', jsonb_build_object(
      'id', competition.id,
      'name', competition.name,
      'slug', competition.slug,
      'entry_format', competition.entry_format,
      'team_size', competition.team_size,
      'sets_per_round', competition.sets_per_round,
      'uses_x_score', competition.uses_x_score,
      'ranking_method', competition.ranking_method,
      'best_rounds_count', competition.best_rounds_count,
      'display_scoring_mode', config.display_scoring_mode,
      'shooter_maximum_possible_score', config.shooter_maximum,
      'expected_score_slots_per_shooter', config.expected_slot_count,
      'divisions_published', exists (
        select 1
        from public.competition_division_configs as division_config
        where division_config.competition_id = competition.id
          and division_config.status = 'published'
      )
    ),
    'components', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position', component.position,
          'short_label', component.short_label,
          'maximum_score', component.maximum_score,
          'score_method', component.score_method
        ) order by component.position
      )
      from public.competition_score_components as component
      where component.competition_id = competition.id
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', competition_round.id,
          'round_number', competition_round.round_number,
          'deadline', competition_round.deadline,
          'shoot_by_date', competition_round.shoot_by_date,
          'entrants', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'entrant_id', entrant.entrant_id,
                'entrant_format', entrant.entry_format,
                'entrant_label', private.competition_entrant_label(
                  entrant.entry_format,
                  entrant.entrant_position,
                  entrant.club_team_name_snapshot
                ),
                'entrant_position', entrant.entrant_position,
                'club_team_id', entrant.club_team_id,
                'club_team_name_snapshot', entrant.club_team_name_snapshot,
                'club_id', entrant.club_id,
                'club_name', entrant.club_name,
                'division', entrant.division,
                'participant_count', entrant.participant_count,
                'expected_participant_count', entrant.expected_participant_count,
                'completeness', case when entrant.is_complete
                  then 'complete' else 'incomplete' end,
                'achieved_score', entrant.achieved_score,
                'maximum_possible_score', entrant.maximum_possible_score,
                'display_score', entrant.display_score,
                'display_scoring_mode', entrant.display_scoring_mode,
                'participants', entrant.participants
              ) || case
                when entrant.uses_x_score
                  then jsonb_build_object('x_total', entrant.x_total)
                else '{}'::jsonb
              end
              order by
                (entrant.division ->> 'position')::integer nulls last,
                entrant.club_name,
                entrant.entrant_position,
                entrant.entrant_id
            )
            from entrant_results as entrant
            where entrant.round_id = competition_round.id
          ), '[]'::jsonb)
        ) order by competition_round.round_number
      )
      from public.competition_rounds as competition_round
      where competition_round.competition_id = competition.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.competitions as competition
  cross join component_config as config
  where competition.id = p_competition_id
    and competition.league_season_id = p_league_season_id;

  if v_result is null then
    raise exception 'Competition result context was not found.'
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.require_competition_results_context(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(actor_id uuid, access_scope text, scoped_club_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_context_found boolean := false;
  v_authorised boolean := false;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select true
  into v_context_found
  from public.organisations as organisation
  join public.league_seasons as season
    on season.organisation_id = organisation.id
  join public.competitions as competition
    on competition.league_season_id = season.id
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
    and season.id = p_league_season_id
    and season.status in ('open', 'active', 'completed')
    and competition.id = p_competition_id
    and competition.status = 'published';

  if not coalesce(v_context_found, false) then
    raise exception 'Published Competition result context was not found.'
      using errcode = 'P0002';
  end if;

  if p_club_id is null then
    select exists (
      select 1
      from public.organisation_staff as staff
      where staff.organisation_id = p_organisation_id
        and staff.user_id = v_actor_id
        and staff.status = 'active'
        and staff.role in ('owner', 'manager')
    ) into v_authorised;

    if not v_authorised then
      raise exception 'Only an active organisation owner or manager may inspect all Competition results.'
        using errcode = '42501';
    end if;

    return query select v_actor_id, 'organisation'::text, null::bigint;
    return;
  end if;

  select exists (
    select 1
    from public.club_memberships as membership
    join public.clubs as club
      on club.id = membership.club_id
    join public.club_competition_entries as entry
      on entry.club_id = club.id
    where membership.user_id = v_actor_id
      and membership.club_id = p_club_id
      and membership.status = 'active'
      and membership.role in ('owner', 'official')
      and club.status = 'active'
      and entry.competition_id = p_competition_id
      and entry.status = 'submitted'
  ) into v_authorised;

  if not v_authorised then
    raise exception 'Only an active owner or official of this submitted club entry may inspect its Competition results.'
      using errcode = '42501';
  end if;

  return query select v_actor_id, 'club'::text, p_club_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_aggregate_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_competition record;
  v_division_status text;
  v_derived jsonb;
  v_scoring_mode text;
  v_result jsonb;
begin
  select competition.* into v_competition
  from public.competitions as competition
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  where competition.id = p_competition_id
    and season.id = p_league_season_id
    and organisation.id = p_organisation_id
    and organisation.status = 'active'
    and season.status in ('open', 'active', 'completed')
    and competition.status = 'published';

  if not found then
    raise exception 'Published Competition result context was not found.' using errcode = 'P0002';
  end if;
  if v_competition.ranking_method <> 'aggregate' then
    raise exception 'Aggregate results require Aggregate ranking.' using errcode = '22023';
  end if;

  select config.status into v_division_status
  from public.competition_division_configs as config
  where config.competition_id = p_competition_id;

  -- A draft is not a divisionless competition. Also fail closed if a published
  -- allocation no longer covers every submitted entrant; never mix divisions.
  if v_division_status is not null and (
    v_division_status <> 'published' or exists (
      select 1
      from public.competition_entrants as entrant
      join public.club_competition_entries as entry on entry.id = entrant.club_competition_entry_id
      where entry.competition_id = p_competition_id and entry.status = 'submitted'
        and not exists (
          select 1
          from public.competition_division_assignments as assignment
          join public.competition_divisions as division
            on division.id = assignment.competition_division_id
           and division.competition_id = assignment.competition_id
          where assignment.competition_id = p_competition_id
            and assignment.competition_entrant_id = entrant.id
        )
    )
  ) then
    return jsonb_build_object('status', 'awaiting_divisions', 'rounds', '[]'::jsonb, 'groups', '[]'::jsonb);
  end if;

  v_derived := private.derive_competition_round_results(
    p_organisation_id, p_league_season_id, p_competition_id, null, true
  );
  -- The shared Course of Fire model resolves this from ALL score components,
  -- not the competition's legacy single scoring_method field.
  v_scoring_mode := v_derived #>> '{competition,display_scoring_mode}';

  with rounds as (
    select round_data.*,
      (statement_timestamp() at time zone 'UTC')::date > round_data.deadline as released
    from jsonb_to_recordset(v_derived -> 'rounds') as round_data(
      id bigint, round_number integer, deadline date, entrants jsonb
    )
  ), cells as (
    select round.id as round_id, round.round_number, round.released,
      entrant.*,
      coalesce((entrant.division ->> 'id')::bigint, 0) as division_key,
      round.released and entrant.completeness = 'complete' as scored
    from rounds as round
    cross join lateral jsonb_to_recordset(round.entrants) as entrant(
      entrant_id bigint, entrant_format text, entrant_label text,
      entrant_position integer, club_name text, division jsonb,
      completeness text, achieved_score numeric,
      maximum_possible_score numeric, x_total numeric, participants jsonb
    )
  ), gun_results as (
    select cells.*,
      -- Derive the sporting value from canonical totals once. Round placement,
      -- cells, and overall totals must use this same value, not display_score.
      -- 397/400 achieved => 3 dropped; 396/400 => 4 dropped (lower is better).
      -- Preserve the existing normalized-achieved behavior for mixed courses;
      -- this does not introduce a mixed-method scoring rule.
      case when scored then
        case when v_scoring_mode = 'points_dropped'
          then maximum_possible_score - achieved_score
          else achieved_score end
      end as gun_score
    from cells
  ), placements as (
    select gun_results.*,
      count(*) over (partition by division_key, round_id) as entrant_count,
      -- Competition rank: 1,1,3. IDs do not break sporting ties.
      rank() over (
        partition by division_key, round_id
        order by scored desc,
          case when v_scoring_mode = 'points_dropped' then gun_score end asc nulls last,
          case when v_scoring_mode <> 'points_dropped' then gun_score end desc nulls last,
          case when v_competition.uses_x_score then x_total end desc nulls last
      ) as round_place
    from gun_results
  ), points as (
    select placements.*,
      case when scored then entrant_count - round_place + 1
        when released then 0 end as ranking_points
    from placements
  ), totals as (
    select entrant_id, division_key,
      coalesce(sum(ranking_points), 0) as total_points,
      count(*) filter (where scored) as scored_rounds,
      sum(achieved_score) filter (where scored) as achieved_total,
      sum(maximum_possible_score) filter (where scored) as maximum_total,
      sum(gun_score) filter (where scored) as gun_total,
      sum(x_total) filter (where scored) as x_total,
      jsonb_agg(
        jsonb_build_object(
          'round_id', round_id,
          'state', case when not released then 'pending' when scored then 'scored' else 'nsr' end,
          'gun_score', gun_score,
          'ranking_points', ranking_points
        ) || case when v_competition.uses_x_score then
          jsonb_build_object('x_total', case when scored then x_total end)
          else '{}'::jsonb end
        order by round_number
      ) as rounds
    from points
    group by entrant_id, division_key
  ), ordered_totals as (
    select totals.*,
      -- Dropped totals compare low-to-high even when scored-round counts differ.
      -- Mixed courses compare normalized achieved totals, not incompatible UI values.
      case when v_scoring_mode = 'points_dropped'
        then -gun_total else gun_total end as gun_order
    from totals
  ), standings as (
    select ordered_totals.*,
      rank() over (
        partition by division_key
        order by total_points desc, gun_order desc nulls last,
          case when v_competition.uses_x_score then x_total end desc nulls last
      ) as position,
      count(*) over (
        partition by division_key, total_points, gun_order,
          case when v_competition.uses_x_score then x_total end
      ) > 1 as tied
    from ordered_totals
  ), entrant_names as (
    select distinct on (entrant_id) entrant_id, entrant_format, entrant_label,
      club_name, participants
    from cells order by entrant_id, round_number
  ), participant_cells as (
    select
      cells.entrant_id,
      cells.round_id,
      cells.round_number,
      cells.released,
      (participant ->> 'slot_number')::integer as slot_number,
      participant ->> 'first_name' as first_name,
      participant ->> 'last_name' as last_name,
      case
        when not cells.released then 'pending'
        when participant ->> 'completeness' = 'complete' then 'scored'
        else 'nsr'
      end as state,
      case
        when cells.released
          and participant ->> 'completeness' = 'complete'
        then case
          -- The private derivation already supplies the configured participant
          -- display result. Mixed retains Aggregate's existing achieved-total
          -- presentation without introducing a new mixed scoring rule.
          when v_scoring_mode = 'mixed'
            then (participant ->> 'achieved_score')::numeric
          else (participant ->> 'display_score')::numeric
        end
      end as gun_score,
      case
        when cells.released
          and participant ->> 'completeness' = 'complete'
        then (participant ->> 'x_total')::numeric
      end as x_total
    from cells
    cross join lateral jsonb_array_elements(cells.participants) as participant
  ), participant_totals as (
    select
      entrant_id,
      slot_number,
      first_name,
      last_name,
      sum(gun_score) filter (where state = 'scored') as gun_total,
      sum(x_total) filter (where state = 'scored') as x_total,
      jsonb_agg(
        jsonb_build_object(
          'round_id', round_id,
          'state', state,
          'gun_score', gun_score
        ) || case when v_competition.uses_x_score then
          jsonb_build_object('x_total', x_total)
          else '{}'::jsonb end
        order by round_number
      ) as rounds
    from participant_cells
    group by entrant_id, slot_number, first_name, last_name
  ), participant_payloads as (
    select entrant_id,
      jsonb_agg(
        jsonb_build_object(
          'first_name', first_name,
          'last_name', last_name,
          'slot_number', slot_number,
          'gun_total', gun_total,
          'rounds', rounds
        ) || case when v_competition.uses_x_score then
          jsonb_build_object('x_total', x_total)
          else '{}'::jsonb end
        order by slot_number
      ) as participants
    from participant_totals
    group by entrant_id
  ), groups as (
    select division.id as division_key, division.name, division.position
    from public.competition_divisions as division
    where division.competition_id = p_competition_id and v_division_status = 'published'
    union all
    select 0::bigint, 'Competition results'::text, 0 where v_division_status is null
  )
  select jsonb_build_object(
    'status', 'ready',
    'display_scoring_mode', v_scoring_mode,
    'uses_x_score', v_competition.uses_x_score,
    'released_round_count', (select count(*) from rounds where released),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'round_number', round_number, 'deadline', deadline, 'released', released
    ) order by round_number) from rounds), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'id', division_key, 'name', name,
      'entrants', coalesce((select jsonb_agg(jsonb_build_object(
        'entrant_id', standings.entrant_id,
        'entrant_format', names.entrant_format,
        'entrant_label', names.entrant_label,
        'club_name', names.club_name,
        -- Individuals retain the names-only shape. Pair/Team participant values
        -- are complete, released derived results only: no IDs, contacts, source
        -- rows, components, or partial values cross this public read boundary.
        'participants', case when names.entrant_format = 'individual' then
          (select coalesce(jsonb_agg(jsonb_build_object(
            'first_name', participant -> 'first_name',
            'last_name', participant -> 'last_name',
            'slot_number', participant -> 'slot_number'
          ) order by (participant ->> 'slot_number')::integer), '[]'::jsonb)
            from jsonb_array_elements(names.participants) as participant)
          else coalesce((select payload.participants
            from participant_payloads as payload
            where payload.entrant_id = standings.entrant_id), '[]'::jsonb)
        end,
        'position', standings.position, 'tied', standings.tied,
        'total_points', standings.total_points,
        'scored_rounds', standings.scored_rounds,
        'achieved_total', standings.achieved_total,
        'maximum_total', standings.maximum_total,
        'gun_total', standings.gun_total,
        'rounds', standings.rounds
      ) || case when v_competition.uses_x_score then jsonb_build_object('x_total', standings.x_total)
        else '{}'::jsonb end
      order by standings.position, standings.entrant_id)
      from standings join entrant_names as names using (entrant_id)
      where standings.division_key = groups.division_key), '[]'::jsonb)
    ) order by position, division_key) from groups), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_best_n_average_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_competition record;
  v_division_status text;
  v_derived jsonb;
  v_scoring_mode text;
  v_result jsonb;
begin
  select competition.* into v_competition
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
    and competition.status = 'published';

  if not found then
    raise exception 'Published Competition result context was not found.'
      using errcode = 'P0002';
  end if;
  if v_competition.ranking_method <> 'best_n_average' then
    raise exception 'Best N Average results require Best N Average ranking.'
      using errcode = '22023';
  end if;
  if v_competition.best_rounds_count is null then
    raise exception 'Best N Average results require a configured best rounds count.'
      using errcode = '22023';
  end if;

  select config.status into v_division_status
  from public.competition_division_configs as config
  where config.competition_id = p_competition_id;

  -- A draft allocation is not divisionless. Published allocations fail closed
  -- if they no longer cover the complete submitted roster.
  if v_division_status is not null and (
    v_division_status <> 'published' or exists (
      select 1
      from public.competition_entrants as entrant
      join public.club_competition_entries as entry
        on entry.id = entrant.club_competition_entry_id
      where entry.competition_id = p_competition_id
        and entry.status = 'submitted'
        and not exists (
          select 1
          from public.competition_division_assignments as assignment
          join public.competition_divisions as division
            on division.id = assignment.competition_division_id
           and division.competition_id = assignment.competition_id
          where assignment.competition_id = p_competition_id
            and assignment.competition_entrant_id = entrant.id
        )
    )
  ) then
    return jsonb_build_object(
      'status', 'awaiting_divisions',
      'rounds', '[]'::jsonb,
      'groups', '[]'::jsonb
    );
  end if;

  v_derived := private.derive_competition_round_results(
    p_organisation_id,
    p_league_season_id,
    p_competition_id,
    null,
    true
  );
  v_scoring_mode := v_derived #>> '{competition,display_scoring_mode}';

  with rounds as (
    select round_data.*,
      (statement_timestamp() at time zone 'UTC')::date > round_data.deadline as released
    from jsonb_to_recordset(v_derived -> 'rounds') as round_data(
      id bigint, round_number integer, deadline date, entrants jsonb
    )
  ), cells as (
    select round.id as round_id, round.round_number, round.released,
      entrant.*,
      coalesce((entrant.division ->> 'id')::bigint, 0) as division_key,
      round.released and entrant.completeness = 'complete' as scored
    from rounds as round
    cross join lateral jsonb_to_recordset(round.entrants) as entrant(
      entrant_id bigint, entrant_format text, entrant_label text,
      entrant_position integer, club_name text, division jsonb,
      completeness text, achieved_score numeric,
      maximum_possible_score numeric, participants jsonb
    )
  ), ranked_cells as (
    select cells.*,
      case when scored then row_number() over (
        partition by division_key, entrant_id
        order by achieved_score desc nulls last, round_number, round_id
      ) end as best_round_rank
    from cells
  ), totals as (
    select entrant_id, division_key,
      count(*) filter (where scored) as scored_rounds,
      count(*) filter (where released and not scored) as nsr_rounds,
      count(*) filter (
        where scored and best_round_rank <= v_competition.best_rounds_count
      ) as counted_rounds,
      avg(achieved_score) filter (
        where scored and best_round_rank <= v_competition.best_rounds_count
      ) as qualifying_average,
      jsonb_agg(
        jsonb_build_object(
          'round_id', round_id,
          'state', case
            when not released then 'pending'
            when scored then 'scored'
            else 'nsr'
          end,
          'gun_score', case when scored then achieved_score end,
          'counts_towards_average', scored
            and best_round_rank <= v_competition.best_rounds_count
        ) order by round_number
      ) as rounds
    from ranked_cells
    group by entrant_id, division_key
  ), eligibility as (
    select totals.*,
      least(
        v_competition.best_rounds_count,
        (select count(*)::integer from rounds where released)
      ) as required_complete_results,
      scored_rounds >= least(
        v_competition.best_rounds_count,
        (select count(*)::integer from rounds where released)
      ) as ranking_eligible
    from totals
  ), standings as (
    select eligibility.*,
      case when ranking_eligible then rank() over (
        partition by division_key, ranking_eligible
        order by qualifying_average desc nulls last
      ) end as position,
      case when ranking_eligible then count(*) over (
        partition by division_key, ranking_eligible, qualifying_average
      ) > 1 else false end as tied
    from eligibility
  ), entrant_names as (
    select distinct on (entrant_id)
      entrant_id, entrant_format, entrant_label, club_name, participants
    from cells
    order by entrant_id, round_number
  ), participant_cells as (
    select cells.entrant_id, cells.round_id, cells.round_number, cells.released,
      (participant ->> 'slot_number')::integer as slot_number,
      participant ->> 'first_name' as first_name,
      participant ->> 'last_name' as last_name,
      case
        when not cells.released then 'pending'
        when participant ->> 'completeness' = 'complete' then 'scored'
        else 'nsr'
      end as state,
      case
        when cells.released and participant ->> 'completeness' = 'complete'
          then (participant ->> 'achieved_score')::numeric
      end as achieved_score
    from cells
    cross join lateral jsonb_array_elements(cells.participants) as participant
  ), participant_totals as (
    select entrant_id, slot_number, first_name, last_name,
      sum(achieved_score) filter (where state = 'scored') as gun_total,
      jsonb_agg(jsonb_build_object(
        'round_id', round_id,
        'state', state,
        'gun_score', achieved_score
      ) order by round_number) as rounds
    from participant_cells
    group by entrant_id, slot_number, first_name, last_name
  ), participant_payloads as (
    select entrant_id, jsonb_agg(jsonb_build_object(
      'first_name', first_name,
      'last_name', last_name,
      'slot_number', slot_number,
      'gun_total', gun_total,
      'rounds', rounds
    ) order by slot_number) as participants
    from participant_totals
    group by entrant_id
  ), groups as (
    select division.id as division_key, division.name, division.position
    from public.competition_divisions as division
    where division.competition_id = p_competition_id
      and v_division_status = 'published'
    union all
    select 0::bigint, 'Competition results'::text, 0
    where v_division_status is null
  )
  select jsonb_build_object(
    'status', 'ready',
    'display_scoring_mode', v_scoring_mode,
    'uses_x_score', false,
    'best_rounds_count', v_competition.best_rounds_count,
    'released_round_count', (select count(*) from rounds where released),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'round_number', round_number, 'deadline', deadline, 'released', released
    ) order by round_number) from rounds), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
      'id', division_key,
      'name', name,
      'entrants', coalesce((select jsonb_agg(jsonb_build_object(
        'entrant_id', standings.entrant_id,
        'entrant_format', names.entrant_format,
        'entrant_label', names.entrant_label,
        'club_name', names.club_name,
        'participants', case when names.entrant_format = 'individual' then
          (select coalesce(jsonb_agg(jsonb_build_object(
            'first_name', participant -> 'first_name',
            'last_name', participant -> 'last_name',
            'slot_number', participant -> 'slot_number'
          ) order by (participant ->> 'slot_number')::integer), '[]'::jsonb)
            from jsonb_array_elements(names.participants) as participant)
          else coalesce((select payload.participants
            from participant_payloads as payload
            where payload.entrant_id = standings.entrant_id), '[]'::jsonb)
        end,
        'position', standings.position,
        'tied', standings.tied,
        'ranking_eligible', standings.ranking_eligible,
        'required_complete_results', standings.required_complete_results,
        'scored_rounds', standings.scored_rounds,
        'nsr_rounds', standings.nsr_rounds,
        'counted_rounds', standings.counted_rounds,
        'qualifying_average', standings.qualifying_average,
        'rounds', standings.rounds
      ) order by standings.ranking_eligible desc, standings.position nulls last,
        standings.qualifying_average desc nulls last, standings.entrant_id)
      from standings
      join entrant_names as names using (entrant_id)
      where standings.division_key = groups.division_key), '[]'::jsonb)
    ) order by position, division_key) from groups), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_gun_score_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_competition record;
  v_division_status text;
  v_derived jsonb;
  v_scoring_mode text;
  v_result jsonb;
begin
  select competition.* into v_competition
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
    and competition.status = 'published';

  if not found then
    raise exception 'Published Competition result context was not found.'
      using errcode = 'P0002';
  end if;

  if v_competition.ranking_method <> 'gun_score' then
    raise exception 'Gun Score results require Gun Score ranking.'
      using errcode = '22023';
  end if;

  select config.status into v_division_status
  from public.competition_division_configs as config
  where config.competition_id = p_competition_id;

  -- Draft allocations are not divisionless. Published allocations also fail
  -- closed when any submitted entrant is unassigned, matching Aggregate Results.
  if v_division_status is not null and (
    v_division_status <> 'published' or exists (
      select 1
      from public.competition_entrants as entrant
      join public.club_competition_entries as entry
        on entry.id = entrant.club_competition_entry_id
      where entry.competition_id = p_competition_id
        and entry.status = 'submitted'
        and not exists (
          select 1
          from public.competition_division_assignments as assignment
          join public.competition_divisions as division
            on division.id = assignment.competition_division_id
           and division.competition_id = assignment.competition_id
          where assignment.competition_id = p_competition_id
            and assignment.competition_entrant_id = entrant.id
        )
    )
  ) then
    return jsonb_build_object(
      'status', 'awaiting_divisions',
      'rounds', '[]'::jsonb,
      'groups', '[]'::jsonb
    );
  end if;

  v_derived := private.derive_competition_round_results(
    p_organisation_id,
    p_league_season_id,
    p_competition_id,
    null,
    true
  );
  v_scoring_mode := v_derived #>> '{competition,display_scoring_mode}';

  with rounds as (
    select
      round_data.*,
      (statement_timestamp() at time zone 'UTC')::date
        > round_data.deadline as released
    from jsonb_to_recordset(v_derived -> 'rounds') as round_data(
      id bigint,
      round_number integer,
      deadline date,
      entrants jsonb
    )
  ), cells as (
    select
      round.id as round_id,
      round.round_number,
      round.released,
      entrant.*,
      coalesce((entrant.division ->> 'id')::bigint, 0) as division_key,
      round.released and entrant.completeness = 'complete' as scored
    from rounds as round
    cross join lateral jsonb_to_recordset(round.entrants) as entrant(
      entrant_id bigint,
      entrant_format text,
      entrant_label text,
      entrant_position integer,
      club_name text,
      division jsonb,
      completeness text,
      achieved_score numeric,
      maximum_possible_score numeric,
      x_total numeric,
      participants jsonb
    )
  ), gun_results as (
    select
      cells.*,
      case when scored then
        case when v_scoring_mode = 'points_dropped'
          then maximum_possible_score - achieved_score
          else achieved_score
        end
      end as gun_score
    from cells
  ), totals as (
    select
      entrant_id,
      division_key,
      count(*) filter (where scored) as scored_rounds,
      count(*) filter (where released and not scored) as nsr_rounds,
      sum(achieved_score) filter (where scored) as achieved_total,
      sum(maximum_possible_score) filter (where scored) as maximum_total,
      sum(gun_score) filter (where scored) as gun_total,
      sum(x_total) filter (where scored) as x_total,
      jsonb_agg(
        jsonb_build_object(
          'round_id', round_id,
          'state', case
            when not released then 'pending'
            when scored then 'scored'
            else 'nsr'
          end,
          'gun_score', gun_score
        ) || case when v_competition.uses_x_score then
          jsonb_build_object('x_total', case when scored then x_total end)
          else '{}'::jsonb
        end
        order by round_number
      ) as rounds
    from gun_results
    group by entrant_id, division_key
  ), standings as (
    select
      totals.*,
      -- Only complete released results form the primary total. A null total
      -- (no returned score yet) sorts after every real total. The number of
      -- scored Rounds is descriptive and is not an invented tie-break.
      rank() over (
        partition by division_key
        order by
          (gun_total is not null) desc,
          case when v_scoring_mode = 'points_dropped'
            then gun_total end asc nulls last,
          case when v_scoring_mode <> 'points_dropped'
            then gun_total end desc nulls last,
          case when v_competition.uses_x_score
            then x_total end desc nulls last
      ) as position,
      count(*) over (
        partition by
          division_key,
          gun_total,
          case when v_competition.uses_x_score then x_total end
      ) > 1 as tied
    from totals
  ), entrant_names as (
    select distinct on (entrant_id)
      entrant_id,
      entrant_format,
      entrant_label,
      club_name,
      participants
    from cells
    order by entrant_id, round_number
  ), participant_cells as (
    select
      cells.entrant_id,
      cells.round_id,
      cells.round_number,
      cells.released,
      (participant ->> 'slot_number')::integer as slot_number,
      participant ->> 'first_name' as first_name,
      participant ->> 'last_name' as last_name,
      case
        when not cells.released then 'pending'
        when participant ->> 'completeness' = 'complete' then 'scored'
        else 'nsr'
      end as state,
      case
        when cells.released
          and participant ->> 'completeness' = 'complete'
        then case
          when v_scoring_mode = 'mixed'
            then (participant ->> 'achieved_score')::numeric
          else (participant ->> 'display_score')::numeric
        end
      end as gun_score,
      case
        when cells.released
          and participant ->> 'completeness' = 'complete'
        then (participant ->> 'x_total')::numeric
      end as x_total
    from cells
    cross join lateral jsonb_array_elements(cells.participants) as participant
  ), participant_totals as (
    select
      entrant_id,
      slot_number,
      first_name,
      last_name,
      sum(gun_score) filter (where state = 'scored') as gun_total,
      sum(x_total) filter (where state = 'scored') as x_total,
      jsonb_agg(
        jsonb_build_object(
          'round_id', round_id,
          'state', state,
          'gun_score', gun_score
        ) || case when v_competition.uses_x_score then
          jsonb_build_object('x_total', x_total)
          else '{}'::jsonb
        end
        order by round_number
      ) as rounds
    from participant_cells
    group by entrant_id, slot_number, first_name, last_name
  ), participant_payloads as (
    select
      entrant_id,
      jsonb_agg(
        jsonb_build_object(
          'first_name', first_name,
          'last_name', last_name,
          'slot_number', slot_number,
          'gun_total', gun_total,
          'rounds', rounds
        ) || case when v_competition.uses_x_score then
          jsonb_build_object('x_total', x_total)
          else '{}'::jsonb
        end
        order by slot_number
      ) as participants
    from participant_totals
    group by entrant_id
  ), groups as (
    select division.id as division_key, division.name, division.position
    from public.competition_divisions as division
    where division.competition_id = p_competition_id
      and v_division_status = 'published'
    union all
    select 0::bigint, 'Competition results'::text, 0
    where v_division_status is null
  )
  select jsonb_build_object(
    'status', 'ready',
    'display_scoring_mode', v_scoring_mode,
    'uses_x_score', v_competition.uses_x_score,
    'released_round_count', (select count(*) from rounds where released),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'round_number', round_number,
        'deadline', deadline,
        'released', released
      ) order by round_number)
      from rounds
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', division_key,
        'name', name,
        'entrants', coalesce((
          select jsonb_agg(jsonb_build_object(
            'entrant_id', standings.entrant_id,
            'entrant_format', names.entrant_format,
            'entrant_label', names.entrant_label,
            'club_name', names.club_name,
            -- Individual rows need names only. Pair/Team breakdowns contain
            -- complete released derived values, never source or profile IDs.
            'participants', case when names.entrant_format = 'individual' then
              (select coalesce(jsonb_agg(jsonb_build_object(
                'first_name', participant -> 'first_name',
                'last_name', participant -> 'last_name',
                'slot_number', participant -> 'slot_number'
              ) order by (participant ->> 'slot_number')::integer), '[]'::jsonb)
                from jsonb_array_elements(names.participants) as participant)
              else coalesce((
                select payload.participants
                from participant_payloads as payload
                where payload.entrant_id = standings.entrant_id
              ), '[]'::jsonb)
            end,
            'position', standings.position,
            'tied', standings.tied,
            'scored_rounds', standings.scored_rounds,
            'nsr_rounds', standings.nsr_rounds,
            'achieved_total', standings.achieved_total,
            'maximum_total', standings.maximum_total,
            'gun_total', standings.gun_total,
            'rounds', standings.rounds
          ) || case when v_competition.uses_x_score then
            jsonb_build_object('x_total', standings.x_total)
            else '{}'::jsonb
          end
          order by standings.position, standings.entrant_id)
          from standings
          join entrant_names as names using (entrant_id)
          where standings.division_key = groups.division_key
        ), '[]'::jsonb)
      ) order by position, division_key)
      from groups
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_round_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_club_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_competition_results_context(
    p_organisation_id, p_league_season_id, p_competition_id, p_club_id
  );
  return private.derive_competition_round_results(
    p_organisation_id, p_league_season_id, p_competition_id, p_club_id, false
  );
end;
$function$;


commit;

