-- Run after database/user-profiles.sql, database/organisations.sql, and
-- database/organisation-staff.sql. Adds the first league-domain entity:
-- organisation-owned league season containers. Competitions are intentionally
-- outside this schema.

begin;

create table if not exists public.league_seasons (
  id bigint generated always as identity primary key,
  organisation_id bigint not null
    references public.organisations (id) on delete cascade,
  name text not null,
  description text,
  slug text not null,
  status text not null default 'draft',
  entry_opens_at date,
  entry_closes_at date,
  starts_at date,
  ends_at date,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint league_seasons_name_value check (
    char_length(name) between 2 and 160
    and name = btrim(name)
  ),
  constraint league_seasons_slug_value check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(slug) between 2 and 180
  ),
  constraint league_seasons_status_value check (
    status in ('draft', 'open', 'active', 'completed')
  ),
  constraint league_seasons_entry_dates_order check (
    entry_opens_at is null
    or entry_closes_at is null
    or entry_closes_at >= entry_opens_at
  ),
  constraint league_seasons_dates_order check (
    starts_at is null
    or ends_at is null
    or ends_at >= starts_at
  ),
  constraint league_seasons_organisation_slug_unique unique (
    organisation_id,
    slug
  )
);

-- Existing installations gain one nullable column without rewriting or
-- backfilling any season row. A missing description remains NULL.
alter table public.league_seasons
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'league_seasons_description_length'
      and conrelid = 'public.league_seasons'::regclass
  ) then
    alter table public.league_seasons
      add constraint league_seasons_description_length
      check (
        description is null
        or (
          char_length(description) <= 2000
          and description = btrim(description)
        )
      ) not valid;
  end if;
end;
$$;

alter table public.league_seasons
  validate constraint league_seasons_description_length;

comment on table public.league_seasons is
  'Organisation-owned league season containers. Competitions, entries, scores, and standings are separate future entities.';

comment on column public.league_seasons.slug is
  'Stable organisation-scoped route slug generated when the season is created; renaming a season does not change it.';

comment on column public.league_seasons.status is
  'Manual lifecycle: draft, open, active, completed. Only the next forward status is accepted by the update RPC.';

comment on column public.league_seasons.description is
  'Optional plain-text season description, limited to 2,000 characters.';

-- Supports grouped organisation listings and Overview lookups. PostgreSQL does
-- not automatically index the nullable profile foreign keys.
create index if not exists league_seasons_organisation_status_starts_idx
  on public.league_seasons (organisation_id, status, starts_at, id);

create index if not exists league_seasons_created_by_idx
  on public.league_seasons (created_by)
  where created_by is not null;

create index if not exists league_seasons_updated_by_idx
  on public.league_seasons (updated_by)
  where updated_by is not null;

drop trigger if exists set_league_seasons_updated_at
  on public.league_seasons;
create trigger set_league_seasons_updated_at
  before update on public.league_seasons
  for each row execute function private.set_updated_at();

alter table public.league_seasons enable row level security;

-- Data API access is read-only. Creation and editing are available only through
-- the two owner-authorising RPCs below.
revoke all privileges on table public.league_seasons from anon, authenticated;
revoke all privileges on sequence public.league_seasons_id_seq
  from anon, authenticated;
grant select (
  id,
  organisation_id,
  name,
  description,
  slug,
  status,
  entry_opens_at,
  entry_closes_at,
  starts_at,
  ends_at,
  created_at,
  updated_at
) on table public.league_seasons to authenticated;

drop policy if exists "Authenticated users can read visible league seasons"
  on public.league_seasons;
create policy "Authenticated users can read visible league seasons"
on public.league_seasons
for select
to authenticated
using (
  status in ('open', 'active', 'completed')
  or exists (
    select 1
    from public.organisation_staff as staff
    where staff.organisation_id = league_seasons.organisation_id
      and staff.user_id = (select auth.uid())
      and staff.role = 'owner'
      and staff.status = 'active'
  )
);

create or replace function public.create_league_season(
  p_organisation_id bigint,
  p_name text,
  p_entry_opens_at date,
  p_entry_closes_at date,
  p_starts_at date,
  p_ends_at date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text;
  v_organisation_slug text;
  v_season_id bigint;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 160 then
    raise exception 'League name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if p_entry_opens_at is not null
    and p_entry_closes_at is not null
    and p_entry_closes_at < p_entry_opens_at then
    raise exception 'Entry close date cannot be before entry open date.'
      using errcode = '22023';
  end if;

  if p_starts_at is not null
    and p_ends_at is not null
    and p_ends_at < p_starts_at then
    raise exception 'End date cannot be before start date.'
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
    raise exception 'The league name cannot produce a route-safe web address.'
      using errcode = '22023';
  end if;

  -- Keep the organisation active while ownership is checked and the season is
  -- inserted. The RPC still rechecks the exact active owner row independently.
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
    raise exception 'Only this organisation owner can create a league season.'
      using errcode = '42501';
  end if;

  -- Serialise equivalent organisation/slug submissions so concurrent requests
  -- return the same useful duplicate error rather than creating ambiguity.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organisation_id::text || ':' || v_slug, 0)
  );

  if exists (
    select 1
    from public.league_seasons as season
    where season.organisation_id = p_organisation_id
      and (
        season.slug = v_slug
        or lower(season.name) = lower(v_name)
      )
  ) then
    raise exception 'A league season with this name already exists in this organisation.'
      using errcode = '23505';
  end if;

  insert into public.league_seasons (
    organisation_id,
    name,
    slug,
    status,
    entry_opens_at,
    entry_closes_at,
    starts_at,
    ends_at,
    created_by,
    updated_by
  )
  values (
    p_organisation_id,
    v_name,
    v_slug,
    'draft',
    p_entry_opens_at,
    p_entry_closes_at,
    p_starts_at,
    p_ends_at,
    v_actor_id,
    v_actor_id
  )
  returning id into v_season_id;

  return jsonb_build_object(
    'id', v_season_id,
    'organisation_slug', v_organisation_slug,
    'season_slug', v_slug,
    'status', 'draft'
  );
exception
  when unique_violation then
    raise exception 'A league season with this name already exists in this organisation.'
      using errcode = '23505';
end;
$$;

comment on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date
) is
  'Creates one draft season after verifying the authenticated caller is the active owner of the active organisation.';

revoke execute on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date
) from public, anon, authenticated;
grant execute on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date
) to authenticated;

create or replace function public.update_league_season(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_name text,
  p_entry_opens_at date,
  p_entry_closes_at date,
  p_starts_at date,
  p_ends_at date,
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
  v_status text := btrim(coalesce(p_status, ''));
  v_candidate_slug text;
  v_organisation_slug text;
  v_season_slug text;
  v_current_status text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 160 then
    raise exception 'League name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if v_status not in ('draft', 'open', 'active', 'completed') then
    raise exception 'Select a valid league status.' using errcode = '22023';
  end if;

  if p_entry_opens_at is not null
    and p_entry_closes_at is not null
    and p_entry_closes_at < p_entry_opens_at then
    raise exception 'Entry close date cannot be before entry open date.'
      using errcode = '22023';
  end if;

  if p_starts_at is not null
    and p_ends_at is not null
    and p_ends_at < p_starts_at then
    raise exception 'End date cannot be before start date.'
      using errcode = '22023';
  end if;

  v_candidate_slug := lower(
    regexp_replace(
      regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    )
  );

  if char_length(v_candidate_slug) not between 2 and 180 then
    raise exception 'The league name cannot produce a route-safe web address.'
      using errcode = '22023';
  end if;

  -- Authorise the organisation scope before looking up the season ID. This
  -- prevents callers from probing whether a season in another organisation
  -- exists by comparing not-found and permission errors.
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
    raise exception 'Only this organisation owner can edit the league season.'
      using errcode = '42501';
  end if;

  select season.slug, season.status
  into v_season_slug, v_current_status
  from public.league_seasons as season
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id
  for update;

  if v_season_slug is null then
    raise exception 'League season not found in this organisation.'
      using errcode = 'P0002';
  end if;

  if v_status <> v_current_status
    and not (
      (v_current_status = 'draft' and v_status = 'open')
      or (v_current_status = 'open' and v_status = 'active')
      or (v_current_status = 'active' and v_status = 'completed')
    ) then
    raise exception 'League status may only move one step forward.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organisation_id::text || ':' || v_candidate_slug,
      0
    )
  );

  if exists (
    select 1
    from public.league_seasons as other_season
    where other_season.organisation_id = p_organisation_id
      and other_season.id <> p_league_season_id
      and (
        other_season.slug = v_candidate_slug
        or lower(other_season.name) = lower(v_name)
      )
  ) then
    raise exception 'A league season with this name already exists in this organisation.'
      using errcode = '23505';
  end if;

  update public.league_seasons as season
  set name = v_name,
      entry_opens_at = p_entry_opens_at,
      entry_closes_at = p_entry_closes_at,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      status = v_status,
      updated_by = v_actor_id
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;

  return jsonb_build_object(
    'id', p_league_season_id,
    'organisation_slug', v_organisation_slug,
    'season_slug', v_season_slug,
    'status', v_status
  );
exception
  when unique_violation then
    raise exception 'A league season with this name already exists in this organisation.'
      using errcode = '23505';
end;
$$;

comment on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) is
  'Updates mutable season fields after verifying the active owner of the season organisation; the route slug remains stable.';

revoke execute on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) from public, anon, authenticated;
grant execute on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) to authenticated;

-- Backward-compatible overloads add description support while retaining the
-- original RPC signatures for existing clients. Legacy updates leave any
-- existing description unchanged.
create or replace function public.create_league_season(
  p_organisation_id bigint,
  p_name text,
  p_entry_opens_at date,
  p_entry_closes_at date,
  p_starts_at date,
  p_ends_at date,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_result jsonb;
begin
  if char_length(v_description) > 2000 then
    raise exception 'Season description must contain 2,000 characters or fewer.'
      using errcode = '22023';
  end if;

  v_result := public.create_league_season(
    p_organisation_id,
    p_name,
    p_entry_opens_at,
    p_entry_closes_at,
    p_starts_at,
    p_ends_at
  );

  update public.league_seasons as season
  set description = v_description
  where season.id = (v_result ->> 'id')::bigint
    and season.organisation_id = p_organisation_id;

  return v_result;
end;
$$;

comment on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) is
  'Creates one draft season with an optional plain-text description; preserves the original RPC signature as a compatibility overload.';

revoke execute on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) from public, anon, authenticated;
grant execute on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) to authenticated;

create or replace function public.update_league_season(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_name text,
  p_entry_opens_at date,
  p_entry_closes_at date,
  p_starts_at date,
  p_ends_at date,
  p_status text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_result jsonb;
begin
  if char_length(v_description) > 2000 then
    raise exception 'Season description must contain 2,000 characters or fewer.'
      using errcode = '22023';
  end if;

  v_result := public.update_league_season(
    p_organisation_id,
    p_league_season_id,
    p_name,
    p_entry_opens_at,
    p_entry_closes_at,
    p_starts_at,
    p_ends_at,
    p_status
  );

  update public.league_seasons as season
  set description = v_description
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;

  return v_result;
end;
$$;

comment on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text,
  text
) is
  'Updates mutable season fields including an optional plain-text description; preserves the original RPC signature as a compatibility overload.';

revoke execute on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text,
  text
) to authenticated;

commit;
