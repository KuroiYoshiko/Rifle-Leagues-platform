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
  'Public discovery information for rifle clubs; authenticated officials manage approved fields through a scoped function.';

create table if not exists public.club_memberships (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_memberships_status_value check (
    status in ('pending', 'active', 'rejected', 'left')
  ),
  constraint club_memberships_club_user_unique unique (club_id, user_id)
);

-- Existing installations receive the new role as member without replacing or
-- deleting any membership rows. Keeping the upgrade in the main transaction
-- makes the complete schema file safe to rerun.
alter table public.club_memberships
  add column if not exists role text;
update public.club_memberships
set role = 'member'
where role is null;
alter table public.club_memberships
  alter column role set default 'member',
  alter column role set not null;

alter table public.club_memberships
  drop constraint if exists club_memberships_status_value;
alter table public.club_memberships
  add constraint club_memberships_status_value check (
    status in ('pending', 'active', 'rejected', 'left')
  );

alter table public.club_memberships
  drop constraint if exists club_memberships_role_value;
alter table public.club_memberships
  add constraint club_memberships_role_value check (
    role in ('member', 'official', 'owner')
  );

alter table public.club_memberships
  drop constraint if exists club_memberships_privileged_role_active;
alter table public.club_memberships
  add constraint club_memberships_privileged_role_active check (
    role = 'member' or status = 'active'
  );

comment on table public.club_memberships is
  'One user profile association with one club, including its lifecycle state and club-contextual role.';

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

create index if not exists club_memberships_club_status_updated_idx
  on public.club_memberships (club_id, status, updated_at desc);

-- Existing clubs may have no owner, but no club can have two owners. The
-- privileged-role check above guarantees every owner row is also active.
create unique index if not exists club_memberships_one_owner_per_club_idx
  on public.club_memberships (club_id)
  where role = 'owner';

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

    if new.role is distinct from old.role then
      raise exception 'Club membership roles cannot be changed through self-service updates.'
        using errcode = '42501';
    end if;

    if old.status = 'active'
      and old.role = 'owner'
      and new.status = 'left' then
      raise exception 'Transfer club ownership before leaving this club.'
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

    -- Role is deliberately not client-updatable. Normalising it here lets the
    -- existing status-only self-service API remain intact.
    if new.status in ('pending', 'left') then
      new.role = 'member';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_authenticated_membership_transition()
  from public, anon, authenticated;

-- Returns only the safe profile fields required by club management. It does
-- not change profiles RLS or expose private address/phone fields.
create or replace function public.get_club_members(p_club_id bigint)
returns table (
  membership_id bigint,
  first_name text,
  last_name text,
  membership_status text,
  club_role text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  -- Keep the caller's manager membership stable for the duration of this
  -- authorised read without blocking other club rows.
  perform actor_membership.id
  from public.club_memberships as actor_membership
  where actor_membership.club_id = p_club_id
    and actor_membership.user_id = v_actor_id
  for share;

  if not exists (
    select 1
    from public.club_memberships as actor_membership
    join public.clubs as actor_club
      on actor_club.id = actor_membership.club_id
    where actor_membership.club_id = p_club_id
      and actor_membership.user_id = v_actor_id
      and actor_membership.status = 'active'
      and actor_membership.role in ('official', 'owner')
      and actor_club.status = 'active'
  ) then
    raise exception 'You do not have permission to view this club membership list.'
      using errcode = '42501';
  end if;

  return query
  select
    membership.id,
    profile.first_name,
    profile.last_name,
    membership.status,
    membership.role,
    membership.created_at,
    membership.updated_at
  from public.club_memberships as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.club_id = p_club_id
    and membership.status in ('pending', 'active')
  order by
    case when membership.status = 'pending' then 0 else 1 end,
    membership.updated_at,
    membership.id;
end;
$$;

revoke execute on function public.get_club_members(bigint)
  from public, anon;
grant execute on function public.get_club_members(bigint)
  to authenticated;

create or replace function public.process_club_membership_request(
  p_membership_id bigint,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_club_id bigint;
  v_current_status text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_decision not in ('active', 'rejected') then
    raise exception 'Membership requests may only be approved or rejected.'
      using errcode = '22023';
  end if;

  select membership.club_id
  into v_club_id
  from public.club_memberships as membership
  where membership.id = p_membership_id;

  if not found then
    raise exception 'Membership request not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.club_memberships as actor_membership
    join public.clubs as actor_club
      on actor_club.id = actor_membership.club_id
    where actor_membership.club_id = v_club_id
      and actor_membership.user_id = v_actor_id
      and actor_membership.status = 'active'
      and actor_membership.role in ('official', 'owner')
      and actor_club.status = 'active'
  ) then
    raise exception 'You do not have permission to process this club request.'
      using errcode = '42501';
  end if;

  -- Lock the actor and target in a stable order, then re-check the actor. This
  -- prevents a concurrent demotion or leave from racing the decision.
  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = v_club_id
    and (
      membership.user_id = v_actor_id
      or membership.id = p_membership_id
    )
  order by membership.id
  for update;

  if not exists (
    select 1
    from public.club_memberships as actor_membership
    join public.clubs as actor_club
      on actor_club.id = actor_membership.club_id
    where actor_membership.club_id = v_club_id
      and actor_membership.user_id = v_actor_id
      and actor_membership.status = 'active'
      and actor_membership.role in ('official', 'owner')
      and actor_club.status = 'active'
  ) then
    raise exception 'You do not have permission to process this club request.'
      using errcode = '42501';
  end if;

  select membership.status
  into v_current_status
  from public.club_memberships as membership
  where membership.id = p_membership_id
    and membership.club_id = v_club_id
  for update;

  if not found then
    raise exception 'Membership request not found.' using errcode = 'P0002';
  end if;

  if v_current_status <> 'pending' then
    raise exception 'Only pending membership requests can be processed.'
      using errcode = '22023';
  end if;

  update public.club_memberships
  set status = p_decision,
      role = 'member'
  where id = p_membership_id;

  return p_decision;
end;
$$;

revoke execute on function public.process_club_membership_request(bigint, text)
  from public, anon;
grant execute on function public.process_club_membership_request(bigint, text)
  to authenticated;

create or replace function public.set_club_member_role(
  p_membership_id bigint,
  p_role text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_club_id bigint;
  v_target_status text;
  v_target_role text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_role not in ('member', 'official') then
    raise exception 'This role change is not allowed.' using errcode = '22023';
  end if;

  select membership.club_id
  into v_club_id
  from public.club_memberships as membership
  where membership.id = p_membership_id;

  if not found then
    raise exception 'Club member not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.club_memberships as actor_membership
    join public.clubs as actor_club
      on actor_club.id = actor_membership.club_id
    where actor_membership.club_id = v_club_id
      and actor_membership.user_id = v_actor_id
      and actor_membership.status = 'active'
      and actor_membership.role = 'owner'
      and actor_club.status = 'active'
  ) then
    raise exception 'Only this club owner can manage official access.'
      using errcode = '42501';
  end if;

  -- Lock the owner and target in a stable order, then re-check ownership so a
  -- concurrent transfer cannot race this role change.
  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = v_club_id
    and (
      membership.user_id = v_actor_id
      or membership.id = p_membership_id
    )
  order by membership.id
  for update;

  if not exists (
    select 1
    from public.club_memberships as actor_membership
    join public.clubs as actor_club
      on actor_club.id = actor_membership.club_id
    where actor_membership.club_id = v_club_id
      and actor_membership.user_id = v_actor_id
      and actor_membership.status = 'active'
      and actor_membership.role = 'owner'
      and actor_club.status = 'active'
  ) then
    raise exception 'Only this club owner can manage official access.'
      using errcode = '42501';
  end if;

  select membership.status, membership.role
  into v_target_status, v_target_role
  from public.club_memberships as membership
  where membership.id = p_membership_id
    and membership.club_id = v_club_id
  for update;

  if not found then
    raise exception 'Club member not found.' using errcode = 'P0002';
  end if;

  if v_target_status <> 'active'
    or not (
      (v_target_role = 'member' and p_role = 'official')
      or (v_target_role = 'official' and p_role = 'member')
    ) then
    raise exception 'Only active members and officials can change official access.'
      using errcode = '22023';
  end if;

  update public.club_memberships
  set role = p_role
  where id = p_membership_id;

  return p_role;
end;
$$;

revoke execute on function public.set_club_member_role(bigint, text)
  from public, anon;
grant execute on function public.set_club_member_role(bigint, text)
  to authenticated;

create or replace function public.transfer_club_ownership(
  p_club_id bigint,
  p_target_membership_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_membership_id bigint;
  v_target_user_id uuid;
  v_target_status text;
  v_target_role text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.club_memberships as actor_membership
    join public.clubs as actor_club
      on actor_club.id = actor_membership.club_id
    where actor_membership.club_id = p_club_id
      and actor_membership.user_id = v_actor_id
      and actor_membership.status = 'active'
      and actor_membership.role = 'owner'
      and actor_club.status = 'active'
  ) then
    raise exception 'Only this club owner can transfer ownership.'
      using errcode = '42501';
  end if;

  -- Lock both memberships in a stable order before validating or updating.
  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = p_club_id
    and (
      membership.user_id = v_actor_id
      or membership.id = p_target_membership_id
    )
  order by membership.id
  for update;

  select membership.id
  into v_actor_membership_id
  from public.club_memberships as membership
  join public.clubs as actor_club on actor_club.id = membership.club_id
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.status = 'active'
    and membership.role = 'owner'
    and actor_club.status = 'active';

  if v_actor_membership_id is null then
    raise exception 'Only this club owner can transfer ownership.'
      using errcode = '42501';
  end if;

  select membership.user_id, membership.status, membership.role
  into v_target_user_id, v_target_status, v_target_role
  from public.club_memberships as membership
  where membership.id = p_target_membership_id
    and membership.club_id = p_club_id;

  if not found
    or v_target_user_id = v_actor_id
    or v_target_status <> 'active'
    or v_target_role not in ('member', 'official') then
    raise exception 'Ownership can only be transferred to another active club member.'
      using errcode = '22023';
  end if;

  -- Both writes are part of the RPC transaction. Other transactions cannot
  -- observe the temporary ownerless state between these statements.
  update public.club_memberships
  set role = 'official'
  where id = v_actor_membership_id;

  update public.club_memberships
  set role = 'owner'
  where id = p_target_membership_id;
end;
$$;

revoke execute on function public.transfer_club_ownership(bigint, bigint)
  from public, anon;
grant execute on function public.transfer_club_ownership(bigint, bigint)
  to authenticated;

create or replace function public.update_club_details(
  p_club_id bigint,
  p_name text,
  p_town text,
  p_county text,
  p_postcode text,
  p_website text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  -- Keep the caller's membership stable through authorisation and the update.
  perform actor_membership.id
  from public.club_memberships as actor_membership
  where actor_membership.club_id = p_club_id
    and actor_membership.user_id = v_actor_id
  for update;

  if not exists (
    select 1
    from public.club_memberships as actor_membership
    join public.clubs as actor_club
      on actor_club.id = actor_membership.club_id
    where actor_membership.club_id = p_club_id
      and actor_membership.user_id = v_actor_id
      and actor_membership.status = 'active'
      and actor_membership.role in ('official', 'owner')
      and actor_club.status = 'active'
  ) then
    raise exception 'You do not have permission to edit this club.'
      using errcode = '42501';
  end if;

  update public.clubs
  set name = btrim(p_name),
      town = nullif(btrim(p_town), ''),
      county = nullif(btrim(p_county), ''),
      postcode = nullif(btrim(p_postcode), ''),
      website = nullif(btrim(p_website), '')
  where id = p_club_id
    and status = 'active';

  if not found then
    raise exception 'Active club not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.update_club_details(bigint, text, text, text, text, text)
  from public, anon;
grant execute on function public.update_club_details(bigint, text, text, text, text, text)
  to authenticated;

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
  and role = 'member'
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
