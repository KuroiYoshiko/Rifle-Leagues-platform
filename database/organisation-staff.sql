begin;

create table if not exists public.organisation_staff (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'manager',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_staff_role_value check (
    role in ('owner', 'manager')
  ),
  constraint organisation_staff_status_value check (
    status in ('pending', 'active', 'rejected', 'revoked')
  ),
  constraint organisation_staff_owner_active check (
    role <> 'owner' or status = 'active'
  ),
  constraint organisation_staff_organisation_user_unique unique (
    organisation_id,
    user_id
  )
);

comment on table public.organisation_staff is
  'Administrative access to an existing organisation. This is separate from personal user_organisations dashboard follows.';

comment on column public.organisation_staff.role is
  'Administrative role. Managers administer the organisation; the single owner additionally controls staff access and ownership.';

comment on column public.organisation_staff.status is
  'Access lifecycle. Only active rows grant organisation-management access.';

-- The unique constraint supports organisation-side staff lookups. These indexes
-- cover the user-side sidebar query and status-filtered management listing.
create index if not exists organisation_staff_user_status_organisation_idx
  on public.organisation_staff (user_id, status, organisation_id);

create index if not exists organisation_staff_organisation_status_updated_idx
  on public.organisation_staff (organisation_id, status, updated_at desc, id);

-- Existing organisations may have zero owners. The owner-active check above
-- means this index also enforces at most one active owner per organisation.
create unique index if not exists organisation_staff_one_owner_per_organisation_idx
  on public.organisation_staff (organisation_id)
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

revoke execute on function private.set_updated_at()
  from public, anon, authenticated;

drop trigger if exists set_organisation_staff_updated_at
  on public.organisation_staff;
create trigger set_organisation_staff_updated_at
  before update on public.organisation_staff
  for each row execute function private.set_updated_at();

-- Requests are idempotent. Rejected and revoked manager rows are reused so the
-- unique organisation/user relationship also preserves lifecycle history.
create or replace function public.request_organisation_management_access(
  p_organisation_id bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_staff_id bigint;
  v_role text;
  v_status text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  -- Keep the organisation active while this short request transaction runs.
  perform organisation.id
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for share;

  if not found then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  insert into public.organisation_staff (
    organisation_id,
    user_id,
    role,
    status
  )
  values (
    p_organisation_id,
    v_actor_id,
    'manager',
    'pending'
  )
  on conflict (organisation_id, user_id) do nothing
  returning id into v_staff_id;

  if v_staff_id is not null then
    return 'pending';
  end if;

  select staff.id, staff.role, staff.status
  into v_staff_id, v_role, v_status
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and staff.user_id = v_actor_id
  for update;

  if v_status = 'pending' then
    return 'pending';
  end if;

  if v_status = 'active' then
    raise exception 'Active organisation management access already exists.'
      using errcode = '22023';
  end if;

  if v_status not in ('rejected', 'revoked') then
    raise exception 'Management access cannot be requested from this state.'
      using errcode = '22023';
  end if;

  update public.organisation_staff
  set role = 'manager',
      status = 'pending'
  where id = v_staff_id;

  return 'pending';
end;
$$;

revoke execute on function public.request_organisation_management_access(bigint)
  from public, anon;
grant execute on function public.request_organisation_management_access(bigint)
  to authenticated;

-- Returns only the profile name and staff fields needed on the authorised
-- management screen. Managers see active staff; owners additionally see
-- pending requests. public.profiles RLS remains unchanged.
create or replace function public.get_organisation_staff(
  p_organisation_id bigint
)
returns table (
  staff_id bigint,
  first_name text,
  last_name text,
  staff_role text,
  staff_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_role text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select actor_staff.role
  into v_actor_role
  from public.organisation_staff as actor_staff
  join public.organisations as organisation
    on organisation.id = actor_staff.organisation_id
  where actor_staff.organisation_id = p_organisation_id
    and actor_staff.user_id = v_actor_id
    and actor_staff.status = 'active'
    and actor_staff.role in ('manager', 'owner')
    and organisation.status = 'active'
  for share of actor_staff;

  if v_actor_role is null then
    raise exception 'You do not have permission to view this organisation staff list.'
      using errcode = '42501';
  end if;

  return query
  select
    staff.id,
    profile.first_name,
    profile.last_name,
    staff.role,
    staff.status,
    staff.created_at,
    staff.updated_at
  from public.organisation_staff as staff
  join public.profiles as profile on profile.id = staff.user_id
  where staff.organisation_id = p_organisation_id
    and (
      staff.status = 'active'
      or (v_actor_role = 'owner' and staff.status = 'pending')
    )
  order by
    case when staff.status = 'pending' then 0 else 1 end,
    case when staff.role = 'owner' then 0 else 1 end,
    staff.updated_at,
    staff.id;
end;
$$;

revoke execute on function public.get_organisation_staff(bigint)
  from public, anon;
grant execute on function public.get_organisation_staff(bigint)
  to authenticated;

create or replace function public.process_organisation_management_request(
  p_staff_id bigint,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_organisation_id bigint;
  v_target_role text;
  v_target_status text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_decision not in ('active', 'rejected') then
    raise exception 'Management requests may only be approved or rejected.'
      using errcode = '22023';
  end if;

  select staff.organisation_id
  into v_organisation_id
  from public.organisation_staff as staff
  where staff.id = p_staff_id;

  if v_organisation_id is null then
    raise exception 'Management request not found.' using errcode = 'P0002';
  end if;

  -- Lock actor and target in stable primary-key order, then authorise again.
  perform staff.id
  from public.organisation_staff as staff
  where staff.organisation_id = v_organisation_id
    and (staff.user_id = v_actor_id or staff.id = p_staff_id)
  order by staff.id
  for update;

  if not exists (
    select 1
    from public.organisation_staff as actor_staff
    join public.organisations as organisation
      on organisation.id = actor_staff.organisation_id
    where actor_staff.organisation_id = v_organisation_id
      and actor_staff.user_id = v_actor_id
      and actor_staff.role = 'owner'
      and actor_staff.status = 'active'
      and organisation.status = 'active'
  ) then
    raise exception 'Only this organisation owner can process management requests.'
      using errcode = '42501';
  end if;

  select staff.role, staff.status
  into v_target_role, v_target_status
  from public.organisation_staff as staff
  where staff.id = p_staff_id
    and staff.organisation_id = v_organisation_id;

  if not found
    or v_target_role <> 'manager'
    or v_target_status <> 'pending' then
    raise exception 'Only a pending manager request can be processed.'
      using errcode = '22023';
  end if;

  update public.organisation_staff
  set role = 'manager',
      status = p_decision
  where id = p_staff_id;

  return p_decision;
end;
$$;

revoke execute on function public.process_organisation_management_request(bigint, text)
  from public, anon;
grant execute on function public.process_organisation_management_request(bigint, text)
  to authenticated;

create or replace function public.remove_organisation_manager_access(
  p_staff_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_organisation_id bigint;
  v_target_user_id uuid;
  v_target_role text;
  v_target_status text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select staff.organisation_id
  into v_organisation_id
  from public.organisation_staff as staff
  where staff.id = p_staff_id;

  if v_organisation_id is null then
    raise exception 'Organisation manager not found.' using errcode = 'P0002';
  end if;

  perform staff.id
  from public.organisation_staff as staff
  where staff.organisation_id = v_organisation_id
    and (staff.user_id = v_actor_id or staff.id = p_staff_id)
  order by staff.id
  for update;

  if not exists (
    select 1
    from public.organisation_staff as actor_staff
    join public.organisations as organisation
      on organisation.id = actor_staff.organisation_id
    where actor_staff.organisation_id = v_organisation_id
      and actor_staff.user_id = v_actor_id
      and actor_staff.role = 'owner'
      and actor_staff.status = 'active'
      and organisation.status = 'active'
  ) then
    raise exception 'Only this organisation owner can remove manager access.'
      using errcode = '42501';
  end if;

  select staff.user_id, staff.role, staff.status
  into v_target_user_id, v_target_role, v_target_status
  from public.organisation_staff as staff
  where staff.id = p_staff_id
    and staff.organisation_id = v_organisation_id;

  if not found
    or v_target_user_id = v_actor_id
    or v_target_role <> 'manager'
    or v_target_status <> 'active' then
    raise exception 'Only another active manager can have access removed.'
      using errcode = '22023';
  end if;

  update public.organisation_staff
  set role = 'manager',
      status = 'revoked'
  where id = p_staff_id;
end;
$$;

revoke execute on function public.remove_organisation_manager_access(bigint)
  from public, anon;
grant execute on function public.remove_organisation_manager_access(bigint)
  to authenticated;

create or replace function public.transfer_organisation_ownership(
  p_organisation_id bigint,
  p_target_staff_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_staff_id bigint;
  v_target_user_id uuid;
  v_target_role text;
  v_target_status text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  -- A preliminary check avoids locking rows for callers with no plausible
  -- access. The owner row is locked and rechecked immediately afterwards.
  if not exists (
    select 1
    from public.organisation_staff as actor_staff
    join public.organisations as organisation
      on organisation.id = actor_staff.organisation_id
    where actor_staff.organisation_id = p_organisation_id
      and actor_staff.user_id = v_actor_id
      and actor_staff.role = 'owner'
      and actor_staff.status = 'active'
      and organisation.status = 'active'
  ) then
    raise exception 'Only this organisation owner can transfer ownership.'
      using errcode = '42501';
  end if;

  perform staff.id
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and (staff.user_id = v_actor_id or staff.id = p_target_staff_id)
  order by staff.id
  for update;

  select actor_staff.id
  into v_actor_staff_id
  from public.organisation_staff as actor_staff
  join public.organisations as organisation
    on organisation.id = actor_staff.organisation_id
  where actor_staff.organisation_id = p_organisation_id
    and actor_staff.user_id = v_actor_id
    and actor_staff.role = 'owner'
    and actor_staff.status = 'active'
    and organisation.status = 'active';

  if v_actor_staff_id is null then
    raise exception 'Only this organisation owner can transfer ownership.'
      using errcode = '42501';
  end if;

  select staff.user_id, staff.role, staff.status
  into v_target_user_id, v_target_role, v_target_status
  from public.organisation_staff as staff
  where staff.id = p_target_staff_id
    and staff.organisation_id = p_organisation_id;

  if not found
    or v_target_user_id = v_actor_id
    or v_target_role <> 'manager'
    or v_target_status <> 'active' then
    raise exception 'Ownership can only be transferred to another active manager in this organisation.'
      using errcode = '22023';
  end if;

  -- Both writes share the RPC transaction. If promotion fails, PostgreSQL
  -- rolls the demotion back, so no partially completed transfer is committed.
  update public.organisation_staff
  set role = 'manager'
  where id = v_actor_staff_id;

  update public.organisation_staff
  set role = 'owner'
  where id = p_target_staff_id;
end;
$$;

revoke execute on function public.transfer_organisation_ownership(bigint, bigint)
  from public, anon;
grant execute on function public.transfer_organisation_ownership(bigint, bigint)
  to authenticated;

alter table public.organisation_staff enable row level security;

-- Authenticated callers can inspect only their own relationship row. All
-- writes are intentionally RPC-only; no INSERT, UPDATE, or DELETE is granted.
revoke all privileges on table public.organisation_staff from anon, authenticated;
revoke all privileges on sequence public.organisation_staff_id_seq
  from anon, authenticated;
grant select on table public.organisation_staff to authenticated;

drop policy if exists "Users can read their own organisation staff access"
  on public.organisation_staff;
create policy "Users can read their own organisation staff access"
on public.organisation_staff
for select
to authenticated
using ((select auth.uid()) = user_id);

commit;
