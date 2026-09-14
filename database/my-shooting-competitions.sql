-- Authenticated shooter Competition hub read model.
-- Run after database/public-results.sql and the current Competition Division
-- and configuration files. Safe to rerun on populated databases.
--
-- This projection contains participation and schedule metadata only. Official
-- placing, ranking values, S/Av and R/Av remain owned by the existing released
-- Results RPCs and are loaded separately by the application.
begin;

create or replace function public.get_my_shooting_competitions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shooter_id uuid := (select auth.uid());
  v_today date := (statement_timestamp() at time zone 'UTC')::date;
  v_result jsonb;
begin
  if v_shooter_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  with own_participation as (
    select
      participant.id as competition_entrant_participant_id,
      participant.slot_number,
      entrant.id as competition_entrant_id,
      entrant.position as entrant_position,
      entry.id as club_competition_entry_id,
      entry.status as entry_status,
      entry.submitted_at,
      club.id as club_id,
      club.name as club_name,
      club.slug as club_slug,
      competition.id as competition_id,
      competition.name as competition_name,
      competition.slug as competition_slug,
      competition.entry_format,
      competition.team_size,
      competition.ranking_method,
      competition.number_of_rounds,
      effective.effective_starts_at,
      season.id as league_season_id,
      season.name as season_name,
      season.slug as season_slug,
      season.status as season_status,
      season.starts_at as season_starts_at,
      season.ends_at as season_ends_at,
      organisation.id as organisation_id,
      organisation.name as organisation_name,
      organisation.slug as organisation_slug,
      published_division.id as division_id,
      published_division.name as division_name,
      published_division.position as division_position
    from public.competition_entrant_participants as participant
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
     and membership.user_id = v_shooter_id
    join public.competition_entrants as entrant
      on entrant.id = participant.competition_entrant_id
     and entrant.club_competition_entry_id = participant.club_competition_entry_id
    join public.club_competition_entries as entry
      on entry.id = participant.club_competition_entry_id
     and entry.id = entrant.club_competition_entry_id
     and entry.status = 'submitted'
    join public.clubs as club on club.id = entry.club_id
    join public.competitions as competition
      on competition.id = entry.competition_id
     and competition.status = 'published'
    join public.league_seasons as season
      on season.id = competition.league_season_id
     and season.status in ('open', 'active', 'completed')
    join public.organisations as organisation
      on organisation.id = season.organisation_id
     and organisation.status = 'active'
    cross join lateral private.get_competition_effective_dates(
      competition.id
    ) as effective
    left join lateral (
      select division.id, division.name, division.position
      from public.competition_division_configs as config
      join public.competition_division_assignments as assignment
        on assignment.competition_id = config.competition_id
       and assignment.competition_entrant_id = entrant.id
      join public.competition_divisions as division
        on division.id = assignment.competition_division_id
       and division.competition_id = assignment.competition_id
      where config.competition_id = competition.id
        and config.status = 'published'
    ) as published_division on true
  )
  select jsonb_build_object(
    'as_of_date', v_today,
    'competitions', coalesce(jsonb_agg(
      jsonb_build_object(
        'competition_entrant_participant_id', own.competition_entrant_participant_id,
        'slot_number', own.slot_number,
        'competition_entrant_id', own.competition_entrant_id,
        'entrant_position', own.entrant_position,
        'entrant_label', case own.entry_format
          when 'pairs' then 'Pair ' || own.entrant_position::text
          when 'team' then 'Team ' || own.entrant_position::text
          else 'Individual ' || own.entrant_position::text
        end,
        'club_competition_entry_id', own.club_competition_entry_id,
        'entry_status', own.entry_status,
        'submitted_at', own.submitted_at,
        'club', jsonb_build_object(
          'id', own.club_id,
          'name', own.club_name,
          'slug', own.club_slug
        ),
        'competition', jsonb_build_object(
          'id', own.competition_id,
          'name', own.competition_name,
          'slug', own.competition_slug,
          'entry_format', own.entry_format,
          'team_size', own.team_size,
          'ranking_method', own.ranking_method,
          'number_of_rounds', own.number_of_rounds,
          'effective_starts_at', own.effective_starts_at
        ),
        'season', jsonb_build_object(
          'id', own.league_season_id,
          'name', own.season_name,
          'slug', own.season_slug,
          'status', own.season_status,
          'starts_at', own.season_starts_at,
          'ends_at', own.season_ends_at
        ),
        'organisation', jsonb_build_object(
          'id', own.organisation_id,
          'name', own.organisation_name,
          'slug', own.organisation_slug
        ),
        'division', case when own.division_id is null then null else
          jsonb_build_object(
            'id', own.division_id,
            'name', own.division_name,
            'position', own.division_position
          )
        end,
        'participants', coalesce((
          select jsonb_agg(jsonb_build_object(
            'slot_number', teammate.slot_number,
            'first_name', profile.first_name,
            'last_name', profile.last_name,
            'is_current_user', teammate_membership.user_id = v_shooter_id
          ) order by teammate.slot_number, teammate.id)
          from public.competition_entrant_participants as teammate
          join public.club_memberships as teammate_membership
            on teammate_membership.id = teammate.club_membership_id
          join public.profiles as profile
            on profile.id = teammate_membership.user_id
          where teammate.competition_entrant_id = own.competition_entrant_id
            and teammate.club_competition_entry_id = own.club_competition_entry_id
        ), '[]'::jsonb),
        'rounds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', round_row.id,
            'round_number', round_row.round_number,
            'deadline', round_row.deadline,
            'shoot_by_date', round_row.shoot_by_date,
            'released', v_today > round_row.deadline
          ) order by round_row.round_number, round_row.id)
          from public.competition_rounds as round_row
          where round_row.competition_id = own.competition_id
        ), '[]'::jsonb),
        'has_released_results', exists (
          select 1
          from public.competition_rounds as released_round
          where released_round.competition_id = own.competition_id
            and v_today > released_round.deadline
        )
      ) order by
        own.effective_starts_at nulls last,
        own.organisation_name,
        own.competition_name,
        own.club_name,
        own.competition_entrant_id
    ), '[]'::jsonb)
  ) into v_result
  from own_participation as own;

  return v_result;
end;
$$;

comment on function public.get_my_shooting_competitions() is
  'Current-shooter Competition participation from submitted entrant slots across Clubs. Returns published Competition, public Season, schedule and published Division metadata only; official released Results and participant averages remain in their existing RPCs.';

revoke execute on function public.get_my_shooting_competitions()
  from public, anon, authenticated;
grant execute on function public.get_my_shooting_competitions()
  to authenticated;

commit;
