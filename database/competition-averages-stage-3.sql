-- Run AFTER database/competition-averages-optional-null.sql and the three
-- released Results projections. Safe to rerun on populated databases.
--
-- R/Av is intentionally not stored. This narrow projection derives one live
-- participant value from canonical achieved scores in complete released
-- Competition Rounds. Public callers receive R/Av only; contextual active
-- Organisation owners/managers additionally receive the existing frozen S/Av.
begin;

create or replace function public.get_competition_result_averages(
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
  v_include_starting_average boolean := false;
  v_result jsonb;
begin
  if not exists (
    select 1
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
      and competition.status = 'published'
      and competition.ranking_method in (
        'aggregate', 'gun_score', 'round_robin'
      )
  ) then
    raise exception 'Published Competition result context was not found.'
      using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.organisation_staff as staff
    where staff.organisation_id = p_organisation_id
      and staff.user_id = (select auth.uid())
      and staff.status = 'active'
      and staff.role in ('owner', 'manager')
  ) into v_include_starting_average;

  with component_config as (
    select
      competition.id as competition_id,
      competition.sets_per_round,
      count(component.id)::integer as component_count,
      (
        competition.sets_per_round * count(component.id)
      )::integer as expected_slot_count
    from public.competitions as competition
    left join public.competition_score_components as component
      on component.competition_id = competition.id
    where competition.id = p_competition_id
    group by competition.id, competition.sets_per_round
  ), participant_roster as (
    select
      entrant.id as entrant_id,
      participant.id as participant_id,
      participant.slot_number,
      membership.user_id as shooter_profile_id
    from public.club_competition_entries as entry
    join public.competition_entrants as entrant
      on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants as participant
      on participant.club_competition_entry_id = entry.id
     and participant.competition_entrant_id = entrant.id
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
    where entry.competition_id = p_competition_id
      and entry.status = 'submitted'
  ), raw_candidates as (
    select
      roster.participant_id,
      competition_round.id as round_id,
      source.id as shooting_score_source_id,
      score_values.achieved_score,
      row_number() over (
        partition by
          roster.participant_id,
          competition_round.id,
          source.id
        order by usage.id desc
      ) as source_usage_order
    from participant_roster as roster
    join public.competition_score_usages as usage
      on usage.competition_id = p_competition_id
     and usage.competition_entrant_participant_id = roster.participant_id
    join public.competition_rounds as competition_round
      on competition_round.id = usage.competition_round_id
     and competition_round.competition_id = usage.competition_id
    join public.shooting_score_sources as source
      on source.id = usage.shooting_score_source_id
     and source.shooter_profile_id = roster.shooter_profile_id
    cross join component_config as config
    cross join lateral (
      select
        count(score_value.id)::integer as recorded_slot_count,
        sum(score_value.achieved_score) as achieved_score
      from public.shooting_score_values as score_value
      where score_value.shooting_score_source_id = source.id
    ) as score_values
    where config.component_count > 0
      and score_values.recorded_slot_count = config.expected_slot_count
      and (statement_timestamp() at time zone 'UTC')::date
        > competition_round.deadline
  ), running_averages as (
    select
      candidate.participant_id,
      avg(candidate.achieved_score) as running_average
    from raw_candidates as candidate
    where candidate.source_usage_order = 1
    group by candidate.participant_id
  )
  select jsonb_build_object(
    'participants', coalesce(jsonb_agg(
      jsonb_build_object(
        'entrant_id', roster.entrant_id,
        'slot_number', roster.slot_number,
        'running_average', running.running_average
      ) || case when v_include_starting_average then
        jsonb_build_object('starting_average', starting.starting_average)
      else '{}'::jsonb end
      order by roster.entrant_id, roster.slot_number, roster.participant_id
    ), '[]'::jsonb)
  ) into v_result
  from participant_roster as roster
  left join running_averages as running
    on running.participant_id = roster.participant_id
  left join public.competition_participant_starting_averages as starting
    on starting.competition_entrant_participant_id = roster.participant_id
   and starting.competition_id = p_competition_id
   and starting.status = 'frozen';

  return v_result;
end;
$$;

revoke execute on function public.get_competition_result_averages(
  bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.get_competition_result_averages(
  bigint, bigint, bigint
) to anon, authenticated;

comment on function public.get_competition_result_averages(
  bigint, bigint, bigint
) is
  'Released Results participant statistics. R/Av is the unrounded numeric mean of complete released canonical achieved scores in this Competition, with null for no qualifying score. Frozen S/Av is included only for contextual active Organisation owners/managers. No ranking or score state is written.';

commit;
