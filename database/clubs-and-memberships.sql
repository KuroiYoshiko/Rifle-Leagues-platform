begin;

create table if not exists public.clubs (
  id bigint generated always as identity primary key,
  name text not null,
  slug text not null,
  town text,
  county text,
  postcode text,
  website text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(name, '')), 'A') ||
    setweight(
      to_tsvector(
        'simple'::regconfig,
        coalesce(town, '') || ' ' ||
        coalesce(county, '') || ' ' ||
        coalesce(postcode, '')
      ),
      'B'
    )
  ) stored,
  constraint clubs_name_length check (
    char_length(name) between 2 and 160 and name = btrim(name)
  ),
  constraint clubs_slug_unique unique (slug),
  constraint clubs_slug_format check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(slug) between 2 and 180
  ),
  constraint clubs_town_length check (
    town is null or (
      char_length(town) between 1 and 100 and town = btrim(town)
    )
  ),
  constraint clubs_county_length check (
    county is null or (
      char_length(county) between 1 and 100 and county = btrim(county)
    )
  ),
  constraint clubs_postcode_length check (
    postcode is null or (
      char_length(postcode) between 1 and 20 and postcode = btrim(postcode)
    )
  ),
  constraint clubs_website_value check (
    website is null or (
      char_length(website) between 8 and 2048
      and website = btrim(website)
      and website ~* '^https?://'
    )
  ),
  constraint clubs_status_value check (status in ('active', 'inactive'))
);

comment on table public.clubs is
  'Public discovery information for rifle clubs. Client access is read-only in this phase.';

create table if not exists public.club_memberships (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_memberships_status_value check (
    status in ('pending', 'active', 'rejected', 'left')
  ),
  constraint club_memberships_club_user_unique unique (club_id, user_id)
);

-- Existing installations need their original status check replaced. Keeping
-- this in the main transaction makes the full schema file safe to rerun.
alter table public.club_memberships
  drop constraint if exists club_memberships_status_value;
alter table public.club_memberships
  add constraint club_memberships_status_value check (
    status in ('pending', 'active', 'rejected', 'left')
  );

comment on table public.club_memberships is
  'One user profile association with one club and its current membership state; users may have rows for multiple clubs.';

-- Supports active-club browsing and indexed full-text discovery without loading
-- the full clubs table into the application.
create index if not exists clubs_active_name_idx
  on public.clubs (name, id)
  where status = 'active';

create index if not exists clubs_active_search_document_idx
  on public.clubs using gin (search_document)
  where status = 'active';

-- The UNIQUE constraint already indexes (club_id, user_id), which supports
-- club-side lookups and the club foreign key. This index supports owner RLS and
-- the dashboard's user/status lookup.
create index if not exists club_memberships_user_status_created_idx
  on public.club_memberships (user_id, status, created_at desc);

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

revoke execute on function private.set_updated_at() from public, anon, authenticated;

-- RLS can independently validate old and new rows, but it cannot safely pair
-- multiple allowed source and destination statuses into an exact transition
-- matrix. This security-invoker trigger closes that gap for Data API users.
create or replace function private.enforce_authenticated_membership_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if new.club_id is distinct from old.club_id
      or new.user_id is distinct from old.user_id then
      raise exception 'Club membership identity cannot be changed.'
        using errcode = '42501';
    end if;

    if not (
      (old.status = 'active' and new.status = 'left')
      or (
        old.status in ('rejected', 'left')
        and new.status = 'pending'
      )
    ) then
      raise exception 'Club membership status transition is not allowed.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_authenticated_membership_transition()
  from public, anon, authenticated;

drop trigger if exists set_clubs_updated_at on public.clubs;
create trigger set_clubs_updated_at
  before update on public.clubs
  for each row execute function private.set_updated_at();

drop trigger if exists set_club_memberships_updated_at on public.club_memberships;
create trigger set_club_memberships_updated_at
  before update on public.club_memberships
  for each row execute function private.set_updated_at();

drop trigger if exists enforce_authenticated_membership_transition
  on public.club_memberships;
create trigger enforce_authenticated_membership_transition
  before update on public.club_memberships
  for each row
  execute function private.enforce_authenticated_membership_transition();

alter table public.clubs enable row level security;
alter table public.club_memberships enable row level security;

-- Explicit grants are required even when public is exposed through Supabase's
-- Data API. RLS then decides which rows an authenticated user can access.
revoke all privileges on table public.clubs from anon, authenticated;
grant select (
  id,
  name,
  slug,
  town,
  county,
  postcode,
  website,
  status,
  created_at,
  updated_at,
  search_document
) on table public.clubs to authenticated;

revoke all privileges on table public.club_memberships from anon, authenticated;
grant select on table public.club_memberships to authenticated;
grant insert (club_id, user_id) on table public.club_memberships to authenticated;
grant update (status) on table public.club_memberships to authenticated;

revoke all privileges on sequence public.club_memberships_id_seq from anon, authenticated;
grant usage on sequence public.club_memberships_id_seq to authenticated;

drop policy if exists "Authenticated users can discover active clubs" on public.clubs;
create policy "Authenticated users can discover active clubs"
on public.clubs
for select
to authenticated
using (status = 'active');

drop policy if exists "Users can read their own club memberships" on public.club_memberships;
create policy "Users can read their own club memberships"
on public.club_memberships
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can request their own pending club membership" on public.club_memberships;
create policy "Users can request their own pending club membership"
on public.club_memberships
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'pending'
  and exists (
    select 1
    from public.clubs
    where clubs.id = club_memberships.club_id
      and clubs.status = 'active'
  )
);

-- Authenticated users can act only on their own lifecycle rows. The transition
-- trigger above pairs each source state with its permitted destination state.
-- The column-level grant prevents club_id, user_id, or timestamp changes.
drop policy if exists "Users can retry their own rejected club membership" on public.club_memberships;
drop policy if exists "Users can manage their own club membership lifecycle" on public.club_memberships;
create policy "Users can manage their own club membership lifecycle"
on public.club_memberships
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and status in ('active', 'rejected', 'left')
)
with check (
  (select auth.uid()) = user_id
  and (
    status = 'left'
    or (
      status = 'pending'
      and exists (
        select 1
        from public.clubs
        where clubs.id = club_memberships.club_id
          and clubs.status = 'active'
      )
    )
  )
);

commit;
