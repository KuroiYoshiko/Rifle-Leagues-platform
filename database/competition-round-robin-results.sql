-- Run AFTER database/competition-round-robin.sql (and its prerequisites).
-- Safe to rerun on populated databases. No data writes or stored standings.
begin;

-- Narrow anonymous read model. Shared released-only source derivation remains
-- authoritative for participant completeness, achieved totals, display and X.
create or replace function public.get_competition_round_robin_results(
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

  if v_competition.ranking_method <> 'round_robin' then
    raise exception 'Round Robin results require Round Robin ranking.'
      using errcode = '22023';
  end if;

  select config.status into v_division_status
  from public.competition_division_configs as config
  where config.competition_id = p_competition_id;

  -- Draft allocations are not divisionless. Published allocations also fail
  -- closed when any submitted entrant is unassigned, matching Aggregate Results.
  if v_division_status is distinct from 'published' or (
    not exists (select 1 from public.competition_round_robin_fixtures where competition_id = p_competition_id) or exists (
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
  ), matches as (
    select g.*, f.match_number,
      case when f.entrant_a_id=g.entrant_id then f.entrant_b_id else f.entrant_a_id end as opponent_id,
      case
        when not g.released then 'pending'
        when f.entrant_b_id is null and g.scored then 'bye'
        when f.entrant_b_id is null then 'bye_nsr'
        -- No one-sided forfeit or both-NSR penalty established by legacy evidence.
        when not g.scored or not coalesce(op.scored,false) then 'unresolved'
        when (case when v_scoring_mode='points_dropped' then -g.gun_score else g.gun_score end)
           > (case when v_scoring_mode='points_dropped' then -op.gun_score else op.gun_score end) then 'win'
        when (case when v_scoring_mode='points_dropped' then -g.gun_score else g.gun_score end)
           < (case when v_scoring_mode='points_dropped' then -op.gun_score else op.gun_score end) then 'loss'
        when v_competition.uses_x_score and g.x_total > op.x_total then 'win'
        when v_competition.uses_x_score and g.x_total < op.x_total then 'loss'
        else 'draw'
      end as outcome
    from gun_results g
    join public.competition_round_robin_fixtures f
      on f.competition_id=p_competition_id and f.division_id=g.division_key and f.round_id=g.round_id
      and g.entrant_id in (f.entrant_a_id,f.entrant_b_id)
    left join gun_results op on op.round_id=g.round_id and op.entrant_id=
      case when f.entrant_a_id=g.entrant_id then f.entrant_b_id else f.entrant_a_id end
  ), match_points as (
    select matches.*, case outcome when 'win' then 2 when 'bye' then 2 when 'draw' then 1 when 'loss' then 0 end as match_points
    from matches
  ), totals as (
    select
      entrant_id,
      division_key,
      coalesce(sum(match_points),0) as total_match_points,
      count(*) filter (where outcome='unresolved') as unresolved_matches,
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
          'gun_score', gun_score,
          'opponent_id', opponent_id,
          'match_number', match_number,
          'outcome', outcome,
          'match_points', match_points
        ) || case when v_competition.uses_x_score then
          jsonb_build_object('x_total', case when scored then x_total end)
          else '{}'::jsonb
        end
        order by round_number
      ) as rounds
    from match_points
    group by entrant_id, division_key
  ), standings as (
    select
      totals.*,
      -- Match points, complete released gun aggregate, then X. No countback.
      rank() over (
        partition by division_key
        order by
          total_match_points desc,
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
          total_match_points,
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
            'total_match_points', standings.total_match_points,
            'unresolved_matches', standings.unresolved_matches,
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

revoke execute on function public.get_competition_round_robin_results(
  bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.get_competition_round_robin_results(
  bigint, bigint, bigint
) to anon, authenticated;

comment on function public.get_competition_round_robin_results(bigint,bigint,bigint) is
  'Published Round Robin schedule and released Results. W=2, D=1, L=0; complete bye=2. NSR matches unresolved, incomplete bye no points. Match points then gun aggregate then X; no countback. Future gun values, outcomes and points are gated at inclusive UTC Round End.';

commit;
