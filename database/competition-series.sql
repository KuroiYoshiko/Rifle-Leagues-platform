-- Stage 1 foundation. Run after the current Competition/score/Results/Round Robin SQL,
-- then run competition-series-management.sql. Additive and safe to rerun; no backfill.
begin;

create table if not exists public.competition_series (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id),
  name text not null check (name = btrim(name) and char_length(name) between 2 and 160),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 180),
  archived_at timestamptz,
  entry_format text not null check (entry_format in ('individual','pairs','team')),
  team_size integer not null,
  discipline_code text,
  discipline_detail text,
  sets_per_round integer not null check (sets_per_round between 1 and 100),
  shots_per_round integer check (shots_per_round between 1 and 10000),
  identity_locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  unique (organisation_id, slug),
  check ((entry_format='individual' and team_size=1) or (entry_format='pairs' and team_size=2)
    or (entry_format='team' and team_size between 3 and 20)),
  check (discipline_code is null or discipline_code in
    ('rifle_prone','rifle_benchrest','rifle_three_position','air_pistol','other')),
  check (discipline_detail is null or (discipline_detail=btrim(discipline_detail)
    and char_length(discipline_detail) between 1 and 200)),
  check (discipline_code is not null or discipline_detail is null),
  check (discipline_code is distinct from 'other' or discipline_detail is not null)
);

create table if not exists public.competition_series_score_components (
  competition_series_id bigint not null references public.competition_series(id) on delete cascade,
  position integer not null check (position between 1 and 20),
  short_label text check (short_label=btrim(short_label) and char_length(short_label) between 1 and 30),
  maximum_score numeric(10,2) not null check (maximum_score between 0.01 and 1000000),
  score_method text not null check (score_method in ('points_scored','points_dropped')),
  primary key (competition_series_id,position)
);

alter table public.competitions
  add column if not exists competition_series_id bigint references public.competition_series(id),
  add column if not exists configuration_source_competition_id bigint references public.competitions(id) on delete set null,
  add column if not exists configuration_source_version text,
  add column if not exists discipline_code text,
  add column if not exists discipline_detail text;

do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.competitions'::regclass
    and conname='competitions_discipline_value') then
    alter table public.competitions add constraint competitions_discipline_value check (
      (discipline_code is null or discipline_code in
        ('rifle_prone','rifle_benchrest','rifle_three_position','air_pistol','other'))
      and (discipline_detail is null or (discipline_detail=btrim(discipline_detail)
        and char_length(discipline_detail) between 1 and 200))
      and (discipline_code is not null or discipline_detail is null)
      and (discipline_code is distinct from 'other' or discipline_detail is not null));
  end if;
end $$;

create index if not exists competitions_series_idx on public.competitions(competition_series_id,league_season_id,id)
  where competition_series_id is not null;
create index if not exists competitions_configuration_source_idx on public.competitions(configuration_source_competition_id)
  where configuration_source_competition_id is not null;
create index if not exists competition_series_created_by_idx on public.competition_series(created_by) where created_by is not null;
create index if not exists competition_series_updated_by_idx on public.competition_series(updated_by) where updated_by is not null;

comment on table public.competition_series is 'Organisation-scoped historical identity, not a template or average policy. Operational configuration stays on each Competition.';
comment on column public.competitions.competition_series_id is 'NULL means one-off or historical identity not yet established. Never inferred from names.';
comment on column public.competitions.configuration_source_competition_id is 'Configuration provenance ONLY. Not an average predecessor or permission to reuse source scores.';
comment on column public.competitions.configuration_source_version is 'Opaque version of the source configuration, including components, rounds and inherited Season dates, at creation.';

-- Client writes remain unavailable. Draft reads use contextual staff only.
alter table public.competition_series enable row level security;
alter table public.competition_series_score_components enable row level security;
revoke all on public.competition_series, public.competition_series_score_components from public,anon,authenticated;
revoke all on sequence public.competition_series_id_seq from public,anon,authenticated;
grant select on public.competition_series, public.competition_series_score_components to authenticated;
-- Provenance is returned by management RPCs, not added to broad Competition grants.
grant select (competition_series_id,discipline_code,discipline_detail) on public.competitions to authenticated;

drop policy if exists "Staff read Competition Series" on public.competition_series;
create policy "Staff read Competition Series" on public.competition_series for select to authenticated using (
  exists (select 1 from public.organisation_staff s join public.organisations o on o.id=s.organisation_id
    where s.organisation_id=competition_series.organisation_id and s.user_id=(select auth.uid())
      and s.status='active' and s.role in ('owner','manager') and o.status='active'));
drop policy if exists "Staff read Series components" on public.competition_series_score_components;
create policy "Staff read Series components" on public.competition_series_score_components for select to authenticated
  using (exists (select 1 from public.competition_series s where s.id=competition_series_id));
drop policy if exists "Managers read draft Seasons" on public.league_seasons;
create policy "Managers read draft Seasons" on public.league_seasons for select to authenticated using (
  exists (select 1 from public.organisation_staff s join public.organisations o on o.id=s.organisation_id
    where s.organisation_id=league_seasons.organisation_id and s.user_id=(select auth.uid())
      and s.status='active' and s.role='manager' and o.status='active'));
drop policy if exists "Managers read draft Competitions" on public.competitions;
create policy "Managers read draft Competitions" on public.competitions for select to authenticated using (
  exists (select 1 from public.league_seasons season join public.organisation_staff s on s.organisation_id=season.organisation_id
    join public.organisations o on o.id=s.organisation_id
    where season.id=competitions.league_season_id and s.user_id=(select auth.uid())
      and s.status='active' and s.role='manager' and o.status='active'));

create or replace function private.competition_series_components(p_series_id bigint)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('short_label',c.short_label,'maximum_score',c.maximum_score,
    'score_method',c.score_method) order by c.position),'[]'::jsonb)
  from public.competition_series_score_components c where c.competition_series_id=p_series_id
$$;
create or replace function private.competition_components(p_competition_id bigint)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('short_label',c.short_label,'maximum_score',c.maximum_score,
    'score_method',c.score_method) order by c.position),'[]'::jsonb)
  from public.competition_score_components c where c.competition_id=p_competition_id
$$;

-- Every authoring RPC takes this advisory lock BEFORE staff/Season/Competition rows.
-- This serialises competing authoring operations within an Organisation, including
-- legacy RPCs. Row locks still protect Series against privileged concurrent writes.
create or replace function private.require_competition_author(p_organisation_id bigint,p_owner_only boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('competition-author:'||p_organisation_id::text,0));
  perform s.id from public.organisation_staff s join public.organisations o on o.id=s.organisation_id
    where o.id=p_organisation_id and o.status='active' and s.user_id=actor and s.status='active'
      and (s.role='owner' or (not p_owner_only and s.role='manager')) for share of s,o;
  if not found then raise exception 'Active contextual Organisation author permission is required.' using errcode='42501'; end if;
  return actor;
end $$;

create or replace function private.validate_competition_series(p_series_id bigint,p_finalise boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare s public.competition_series%rowtype; c record; components jsonb;
begin
  select * into s from public.competition_series where id=p_series_id for update;
  if not found then return; end if;
  components := private.competition_series_components(s.id);
  if exists (select 1 from (select position,row_number() over(order by position) n
    from public.competition_series_score_components where competition_series_id=s.id) x where position<>n) then
    raise exception 'Series component positions must be contiguous.' using errcode='22023';
  end if;
  if p_finalise or s.identity_locked_at is not null then
    if s.discipline_code is null or jsonb_array_length(components)=0 then
      raise exception 'Complete discipline and Course of Fire before finalising Series identity.' using errcode='22023';
    end if;
  end if;
  for c in select e.*,season.organisation_id from public.competitions e
    join public.league_seasons season on season.id=e.league_season_id where e.competition_series_id=s.id loop
    if c.organisation_id<>s.organisation_id then
      raise exception 'Series and Season must belong to the same Organisation.' using errcode='22023';
    end if;
    if (c.entry_format,c.team_size,c.discipline_code,c.discipline_detail,c.sets_per_round,c.shots_per_round)
      is distinct from (s.entry_format,s.team_size,s.discipline_code,s.discipline_detail,s.sets_per_round,s.shots_per_round)
      or private.competition_components(c.id) is distinct from components
      or exists (select 1 from (select position,row_number() over(order by position) n
        from public.competition_score_components where competition_id=c.id) x where position<>n) then
      raise exception 'Competition identity must match its Series. Create a new Series to change the shooting format.' using errcode='22023';
    end if;
    if c.configuration_source_competition_id is not null and not exists (
      select 1 from public.competitions source where source.id=c.configuration_source_competition_id
        and source.competition_series_id=s.id and source.id<>c.id) then
      raise exception 'Configuration source must be another edition of this Series.' using errcode='22023';
    end if;
  end loop;
  if p_finalise and s.identity_locked_at is null then
    update public.competition_series set identity_locked_at=clock_timestamp(),updated_by=(select auth.uid()) where id=s.id;
  end if;
end $$;

create or replace function private.protect_series_contract()
returns trigger language plpgsql security definer set search_path='' as $$
declare sid bigint; locked timestamptz;
begin
  if tg_table_name='competition_series' then
    if tg_op='DELETE' then return old; end if;
    if new.organisation_id is distinct from old.organisation_id or new.slug is distinct from old.slug then
      raise exception 'Series Organisation and slug are immutable.' using errcode='22023';
    end if;
    if old.identity_locked_at is not null and (
      new.identity_locked_at is distinct from old.identity_locked_at or
      (new.entry_format,new.team_size,new.discipline_code,new.discipline_detail,new.sets_per_round,new.shots_per_round)
        is distinct from (old.entry_format,old.team_size,old.discipline_code,old.discipline_detail,old.sets_per_round,old.shots_per_round)) then
      raise exception 'Finalised Series identity is immutable. Create a new Series instead.' using errcode='22023';
    end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;
  sid := case when tg_op='DELETE' then old.competition_series_id else new.competition_series_id end;
  if tg_op='UPDATE' and new.competition_series_id<>old.competition_series_id then
    raise exception 'Series components cannot be moved.' using errcode='22023';
  end if;
  select identity_locked_at into locked from public.competition_series where id=sid for update;
  if locked is not null then raise exception 'Finalised Series components are immutable.' using errcode='22023'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists protect_series_contract on public.competition_series;
create trigger protect_series_contract before update on public.competition_series for each row execute function private.protect_series_contract();
drop trigger if exists protect_series_contract on public.competition_series_score_components;
create trigger protect_series_contract before insert or update or delete on public.competition_series_score_components
  for each row execute function private.protect_series_contract();

create or replace function private.check_series_final_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare sid bigint; cid bigint;
begin
  if tg_table_name='competition_series' then sid:=case when tg_op='DELETE' then old.id else new.id end;
  elsif tg_table_name='competition_score_components' then
    if tg_op='UPDATE' and new.competition_id is distinct from old.competition_id then
      select competition_series_id into sid from public.competitions where id=old.competition_id;
      if sid is not null then perform private.validate_competition_series(sid); end if;
    end if;
    cid:=case when tg_op='DELETE' then old.competition_id else new.competition_id end;
    select competition_series_id into sid from public.competitions where id=cid;
  else sid:=case when tg_op='DELETE' then old.competition_series_id else new.competition_series_id end;
  end if;
  if sid is not null then
    perform private.validate_competition_series(sid,
      exists(select 1 from public.competitions where competition_series_id=sid and status='published')
      or (select count(*) from public.competitions where competition_series_id=sid)>1);
  end if;
  return null;
end $$;
drop trigger if exists check_series_final_state on public.competition_series;
create constraint trigger check_series_final_state after insert or update on public.competition_series
  deferrable initially deferred for each row execute function private.check_series_final_state();
drop trigger if exists check_series_final_state on public.competition_series_score_components;
create constraint trigger check_series_final_state after insert or update or delete on public.competition_series_score_components
  deferrable initially deferred for each row execute function private.check_series_final_state();
drop trigger if exists check_series_final_state on public.competitions;
create constraint trigger check_series_final_state after insert or update or delete on public.competitions
  deferrable initially deferred for each row execute function private.check_series_final_state();
drop trigger if exists check_series_final_state on public.competition_score_components;
create constraint trigger check_series_final_state after insert or update or delete on public.competition_score_components
  deferrable initially deferred for each row execute function private.check_series_final_state();

create or replace function private.protect_series_edition()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.competition_series_id is not null and new.competition_series_id is distinct from old.competition_series_id then
    raise exception 'Series editions cannot be detached or reassigned.' using errcode='22023';
  end if;
  if old.configuration_source_competition_id is not null and
    (new.configuration_source_competition_id is not null and
     new.configuration_source_competition_id is distinct from old.configuration_source_competition_id
     or new.configuration_source_version is distinct from old.configuration_source_version) then
    raise exception 'Configuration provenance is immutable.' using errcode='22023';
  end if;
  if new.status='published' and old.status='draft' and new.competition_series_id is not null then
    perform private.validate_competition_series(new.competition_series_id,true);
  end if;
  return new;
end $$;
drop trigger if exists protect_series_edition on public.competitions;
create trigger protect_series_edition before update on public.competitions for each row execute function private.protect_series_edition();

create or replace function private.protect_series_season_organisation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.organisation_id is distinct from old.organisation_id and exists (
    select 1 from public.competitions where league_season_id=old.id and competition_series_id is not null) then
    raise exception 'A Season containing Series editions cannot change Organisation.' using errcode='22023';
  end if;
  return new;
end $$;
drop trigger if exists protect_series_season_organisation on public.league_seasons;
create trigger protect_series_season_organisation before update of organisation_id on public.league_seasons
  for each row execute function private.protect_series_season_organisation();

revoke all on function private.competition_series_components(bigint), private.competition_components(bigint),
  private.require_competition_author(bigint,boolean), private.validate_competition_series(bigint,boolean),
  private.protect_series_contract(), private.check_series_final_state(), private.protect_series_edition(),
  private.protect_series_season_organisation() from public,anon,authenticated;
commit;
