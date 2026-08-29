begin;

create table if not exists public.organisations (
  id bigint generated always as identity primary key,
  name text not null,
  slug text not null,
  short_name text,
  description text,
  website text,
  contact_email text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(short_name, '')), 'B')
  ) stored,
  constraint organisations_name_length check (
    char_length(name) between 2 and 160 and name = btrim(name)
  ),
  constraint organisations_slug_unique unique (slug),
  constraint organisations_slug_format check (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and char_length(slug) between 2 and 180
  ),
  constraint organisations_short_name_length check (
    short_name is null or (
      char_length(short_name) between 1 and 100
      and short_name = btrim(short_name)
    )
  ),
  constraint organisations_description_length check (
    description is null or (
      char_length(description) between 1 and 2000
      and description = btrim(description)
    )
  ),
  constraint organisations_website_value check (
    website is null or (
      char_length(website) between 8 and 2048
      and website = btrim(website)
      and website ~* '^https?://[^[:space:]]+$'
    )
  ),
  constraint organisations_contact_email_value check (
    contact_email is null or (
      char_length(contact_email) between 3 and 320
      and contact_email = btrim(contact_email)
      and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  constraint organisations_status_value check (status in ('active', 'inactive'))
);

comment on table public.organisations is
  'Public discovery information for league organisations. Client access is read-only in this phase.';

create table if not exists public.user_organisations (
  user_id uuid not null references public.profiles (id) on delete cascade,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_organisations_pkey primary key (user_id, organisation_id)
);

comment on table public.user_organisations is
  'A personal dashboard/navigation association only. It is not organisation membership, office, permission, or league-entry authority.';

comment on column public.user_organisations.user_id is
  'The personal account that added the organisation to its dashboard.';

comment on column public.user_organisations.organisation_id is
  'The league organisation shown in that user dashboard; this grants no role or permission.';

-- Supports active discovery ordered by name and active-only full-text search.
create index if not exists organisations_active_name_idx
  on public.organisations (name, id)
  where status = 'active';

create index if not exists organisations_active_search_document_idx
  on public.organisations using gin (search_document)
  where status = 'active';

-- The composite primary key supports user-owned reads and duplicate prevention.
-- PostgreSQL does not automatically index the organisation foreign-key side.
create index if not exists user_organisations_organisation_id_idx
  on public.user_organisations (organisation_id, user_id);

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

drop trigger if exists set_organisations_updated_at on public.organisations;
create trigger set_organisations_updated_at
  before update on public.organisations
  for each row execute function private.set_updated_at();

alter table public.organisations enable row level security;
alter table public.user_organisations enable row level security;

-- Grants decide which Data API operations are reachable; RLS below decides
-- which rows the authenticated caller may access.
revoke all privileges on table public.organisations from anon, authenticated;
revoke all privileges on sequence public.organisations_id_seq from anon, authenticated;
grant select (
  id,
  name,
  slug,
  short_name,
  description,
  website,
  contact_email,
  status,
  created_at,
  updated_at,
  search_document
) on table public.organisations to authenticated;

revoke all privileges on table public.user_organisations from anon, authenticated;
grant select on table public.user_organisations to authenticated;
grant insert (user_id, organisation_id) on table public.user_organisations to authenticated;
grant delete on table public.user_organisations to authenticated;

drop policy if exists "Authenticated users can discover active organisations"
  on public.organisations;
create policy "Authenticated users can discover active organisations"
on public.organisations
for select
to authenticated
using (status = 'active');

drop policy if exists "Users can read their own dashboard organisations"
  on public.user_organisations;
create policy "Users can read their own dashboard organisations"
on public.user_organisations
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can add active organisations to their own dashboard"
  on public.user_organisations;
create policy "Users can add active organisations to their own dashboard"
on public.user_organisations
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.organisations
    where organisations.id = user_organisations.organisation_id
      and organisations.status = 'active'
  )
);

drop policy if exists "Users can remove organisations from their own dashboard"
  on public.user_organisations;
create policy "Users can remove organisations from their own dashboard"
on public.user_organisations
for delete
to authenticated
using ((select auth.uid()) = user_id);

commit;
