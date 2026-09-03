-- Run after database/user-profiles.sql, database/organisations.sql,
-- database/organisation-staff.sql, and database/league-seasons.sql.
-- Adds competition configuration and explicit round deadlines only. Entries,
-- divisions, scores, standings, and payments are intentionally out of scope.

begin;

create table if not exists public.competitions (
  id bigint generated always as identity primary key,
  league_season_id bigint not null
    references public.league_seasons (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  status text not null default 'draft',
  entry_format text not null,
  team_size integer not null,
  scoring_method text not null,
  maximum_score_per_round integer,
  shots_per_round integer,
  uses_x_score boolean not null default false,
  number_of_rounds integer not null,
  entry_fee numeric(8, 2),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competitions_name_value check (
    char_length(name) between 2 and 160
    and name = btrim(name)
  ),
  constraint competitions_slug_value check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(slug) between 2 and 180
  ),
  constraint competitions_description_value check (
    description is null
    or (
      char_length(description) between 1 and 2000
      and description = btrim(description)
    )
  ),
  constraint competitions_status_value check (
    status in ('draft', 'published')
  ),
  constraint competitions_entry_format_value check (
    entry_format in ('individual', 'pairs', 'team')
  ),
  constraint competitions_team_size_value check (
    (entry_format = 'individual' and team_size = 1)
    or (entry_format = 'pairs' and team_size = 2)
    or (entry_format = 'team' and team_size between 3 and 20)
  ),
  constraint competitions_scoring_method_value check (
    scoring_method in ('points_dropped', 'points_scored')
  ),
  constraint competitions_maximum_score_value check (
    maximum_score_per_round is null
    or maximum_score_per_round between 1 and 1000000
  ),
  constraint competitions_shots_per_round_value check (
    shots_per_round is null
    or shots_per_round between 1 and 10000
  ),
  constraint competitions_number_of_rounds_value check (
    number_of_rounds between 1 and 52
  ),
  constraint competitions_entry_fee_value check (
    entry_fee is null or entry_fee between 0 and 10000
  ),
  constraint competitions_season_slug_unique unique (
    league_season_id,
    slug
  )
);

comment on table public.competitions is
  'League-season competition configuration. Entries, divisions, scores, and standings are separate future entities.';

comment on column public.competitions.slug is
  'Stable season-scoped route slug generated at creation; renaming a competition does not change it.';

comment on column public.competitions.status is
  'Configuration visibility only: draft or published. The parent league season owns the wider lifecycle.';

comment on column public.competitions.entry_fee is
  'Optional GBP entry fee display value only. No payment state or processing is attached.';

create table if not exists public.competition_rounds (
  id bigint generated always as identity primary key,
  competition_id bigint not null
    references public.competitions (id) on delete cascade,
  round_number integer not null,
  deadline date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_rounds_round_number_value check (
    round_number between 1 and 52
  ),
  constraint competition_rounds_deadline_value check (
    deadline between date '1900-01-01' and date '2200-12-31'
  ),
  constraint competition_rounds_competition_number_unique unique (
    competition_id,
    round_number
  )
);

comment on table public.competition_rounds is
  'Explicit competition round deadlines. A row contains no entry, score, result, or round-opening state.';

comment on column public.competition_rounds.deadline is
  'The round completion/recording deadline, not a round start date or score-entry lock.';

-- The season/slug constraint and round uniqueness cover their leading foreign
-- keys. These indexes support status-filtered listings and nullable audit FKs.
create index if not exists competitions_season_status_id_idx
  on public.competitions (league_season_id, status, id);

create unique index if not exists competitions_season_lower_name_unique_idx
  on public.competitions (league_season_id, lower(name));

create index if not exists competitions_created_by_idx
  on public.competitions (created_by)
  where created_by is not null;

create index if not exists competitions_updated_by_idx
  on public.competitions (updated_by)
  where updated_by is not null;

create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at()
  from public, anon, authenticated;

drop trigger if exists set_competitions_updated_at
  on public.competitions;
create trigger set_competitions_updated_at
  before update on public.competitions
  for each row execute function private.set_updated_at();

drop trigger if exists set_competition_rounds_updated_at
  on public.competition_rounds;
create trigger set_competition_rounds_updated_at
  before update on public.competition_rounds
  for each row execute function private.set_updated_at();

-- Defence in depth for writes outside the application RPCs. The RPCs perform
-- the same checks before inserting so callers receive useful validation errors.
create or replace function private.validate_competition_round()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_number_of_rounds integer;
  v_starts_at date;
  v_ends_at date;
begin
  select competition.number_of_rounds, season.starts_at, season.ends_at
  into v_number_of_rounds, v_starts_at, v_ends_at
  from public.competitions as competition
  join public.league_seasons as season
    on season.id = competition.league_season_id
  where competition.id = new.competition_id;

  if v_number_of_rounds is null then
    raise exception 'Competition not found for round deadline.'
      using errcode = '23503';
  end if;

  if new.round_number > v_number_of_rounds then
    raise exception 'Round number exceeds the competition round count.'
      using errcode = '22023';
  end if;

  if v_starts_at is not null and new.deadline < v_starts_at then
    raise exception 'Round deadline falls before the league season starts.'
      using errcode = '22023';
  end if;

  if v_ends_at is not null and new.deadline > v_ends_at then
    raise exception 'Round deadline falls after the league season ends.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function private.validate_competition_round()
  from public, anon, authenticated;

drop trigger if exists validate_competition_round
  on public.competition_rounds;
create trigger validate_competition_round
  before insert or update of competition_id, round_number, deadline
  on public.competition_rounds
  for each row execute function private.validate_competition_round();

-- Later season date edits cannot silently make any persisted round deadline
-- invalid. Drafts may omit deadlines, but every deadline they do store remains
-- inside the season boundaries that exist.
create or replace function private.protect_competition_season_bounds()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invalid_round_number integer;
begin
  if new.starts_at is not distinct from old.starts_at
    and new.ends_at is not distinct from old.ends_at then
    return new;
  end if;

  select competition_round.round_number
  into v_invalid_round_number
  from public.competitions as competition
  join public.competition_rounds as competition_round
    on competition_round.competition_id = competition.id
  where competition.league_season_id = new.id
    and (
      (new.starts_at is not null and competition_round.deadline < new.starts_at)
      or (new.ends_at is not null and competition_round.deadline > new.ends_at)
    )
  order by competition_round.round_number
  limit 1;

  if v_invalid_round_number is not null then
    raise exception 'Season dates would exclude round % of a configured competition.',
      v_invalid_round_number
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_competition_season_bounds()
  from public, anon, authenticated;

drop trigger if exists protect_competition_season_bounds
  on public.league_seasons;
create trigger protect_competition_season_bounds
  before update of starts_at, ends_at on public.league_seasons
  for each row
  execute function private.protect_competition_season_bounds();

alter table public.competitions enable row level security;
alter table public.competition_rounds enable row level security;

-- Both tables are read-only through the Data API. All mutations use the two
-- exact-scope, active-owner RPCs below.
revoke all privileges on table public.competitions from anon, authenticated;
revoke all privileges on sequence public.competitions_id_seq
  from anon, authenticated;
grant select (
  id,
  league_season_id,
  name,
  slug,
  description,
  status,
  entry_format,
  team_size,
  scoring_method,
  maximum_score_per_round,
  shots_per_round,
  uses_x_score,
  number_of_rounds,
  entry_fee,
  created_at,
  updated_at
) on table public.competitions to authenticated;

revoke all privileges on table public.competition_rounds
  from anon, authenticated;
revoke all privileges on sequence public.competition_rounds_id_seq
  from anon, authenticated;
grant select (
  id,
  competition_id,
  round_number,
  deadline,
  created_at,
  updated_at
) on table public.competition_rounds to authenticated;

drop policy if exists "Authenticated users can read visible competitions"
  on public.competitions;
create policy "Authenticated users can read visible competitions"
on public.competitions
for select
to authenticated
using (
  exists (
    select 1
    from public.league_seasons as season
    join public.organisations as organisation
      on organisation.id = season.organisation_id
    where season.id = competitions.league_season_id
      and organisation.status = 'active'
      and (
        (
          competitions.status = 'published'
          and season.status in ('open', 'active', 'completed')
        )
        or exists (
          select 1
          from public.organisation_staff as staff
          where staff.organisation_id = season.organisation_id
            and staff.user_id = (select auth.uid())
            and staff.role = 'owner'
            and staff.status = 'active'
        )
      )
  )
);

drop policy if exists "Authenticated users can read visible competition rounds"
  on public.competition_rounds;
create policy "Authenticated users can read visible competition rounds"
on public.competition_rounds
for select
to authenticated
using (
  exists (
    select 1
    from public.competitions as competition
    where competition.id = competition_rounds.competition_id
  )
);

create or replace function public.create_competition(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_name text,
  p_description text,
  p_entry_format text,
  p_team_size integer,
  p_scoring_method text,
  p_maximum_score_per_round integer,
  p_shots_per_round integer,
  p_uses_x_score boolean,
  p_number_of_rounds integer,
  p_entry_fee numeric,
  p_round_deadlines date[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_entry_format text := btrim(coalesce(p_entry_format, ''));
  v_scoring_method text := btrim(coalesce(p_scoring_method, ''));
  v_team_size integer;
  v_round_deadlines date[] := coalesce(p_round_deadlines, array[]::date[]);
  v_slug text;
  v_organisation_slug text;
  v_season_slug text;
  v_starts_at date;
  v_ends_at date;
  v_competition_id bigint;
  v_round_number integer;
  v_previous_deadline date;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 160 then
    raise exception 'Competition name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Competition description must not exceed 2,000 characters.'
      using errcode = '22023';
  end if;

  if v_entry_format not in ('individual', 'pairs', 'team') then
    raise exception 'Select a valid entry format.' using errcode = '22023';
  end if;

  v_team_size := case v_entry_format
    when 'individual' then 1
    when 'pairs' then 2
    else p_team_size
  end;

  if v_team_size is null
    or (v_entry_format = 'team' and v_team_size not between 3 and 20) then
    raise exception 'Team entries must contain between 3 and 20 shooters.'
      using errcode = '22023';
  end if;

  if v_scoring_method not in ('points_dropped', 'points_scored') then
    raise exception 'Select a valid scoring method.' using errcode = '22023';
  end if;

  if p_maximum_score_per_round is not null
    and p_maximum_score_per_round not between 1 and 1000000 then
    raise exception 'Maximum score per round must be between 1 and 1,000,000.'
      using errcode = '22023';
  end if;

  if p_shots_per_round is not null
    and p_shots_per_round not between 1 and 10000 then
    raise exception 'Shots per round must be between 1 and 10,000.'
      using errcode = '22023';
  end if;

  if p_number_of_rounds is null or p_number_of_rounds not between 1 and 52 then
    raise exception 'Number of rounds must be between 1 and 52.'
      using errcode = '22023';
  end if;

  if p_entry_fee is not null
    and (
      p_entry_fee < 0
      or p_entry_fee > 10000
      or p_entry_fee <> round(p_entry_fee, 2)
    ) then
    raise exception 'Entry fee must be between £0 and £10,000 with no more than two decimal places.'
      using errcode = '22023';
  end if;

  if cardinality(v_round_deadlines) not in (0, p_number_of_rounds)
    or (
      cardinality(v_round_deadlines) > 0
      and array_lower(v_round_deadlines, 1) <> 1
    ) then
    raise exception 'Round deadlines must contain either zero items or exactly one position per configured round.'
      using errcode = '22023';
  end if;

  v_slug := lower(
    regexp_replace(
      regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    )
  );

  if char_length(v_slug) not between 2 and 180 then
    raise exception 'The competition name cannot produce a route-safe web address.'
      using errcode = '22023';
  end if;

  select organisation.slug
  into v_organisation_slug
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for share;

  if v_organisation_slug is null then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  perform staff.id
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and staff.user_id = v_actor_id
    and staff.role = 'owner'
    and staff.status = 'active'
  for share;

  if not found then
    raise exception 'Only this organisation owner can create competitions.'
      using errcode = '42501';
  end if;

  select season.slug, season.starts_at, season.ends_at
  into v_season_slug, v_starts_at, v_ends_at
  from public.league_seasons as season
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id
  for share;

  if v_season_slug is null then
    raise exception 'League season not found in this organisation.'
      using errcode = 'P0002';
  end if;

  if cardinality(v_round_deadlines) > 0 then
    for v_round_number in 1..p_number_of_rounds loop
      if v_round_deadlines[v_round_number] is null then
        continue;
      end if;

      if v_round_deadlines[v_round_number]
        not between date '1900-01-01' and date '2200-12-31' then
        raise exception 'Round % has an unsupported deadline.', v_round_number
          using errcode = '22023';
      end if;

      if v_starts_at is not null
        and v_round_deadlines[v_round_number] < v_starts_at then
        raise exception 'Round % falls before the league season starts.', v_round_number
          using errcode = '22023';
      end if;

      if v_ends_at is not null
        and v_round_deadlines[v_round_number] > v_ends_at then
        raise exception 'Round % falls after the league season ends.', v_round_number
          using errcode = '22023';
      end if;

      if v_previous_deadline is not null
        and v_round_deadlines[v_round_number] < v_previous_deadline then
        raise exception 'Round deadlines cannot move backwards in time.'
          using errcode = '22023';
      end if;

      v_previous_deadline := v_round_deadlines[v_round_number];
    end loop;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_league_season_id::text || ':' || v_slug, 0)
  );

  if exists (
    select 1
    from public.competitions as competition
    where competition.league_season_id = p_league_season_id
      and (
        competition.slug = v_slug
        or lower(competition.name) = lower(v_name)
      )
  ) then
    raise exception 'A competition with this name already exists in this league season.'
      using errcode = '23505';
  end if;

  insert into public.competitions (
    league_season_id,
    name,
    slug,
    description,
    status,
    entry_format,
    team_size,
    scoring_method,
    maximum_score_per_round,
    shots_per_round,
    uses_x_score,
    number_of_rounds,
    entry_fee,
    created_by,
    updated_by
  )
  values (
    p_league_season_id,
    v_name,
    v_slug,
    v_description,
    'draft',
    v_entry_format,
    v_team_size,
    v_scoring_method,
    p_maximum_score_per_round,
    p_shots_per_round,
    coalesce(p_uses_x_score, false),
    p_number_of_rounds,
    p_entry_fee,
    v_actor_id,
    v_actor_id
  )
  returning id into v_competition_id;

  if cardinality(v_round_deadlines) > 0 then
    insert into public.competition_rounds (
      competition_id,
      round_number,
      deadline
    )
    select
      v_competition_id,
      supplied.round_number::integer,
      supplied.deadline
    from unnest(v_round_deadlines) with ordinality
      as supplied(deadline, round_number)
    where supplied.deadline is not null;
  end if;

  return jsonb_build_object(
    'id', v_competition_id,
    'organisation_slug', v_organisation_slug,
    'season_slug', v_season_slug,
    'competition_slug', v_slug,
    'status', 'draft'
  );
exception
  when unique_violation then
    raise exception 'A competition with this name already exists in this league season.'
      using errcode = '23505';
end;
$$;

create or replace function public.update_competition(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_name text,
  p_description text,
  p_entry_format text,
  p_team_size integer,
  p_scoring_method text,
  p_maximum_score_per_round integer,
  p_shots_per_round integer,
  p_uses_x_score boolean,
  p_number_of_rounds integer,
  p_entry_fee numeric,
  p_round_deadlines date[],
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_entry_format text := btrim(coalesce(p_entry_format, ''));
  v_scoring_method text := btrim(coalesce(p_scoring_method, ''));
  v_status text := btrim(coalesce(p_status, ''));
  v_team_size integer;
  v_round_deadlines date[] := coalesce(p_round_deadlines, array[]::date[]);
  v_organisation_slug text;
  v_season_slug text;
  v_competition_slug text;
  v_current_status text;
  v_starts_at date;
  v_ends_at date;
  v_round_number integer;
  v_previous_deadline date;
  v_deadline_count integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 160 then
    raise exception 'Competition name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Competition description must not exceed 2,000 characters.'
      using errcode = '22023';
  end if;

  if v_entry_format not in ('individual', 'pairs', 'team') then
    raise exception 'Select a valid entry format.' using errcode = '22023';
  end if;

  v_team_size := case v_entry_format
    when 'individual' then 1
    when 'pairs' then 2
    else p_team_size
  end;

  if v_team_size is null
    or (v_entry_format = 'team' and v_team_size not between 3 and 20) then
    raise exception 'Team entries must contain between 3 and 20 shooters.'
      using errcode = '22023';
  end if;

  if v_scoring_method not in ('points_dropped', 'points_scored') then
    raise exception 'Select a valid scoring method.' using errcode = '22023';
  end if;

  if p_maximum_score_per_round is not null
    and p_maximum_score_per_round not between 1 and 1000000 then
    raise exception 'Maximum score per round must be between 1 and 1,000,000.'
      using errcode = '22023';
  end if;

  if p_shots_per_round is not null
    and p_shots_per_round not between 1 and 10000 then
    raise exception 'Shots per round must be between 1 and 10,000.'
      using errcode = '22023';
  end if;

  if p_number_of_rounds is null or p_number_of_rounds not between 1 and 52 then
    raise exception 'Number of rounds must be between 1 and 52.'
      using errcode = '22023';
  end if;

  if p_entry_fee is not null
    and (
      p_entry_fee < 0
      or p_entry_fee > 10000
      or p_entry_fee <> round(p_entry_fee, 2)
    ) then
    raise exception 'Entry fee must be between £0 and £10,000 with no more than two decimal places.'
      using errcode = '22023';
  end if;

  if v_status not in ('draft', 'published') then
    raise exception 'Select a valid competition status.' using errcode = '22023';
  end if;

  if cardinality(v_round_deadlines) not in (0, p_number_of_rounds)
    or (
      cardinality(v_round_deadlines) > 0
      and array_lower(v_round_deadlines, 1) <> 1
    ) then
    raise exception 'Round deadlines must contain either zero items or exactly one position per configured round.'
      using errcode = '22023';
  end if;

  select organisation.slug
  into v_organisation_slug
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for share;

  if v_organisation_slug is null then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  perform staff.id
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and staff.user_id = v_actor_id
    and staff.role = 'owner'
    and staff.status = 'active'
  for share;

  if not found then
    raise exception 'Only this organisation owner can edit competitions.'
      using errcode = '42501';
  end if;

  select season.slug, season.starts_at, season.ends_at
  into v_season_slug, v_starts_at, v_ends_at
  from public.league_seasons as season
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id
  for share;

  if v_season_slug is null then
    raise exception 'League season not found in this organisation.'
      using errcode = 'P0002';
  end if;

  select competition.slug, competition.status
  into v_competition_slug, v_current_status
  from public.competitions as competition
  where competition.id = p_competition_id
    and competition.league_season_id = p_league_season_id
  for update;

  if v_competition_slug is null then
    raise exception 'Competition not found in this league season.'
      using errcode = 'P0002';
  end if;

  if v_status <> v_current_status
    and not (v_current_status = 'draft' and v_status = 'published') then
    raise exception 'A competition may only move from draft to published.'
      using errcode = '22023';
  end if;

  if cardinality(v_round_deadlines) > 0 then
    for v_round_number in 1..p_number_of_rounds loop
      if v_round_deadlines[v_round_number] is null then
        continue;
      end if;

      if v_round_deadlines[v_round_number]
        not between date '1900-01-01' and date '2200-12-31' then
        raise exception 'Round % has an unsupported deadline.', v_round_number
          using errcode = '22023';
      end if;

      if v_starts_at is not null
        and v_round_deadlines[v_round_number] < v_starts_at then
        raise exception 'Round % falls before the league season starts.', v_round_number
          using errcode = '22023';
      end if;

      if v_ends_at is not null
        and v_round_deadlines[v_round_number] > v_ends_at then
        raise exception 'Round % falls after the league season ends.', v_round_number
          using errcode = '22023';
      end if;

      if v_previous_deadline is not null
        and v_round_deadlines[v_round_number] < v_previous_deadline then
        raise exception 'Round deadlines cannot move backwards in time.'
          using errcode = '22023';
      end if;

      v_previous_deadline := v_round_deadlines[v_round_number];
    end loop;
  end if;

  if exists (
    select 1
    from public.competitions as other_competition
    where other_competition.league_season_id = p_league_season_id
      and other_competition.id <> p_competition_id
      and lower(other_competition.name) = lower(v_name)
  ) then
    raise exception 'A competition with this name already exists in this league season.'
      using errcode = '23505';
  end if;

  -- Replace the explicit schedule and metadata in one transaction. If any
  -- validation or insert fails, PostgreSQL restores the previous configuration.
  delete from public.competition_rounds as round
  where round.competition_id = p_competition_id;

  update public.competitions as competition
  set name = v_name,
      description = v_description,
      entry_format = v_entry_format,
      team_size = v_team_size,
      scoring_method = v_scoring_method,
      maximum_score_per_round = p_maximum_score_per_round,
      shots_per_round = p_shots_per_round,
      uses_x_score = coalesce(p_uses_x_score, false),
      number_of_rounds = p_number_of_rounds,
      entry_fee = p_entry_fee,
      updated_by = v_actor_id
  where competition.id = p_competition_id
    and competition.league_season_id = p_league_season_id;

  if cardinality(v_round_deadlines) > 0 then
    insert into public.competition_rounds (
      competition_id,
      round_number,
      deadline
    )
    select
      p_competition_id,
      supplied.round_number::integer,
      supplied.deadline
    from unnest(v_round_deadlines) with ordinality
      as supplied(deadline, round_number)
    where supplied.deadline is not null;
  end if;

  if v_status = 'published' then
    if p_maximum_score_per_round is null then
      raise exception 'Set the maximum score per round before publishing.'
        using errcode = '22023';
    end if;

    if p_shots_per_round is null then
      raise exception 'Set the shots per round before publishing.'
        using errcode = '22023';
    end if;

    select count(*)::integer
    into v_deadline_count
    from public.competition_rounds as round
    where round.competition_id = p_competition_id;

    if v_deadline_count <> p_number_of_rounds then
      raise exception 'Set a deadline for every configured round before publishing.'
        using errcode = '22023';
    end if;

    update public.competitions as competition
    set status = 'published',
        updated_by = v_actor_id
    where competition.id = p_competition_id
      and competition.league_season_id = p_league_season_id;
  end if;

  return jsonb_build_object(
    'id', p_competition_id,
    'organisation_slug', v_organisation_slug,
    'season_slug', v_season_slug,
    'competition_slug', v_competition_slug,
    'status', v_status
  );
exception
  when unique_violation then
    raise exception 'A competition with this name already exists in this league season.'
      using errcode = '23505';
end;
$$;

comment on function public.create_competition(
  bigint,
  bigint,
  text,
  text,
  text,
  integer,
  text,
  integer,
  integer,
  boolean,
  integer,
  numeric,
  date[]
) is
  'Creates one private draft competition and its supplied explicit deadlines after exact active-owner authorization.';

comment on function public.update_competition(
  bigint,
  bigint,
  bigint,
  text,
  text,
  text,
  integer,
  text,
  integer,
  integer,
  boolean,
  integer,
  numeric,
  date[],
  text
) is
  'Atomically updates competition configuration and explicit deadlines; draft-to-published requires complete valid data.';

revoke execute on function public.create_competition(
  bigint,
  bigint,
  text,
  text,
  text,
  integer,
  text,
  integer,
  integer,
  boolean,
  integer,
  numeric,
  date[]
) from public, anon, authenticated;
grant execute on function public.create_competition(
  bigint,
  bigint,
  text,
  text,
  text,
  integer,
  text,
  integer,
  integer,
  boolean,
  integer,
  numeric,
  date[]
) to authenticated;

revoke execute on function public.update_competition(
  bigint,
  bigint,
  bigint,
  text,
  text,
  text,
  integer,
  text,
  integer,
  integer,
  boolean,
  integer,
  numeric,
  date[],
  text
) from public, anon, authenticated;
grant execute on function public.update_competition(
  bigint,
  bigint,
  bigint,
  text,
  text,
  text,
  integer,
  text,
  integer,
  integer,
  boolean,
  integer,
  numeric,
  date[],
  text
) to authenticated;

commit;
