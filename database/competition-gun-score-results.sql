-- Run AFTER database/competition-results.sql.
-- Safe to rerun on populated databases. No data writes or stored standings.
begin;

-- Purpose-built public Results projection for Gun Score competitions. The
-- source-table grants and RLS policies remain unchanged: this wrapper validates
-- the exact public context, then calls the shared released-only derivation.
create or replace function public.get_competition_gun_score_results(
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
$$;

revoke execute on function public.get_competition_gun_score_results(
  bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.get_competition_gun_score_results(
  bigint, bigint, bigint
) to anon, authenticated;

comment on function public.get_competition_gun_score_results(
  bigint, bigint, bigint
) is
  'Public released Gun Score standings for an exact active organisation, public season, and published competition. Complete released gun results are accumulated directly: points scored rank descending and points dropped rank ascending, with higher X as the only enabled tie-break. NSR contributes no gun result or X. Pair/Team participant breakdowns contain only released derived results. UTC Round End dates are inclusive. No stored totals or source-score writes.';

commit;
