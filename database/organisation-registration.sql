-- Run after database/organisations.sql and database/organisation-staff.sql.
-- Adds the legacy registration fields and an authenticated, atomic
-- organisation + first-owner registration operation.

begin;

alter table public.organisations
  add column if not exists organisation_type text,
  add column if not exists address text,
  add column if not exists postcode text,
  add column if not exists telephone text;

-- Existing records predate typed registration. Treat their unknown legacy
-- classification as Other without changing any other organisation data.
update public.organisations
set organisation_type = 'other'
where organisation_type is null;

alter table public.organisations
  alter column organisation_type set default 'other',
  alter column organisation_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organisations_type_value'
      and conrelid = 'public.organisations'::regclass
  ) then
    alter table public.organisations
      add constraint organisations_type_value check (
        organisation_type in (
          'county_association',
          'regional_association',
          'business',
          'other'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'organisations_address_value'
      and conrelid = 'public.organisations'::regclass
  ) then
    alter table public.organisations
      add constraint organisations_address_value check (
        address is null or (
          char_length(address) between 1 and 1000
          and address = btrim(address)
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'organisations_postcode_value'
      and conrelid = 'public.organisations'::regclass
  ) then
    alter table public.organisations
      add constraint organisations_postcode_value check (
        postcode is null or (
          char_length(postcode) between 1 and 20
          and postcode = btrim(postcode)
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'organisations_telephone_value'
      and conrelid = 'public.organisations'::regclass
  ) then
    alter table public.organisations
      add constraint organisations_telephone_value check (
        telephone is null or (
          char_length(telephone) between 3 and 50
          and telephone = btrim(telephone)
        )
      );
  end if;
end;
$$;

-- These are public organisation details, readable under the existing
-- active-organisation RLS policy. Direct client writes remain revoked.
grant select (
  organisation_type,
  address,
  postcode,
  telephone
) on table public.organisations to authenticated;

create or replace function public.register_organisation(
  p_name text,
  p_short_name text,
  p_organisation_type text,
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
  v_organisation_id bigint;
  v_name text := btrim(coalesce(p_name, ''));
  v_short_name text := nullif(btrim(coalesce(p_short_name, '')), '');
  v_organisation_type text := btrim(coalesce(p_organisation_type, ''));
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_postcode text := nullif(btrim(coalesce(p_postcode, '')), '');
  v_telephone text := nullif(btrim(coalesce(p_telephone, '')), '');
  v_contact_email text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_slug text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 160 then
    raise exception 'Organisation name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if v_short_name is not null
    and char_length(v_short_name) not between 1 and 100 then
    raise exception 'Abbreviated name must contain 100 characters or fewer.'
      using errcode = '22023';
  end if;

  if v_organisation_type not in (
    'county_association',
    'regional_association',
    'business',
    'other'
  ) then
    raise exception 'Select a valid organisation type.' using errcode = '22023';
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

  v_slug := lower(
    regexp_replace(
      regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    )
  );

  if char_length(v_slug) not between 2 and 180 then
    raise exception 'The organisation name cannot produce a route-safe web address.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.organisations as organisation
    where organisation.slug = v_slug
  ) then
    raise exception 'An organisation with this name appears to already be registered.'
      using errcode = '23505';
  end if;

  insert into public.organisations (
    name,
    slug,
    short_name,
    organisation_type,
    address,
    postcode,
    telephone,
    contact_email,
    website,
    status
  )
  values (
    v_name,
    v_slug,
    v_short_name,
    v_organisation_type,
    v_address,
    v_postcode,
    v_telephone,
    v_contact_email,
    v_website,
    'active'
  )
  returning id into v_organisation_id;

  insert into public.organisation_staff (
    organisation_id,
    user_id,
    role,
    status
  )
  values (
    v_organisation_id,
    v_actor_id,
    'owner',
    'active'
  );

  return v_slug;
exception
  when unique_violation then
    raise exception 'An organisation with this name appears to already be registered.'
      using errcode = '23505';
end;
$$;

comment on function public.register_organisation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) is
  'Atomically registers an active organisation and makes the authenticated caller its active owner.';

revoke execute on function public.register_organisation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.register_organisation(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

commit;
