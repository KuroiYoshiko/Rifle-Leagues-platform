-- Run after database/organisations.sql, database/organisation-staff.sql, and
-- database/organisation-registration.sql. Adds the single long-form About
-- document and narrowly scoped owner-only About and Contact update operations.

begin;

alter table public.organisations
  add column if not exists about_content text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organisations_about_content_value'
      and conrelid = 'public.organisations'::regclass
  ) then
    alter table public.organisations
      add constraint organisations_about_content_value check (
        about_content is null or (
          char_length(about_content) between 1 and 20000
          and about_content = btrim(about_content)
        )
      );
  end if;
end;
$$;

comment on column public.organisations.about_content is
  'The organisation''s single public long-form About document, stored as constrained Markdown rather than HTML.';

-- Public About content remains read-only through the Data API. Direct client
-- updates to organisations remain revoked; writes use the RPCs below.
grant select (about_content) on table public.organisations to authenticated;

create or replace function public.update_organisation_about(
  p_organisation_id bigint,
  p_about_content text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_about_content text := nullif(btrim(coalesce(p_about_content, '')), '');
  v_organisation_slug text;
  v_owner_staff_id bigint;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_about_content is not null
    and char_length(v_about_content) > 20000 then
    raise exception 'About content must contain 20,000 characters or fewer.'
      using errcode = '22023';
  end if;

  select organisation.slug
  into v_organisation_slug
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for update;

  if v_organisation_slug is null then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  -- Lock the exact active owner relationship so an ownership transfer cannot
  -- race this authorisation check and mutation.
  select staff.id
  into v_owner_staff_id
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and staff.user_id = v_actor_id
    and staff.role = 'owner'
    and staff.status = 'active'
  for share;

  if v_owner_staff_id is null then
    raise exception 'Only this organisation owner can update About content.'
      using errcode = '42501';
  end if;

  update public.organisations as organisation
  set about_content = v_about_content
  where organisation.id = p_organisation_id;

  return v_organisation_slug;
end;
$$;

comment on function public.update_organisation_about(bigint, text) is
  'Updates only the single About document for an active organisation after verifying its active owner.';

revoke execute on function public.update_organisation_about(bigint, text)
  from public, anon, authenticated;
grant execute on function public.update_organisation_about(bigint, text)
  to authenticated;

create or replace function public.update_organisation_contact_details(
  p_organisation_id bigint,
  p_address text,
  p_postcode text,
  p_telephone text,
  p_contact_email text,
  p_website text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_postcode text := nullif(btrim(coalesce(p_postcode, '')), '');
  v_telephone text := nullif(btrim(coalesce(p_telephone, '')), '');
  v_contact_email text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_organisation_slug text;
  v_owner_staff_id bigint;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_address is not null and char_length(v_address) > 1000 then
    raise exception 'Address must contain 1000 characters or fewer.'
      using errcode = '22023';
  end if;

  if v_postcode is not null and char_length(v_postcode) > 20 then
    raise exception 'Postcode must contain 20 characters or fewer.'
      using errcode = '22023';
  end if;

  if v_telephone is not null
    and char_length(v_telephone) not between 3 and 50 then
    raise exception 'Telephone must contain between 3 and 50 characters.'
      using errcode = '22023';
  end if;

  if v_contact_email is not null and (
    char_length(v_contact_email) not between 3 and 320
    or v_contact_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  if v_website is not null and (
    char_length(v_website) not between 8 and 2048
    or v_website !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'Enter a complete website address beginning with http:// or https://.'
      using errcode = '22023';
  end if;

  select organisation.slug
  into v_organisation_slug
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for update;

  if v_organisation_slug is null then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  select staff.id
  into v_owner_staff_id
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and staff.user_id = v_actor_id
    and staff.role = 'owner'
    and staff.status = 'active'
  for share;

  if v_owner_staff_id is null then
    raise exception 'Only this organisation owner can update contact details.'
      using errcode = '42501';
  end if;

  update public.organisations as organisation
  set address = v_address,
      postcode = v_postcode,
      telephone = v_telephone,
      contact_email = v_contact_email,
      website = v_website
  where organisation.id = p_organisation_id;

  return v_organisation_slug;
end;
$$;

comment on function public.update_organisation_contact_details(
  bigint,
  text,
  text,
  text,
  text,
  text
) is
  'Updates only structured contact fields for an active organisation after verifying its active owner.';

revoke execute on function public.update_organisation_contact_details(
  bigint,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.update_organisation_contact_details(
  bigint,
  text,
  text,
  text,
  text,
  text
) to authenticated;

commit;
