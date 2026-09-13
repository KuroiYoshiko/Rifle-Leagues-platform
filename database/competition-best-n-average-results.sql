-- Run AFTER database/competition-results.sql.
-- Safe to rerun on populated databases. No data writes or stored standings.
begin;

-- Purpose-built public Results projection for Best N Average competitions.
-- The exact public-context and released-only boundary matches the other Results
-- wrappers; canonical achieved values are the ranking basis for every scoring
-- display mode.
create or replace function public.get_competition_best_n_average_results(
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
  ), standings as (
    select totals.*,
      rank() over (
        partition by division_key
        order by (qualifying_average is not null) desc,
          qualifying_average desc nulls last
      ) as position,
      count(*) over (
        partition by division_key, qualifying_average
      ) > 1 as tied
    from totals
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
        'scored_rounds', standings.scored_rounds,
        'nsr_rounds', standings.nsr_rounds,
        'counted_rounds', standings.counted_rounds,
        'qualifying_average', standings.qualifying_average,
        'rounds', standings.rounds
      ) order by standings.position, standings.entrant_id)
      from standings
      join entrant_names as names using (entrant_id)
      where standings.division_key = groups.division_key), '[]'::jsonb)
    ) order by position, division_key) from groups), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_competition_best_n_average_results(
  bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.get_competition_best_n_average_results(
  bigint, bigint, bigint
) to anon, authenticated;

comment on function public.get_competition_best_n_average_results(
  bigint, bigint, bigint
) is
  'Public released Best N Average standings for an exact active organisation, public season, and published competition. The highest N complete released entrant achieved-score totals form the live arithmetic mean; before N returns, every complete released result counts. NSR and unreleased values are excluded. X ranking is not defined. Pair/Team participant breakdowns contain only released derived achieved values. No stored totals or source-score writes.';

commit;
