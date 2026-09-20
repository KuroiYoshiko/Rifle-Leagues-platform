-- Canonical fresh-install schema: organisations.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."organisation_information_cards" (
  "id" bigint generated always as identity not null,
  "organisation_id" bigint not null,
  "title" text not null,
  "content" text not null,
  "position" smallint not null,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."organisation_staff" (
  "id" bigint generated always as identity not null,
  "organisation_id" bigint not null,
  "user_id" uuid not null,
  "role" text default 'manager'::text not null,
  "status" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."organisations" (
  "id" bigint generated always as identity not null,
  "name" text not null,
  "slug" text not null,
  "short_name" text,
  "description" text,
  "website" text,
  "contact_email" text,
  "status" text default 'active'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "search_document" tsvector generated always as ((setweight(to_tsvector('simple'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, COALESCE(short_name, ''::text)), 'B'::"char"))) stored,
  "organisation_type" text default 'other'::text not null,
  "address" text,
  "postcode" text,
  "telephone" text,
  "about_content" text
);

create table "public"."user_organisations" (
  "user_id" uuid not null,
  "organisation_id" bigint not null,
  "created_at" timestamp with time zone default now() not null
);

CREATE OR REPLACE FUNCTION private.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_organisation_information_card(p_organisation_id bigint, p_title text, p_content text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_title text := btrim(p_title);
  v_content text := btrim(p_content);
  v_position smallint;
  v_card_id bigint;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_title is null
    or char_length(v_title) not between 1 and 120
    or v_content is null
    or char_length(v_content) not between 1 and 20000 then
    raise exception 'Card title or content is invalid.' using errcode = '22023';
  end if;

  -- Serialise every card mutation for this organisation. This makes the count
  -- and next dense position stable even when two requests arrive together.
  perform organisation.id
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for update;

  if not found then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.organisation_staff as staff
    where staff.organisation_id = p_organisation_id
      and staff.user_id = v_actor_id
      and staff.role = 'owner'
      and staff.status = 'active'
  ) then
    raise exception 'Only this organisation owner can create information cards.'
      using errcode = '42501';
  end if;

  select (count(*) + 1)::smallint
  into v_position
  from public.organisation_information_cards as card
  where card.organisation_id = p_organisation_id;

  if v_position > 5 then
    raise exception 'An organisation can publish at most five information cards.'
      using errcode = '54000';
  end if;

  insert into public.organisation_information_cards (
    organisation_id,
    title,
    content,
    position,
    created_by,
    updated_by
  )
  values (
    p_organisation_id,
    v_title,
    v_content,
    v_position,
    v_actor_id,
    v_actor_id
  )
  returning id into v_card_id;

  return v_card_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_organisation_information_card(p_organisation_id bigint, p_card_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_deleted_position smallint;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  perform organisation.id
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for update;

  if not found then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.organisation_staff as staff
    where staff.organisation_id = p_organisation_id
      and staff.user_id = v_actor_id
      and staff.role = 'owner'
      and staff.status = 'active'
  ) then
    raise exception 'Only this organisation owner can delete information cards.'
      using errcode = '42501';
  end if;

  select card.position
  into v_deleted_position
  from public.organisation_information_cards as card
  where card.id = p_card_id
    and card.organisation_id = p_organisation_id
  for update;

  if v_deleted_position is null then
    raise exception 'Information card not found in this organisation.'
      using errcode = 'P0002';
  end if;

  set constraints organisation_information_cards_organisation_position_unique deferred;

  delete from public.organisation_information_cards as card
  where card.id = p_card_id
    and card.organisation_id = p_organisation_id;

  update public.organisation_information_cards as card
  set position = card.position - 1,
      updated_by = v_actor_id
  where card.organisation_id = p_organisation_id
    and card.position > v_deleted_position;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_organisations()
 RETURNS TABLE(id bigint, name text, slug text, management_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  with sources as (
    select followed.organisation_id, null::text as management_role
    from public.user_organisations as followed
    where followed.user_id = v_actor_id

    union all

    select staff.organisation_id, staff.role
    from public.organisation_staff as staff
    where staff.user_id = v_actor_id
      and staff.status = 'active'

    union all

    select season.organisation_id, null::text
    from public.club_memberships as membership
    join public.clubs as club
      on club.id = membership.club_id
     and club.status = 'active'
    join public.club_competition_entries as entry
      on entry.club_id = membership.club_id
     and entry.status = 'submitted'
    join public.competitions as competition
      on competition.id = entry.competition_id
    join public.league_seasons as season
      on season.id = competition.league_season_id
    where membership.user_id = v_actor_id
      and membership.status = 'active'
  ), deduplicated as (
    select
      source.organisation_id,
      case max(
        case source.management_role
          when 'owner' then 2
          when 'manager' then 1
          else 0
        end
      )
        when 2 then 'owner'
        when 1 then 'manager'
        else null
      end as management_role
    from sources as source
    group by source.organisation_id
  )
  select organisation.id, organisation.name, organisation.slug,
    deduplicated.management_role
  from deduplicated
  join public.organisations as organisation
    on organisation.id = deduplicated.organisation_id
  where organisation.status = 'active'
  order by organisation.name, organisation.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_organisation_staff(p_organisation_id bigint)
 RETURNS TABLE(staff_id bigint, first_name text, last_name text, staff_role text, staff_status text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.process_organisation_management_request(p_staff_id bigint, p_decision text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.register_organisation(p_name text, p_short_name text, p_organisation_type text, p_address text, p_postcode text, p_telephone text, p_contact_email text, p_website text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.remove_organisation_manager_access(p_staff_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.reorder_organisation_information_cards(p_organisation_id bigint, p_card_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_current_count integer;
  v_unique_count integer;
  v_matching_count integer;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if p_card_ids is null or cardinality(p_card_ids) > 5 then
    raise exception 'The complete card order must contain at most five IDs.'
      using errcode = '22023';
  end if;

  perform organisation.id
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for update;

  if not found then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.organisation_staff as staff
    where staff.organisation_id = p_organisation_id
      and staff.user_id = v_actor_id
      and staff.role = 'owner'
      and staff.status = 'active'
  ) then
    raise exception 'Only this organisation owner can reorder information cards.'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into v_current_count
  from public.organisation_information_cards as card
  where card.organisation_id = p_organisation_id;

  select count(distinct supplied.card_id)::integer
  into v_unique_count
  from unnest(p_card_ids) as supplied(card_id);

  select count(*)::integer
  into v_matching_count
  from public.organisation_information_cards as card
  where card.organisation_id = p_organisation_id
    and card.id = any(p_card_ids);

  if cardinality(p_card_ids) <> v_current_count
    or v_unique_count <> v_current_count
    or v_matching_count <> v_current_count then
    raise exception 'Card order must contain every current card exactly once.'
      using errcode = '22023';
  end if;

  -- The function has an intentionally empty search_path, so the constraint
  -- must be schema-qualified before positions can be swapped atomically.
  set constraints public.organisation_information_cards_organisation_position_unique deferred;

  update public.organisation_information_cards as card
  set position = supplied.position::smallint,
      updated_by = v_actor_id
  from unnest(p_card_ids) with ordinality as supplied(card_id, position)
  where card.id = supplied.card_id
    and card.organisation_id = p_organisation_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_organisation_management_access(p_organisation_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.transfer_organisation_ownership(p_organisation_id bigint, p_target_staff_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_organisation_about(p_organisation_id bigint, p_about_content text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_organisation_contact_details(p_organisation_id bigint, p_address text, p_postcode text, p_telephone text, p_contact_email text, p_website text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_organisation_information_card(p_organisation_id bigint, p_card_id bigint, p_title text, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_title text := btrim(p_title);
  v_content text := btrim(p_content);
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_title is null
    or char_length(v_title) not between 1 and 120
    or v_content is null
    or char_length(v_content) not between 1 and 20000 then
    raise exception 'Card title or content is invalid.' using errcode = '22023';
  end if;

  perform organisation.id
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for update;

  if not found then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.organisation_staff as staff
    where staff.organisation_id = p_organisation_id
      and staff.user_id = v_actor_id
      and staff.role = 'owner'
      and staff.status = 'active'
  ) then
    raise exception 'Only this organisation owner can update information cards.'
      using errcode = '42501';
  end if;

  update public.organisation_information_cards as card
  set title = v_title,
      content = v_content,
      updated_by = v_actor_id
  where card.id = p_card_id
    and card.organisation_id = p_organisation_id;

  if not found then
    raise exception 'Information card not found in this organisation.'
      using errcode = 'P0002';
  end if;
end;
$function$;


commit;

