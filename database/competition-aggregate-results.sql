-- Run AFTER the updated database/competition-results.sql.
-- Safe to rerun on populated databases. No data writes or stored standings.
begin;

-- As with published divisions, this is a deliberately narrow cross-club read
-- API. Source-table RLS/grants remain unchanged. The private derivation is not
-- executable by readers; the privileged wrapper validates exact public context.
create or replace function public.get_competition_aggregate_results(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb
language plpgsql
-- One statement snapshot keeps publication, division membership, and scores
-- consistent even if another transaction edits them during this read.
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
$$;

revoke execute on function public.get_competition_aggregate_results(bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.get_competition_aggregate_results(bigint, bigint, bigint)
  to anon, authenticated;
comment on function public.get_competition_aggregate_results(bigint, bigint, bigint) is
  'Public released Aggregate standings for an exact active organisation, public season, and published competition. Pair/Team participant breakdowns contain only complete released derived shooting results. UTC deadline dates are inclusive. Competition-rank ties use X when enabled; countback is deferred. No stored totals or source-score writes.';

commit;
