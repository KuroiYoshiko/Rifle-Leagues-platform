-- RifleLeagues standalone development/demo seed.
-- DEVELOPMENT AND TEST PROJECTS ONLY. Do not run against production.
--
-- First run the schema files in this order:
--   1. database/user-profiles.sql
--   2. database/organisations.sql
--   3. database/organisation-staff.sql
--   4. database/organisation-registration.sql
--   5. database/organisation-about-contact.sql
--   6. database/organisation-information-cards.sql
--   7. database/clubs-and-memberships.sql
--   8. database/club-foundation.sql
--   9. database/league-seasons.sql
--  10. database/competition-rounds.sql
--  11. database/competition-entries.sql
--  12. database/competition-divisions.sql
--
-- Then run this entire file in the Supabase SQL Editor. It creates 40
-- confirmed email/password Auth users and the complete demo domain world and
-- is safe to rerun.
-- Shared development-only password: RifleLeagues-Demo-2026!
--
-- Direct Auth-table writes are intentionally limited to this private
-- development seed. Supabase-managed Auth internals can change between
-- versions, so the seed validates the current required shape before writing.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $$
declare
  v_missing text;
begin
  select string_agg(required.relation_name, ', ' order by required.relation_name)
  into v_missing
  from (values
    ('auth.users'),
    ('auth.identities'),
    ('public.profiles'),
    ('public.organisations'),
    ('public.organisation_staff'),
    ('public.user_organisations'),
    ('public.clubs'),
    ('public.club_memberships'),
    ('public.league_seasons'),
    ('public.competitions'),
    ('public.competition_rounds'),
    ('public.club_competition_entries'),
    ('public.competition_entrants'),
    ('public.competition_entrant_participants'),
    ('public.competition_division_configs'),
    ('public.competition_divisions'),
    ('public.competition_division_assignments')
  ) as required(relation_name)
  where to_regclass(required.relation_name) is null;

  if v_missing is not null then
    raise exception 'RifleLeagues application schema is incomplete. Missing relations: %', v_missing;
  end if;

  select string_agg(required.column_name, ', ' order by required.column_name)
  into v_missing
  from (values
    ('instance_id'), ('id'), ('aud'), ('role'), ('email'),
    ('encrypted_password'), ('email_confirmed_at'), ('last_sign_in_at'),
    ('raw_app_meta_data'), ('raw_user_meta_data'), ('created_at'),
    ('updated_at'), ('is_sso_user'), ('is_anonymous'),
    ('confirmation_token'), ('recovery_token'), ('email_change'),
    ('email_change_token_current'), ('email_change_token_new'),
    ('email_change_confirm_status'), ('phone_change'),
    ('phone_change_token'), ('reauthentication_token')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns as columns
    where columns.table_schema = 'auth'
      and columns.table_name = 'users'
      and columns.column_name = required.column_name
  );

  if v_missing is not null then
    raise exception 'Unsupported auth.users shape. Missing current Supabase Auth columns: %', v_missing;
  end if;

  select string_agg(required.column_name, ', ' order by required.column_name)
  into v_missing
  from (values
    ('id'), ('provider_id'), ('user_id'), ('identity_data'), ('provider'),
    ('last_sign_in_at'), ('created_at'), ('updated_at')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns as columns
    where columns.table_schema = 'auth'
      and columns.table_name = 'identities'
      and columns.column_name = required.column_name
  );

  if v_missing is not null then
    raise exception 'Unsupported auth.identities shape. Missing current Supabase Auth columns: %', v_missing;
  end if;

  if to_regprocedure('extensions.crypt(text,text)') is null
     or to_regprocedure('extensions.gen_salt(text)') is null then
    raise exception 'Supabase pgcrypto functions extensions.crypt and extensions.gen_salt are required.';
  end if;
end;
$$;

create temporary table demo_user_specs (
  intended_user_id uuid primary key,
  user_id uuid not null unique,
  email text not null unique,
  first_name text not null,
  last_name text not null,
  demo_number integer not null unique
) on commit drop;

insert into demo_user_specs (
  intended_user_id, user_id, email, first_name, last_name, demo_number
)
values
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'basildon.demo01@example.com', 'Eleanor', 'Hughes', 1),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'basildon.demo02@example.com', 'Oliver', 'Bennett', 2),
  ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'basildon.demo03@example.com', 'Amelia', 'Clarke', 3),
  ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'basildon.demo04@example.com', 'George', 'Foster', 4),
  ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 'basildon.demo05@example.com', 'Sophie', 'Turner', 5),
  ('10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', 'basildon.demo06@example.com', 'Harry', 'Collins', 6),
  ('10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007', 'basildon.demo07@example.com', 'Isla', 'Morgan', 7),
  ('10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008', 'basildon.demo08@example.com', 'Jack', 'Ward', 8),
  ('10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000009', 'basildon.demo09@example.com', 'Emily', 'Price', 9),
  ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000010', 'basildon.demo10@example.com', 'Thomas', 'Reed', 10),
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'northbridge.demo01@example.com', 'Charlotte', 'Wilson', 11),
  ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'northbridge.demo02@example.com', 'James', 'Hall', 12),
  ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 'northbridge.demo03@example.com', 'Grace', 'Walker', 13),
  ('20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 'northbridge.demo04@example.com', 'Alfie', 'Robinson', 14),
  ('20000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000005', 'northbridge.demo05@example.com', 'Phoebe', 'Wood', 15),
  ('20000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000006', 'northbridge.demo06@example.com', 'Henry', 'Thompson', 16),
  ('20000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000007', 'northbridge.demo07@example.com', 'Lucy', 'Green', 17),
  ('20000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000008', 'northbridge.demo08@example.com', 'Oscar', 'Harris', 18),
  ('20000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000009', 'northbridge.demo09@example.com', 'Freya', 'Martin', 19),
  ('20000000-0000-4000-8000-000000000010', '20000000-0000-4000-8000-000000000010', 'northbridge.demo10@example.com', 'William', 'Cooper', 20),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'westmere.demo01@example.com', 'Alice', 'Davidson', 21),
  ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'westmere.demo02@example.com', 'Arthur', 'Scott', 22),
  ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'westmere.demo03@example.com', 'Matilda', 'Brown', 23),
  ('30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', 'westmere.demo04@example.com', 'Frederick', 'Taylor', 24),
  ('30000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005', 'westmere.demo05@example.com', 'Evie', 'Anderson', 25),
  ('30000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000006', 'westmere.demo06@example.com', 'Leo', 'Mitchell', 26),
  ('30000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000007', 'westmere.demo07@example.com', 'Poppy', 'White', 27),
  ('30000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000008', 'westmere.demo08@example.com', 'Archie', 'Moore', 28),
  ('30000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000009', 'westmere.demo09@example.com', 'Rosie', 'Jackson', 29),
  ('30000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000010', 'westmere.demo10@example.com', 'Samuel', 'Hill', 30),
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'southessex.demo01@example.com', 'Harriet', 'Evans', 31),
  ('40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'southessex.demo02@example.com', 'Edward', 'King', 32),
  ('40000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', 'southessex.demo03@example.com', 'Florence', 'Wright', 33),
  ('40000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000004', 'southessex.demo04@example.com', 'Charlie', 'Baker', 34),
  ('40000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000005', 'southessex.demo05@example.com', 'Daisy', 'Adams', 35),
  ('40000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000006', 'southessex.demo06@example.com', 'Alexander', 'Nelson', 36),
  ('40000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000007', 'southessex.demo07@example.com', 'Molly', 'Carter', 37),
  ('40000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000008', 'southessex.demo08@example.com', 'Joseph', 'Phillips', 38),
  ('40000000-0000-4000-8000-000000000009', '40000000-0000-4000-8000-000000000009', 'southessex.demo09@example.com', 'Lily', 'Campbell', 39),
  ('40000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000010', 'southessex.demo10@example.com', 'Daniel', 'Parker', 40);

do $$
begin
  if exists (
    select 1
    from auth.users as users
    join demo_user_specs as demo on lower(users.email) = demo.email
    where users.raw_app_meta_data ->> 'demo_dataset' is distinct from 'development-demo-v1'
       or users.raw_app_meta_data ->> 'rifleleagues_demo' is distinct from 'true'
  ) then
    raise exception 'A demo email belongs to an unmarked Auth account. Refusing to modify it.';
  end if;

  if exists (
    select 1
    from auth.users as users
    join demo_user_specs as demo on users.id = demo.intended_user_id
    where lower(users.email) is distinct from demo.email
       or users.raw_app_meta_data ->> 'demo_dataset' is distinct from 'development-demo-v1'
       or users.raw_app_meta_data ->> 'rifleleagues_demo' is distinct from 'true'
  ) then
    raise exception 'A deterministic demo UUID belongs to another Auth account. Refusing to modify it.';
  end if;
end;
$$;

-- Reuse marked accounts made by the former helper, if present. Fresh projects
-- always retain the deterministic UUIDs declared above.
update demo_user_specs as demo
set user_id = users.id
from auth.users as users
where lower(users.email) = demo.email
  and users.raw_app_meta_data ->> 'demo_dataset' = 'development-demo-v1'
  and users.raw_app_meta_data ->> 'rifleleagues_demo' = 'true';

do $$
begin
  if exists (
    select 1
    from auth.identities as identity
    join demo_user_specs as demo on identity.user_id = demo.user_id
    where identity.provider = 'email'
      and identity.provider_id is distinct from demo.user_id::text
  ) then
    raise exception 'A marked demo user has an unexpected email identity provider_id.';
  end if;

  if exists (
    select 1
    from auth.identities as identity
    join demo_user_specs as demo
      on identity.provider_id = demo.user_id::text
     and identity.provider = 'email'
    where identity.user_id is distinct from demo.user_id
  ) then
    raise exception 'A demo email identity is attached to another Auth user.';
  end if;

  if exists (
    select 1
    from auth.identities as identity
    join demo_user_specs as demo on identity.id = demo.user_id
    where identity.provider_id is distinct from demo.user_id::text
       or identity.provider is distinct from 'email'
       or identity.user_id is distinct from demo.user_id
  ) then
    raise exception 'A deterministic demo identity UUID belongs to another Auth identity.';
  end if;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change,
  email_change_token_current, email_change_token_new,
  email_change_confirm_status, phone_change, phone_change_token,
  reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  demo.user_id,
  'authenticated',
  'authenticated',
  demo.email,
  extensions.crypt('RifleLeagues-Demo-2026!', extensions.gen_salt('bf')),
  now(),
  now(),
  jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'rifleleagues_demo', true,
    'demo_dataset', 'development-demo-v1'
  ),
  jsonb_build_object(
    'first_name', demo.first_name,
    'last_name', demo.last_name,
    'email_verified', true
  ),
  now(),
  now(),
  false,
  false,
  '', '', '', '', '', 0, '', '', ''
from demo_user_specs as demo
on conflict (id) do update
set instance_id = excluded.instance_id,
    aud = excluded.aud,
    role = excluded.role,
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = excluded.updated_at,
    is_sso_user = excluded.is_sso_user,
    is_anonymous = excluded.is_anonymous,
    confirmation_token = excluded.confirmation_token,
    recovery_token = excluded.recovery_token,
    email_change = excluded.email_change,
    email_change_token_current = excluded.email_change_token_current,
    email_change_token_new = excluded.email_change_token_new,
    email_change_confirm_status = excluded.email_change_confirm_status,
    phone_change = excluded.phone_change,
    phone_change_token = excluded.phone_change_token,
    reauthentication_token = excluded.reauthentication_token;

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  demo.user_id,
  demo.user_id::text,
  demo.user_id,
  jsonb_build_object(
    'sub', demo.user_id::text,
    'email', demo.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
from demo_user_specs as demo
on conflict (provider_id, provider) do update
set user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = excluded.updated_at;

create temporary table demo_users on commit drop as
select user_id, email, first_name, last_name, demo_number
from demo_user_specs;

insert into public.profiles (
  id, first_name, last_name, title, address, town, county, postcode,
  phone_number
)
select
  demo.user_id,
  demo.first_name,
  demo.last_name,
  (array['Mr', 'Mrs', 'Ms', 'Miss', 'Dr'])[1 + ((demo.demo_number - 1) % 5)],
  format('%s Demo Close', 10 + demo.demo_number),
  case
    when demo.email like 'basildon.%' then 'Basildon'
    when demo.email like 'northbridge.%' then 'Northbridge'
    when demo.email like 'westmere.%' then 'Westmere'
    else 'Southend-on-Sea'
  end,
  case
    when demo.email like 'northbridge.%' then 'North Yorkshire'
    when demo.email like 'westmere.%' then 'Cumbria'
    else 'Essex'
  end,
  case
    when demo.email like 'basildon.%' then 'SS14 1DL'
    when demo.email like 'northbridge.%' then 'YO26 4RL'
    when demo.email like 'westmere.%' then 'CA10 2TS'
    else 'SS2 6ER'
  end,
  format('+44 7700 90%s', lpad(demo.demo_number::text, 4, '0'))
from demo_users as demo
on conflict (id) do update
set first_name = excluded.first_name,
    last_name = excluded.last_name,
    title = excluded.title,
    address = excluded.address,
    town = excluded.town,
    county = excluded.county,
    postcode = excluded.postcode,
    phone_number = excluded.phone_number;

do $$
declare
  v_auth_count integer;
  v_identity_count integer;
  v_profile_count integer;
begin
  select count(*) into v_auth_count
  from demo_users as demo
  join auth.users as users on users.id = demo.user_id
  where lower(users.email) = demo.email
    and users.instance_id = '00000000-0000-0000-0000-000000000000'::uuid
    and users.aud = 'authenticated'
    and users.role = 'authenticated'
    and users.email_confirmed_at is not null
    and users.encrypted_password is not null
    and users.encrypted_password <> ''
    and extensions.crypt('RifleLeagues-Demo-2026!', users.encrypted_password)
        = users.encrypted_password
    and users.is_sso_user = false
    and users.is_anonymous = false
    and users.raw_app_meta_data ->> 'provider' = 'email'
    and users.raw_app_meta_data -> 'providers' @> '["email"]'::jsonb;

  select count(*) into v_identity_count
  from demo_users as demo
  join auth.identities as identity
   on identity.user_id = demo.user_id
   and identity.provider_id = demo.user_id::text
   and identity.provider = 'email'
   and identity.identity_data ->> 'sub' = demo.user_id::text
   and lower(identity.identity_data ->> 'email') = demo.email
   and identity.identity_data ->> 'email_verified' = 'true';

  select count(*) into v_profile_count
  from demo_users as demo
  join public.profiles as profile on profile.id = demo.user_id;

  if v_auth_count <> 40 or v_identity_count <> 40 or v_profile_count <> 40 then
    raise exception
      'Demo Auth bootstrap incomplete: users %, email identities %, profiles % (expected 40 each).',
      v_auth_count, v_identity_count, v_profile_count;
  end if;
end;
$$;

insert into public.organisations (
  name, slug, short_name, description, website, contact_email, status,
  organisation_type, address, postcode, telephone, about_content
)
values
  (
    'Eastern Region Shooting Association',
    'eastern-region-shooting-association',
    'Eastern Region',
    'A fictional regional association coordinating friendly postal rifle leagues across eastern England.',
    'https://example.com/eastern-region',
    'eastern.leagues@example.com',
    'active',
    'regional_association',
    '14 Market Square, Chelmsford',
    'CM1 1AB',
    '+44 1200 555 101',
    'The Eastern Region Shooting Association runs inclusive postal competitions for affiliated clubs. This development-only organisation provides realistic league, entry, and division-management scenarios.'
  ),
  (
    'Central Target Sports Association',
    'central-target-sports-association',
    'Central Target Sports',
    'A fictional association supporting smallbore and precision target competition across central England.',
    'https://example.com/central-target-sports',
    'central.leagues@example.com',
    'active',
    'regional_association',
    '8 Station Road, Derby',
    'DE1 2FS',
    '+44 1300 555 202',
    'Central Target Sports Association provides a smaller second-organisation context for testing permissions, discovery, and league navigation.'
  )
on conflict (slug) do update
set name = excluded.name,
    short_name = excluded.short_name,
    description = excluded.description,
    website = excluded.website,
    contact_email = excluded.contact_email,
    status = excluded.status,
    organisation_type = excluded.organisation_type,
    address = excluded.address,
    postcode = excluded.postcode,
    telephone = excluded.telephone,
    about_content = excluded.about_content;

insert into public.organisation_staff (organisation_id, user_id, role, status)
select organisation.id, demo.user_id, staff.role, 'active'
from (values
  ('eastern-region-shooting-association', 'basildon.demo01@example.com', 'owner'),
  ('eastern-region-shooting-association', 'basildon.demo02@example.com', 'manager'),
  ('eastern-region-shooting-association', 'northbridge.demo02@example.com', 'manager'),
  ('central-target-sports-association', 'westmere.demo01@example.com', 'owner'),
  ('central-target-sports-association', 'southessex.demo02@example.com', 'manager')
) as staff(organisation_slug, email, role)
join public.organisations as organisation
  on organisation.slug = staff.organisation_slug
join demo_users as demo on demo.email = staff.email
on conflict (organisation_id, user_id) do update
set role = excluded.role,
    status = excluded.status;

insert into public.user_organisations (user_id, organisation_id)
select demo.user_id, organisation.id
from (values
  ('basildon.demo01@example.com', 'eastern-region-shooting-association'),
  ('basildon.demo02@example.com', 'eastern-region-shooting-association'),
  ('basildon.demo04@example.com', 'eastern-region-shooting-association'),
  ('northbridge.demo02@example.com', 'eastern-region-shooting-association'),
  ('westmere.demo01@example.com', 'central-target-sports-association'),
  ('southessex.demo02@example.com', 'central-target-sports-association'),
  ('westmere.demo04@example.com', 'central-target-sports-association')
) as followed(email, organisation_slug)
join demo_users as demo on demo.email = followed.email
join public.organisations as organisation
  on organisation.slug = followed.organisation_slug
on conflict (user_id, organisation_id) do nothing;

create temporary table demo_organisation_cards on commit drop as
select organisation.id as organisation_id,
  card.title, card.content, card.position,
  owner_user.user_id as owner_user_id
from (values
  ('eastern-region-shooting-association', 'League programme', 'Postal smallbore competitions run throughout the year, with Individual, Pairs, and Team formats.', 1, 'basildon.demo01@example.com'),
  ('eastern-region-shooting-association', 'Entry guidance', 'Club owners and officials submit entrant units during each published season entry window.', 2, 'basildon.demo01@example.com'),
  ('central-target-sports-association', 'About our leagues', 'A compact programme designed to demonstrate a second organisation and an independent staff context.', 1, 'westmere.demo01@example.com')
) as card(organisation_slug, title, content, position, owner_email)
join public.organisations as organisation on organisation.slug = card.organisation_slug
join demo_users as owner_user on owner_user.email = card.owner_email;

update public.organisation_information_cards as existing
set title = demo.title,
    content = demo.content,
    updated_by = demo.owner_user_id
from demo_organisation_cards as demo
where existing.organisation_id = demo.organisation_id
  and existing.position = demo.position;

insert into public.organisation_information_cards (
  organisation_id, title, content, position, created_by, updated_by
)
select organisation_id, title, content, position, owner_user_id, owner_user_id
from demo_organisation_cards as demo
where not exists (
  select 1
  from public.organisation_information_cards as existing
  where existing.organisation_id = demo.organisation_id
    and existing.position = demo.position
);

insert into public.clubs (
  name, slug, town, county, postcode, website, status, about_content
)
values
  ('Basildon Rifle and Pistol Club', 'basildon-rifle-and-pistol-club', 'Basildon', 'Essex', 'SS14 1DL', 'https://example.com/basildon-rpc', 'active', 'A friendly fictional Essex club with a busy postal-league programme and a broad mix of experienced and developing shooters.'),
  ('Northbridge Target Shooting Club', 'northbridge-target-shooting-club', 'Northbridge', 'North Yorkshire', 'YO26 4RL', 'https://example.com/northbridge', 'active', 'A fictional community target club serving Northbridge and neighbouring villages.'),
  ('Westmere Smallbore Rifle Club', 'westmere-smallbore-rifle-club', 'Westmere', 'Cumbria', 'CA10 2TS', 'https://example.com/westmere', 'active', 'A fictional smallbore club with a strong pairs and team tradition.'),
  ('South Essex Shooting Club', 'south-essex-shooting-club', 'Southend-on-Sea', 'Essex', 'SS2 6ER', 'https://example.com/south-essex', 'active', 'A fictional coastal club participating in both Eastern and Central association competitions.')
on conflict (slug) do update
set name = excluded.name,
    town = excluded.town,
    county = excluded.county,
    postcode = excluded.postcode,
    website = excluded.website,
    status = excluded.status,
    about_content = excluded.about_content;

create temporary table demo_memberships (
  club_slug text not null,
  email text not null,
  role text not null
) on commit drop;

insert into demo_memberships (club_slug, email, role)
values
  ('basildon-rifle-and-pistol-club', 'basildon.demo01@example.com', 'owner'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo02@example.com', 'official'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo03@example.com', 'official'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo04@example.com', 'member'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo05@example.com', 'member'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo06@example.com', 'member'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo07@example.com', 'member'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo08@example.com', 'member'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo09@example.com', 'member'),
  ('basildon-rifle-and-pistol-club', 'basildon.demo10@example.com', 'member'),
  ('northbridge-target-shooting-club', 'northbridge.demo01@example.com', 'owner'),
  ('northbridge-target-shooting-club', 'northbridge.demo02@example.com', 'official'),
  ('northbridge-target-shooting-club', 'northbridge.demo03@example.com', 'official'),
  ('northbridge-target-shooting-club', 'northbridge.demo04@example.com', 'member'),
  ('northbridge-target-shooting-club', 'northbridge.demo05@example.com', 'member'),
  ('northbridge-target-shooting-club', 'northbridge.demo06@example.com', 'member'),
  ('northbridge-target-shooting-club', 'northbridge.demo07@example.com', 'member'),
  ('northbridge-target-shooting-club', 'northbridge.demo08@example.com', 'member'),
  ('northbridge-target-shooting-club', 'northbridge.demo09@example.com', 'member'),
  ('northbridge-target-shooting-club', 'northbridge.demo10@example.com', 'member'),
  ('northbridge-target-shooting-club', 'basildon.demo04@example.com', 'member'),
  ('westmere-smallbore-rifle-club', 'westmere.demo01@example.com', 'owner'),
  ('westmere-smallbore-rifle-club', 'westmere.demo02@example.com', 'official'),
  ('westmere-smallbore-rifle-club', 'westmere.demo03@example.com', 'official'),
  ('westmere-smallbore-rifle-club', 'westmere.demo04@example.com', 'member'),
  ('westmere-smallbore-rifle-club', 'westmere.demo05@example.com', 'member'),
  ('westmere-smallbore-rifle-club', 'westmere.demo06@example.com', 'member'),
  ('westmere-smallbore-rifle-club', 'westmere.demo07@example.com', 'member'),
  ('westmere-smallbore-rifle-club', 'westmere.demo08@example.com', 'member'),
  ('westmere-smallbore-rifle-club', 'westmere.demo09@example.com', 'member'),
  ('westmere-smallbore-rifle-club', 'westmere.demo10@example.com', 'member'),
  ('westmere-smallbore-rifle-club', 'northbridge.demo04@example.com', 'member'),
  ('south-essex-shooting-club', 'southessex.demo01@example.com', 'owner'),
  ('south-essex-shooting-club', 'southessex.demo02@example.com', 'official'),
  ('south-essex-shooting-club', 'southessex.demo03@example.com', 'official'),
  ('south-essex-shooting-club', 'southessex.demo04@example.com', 'member'),
  ('south-essex-shooting-club', 'southessex.demo05@example.com', 'member'),
  ('south-essex-shooting-club', 'southessex.demo06@example.com', 'member'),
  ('south-essex-shooting-club', 'southessex.demo07@example.com', 'member'),
  ('south-essex-shooting-club', 'southessex.demo08@example.com', 'member'),
  ('south-essex-shooting-club', 'southessex.demo09@example.com', 'member'),
  ('south-essex-shooting-club', 'southessex.demo10@example.com', 'member'),
  ('south-essex-shooting-club', 'westmere.demo04@example.com', 'member');

insert into public.club_memberships (club_id, user_id, status, role)
select club.id, demo.user_id, 'active', membership.role
from demo_memberships as membership
join public.clubs as club on club.slug = membership.club_slug
join demo_users as demo on demo.email = membership.email
on conflict (club_id, user_id) do update
set status = excluded.status,
    role = excluded.role;

create temporary table demo_club_cards on commit drop as
select club.id as club_id, card.title, card.content, card.position,
  owner_user.user_id as owner_user_id
from (values
  ('basildon-rifle-and-pistol-club', 'Range nights', 'Club practice takes place on Tuesday and Thursday evenings in this fictional demo world.', 1, 'basildon.demo01@example.com'),
  ('basildon-rifle-and-pistol-club', 'League entries', 'Speak to a club official before the season entry deadline if you would like to be considered.', 2, 'basildon.demo01@example.com'),
  ('northbridge-target-shooting-club', 'Club programme', 'Weekly smallbore practice and regular postal-league participation.', 1, 'northbridge.demo01@example.com'),
  ('westmere-smallbore-rifle-club', 'Visitors', 'Prospective members are welcome by prior arrangement.', 1, 'westmere.demo01@example.com'),
  ('south-essex-shooting-club', 'Competition calendar', 'The club enters selected regional Individual, Pairs, and Team competitions.', 1, 'southessex.demo01@example.com')
) as card(club_slug, title, content, position, owner_email)
join public.clubs as club on club.slug = card.club_slug
join demo_users as owner_user on owner_user.email = card.owner_email;

update public.club_information_cards as existing
set title = demo.title,
    content = demo.content,
    updated_by = demo.owner_user_id
from demo_club_cards as demo
where existing.club_id = demo.club_id
  and existing.position = demo.position;

insert into public.club_information_cards (
  club_id, title, content, position, created_by, updated_by
)
select club_id, title, content, position, owner_user_id, owner_user_id
from demo_club_cards as demo
where not exists (
  select 1
  from public.club_information_cards as existing
  where existing.club_id = demo.club_id
    and existing.position = demo.position
);

create temporary table demo_seasons (
  organisation_slug text not null,
  name text not null,
  slug text not null,
  status text not null,
  entry_open_offset integer not null,
  entry_close_offset integer not null,
  start_offset integer not null,
  end_offset integer not null,
  owner_email text not null
) on commit drop;

insert into demo_seasons values
  ('eastern-region-shooting-association', 'Eastern Winter Postal League', 'eastern-winter-postal-league', 'completed', -340, -310, -300, -120, 'basildon.demo01@example.com'),
  ('eastern-region-shooting-association', 'Eastern Summer League', 'eastern-summer-league', 'open', -45, 21, -28, 100, 'basildon.demo01@example.com'),
  ('eastern-region-shooting-association', 'Eastern Autumn Development League', 'eastern-autumn-development-league', 'open', 30, 65, 75, 190, 'basildon.demo01@example.com'),
  ('central-target-sports-association', 'Central Winter League', 'central-winter-league', 'completed', -300, -270, -260, -110, 'westmere.demo01@example.com'),
  ('central-target-sports-association', 'Central Spring League', 'central-spring-league', 'open', -5, 10, 20, 140, 'westmere.demo01@example.com');

insert into public.league_seasons (
  organisation_id, name, slug, status, entry_opens_at, entry_closes_at,
  starts_at, ends_at, created_by, updated_by
)
select organisation.id, season.name, season.slug, season.status,
  current_date + season.entry_open_offset,
  current_date + season.entry_close_offset,
  current_date + season.start_offset,
  current_date + season.end_offset,
  owner_user.user_id,
  owner_user.user_id
from demo_seasons as season
join public.organisations as organisation
  on organisation.slug = season.organisation_slug
join demo_users as owner_user on owner_user.email = season.owner_email
on conflict (organisation_id, slug) do update
set name = excluded.name,
    status = excluded.status,
    entry_opens_at = excluded.entry_opens_at,
    entry_closes_at = excluded.entry_closes_at,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    updated_by = excluded.updated_by;

create temporary table demo_competitions (
  season_slug text not null,
  name text not null,
  slug text not null,
  description text,
  status text not null,
  entry_format text not null,
  team_size integer not null,
  scoring_method text not null,
  maximum_score integer,
  shots_per_round integer,
  uses_x_score boolean not null,
  number_of_rounds integer not null,
  entry_fee numeric(8,2),
  first_deadline_offset integer,
  deadline_step integer,
  owner_email text not null
) on commit drop;

insert into demo_competitions values
  ('eastern-winter-postal-league', 'Winter Smallbore 100', 'winter-smallbore-100', 'A completed Individual postal league scored by points dropped.', 'published', 'individual', 1, 'points_dropped', 100, 10, true, 6, 6.50, -275, 25, 'basildon.demo01@example.com'),
  ('eastern-winter-postal-league', 'Winter Pairs 200', 'winter-pairs-200', 'A completed two-person aggregate competition.', 'published', 'pairs', 2, 'points_scored', 200, 20, false, 5, 10.00, -270, 28, 'basildon.demo01@example.com'),
  ('eastern-winter-postal-league', 'County Team 100', 'county-team-100', 'A completed four-person club team competition.', 'published', 'team', 4, 'points_dropped', 100, 10, false, 4, 16.00, -260, 35, 'basildon.demo01@example.com'),
  ('eastern-summer-league', 'Summer Individual 100', 'summer-individual-100', 'The main open Individual competition used for member and entry testing.', 'published', 'individual', 1, 'points_scored', 100, 10, true, 6, 7.50, -7, 18, 'basildon.demo01@example.com'),
  ('eastern-summer-league', 'Summer Pairs 200', 'summer-pairs-200', 'Open pairs with a saved draft division layout.', 'published', 'pairs', 2, 'points_dropped', 200, 20, false, 4, 12.00, 0, 24, 'basildon.demo01@example.com'),
  ('eastern-summer-league', 'Summer Club Team 200', 'summer-club-team-200', 'Open four-person team competition with X scores.', 'published', 'team', 4, 'points_scored', 200, 20, true, 5, 20.00, 4, 20, 'basildon.demo01@example.com'),
  ('eastern-summer-league', 'Development Individual Trial', 'development-individual-trial', 'A private draft competition visible to the organisation owner.', 'draft', 'individual', 1, 'points_scored', null, null, false, 3, 0.00, null, null, 'basildon.demo01@example.com'),
  ('eastern-autumn-development-league', 'Autumn Individual 200', 'autumn-individual-200', 'A published future Individual competition.', 'published', 'individual', 1, 'points_scored', 200, 20, true, 5, 8.00, 95, 18, 'basildon.demo01@example.com'),
  ('eastern-autumn-development-league', 'Autumn Club Team 100', 'autumn-club-team-100', 'A future three-person team competition.', 'published', 'team', 3, 'points_dropped', 100, 10, false, 4, 15.00, 100, 25, 'basildon.demo01@example.com'),
  ('central-winter-league', 'Central Individual 100', 'central-individual-100', 'Completed Central association Individual competition.', 'published', 'individual', 1, 'points_dropped', 100, 10, false, 5, 6.00, -240, 25, 'westmere.demo01@example.com'),
  ('central-winter-league', 'Central Pairs 200', 'central-pairs-200', 'Completed Central association pairs competition.', 'published', 'pairs', 2, 'points_scored', 200, 20, true, 4, 9.00, -230, 30, 'westmere.demo01@example.com'),
  ('central-spring-league', 'Central Spring Individual 100', 'central-spring-individual-100', 'A future season whose entry window is currently open.', 'published', 'individual', 1, 'points_scored', 100, 10, true, 5, 7.00, 35, 20, 'westmere.demo01@example.com'),
  ('central-spring-league', 'Central Spring Team 200', 'central-spring-team-200', 'A future three-person club team competition.', 'published', 'team', 3, 'points_dropped', 200, 20, false, 4, 14.00, 40, 28, 'westmere.demo01@example.com');

insert into public.competitions (
  league_season_id, name, slug, description, status, entry_format, team_size,
  scoring_method, maximum_score_per_round, shots_per_round, uses_x_score,
  number_of_rounds, entry_fee, created_by, updated_by
)
select season.id, competition.name, competition.slug, competition.description,
  competition.status, competition.entry_format, competition.team_size,
  competition.scoring_method, competition.maximum_score,
  competition.shots_per_round, competition.uses_x_score,
  competition.number_of_rounds, competition.entry_fee,
  owner_user.user_id, owner_user.user_id
from demo_competitions as competition
join demo_seasons as season_spec on season_spec.slug = competition.season_slug
join public.organisations as organisation
  on organisation.slug = season_spec.organisation_slug
join public.league_seasons as season
  on season.organisation_id = organisation.id
 and season.slug = competition.season_slug
join demo_users as owner_user on owner_user.email = competition.owner_email
on conflict (league_season_id, slug) do update
set name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    entry_format = excluded.entry_format,
    team_size = excluded.team_size,
    scoring_method = excluded.scoring_method,
    maximum_score_per_round = excluded.maximum_score_per_round,
    shots_per_round = excluded.shots_per_round,
    uses_x_score = excluded.uses_x_score,
    number_of_rounds = excluded.number_of_rounds,
    entry_fee = excluded.entry_fee,
    updated_by = excluded.updated_by;

create temporary table demo_competition_ids on commit drop as
select competition.id as competition_id,
  demo.slug as competition_slug,
  demo.season_slug
from demo_competitions as demo
join demo_seasons as season_spec on season_spec.slug = demo.season_slug
join public.organisations as organisation
  on organisation.slug = season_spec.organisation_slug
join public.league_seasons as season
  on season.organisation_id = organisation.id
 and season.slug = demo.season_slug
join public.competitions as competition
  on competition.league_season_id = season.id
 and competition.slug = demo.slug;

delete from public.competition_rounds as round
using demo_competition_ids as demo
where round.competition_id = demo.competition_id;

insert into public.competition_rounds (competition_id, round_number, deadline)
select competition.competition_id, round_number,
  current_date + demo.first_deadline_offset
    + ((round_number - 1) * demo.deadline_step)
from demo_competitions as demo
join demo_competition_ids as competition
  on competition.competition_slug = demo.slug
 and competition.season_slug = demo.season_slug
cross join lateral generate_series(1, demo.number_of_rounds) as round_number
where demo.first_deadline_offset is not null;

create temporary table demo_entries (
  competition_slug text not null,
  club_slug text not null,
  status text not null
) on commit drop;

insert into demo_entries values
  ('winter-smallbore-100', 'basildon-rifle-and-pistol-club', 'submitted'),
  ('winter-smallbore-100', 'northbridge-target-shooting-club', 'submitted'),
  ('winter-smallbore-100', 'south-essex-shooting-club', 'submitted'),
  ('winter-pairs-200', 'basildon-rifle-and-pistol-club', 'submitted'),
  ('winter-pairs-200', 'northbridge-target-shooting-club', 'submitted'),
  ('county-team-100', 'basildon-rifle-and-pistol-club', 'submitted'),
  ('county-team-100', 'south-essex-shooting-club', 'submitted'),
  ('summer-individual-100', 'basildon-rifle-and-pistol-club', 'submitted'),
  ('summer-individual-100', 'northbridge-target-shooting-club', 'submitted'),
  ('summer-individual-100', 'westmere-smallbore-rifle-club', 'draft'),
  ('summer-individual-100', 'south-essex-shooting-club', 'withdrawn'),
  ('summer-pairs-200', 'basildon-rifle-and-pistol-club', 'submitted'),
  ('summer-pairs-200', 'northbridge-target-shooting-club', 'submitted'),
  ('summer-pairs-200', 'south-essex-shooting-club', 'draft'),
  ('summer-club-team-200', 'basildon-rifle-and-pistol-club', 'submitted'),
  ('summer-club-team-200', 'westmere-smallbore-rifle-club', 'submitted'),
  ('central-individual-100', 'westmere-smallbore-rifle-club', 'submitted'),
  ('central-individual-100', 'south-essex-shooting-club', 'submitted'),
  ('central-spring-individual-100', 'westmere-smallbore-rifle-club', 'submitted'),
  ('central-spring-individual-100', 'south-essex-shooting-club', 'draft');

insert into public.club_competition_entries (
  competition_id, club_id, status, submitted_at, created_by, updated_by
)
select competition.competition_id, club.id, entry.status,
  case when entry.status = 'submitted' then
    least(now() - interval '3 days', season.entry_closes_at::timestamptz - interval '1 day')
  else null end,
  owner_user.user_id, owner_user.user_id
from demo_entries as entry
join demo_competition_ids as competition
  on competition.competition_slug = entry.competition_slug
join public.competitions as competition_row
  on competition_row.id = competition.competition_id
join public.league_seasons as season
  on season.id = competition_row.league_season_id
join public.clubs as club on club.slug = entry.club_slug
join demo_memberships as owner_membership
  on owner_membership.club_slug = entry.club_slug
 and owner_membership.role = 'owner'
join demo_users as owner_user on owner_user.email = owner_membership.email
on conflict (competition_id, club_id) do update
set status = excluded.status,
    submitted_at = excluded.submitted_at,
    updated_by = excluded.updated_by;

-- Reruns replace only entrant composition belonging to the stable demo
-- competition/club submissions above. Cascades remove their old assignments;
-- the division layouts are rebuilt below in the same transaction.
delete from public.competition_entrants as entrant
using public.club_competition_entries as entry,
      demo_competition_ids as competition,
      public.clubs as club,
      demo_entries as demo
where entrant.club_competition_entry_id = entry.id
  and entry.competition_id = competition.competition_id
  and entry.club_id = club.id
  and competition.competition_slug = demo.competition_slug
  and club.slug = demo.club_slug;

create temporary table demo_participants (
  competition_slug text not null,
  club_slug text not null,
  entrant_position integer not null,
  slot_number integer not null,
  email text not null
) on commit drop;

insert into demo_participants values
  ('winter-smallbore-100', 'basildon-rifle-and-pistol-club', 1, 1, 'basildon.demo04@example.com'),
  ('winter-smallbore-100', 'basildon-rifle-and-pistol-club', 2, 1, 'basildon.demo05@example.com'),
  ('winter-smallbore-100', 'basildon-rifle-and-pistol-club', 3, 1, 'basildon.demo06@example.com'),
  ('winter-smallbore-100', 'basildon-rifle-and-pistol-club', 4, 1, 'basildon.demo07@example.com'),
  ('winter-smallbore-100', 'northbridge-target-shooting-club', 1, 1, 'northbridge.demo04@example.com'),
  ('winter-smallbore-100', 'northbridge-target-shooting-club', 2, 1, 'northbridge.demo05@example.com'),
  ('winter-smallbore-100', 'northbridge-target-shooting-club', 3, 1, 'northbridge.demo06@example.com'),
  ('winter-smallbore-100', 'northbridge-target-shooting-club', 4, 1, 'northbridge.demo07@example.com'),
  ('winter-smallbore-100', 'south-essex-shooting-club', 1, 1, 'southessex.demo04@example.com'),
  ('winter-smallbore-100', 'south-essex-shooting-club', 2, 1, 'southessex.demo05@example.com'),
  ('winter-smallbore-100', 'south-essex-shooting-club', 3, 1, 'southessex.demo06@example.com'),
  ('winter-pairs-200', 'basildon-rifle-and-pistol-club', 1, 1, 'basildon.demo04@example.com'),
  ('winter-pairs-200', 'basildon-rifle-and-pistol-club', 1, 2, 'basildon.demo05@example.com'),
  ('winter-pairs-200', 'basildon-rifle-and-pistol-club', 2, 1, 'basildon.demo06@example.com'),
  ('winter-pairs-200', 'basildon-rifle-and-pistol-club', 2, 2, 'basildon.demo07@example.com'),
  ('winter-pairs-200', 'northbridge-target-shooting-club', 1, 1, 'northbridge.demo04@example.com'),
  ('winter-pairs-200', 'northbridge-target-shooting-club', 1, 2, 'northbridge.demo05@example.com'),
  ('winter-pairs-200', 'northbridge-target-shooting-club', 2, 1, 'northbridge.demo06@example.com'),
  ('winter-pairs-200', 'northbridge-target-shooting-club', 2, 2, 'northbridge.demo07@example.com'),
  ('county-team-100', 'basildon-rifle-and-pistol-club', 1, 1, 'basildon.demo04@example.com'),
  ('county-team-100', 'basildon-rifle-and-pistol-club', 1, 2, 'basildon.demo05@example.com'),
  ('county-team-100', 'basildon-rifle-and-pistol-club', 1, 3, 'basildon.demo06@example.com'),
  ('county-team-100', 'basildon-rifle-and-pistol-club', 1, 4, 'basildon.demo07@example.com'),
  ('county-team-100', 'south-essex-shooting-club', 1, 1, 'southessex.demo04@example.com'),
  ('county-team-100', 'south-essex-shooting-club', 1, 2, 'southessex.demo05@example.com'),
  ('county-team-100', 'south-essex-shooting-club', 1, 3, 'southessex.demo06@example.com'),
  ('county-team-100', 'south-essex-shooting-club', 1, 4, 'southessex.demo07@example.com'),
  ('summer-individual-100', 'basildon-rifle-and-pistol-club', 1, 1, 'basildon.demo04@example.com'),
  ('summer-individual-100', 'basildon-rifle-and-pistol-club', 2, 1, 'basildon.demo05@example.com'),
  ('summer-individual-100', 'basildon-rifle-and-pistol-club', 3, 1, 'basildon.demo06@example.com'),
  ('summer-individual-100', 'basildon-rifle-and-pistol-club', 4, 1, 'basildon.demo07@example.com'),
  ('summer-individual-100', 'basildon-rifle-and-pistol-club', 5, 1, 'basildon.demo08@example.com'),
  ('summer-individual-100', 'northbridge-target-shooting-club', 1, 1, 'northbridge.demo04@example.com'),
  ('summer-individual-100', 'northbridge-target-shooting-club', 2, 1, 'northbridge.demo05@example.com'),
  ('summer-individual-100', 'northbridge-target-shooting-club', 3, 1, 'northbridge.demo06@example.com'),
  ('summer-individual-100', 'northbridge-target-shooting-club', 4, 1, 'northbridge.demo07@example.com'),
  ('summer-individual-100', 'westmere-smallbore-rifle-club', 1, 1, 'westmere.demo04@example.com'),
  ('summer-individual-100', 'westmere-smallbore-rifle-club', 2, 1, 'westmere.demo05@example.com'),
  ('summer-individual-100', 'south-essex-shooting-club', 1, 1, 'southessex.demo04@example.com'),
  ('summer-individual-100', 'south-essex-shooting-club', 2, 1, 'southessex.demo05@example.com'),
  ('summer-individual-100', 'south-essex-shooting-club', 3, 1, 'southessex.demo06@example.com'),
  ('summer-pairs-200', 'basildon-rifle-and-pistol-club', 1, 1, 'basildon.demo04@example.com'),
  ('summer-pairs-200', 'basildon-rifle-and-pistol-club', 1, 2, 'basildon.demo05@example.com'),
  ('summer-pairs-200', 'basildon-rifle-and-pistol-club', 2, 1, 'basildon.demo06@example.com'),
  ('summer-pairs-200', 'basildon-rifle-and-pistol-club', 2, 2, 'basildon.demo07@example.com'),
  ('summer-pairs-200', 'northbridge-target-shooting-club', 1, 1, 'northbridge.demo04@example.com'),
  ('summer-pairs-200', 'northbridge-target-shooting-club', 1, 2, 'northbridge.demo05@example.com'),
  ('summer-pairs-200', 'northbridge-target-shooting-club', 2, 1, 'northbridge.demo06@example.com'),
  ('summer-pairs-200', 'northbridge-target-shooting-club', 2, 2, 'northbridge.demo07@example.com'),
  ('summer-pairs-200', 'south-essex-shooting-club', 1, 1, 'southessex.demo04@example.com'),
  ('summer-pairs-200', 'south-essex-shooting-club', 1, 2, 'southessex.demo05@example.com'),
  ('summer-pairs-200', 'south-essex-shooting-club', 2, 1, 'southessex.demo06@example.com'),
  ('summer-club-team-200', 'basildon-rifle-and-pistol-club', 1, 1, 'basildon.demo04@example.com'),
  ('summer-club-team-200', 'basildon-rifle-and-pistol-club', 1, 2, 'basildon.demo05@example.com'),
  ('summer-club-team-200', 'basildon-rifle-and-pistol-club', 1, 3, 'basildon.demo06@example.com'),
  ('summer-club-team-200', 'basildon-rifle-and-pistol-club', 1, 4, 'basildon.demo07@example.com'),
  ('summer-club-team-200', 'westmere-smallbore-rifle-club', 1, 1, 'westmere.demo04@example.com'),
  ('summer-club-team-200', 'westmere-smallbore-rifle-club', 1, 2, 'westmere.demo05@example.com'),
  ('summer-club-team-200', 'westmere-smallbore-rifle-club', 1, 3, 'westmere.demo06@example.com'),
  ('summer-club-team-200', 'westmere-smallbore-rifle-club', 1, 4, 'westmere.demo07@example.com'),
  ('central-individual-100', 'westmere-smallbore-rifle-club', 1, 1, 'westmere.demo04@example.com'),
  ('central-individual-100', 'westmere-smallbore-rifle-club', 2, 1, 'westmere.demo05@example.com'),
  ('central-individual-100', 'westmere-smallbore-rifle-club', 3, 1, 'westmere.demo06@example.com'),
  ('central-individual-100', 'westmere-smallbore-rifle-club', 4, 1, 'westmere.demo07@example.com'),
  ('central-individual-100', 'south-essex-shooting-club', 1, 1, 'southessex.demo04@example.com'),
  ('central-individual-100', 'south-essex-shooting-club', 2, 1, 'southessex.demo05@example.com'),
  ('central-individual-100', 'south-essex-shooting-club', 3, 1, 'southessex.demo06@example.com'),
  ('central-individual-100', 'south-essex-shooting-club', 4, 1, 'southessex.demo07@example.com'),
  ('central-spring-individual-100', 'westmere-smallbore-rifle-club', 1, 1, 'westmere.demo04@example.com'),
  ('central-spring-individual-100', 'westmere-smallbore-rifle-club', 2, 1, 'westmere.demo05@example.com'),
  ('central-spring-individual-100', 'westmere-smallbore-rifle-club', 3, 1, 'westmere.demo06@example.com'),
  ('central-spring-individual-100', 'south-essex-shooting-club', 1, 1, 'southessex.demo04@example.com'),
  ('central-spring-individual-100', 'south-essex-shooting-club', 2, 1, 'southessex.demo05@example.com');

insert into public.competition_entrants (club_competition_entry_id, position)
select entry.id, participant.entrant_position
from demo_participants as participant
join demo_competition_ids as competition
  on competition.competition_slug = participant.competition_slug
join public.clubs as club on club.slug = participant.club_slug
join public.club_competition_entries as entry
  on entry.competition_id = competition.competition_id
 and entry.club_id = club.id
group by entry.id, participant.entrant_position;

insert into public.competition_entrant_participants (
  club_competition_entry_id, competition_entrant_id,
  club_membership_id, slot_number
)
select entry.id, entrant.id, membership.id, participant.slot_number
from demo_participants as participant
join demo_competition_ids as competition
  on competition.competition_slug = participant.competition_slug
join public.clubs as club on club.slug = participant.club_slug
join public.club_competition_entries as entry
  on entry.competition_id = competition.competition_id
 and entry.club_id = club.id
join public.competition_entrants as entrant
  on entrant.club_competition_entry_id = entry.id
 and entrant.position = participant.entrant_position
join demo_users as demo on demo.email = participant.email
join public.club_memberships as membership
  on membership.club_id = club.id
 and membership.user_id = demo.user_id;

-- Division example 1: a fully published historical allocation. Division
-- publication is valid because the parent season entry deadline has passed.
insert into public.competition_division_configs (
  competition_id, target_size, status, published_at, created_by, updated_by
)
select competition.competition_id, 6, 'published', now() - interval '100 days',
  owner_user.user_id, owner_user.user_id
from demo_competition_ids as competition
join demo_users as owner_user
  on owner_user.email = 'basildon.demo01@example.com'
where competition.competition_slug = 'winter-smallbore-100'
on conflict (competition_id) do update
set target_size = excluded.target_size,
    status = excluded.status,
    published_at = excluded.published_at,
    updated_by = excluded.updated_by;

-- Division example 2: an editable draft while entries remain open. One
-- complete pair is deliberately left unassigned; pair units remain atomic.
insert into public.competition_division_configs (
  competition_id, target_size, status, published_at, created_by, updated_by
)
select competition.competition_id, 2, 'draft', null, manager_user.user_id, manager_user.user_id
from demo_competition_ids as competition
join demo_users as manager_user
  on manager_user.email = 'basildon.demo02@example.com'
where competition.competition_slug = 'summer-pairs-200'
on conflict (competition_id) do update
set target_size = excluded.target_size,
    status = excluded.status,
    published_at = excluded.published_at,
    updated_by = excluded.updated_by;

delete from public.competition_divisions as division
using demo_competition_ids as competition
where division.competition_id = competition.competition_id
  and competition.competition_slug in ('winter-smallbore-100', 'summer-pairs-200');

insert into public.competition_divisions (competition_id, name, position)
select competition.competition_id, division.name, division.position
from (values
  ('winter-smallbore-100', 'Division One', 1),
  ('winter-smallbore-100', 'Division Two', 2),
  ('summer-pairs-200', 'Premier Pairs', 1),
  ('summer-pairs-200', 'Development Pairs', 2)
) as division(competition_slug, name, position)
join demo_competition_ids as competition
  on competition.competition_slug = division.competition_slug;

with ranked_entrants as (
  select entrant.id,
    row_number() over (order by club.slug, entrant.position, entrant.id) as rank
  from public.competition_entrants as entrant
  join public.club_competition_entries as entry
    on entry.id = entrant.club_competition_entry_id
  join demo_competition_ids as competition
    on competition.competition_id = entry.competition_id
  join public.clubs as club on club.id = entry.club_id
  where competition.competition_slug = 'winter-smallbore-100'
    and entry.status = 'submitted'
)
insert into public.competition_division_assignments (
  competition_entrant_id, competition_id, competition_division_id
)
select ranked.id, competition.competition_id, division.id
from ranked_entrants as ranked
join demo_competition_ids as competition
  on competition.competition_slug = 'winter-smallbore-100'
join public.competition_divisions as division
  on division.competition_id = competition.competition_id
 and division.position = case when ranked.rank <= 6 then 1 else 2 end;

with ranked_pairs as (
  select entrant.id,
    row_number() over (order by club.slug, entrant.position, entrant.id) as rank
  from public.competition_entrants as entrant
  join public.club_competition_entries as entry
    on entry.id = entrant.club_competition_entry_id
  join demo_competition_ids as competition
    on competition.competition_id = entry.competition_id
  join public.clubs as club on club.id = entry.club_id
  where competition.competition_slug = 'summer-pairs-200'
    and entry.status = 'submitted'
)
insert into public.competition_division_assignments (
  competition_entrant_id, competition_id, competition_division_id
)
select ranked.id, competition.competition_id, division.id
from ranked_pairs as ranked
join demo_competition_ids as competition
  on competition.competition_slug = 'summer-pairs-200'
join public.competition_divisions as division
  on division.competition_id = competition.competition_id
 and division.position = case when ranked.rank <= 2 then 1 else 2 end
where ranked.rank <= 3;

do $$
begin
  if exists (
    select 1
    from public.clubs as club
    join demo_memberships as expected on expected.club_slug = club.slug
    join demo_users as demo on demo.email = expected.email
    left join public.club_memberships as actual
      on actual.club_id = club.id
     and actual.user_id = demo.user_id
    group by club.id
    having count(actual.id) not between 8 and 14
      or count(actual.id) filter (
        where actual.status = 'active' and actual.role = 'owner'
      ) <> 1
      or count(actual.id) filter (
        where actual.status = 'active' and actual.role = 'official'
      ) not between 1 and 2
  ) then
    raise exception 'Demo club membership role/count validation failed.';
  end if;

  if exists (
    select 1
    from public.organisations as organisation
    where organisation.slug in (
      'eastern-region-shooting-association',
      'central-target-sports-association'
    )
    and (
      (select count(*) from public.organisation_staff as staff
       where staff.organisation_id = organisation.id
         and staff.status = 'active' and staff.role = 'owner') <> 1
      or
      (select count(*) from public.organisation_staff as staff
       where staff.organisation_id = organisation.id
         and staff.status = 'active' and staff.role = 'manager') < 1
    )
  ) then
    raise exception 'Demo organisation staff role validation failed.';
  end if;

  if exists (
    select 1
    from demo_competitions as demo
    join demo_competition_ids as competition
      on competition.competition_slug = demo.slug
     and competition.season_slug = demo.season_slug
    left join public.competition_rounds as round
      on round.competition_id = competition.competition_id
    where demo.status = 'published'
    group by demo.slug, demo.number_of_rounds
    having count(round.id) <> demo.number_of_rounds
  ) then
    raise exception 'Every published demo competition must have its complete round schedule.';
  end if;

  if exists (
    select 1
    from public.competition_entrants as entrant
    join public.club_competition_entries as entry
      on entry.id = entrant.club_competition_entry_id
    join demo_competition_ids as demo_competition
      on demo_competition.competition_id = entry.competition_id
    join public.competitions as competition
      on competition.id = demo_competition.competition_id
    left join public.competition_entrant_participants as participant
      on participant.competition_entrant_id = entrant.id
    where entry.status = 'submitted'
    group by entrant.id, competition.team_size
    having count(participant.id) <> competition.team_size
  ) then
    raise exception 'Every submitted demo entrant unit must be complete.';
  end if;

  if (
    select count(*)
    from public.competition_division_assignments as assignment
    join demo_competition_ids as competition
      on competition.competition_id = assignment.competition_id
    where competition.competition_slug = 'winter-smallbore-100'
  ) <> (
    select count(*)
    from public.competition_entrants as entrant
    join public.club_competition_entries as entry
      on entry.id = entrant.club_competition_entry_id
    join demo_competition_ids as competition
      on competition.competition_id = entry.competition_id
    where competition.competition_slug = 'winter-smallbore-100'
      and entry.status = 'submitted'
  ) then
    raise exception 'Published demo divisions must assign every submitted entrant unit.';
  end if;
end;
$$;

commit;

-- Expected stable top-level result after a successful run:
--   40 confirmed demo Auth users, email identities, and profiles
--   2 organisations, 4 clubs, 43 active club memberships
--   5 seasons, 13 competitions, 20 club submissions
--   1 published division layout and 1 saved draft layout
