-- Run after database/competition-scores-participant-formats.sql and
-- database/competition-divisions.sql.
--
-- Adds a live, authorised Competition Round result read model. No shooter,
-- entrant, Pair, or Team total is stored: every result is derived from the
-- canonical source-score values linked through competition_score_usages.

begin;

-- Resolves one exact result-reading scope. Organisation scope may inspect all
-- submitted entrants; club scope is deliberately restricted to an active
-- owner/official of that submitted club entry, even when the caller also has
-- organisation access.
create or replace function private.require_competition_results_context(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_club_id bigint default null
)
returns table (
  actor_id uuid,
  access_scope text,
  scoped_club_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function private.require_competition_results_context(
  bigint, bigint, bigint, bigint
) from public, anon, authenticated;

comment on function private.require_competition_results_context(
  bigint, bigint, bigint, bigint
) is
  'Authorises one exact organisation-wide or submitted-club Competition result read scope.';

-- Shared derivation, callable only by the authorised wrappers below and in
-- competition-aggregate-results.sql. Ordinary Results always pass true.
create or replace function private.derive_competition_round_results(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_club_id bigint,
  p_released_only boolean
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null then
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
                'entrant_label', case entrant.entry_format
                  when 'pairs' then 'Pair ' || entrant.entrant_position::text
                  when 'team' then 'Team ' || entrant.entrant_position::text
                  else 'Individual ' || entrant.entrant_position::text
                end,
                'entrant_position', entrant.entrant_position,
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
$$;

revoke execute on function private.derive_competition_round_results(
  bigint, bigint, bigint, bigint, boolean
) from public, anon, authenticated;

-- Retained for authorised internal diagnostics; never used by normal Results.
create or replace function public.get_competition_round_results(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_club_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_competition_results_context(
    p_organisation_id, p_league_season_id, p_competition_id, p_club_id
  );
  return private.derive_competition_round_results(
    p_organisation_id, p_league_season_id, p_competition_id, p_club_id, false
  );
end;
$$;

comment on function public.get_competition_round_results(
  bigint, bigint, bigint, bigint
) is
  'Returns live normalised participant and entrant Round results derived from canonical source scores. Missing required slots make totals incomplete; no aggregate totals, zero, or NSR are stored or manufactured.';

revoke execute on function public.get_competition_round_results(
  bigint, bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.get_competition_round_results(
  bigint, bigint, bigint, bigint
) to authenticated;

commit;
