-- Run after competition-configuration-refactor.sql, competition-divisions.sql,
-- competition-scores-participant-formats.sql and competition-results.sql.
-- Additive, rerunnable; does not backfill or reshuffle existing competitions.
begin;

create table if not exists public.competition_round_robin_fixtures (
  competition_id bigint not null references public.competitions(id) on delete cascade,
  division_id bigint not null references public.competition_divisions(id),
  round_id bigint not null references public.competition_rounds(id),
  match_number integer not null check (match_number > 0),
  entrant_a_id bigint not null references public.competition_entrants(id),
  entrant_b_id bigint references public.competition_entrants(id),
  primary key (competition_id, division_id, round_id, match_number),
  check (entrant_a_id <> entrant_b_id)
);
create index if not exists round_robin_fixtures_division_idx on public.competition_round_robin_fixtures(division_id);
create index if not exists round_robin_fixtures_round_idx on public.competition_round_robin_fixtures(round_id);
create index if not exists round_robin_fixtures_a_idx on public.competition_round_robin_fixtures(entrant_a_id);
create index if not exists round_robin_fixtures_b_idx on public.competition_round_robin_fixtures(entrant_b_id);
alter table public.competition_round_robin_fixtures enable row level security;
revoke all on public.competition_round_robin_fixtures from public, anon, authenticated;
comment on table public.competition_round_robin_fixtures is
  'Published entrant-unit schedule only. Stable identity is competition/division/round/match_number. No scores, winners or points stored. Access through the narrow Results RPC.';

-- Circle method: lowest entrant ID is fixed, rotate the other slots clockwise.
-- NULL is a ghost entrant for odd divisions; always put the real bye entrant in A.
create or replace function private.round_robin_pairings(p_entrants bigint[], p_rounds integer)
returns table(round_number integer, match_number integer, entrant_a_id bigint, entrant_b_id bigint)
language plpgsql immutable set search_path = '' as $$
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
$$;
revoke all on function private.round_robin_pairings(bigint[], integer) from public, anon, authenticated;

create or replace function private.generate_round_robin_fixtures(p_competition_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function private.generate_round_robin_fixtures(bigint) from public, anon, authenticated;

-- Hook the existing authenticated publication RPC; its authorization, entry-close
-- check and exact-allocation validation still run. Trigger failure rolls it back.
create or replace function private.round_robin_division_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function private.round_robin_division_lifecycle() from public,anon,authenticated;
drop trigger if exists round_robin_division_lifecycle on public.competition_division_configs;
create trigger round_robin_division_lifecycle after insert or update or delete on public.competition_division_configs
for each row execute function private.round_robin_division_lifecycle();

-- Composition and Round identities cannot mutate under a published schedule.
-- Before Start use Edit divisions first; after Start that transition is blocked.
create or replace function private.protect_round_robin_composition()
returns trigger language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function private.protect_round_robin_composition() from public,anon,authenticated;
drop trigger if exists protect_round_robin_composition on public.competition_division_assignments;
create trigger protect_round_robin_composition before insert or update or delete on public.competition_division_assignments for each row execute function private.protect_round_robin_composition();
drop trigger if exists protect_round_robin_composition on public.competition_entrants;
create trigger protect_round_robin_composition before insert or update or delete on public.competition_entrants for each row execute function private.protect_round_robin_composition();
drop trigger if exists protect_round_robin_composition on public.competition_entrant_participants;
create trigger protect_round_robin_composition before insert or update or delete on public.competition_entrant_participants for each row execute function private.protect_round_robin_composition();
drop trigger if exists protect_round_robin_composition on public.club_competition_entries;
create trigger protect_round_robin_composition before insert or update of status,competition_id,club_id or delete on public.club_competition_entries for each row execute function private.protect_round_robin_composition();
drop trigger if exists protect_round_robin_composition on public.competition_rounds;
create trigger protect_round_robin_composition before insert or update of competition_id,round_number or delete on public.competition_rounds for each row execute function private.protect_round_robin_composition();
drop trigger if exists protect_round_robin_composition on public.competition_divisions;
create trigger protect_round_robin_composition before insert or update of competition_id or delete on public.competition_divisions for each row execute function private.protect_round_robin_composition();

create or replace function private.protect_round_robin_configuration()
returns trigger language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function private.protect_round_robin_configuration() from public,anon,authenticated;
drop trigger if exists protect_round_robin_configuration on public.competitions;
create trigger protect_round_robin_configuration before insert or update on public.competitions for each row execute function private.protect_round_robin_configuration();

create or replace function private.protect_round_robin_season_start()
returns trigger language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function private.protect_round_robin_season_start() from public,anon,authenticated;
drop trigger if exists protect_round_robin_season_start on public.league_seasons;
create trigger protect_round_robin_season_start before update of starts_at on public.league_seasons for each row execute function private.protect_round_robin_season_start();

commit;
