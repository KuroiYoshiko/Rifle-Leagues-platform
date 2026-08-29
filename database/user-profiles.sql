begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  title text,
  address text,
  town text,
  county text,
  postcode text,
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_first_name_length check (
    first_name is null or char_length(btrim(first_name)) between 1 and 100
  ),
  constraint profiles_last_name_length check (
    last_name is null or char_length(btrim(last_name)) between 1 and 100
  ),
  constraint profiles_title_value check (
    title is null or title in ('Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Other', 'Prefer not to say')
  ),
  constraint profiles_address_length check (
    address is null or char_length(btrim(address)) between 1 and 500
  ),
  constraint profiles_town_length check (
    town is null or char_length(btrim(town)) between 1 and 100
  ),
  constraint profiles_county_length check (
    county is null or char_length(btrim(county)) between 1 and 100
  ),
  constraint profiles_postcode_length check (
    postcode is null or char_length(btrim(postcode)) between 1 and 20
  ),
  constraint profiles_phone_number_length check (
    phone_number is null or char_length(btrim(phone_number)) between 1 and 40
  )
);

comment on table public.profiles is
  'Private application profile data with a one-to-one relationship to auth.users.';

create schema if not exists private;

create or replace function private.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    left(nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''), 100),
    left(nullif(btrim(new.raw_user_meta_data ->> 'last_name'), ''), 100)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function private.handle_new_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_profile_created on auth.users;
create trigger on_auth_user_profile_created
  after insert on auth.users
  for each row execute function private.handle_new_user_profile();

create or replace function private.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.set_profile_updated_at() from public, anon, authenticated;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function private.set_profile_updated_at();

-- Backfill users who registered before profiles existed. The primary key and
-- ON CONFLICT guard make this safe to run more than once.
insert into public.profiles (
  id,
  first_name,
  last_name,
  created_at,
  updated_at
)
select
  users.id,
  left(nullif(btrim(users.raw_user_meta_data ->> 'first_name'), ''), 100),
  left(nullif(btrim(users.raw_user_meta_data ->> 'last_name'), ''), 100),
  users.created_at,
  users.created_at
from auth.users as users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

revoke all privileges on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (
  first_name,
  last_name,
  title,
  address,
  town,
  county,
  postcode,
  phone_number
) on table public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

commit;
