-- Canonical fresh-install schema: round robin.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."competition_round_robin_fixtures" (
  "competition_id" bigint not null,
  "division_id" bigint not null,
  "round_id" bigint not null,
  "match_number" integer not null,
  "entrant_a_id" bigint not null,
  "entrant_b_id" bigint
);

CREATE OR REPLACE FUNCTION private.generate_round_robin_fixtures(p_competition_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c record; d record; entrants bigint[]; starts date;
begin
  -- Same lock as the existing Division publication workflow.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('competition-divisions:' || p_competition_id::text, 0));
  -- The publication manager already holds FOR SHARE on the Competition and
  -- FOR UPDATE on its entries. Do not upgrade that shared lock: a concurrent
  -- publication retry may hold another shared lock while waiting on the mutex.
  select * into c from public.competitions where id = p_competition_id;
  if c.ranking_method <> 'round_robin' then return; end if;
  if not exists (select 1 from public.competition_division_configs where competition_id = c.id and status = 'published') then
    raise exception 'Round Robin fixtures require published Divisions.' using errcode = '22023';
  end if;
  -- Existing schedules are immutable and publication retries are a no-op.
  if exists (select 1 from public.competition_round_robin_fixtures where competition_id = c.id) then return; end if;
  select effective_starts_at into starts from private.get_competition_effective_dates(c.id);
  if starts is null or (statement_timestamp() at time zone 'UTC')::date >= starts then
    raise exception 'Finalise Round Robin Divisions before Competition Start. A live schedule cannot be generated or reshuffled.' using errcode = '22023';
  end if;
  if (select count(*) from public.competition_rounds where competition_id = c.id) <> c.number_of_rounds
    or exists (select 1 from generate_series(1,c.number_of_rounds) r where not exists (
      select 1 from public.competition_rounds where competition_id = c.id and round_number = r)) then
    raise exception 'Configure every Competition Round before finalising Round Robin fixtures.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.competition_divisions where competition_id = c.id)
    or exists (select 1 from public.competition_entrants e join public.club_competition_entries ce on ce.id=e.club_competition_entry_id
      where ce.competition_id=c.id and ce.status='submitted' and not exists (
        select 1 from public.competition_division_assignments a where a.competition_id=c.id and a.competition_entrant_id=e.id))
    or exists (select 1 from public.competition_division_assignments a
      join public.competition_entrants e on e.id=a.competition_entrant_id
      join public.club_competition_entries ce on ce.id=e.club_competition_entry_id
      where a.competition_id=c.id and (ce.competition_id<>c.id or ce.status<>'submitted')) then
    raise exception 'Round Robin requires a complete published Division allocation.' using errcode = '22023';
  end if;
  for d in select * from public.competition_divisions where competition_id=c.id order by position,id loop
    select array_agg(competition_entrant_id order by competition_entrant_id) into entrants
      from public.competition_division_assignments where competition_id=c.id and competition_division_id=d.id;
    if coalesce(cardinality(entrants),0)=0 then
      raise exception 'Round Robin Divisions must contain at least one entrant.' using errcode='22023';
    end if;
    insert into public.competition_round_robin_fixtures
      select c.id,d.id,r.id,p.match_number,p.entrant_a_id,p.entrant_b_id
      from private.round_robin_pairings(entrants,c.number_of_rounds) p
      join public.competition_rounds r on r.competition_id=c.id and r.round_number=p.round_number;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_round_robin_composition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cid bigint; row_data jsonb;
begin
  -- The existing configuration save uses INSERT ... ON CONFLICT for dates.
  if tg_table_name='competition_rounds' then
    if tg_op='INSERT' and exists(select 1 from public.competition_rounds where competition_id=new.competition_id and round_number=new.round_number) then return new; end if;
    if tg_op='UPDATE' and (new.competition_id,new.round_number) is not distinct from (old.competition_id,old.round_number) then return new; end if;
  end if;
  for row_data in select x from (values(to_jsonb(old)),(to_jsonb(new))) v(x) where x is not null loop
    if tg_table_name in ('competition_entrants','competition_entrant_participants') then
      select competition_id into cid from public.club_competition_entries where id=(row_data->>'club_competition_entry_id')::bigint;
    else cid := (row_data->>'competition_id')::bigint; end if;
    if exists(select 1 from public.competition_round_robin_fixtures where competition_id=cid) then
      raise exception 'Published Round Robin composition and Round identities are locked. Use Edit divisions before Competition Start.' using errcode='22023';
    end if;
  end loop;
  return coalesce(new,old);
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_round_robin_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare starts date; new_starts date; has_schedule boolean;
begin
  if new.ranking_method<>'round_robin' and (tg_op='INSERT' or old.ranking_method<>'round_robin') then return new; end if;
  select exists(select 1 from public.competition_round_robin_fixtures where competition_id=new.id) into has_schedule;
  select case new.start_date_mode when 'custom' then new.custom_starts_at else starts_at end into new_starts from public.league_seasons where id=new.league_season_id;
  if tg_op='UPDATE' and has_schedule then
    select effective_starts_at into starts from private.get_competition_effective_dates(old.id);
    if (new.ranking_method,new.number_of_rounds,new.entry_format,new.team_size,new.league_season_id,new.status)
      is distinct from (old.ranking_method,old.number_of_rounds,old.entry_format,old.team_size,old.league_season_id,old.status) then
      raise exception 'Edit Round Robin Divisions before changing scheduled Competition structure.' using errcode='22023';
    end if;
    if new_starts is null or (starts <= (statement_timestamp() at time zone 'UTC')::date and new_starts is distinct from starts) then
      raise exception 'A live Round Robin Competition Start cannot change.' using errcode='22023';
    end if;
  end if;
  if new.ranking_method='round_robin' and new.status='published' and not has_schedule
    and (new_starts is null or new_starts <= (statement_timestamp() at time zone 'UTC')::date) then
    raise exception 'Round Robin requires published Divisions and fixtures before Competition Start.' using errcode='22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_round_robin_season_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.starts_at is distinct from old.starts_at and exists (
    select 1 from public.competitions c where c.league_season_id=old.id and c.ranking_method='round_robin'
    and c.start_date_mode='season_default' and c.status='published'
    and (old.starts_at <= (statement_timestamp() at time zone 'UTC')::date or new.starts_at is null
      or (new.starts_at <= (statement_timestamp() at time zone 'UTC')::date and not exists (
        select 1 from public.competition_round_robin_fixtures where competition_id=c.id)))
  ) then raise exception 'Season Start change would invalidate a Round Robin schedule.' using errcode='22023'; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.round_robin_division_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cid bigint := coalesce(new.competition_id,old.competition_id); starts date;
begin
  if not exists(select 1 from public.competitions where id=cid and ranking_method='round_robin') then return coalesce(new,old); end if;
  if tg_op='UPDATE' and new.status=old.status then
    if new.status='published' then perform private.generate_round_robin_fixtures(cid); end if;
    return new;
  end if;
  if tg_op<>'INSERT' and old.status='published' then
    select effective_starts_at into starts from private.get_competition_effective_dates(cid);
    if starts is null or (statement_timestamp() at time zone 'UTC')::date >= starts then
      raise exception 'Round Robin Divisions are frozen from Competition Start.' using errcode='22023';
    end if;
    delete from public.competition_round_robin_fixtures where competition_id=cid;
  end if;
  if tg_op<>'DELETE' and new.status='published' then perform private.generate_round_robin_fixtures(cid); end if;
  return coalesce(new,old);
end;
$function$;

CREATE OR REPLACE FUNCTION private.round_robin_pairings(p_entrants bigint[], p_rounds integer)
 RETURNS TABLE(round_number integer, match_number integer, entrant_a_id bigint, entrant_b_id bigint)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  slots bigint[];
  initial_slots bigint[];
  n integer;
  r integer;
  m integer;
begin
  select array_agg(id order by id) into slots from (select distinct unnest(p_entrants) as id) s where id is not null;
  n := coalesce(cardinality(slots), 0);
  if n = 0 then return; end if;
  if n % 2 = 1 then slots := array_append(slots, null::bigint); n := n + 1; end if;
  initial_slots := slots;
  for r in 1..p_rounds loop
    if (r - 1) % (n - 1) = 0 then slots := initial_slots; end if;
    for m in 1..(n / 2) loop
      round_number := r; match_number := m;
      entrant_a_id := coalesce(slots[m], slots[n + 1 - m]);
      entrant_b_id := case when slots[m] is null then null else slots[n + 1 - m] end;
      return next;
    end loop;
    slots := array[slots[1], slots[n]] || slots[2:n-1];
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_round_robin_results(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
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
$function$;


commit;

