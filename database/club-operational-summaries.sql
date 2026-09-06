-- Run after database/competition-scores-participant-formats.sql.
--
-- Adds one narrow, management-only operational read model for Club Overview
-- and the signed-in User Overview. Completeness is derived from the same
-- canonical participant source slots used by score entry and Results.

begin;

drop function if exists public.get_club_operational_summaries(bigint);
create or replace function public.get_club_operational_summaries(
  p_club_id bigint default null,
  p_warning_days integer default 7
)
returns table (
  club_id bigint,
  club_name text,
  club_slug text,
  active_member_count bigint,
  active_competition_count bigint,
  attention_status text,
  outstanding_score_count bigint,
  competition_id bigint,
  competition_name text,
  competition_slug text,
  organisation_slug text,
  league_season_slug text,
  competition_round_id bigint,
  round_number integer,
  local_cutoff date,
  days_until_cutoff integer,
  participant_count bigint,
  complete_participant_count bigint,
  incomplete_participant_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_warning_days is null or p_warning_days <> 7 then
    raise exception 'The Club scoring warning window must be seven days.'
      using errcode = '22023';
  end if;

  if p_club_id is not null and not exists (
    select 1
    from public.club_memberships as membership
    join public.clubs as club on club.id = membership.club_id
    where membership.user_id = v_actor_id
      and membership.club_id = p_club_id
      and membership.status = 'active'
      and membership.role in ('owner', 'official')
      and club.status = 'active'
  ) then
    raise exception 'Only an active owner or official may view this Club operational summary.'
      using errcode = '42501';
  end if;

  return query
  with managed_clubs as (
    select club.id, club.name, club.slug
    from public.club_memberships as membership
    join public.clubs as club on club.id = membership.club_id
    where membership.user_id = v_actor_id
      and membership.status = 'active'
      and membership.role in ('owner', 'official')
      and club.status = 'active'
      and (p_club_id is null or club.id = p_club_id)
  ), member_counts as (
    select membership.club_id, count(*)::bigint as active_member_count
    from public.club_memberships as membership
    join managed_clubs as managed on managed.id = membership.club_id
    where membership.status = 'active'
    group by membership.club_id
  ), component_config as (
    select
      competition.id as competition_id,
      competition.sets_per_round,
      count(component.id)::integer as component_count,
      (competition.sets_per_round * count(component.id))::integer
        as expected_slot_count
    from public.competitions as competition
    join public.competition_score_components as component
      on component.competition_id = competition.id
    group by competition.id, competition.sets_per_round
  ), participant_completion as (
    select
      managed.id as club_id,
      competition.id as competition_id,
      competition.name as competition_name,
      competition.slug as competition_slug,
      organisation.slug as organisation_slug,
      season.slug as league_season_slug,
      round.id as competition_round_id,
      round.round_number,
      coalesce(round.shoot_by_date, round.deadline) as local_cutoff,
      participant.id as participant_id,
      (
        config.component_count > 0
        and recorded.recorded_slot_count = config.expected_slot_count
      ) as is_complete
    from managed_clubs as managed
    join public.club_competition_entries as entry
      on entry.club_id = managed.id
     and entry.status = 'submitted'
    join public.competitions as competition
      on competition.id = entry.competition_id
     and competition.status = 'published'
     and competition.local_scoring_enabled
    join public.league_seasons as season
      on season.id = competition.league_season_id
     and season.status in ('open', 'active')
    join public.organisations as organisation
      on organisation.id = season.organisation_id
     and organisation.status = 'active'
    cross join lateral private.get_competition_effective_dates(competition.id)
      as effective
    join public.competition_rounds as round
      on round.competition_id = competition.id
    join public.competition_entrants as entrant
      on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants as participant
      on participant.club_competition_entry_id = entry.id
     and participant.competition_entrant_id = entrant.id
    join component_config as config
      on config.competition_id = competition.id
    left join public.competition_score_usages as usage
      on usage.competition_id = competition.id
     and usage.competition_round_id = round.id
     and usage.competition_entrant_participant_id = participant.id
    cross join lateral (
      select count(score_value.id)::integer as recorded_slot_count
      from generate_series(1, config.sets_per_round) as set_slot(set_number)
      cross join public.competition_score_components as component
      left join public.shooting_score_values as score_value
        on score_value.shooting_score_source_id = usage.shooting_score_source_id
       and score_value.set_number = set_slot.set_number
       and score_value.component_position = component.position
      where component.competition_id = competition.id
    ) as recorded
    where effective.effective_starts_at is not null
      and current_date >= effective.effective_starts_at
  ), round_completion as (
    select
      participant.club_id,
      participant.competition_id,
      participant.competition_name,
      participant.competition_slug,
      participant.organisation_slug,
      participant.league_season_slug,
      participant.competition_round_id,
      participant.round_number,
      participant.local_cutoff,
      count(*)::bigint as participant_count,
      count(*) filter (where participant.is_complete)::bigint
        as complete_participant_count,
      count(*) filter (where not participant.is_complete)::bigint
        as incomplete_participant_count
    from participant_completion as participant
    group by
      participant.club_id,
      participant.competition_id,
      participant.competition_name,
      participant.competition_slug,
      participant.organisation_slug,
      participant.league_season_slug,
      participant.competition_round_id,
      participant.round_number,
      participant.local_cutoff
  ), relevant_rounds as (
    select round_state.*
    from round_completion as round_state
    where round_state.local_cutoff >= current_date
      or round_state.incomplete_participant_count > 0
  ), club_rollup as (
    select
      managed.id as club_id,
      managed.name as club_name,
      managed.slug as club_slug,
      coalesce(member_count.active_member_count, 0::bigint)
        as active_member_count,
      count(distinct round_state.competition_id) as active_competition_count,
      coalesce(sum(round_state.incomplete_participant_count), 0::numeric)::bigint
        as outstanding_score_count,
      case
        when coalesce(bool_or(
          round_state.incomplete_participant_count > 0
          and round_state.local_cutoff < current_date
        ), false) then 'deadline_passed'
        when coalesce(bool_or(
          round_state.incomplete_participant_count > 0
          and round_state.local_cutoff between current_date
            and current_date + p_warning_days
        ), false) then 'action_needed'
        when count(round_state.competition_round_id) > 0 then 'all_on_track'
        else 'no_active_scoring'
      end as attention_status
    from managed_clubs as managed
    left join member_counts as member_count on member_count.club_id = managed.id
    left join relevant_rounds as round_state on round_state.club_id = managed.id
    group by
      managed.id,
      managed.name,
      managed.slug,
      member_count.active_member_count
  )
  select
    rollup.club_id,
    rollup.club_name,
    rollup.club_slug,
    rollup.active_member_count,
    rollup.active_competition_count,
    rollup.attention_status,
    rollup.outstanding_score_count,
    priority_round.competition_id,
    priority_round.competition_name,
    priority_round.competition_slug,
    priority_round.organisation_slug,
    priority_round.league_season_slug,
    priority_round.competition_round_id,
    priority_round.round_number,
    priority_round.local_cutoff,
    (priority_round.local_cutoff - current_date)::integer,
    priority_round.participant_count,
    priority_round.complete_participant_count,
    priority_round.incomplete_participant_count
  from club_rollup as rollup
  left join lateral (
    select round_state.*
    from relevant_rounds as round_state
    where round_state.club_id = rollup.club_id
    order by
      case
        when round_state.incomplete_participant_count > 0
          and round_state.local_cutoff < current_date then 0
        when round_state.incomplete_participant_count > 0
          and round_state.local_cutoff between current_date
            and current_date + p_warning_days
          then 1
        else 2
      end,
      abs(round_state.local_cutoff - current_date),
      round_state.local_cutoff,
      round_state.competition_id,
      round_state.competition_round_id
    limit 1
  ) as priority_round on true
  order by
    case rollup.attention_status
      when 'deadline_passed' then 0
      when 'action_needed' then 1
      when 'all_on_track' then 2
      else 3
    end,
    priority_round.local_cutoff nulls last,
    rollup.club_name,
    rollup.club_id;
end;
$$;

comment on function public.get_club_operational_summaries(bigint, integer) is
  'Returns minimal Club-scoring deadline and participant-completeness summaries only for active Clubs the caller manages. Local cutoff is Shoot-by when present, otherwise Round End.';

revoke execute on function public.get_club_operational_summaries(bigint, integer)
  from public, anon, authenticated;
grant execute on function public.get_club_operational_summaries(bigint, integer)
  to authenticated;

commit;
