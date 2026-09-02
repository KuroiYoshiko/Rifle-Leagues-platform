-- Run after database/clubs-and-memberships.sql.
-- Adds atomic club registration, owner-only About content, stricter club-name
-- editing, and optional owner-authored club Information cards.

begin;

alter table public.clubs
  add column if not exists about_content text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clubs_about_content_value'
      and conrelid = 'public.clubs'::regclass
  ) then
    alter table public.clubs
      add constraint clubs_about_content_value check (
        about_content is null or (
          char_length(about_content) between 1 and 20000
          and about_content = btrim(about_content)
        )
      );
  end if;
end;
$$;

comment on column public.clubs.about_content is
  'The club''s single public long-form About document, stored as constrained Markdown rather than HTML.';

grant select (about_content) on table public.clubs to authenticated;

create or replace function public.register_club(
  p_name text,
  p_town text,
  p_county text,
  p_postcode text,
  p_website text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_club_id bigint;
  v_name text := btrim(coalesce(p_name, ''));
  v_town text := nullif(btrim(coalesce(p_town, '')), '');
  v_county text := nullif(btrim(coalesce(p_county, '')), '');
  v_postcode text := nullif(btrim(coalesce(p_postcode, '')), '');
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
  v_slug text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 160 then
    raise exception 'Club name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if v_town is not null and char_length(v_town) > 100 then
    raise exception 'Town must contain 100 characters or fewer.'
      using errcode = '22023';
  end if;

  if v_county is not null and char_length(v_county) > 100 then
    raise exception 'County must contain 100 characters or fewer.'
      using errcode = '22023';
  end if;

  if v_postcode is not null and char_length(v_postcode) > 20 then
    raise exception 'Postcode must contain 20 characters or fewer.'
      using errcode = '22023';
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
    raise exception 'The club name cannot produce a route-safe web address.'
      using errcode = '22023';
  end if;

  -- Serialise equivalent names before checking. The slug uniqueness constraint
  -- remains the final guard for different names that normalise to one slug.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(lower(v_name), 0)
  );

  if exists (
    select 1
    from public.clubs as club
    where club.slug = v_slug
      or lower(club.name) = lower(v_name)
  ) then
    raise exception 'A club with this name appears to already be registered.'
      using errcode = '23505';
  end if;

  insert into public.clubs (
    name,
    slug,
    town,
    county,
    postcode,
    website,
    status
  )
  values (
    v_name,
    v_slug,
    v_town,
    v_county,
    v_postcode,
    v_website,
    'active'
  )
  returning id into v_club_id;

  insert into public.club_memberships (
    club_id,
    user_id,
    status,
    role
  )
  values (
    v_club_id,
    v_actor_id,
    'active',
    'owner'
  );

  return v_slug;
exception
  when unique_violation then
    raise exception 'A club with this name appears to already be registered.'
      using errcode = '23505';
end;
$$;

comment on function public.register_club(text, text, text, text, text) is
  'Atomically registers an active club and makes the authenticated caller its active owner.';

revoke execute on function public.register_club(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.register_club(text, text, text, text, text)
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
  v_actor_role text;
  v_current_name text;
  v_name text := btrim(coalesce(p_name, ''));
  v_town text := nullif(btrim(coalesce(p_town, '')), '');
  v_county text := nullif(btrim(coalesce(p_county, '')), '');
  v_postcode text := nullif(btrim(coalesce(p_postcode, '')), '');
  v_website text := nullif(btrim(coalesce(p_website, '')), '');
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_name) not between 2 and 160
    or (v_town is not null and char_length(v_town) > 100)
    or (v_county is not null and char_length(v_county) > 100)
    or (v_postcode is not null and char_length(v_postcode) > 20)
    or (
      v_website is not null
      and (
        char_length(v_website) not between 8 and 2048
        or v_website !~* '^https?://[^[:space:]]+$'
      )
    ) then
    raise exception 'One or more club details are invalid.' using errcode = '22023';
  end if;

  select club.name
  into v_current_name
  from public.clubs as club
  where club.id = p_club_id
    and club.status = 'active'
  for update;

  if v_current_name is null then
    raise exception 'Active club not found.' using errcode = 'P0002';
  end if;

  select membership.role
  into v_actor_role
  from public.club_memberships as membership
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.status = 'active'
    and membership.role in ('official', 'owner')
  for share;

  if v_actor_role is null then
    raise exception 'You do not have permission to edit this club.'
      using errcode = '42501';
  end if;

  if v_name is distinct from v_current_name and v_actor_role <> 'owner' then
    raise exception 'Only this club owner can change the official club name.'
      using errcode = '42501';
  end if;

  if v_name is distinct from v_current_name then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(lower(v_name), 0)
    );

    if exists (
      select 1
      from public.clubs as other_club
      where other_club.id <> p_club_id
        and lower(other_club.name) = lower(v_name)
    ) then
      raise exception 'A club with this name appears to already be registered.'
        using errcode = '23505';
    end if;
  end if;

  update public.clubs as club
  set name = v_name,
      town = v_town,
      county = v_county,
      postcode = v_postcode,
      website = v_website
  where club.id = p_club_id
    and club.status = 'active';
end;
$$;

comment on function public.update_club_details(bigint, text, text, text, text, text) is
  'Updates normal details for active officials or owners, while restricting official club-name changes to the active owner.';

revoke execute on function public.update_club_details(bigint, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_club_details(bigint, text, text, text, text, text)
  to authenticated;

create or replace function public.update_club_about(
  p_club_id bigint,
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
  v_club_slug text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if v_about_content is not null and char_length(v_about_content) > 20000 then
    raise exception 'About content must contain 20,000 characters or fewer.'
      using errcode = '22023';
  end if;

  select club.slug
  into v_club_slug
  from public.clubs as club
  where club.id = p_club_id
    and club.status = 'active'
  for update;

  if v_club_slug is null then
    raise exception 'Active club not found.' using errcode = 'P0002';
  end if;

  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.role = 'owner'
    and membership.status = 'active'
  for share;

  if not found then
    raise exception 'Only this club owner can update About content.'
      using errcode = '42501';
  end if;

  update public.clubs as club
  set about_content = v_about_content
  where club.id = p_club_id;

  return v_club_slug;
end;
$$;

comment on function public.update_club_about(bigint, text) is
  'Updates only the single About document for an active club after verifying its active owner.';

revoke execute on function public.update_club_about(bigint, text)
  from public, anon, authenticated;
grant execute on function public.update_club_about(bigint, text)
  to authenticated;

create table if not exists public.club_information_cards (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs (id) on delete cascade,
  title text not null,
  content text not null,
  position smallint not null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_information_cards_title_value check (
    char_length(title) between 1 and 120
    and title = btrim(title)
  ),
  constraint club_information_cards_content_value check (
    char_length(content) between 1 and 20000
    and content = btrim(content)
  ),
  constraint club_information_cards_position_value check (
    position between 1 and 5
  ),
  constraint club_information_cards_club_position_unique
    unique (club_id, position)
    deferrable initially immediate
);

comment on table public.club_information_cards is
  'Optional owner-authored public long-form information cards for a club. Content is constrained Markdown, not HTML.';

comment on column public.club_information_cards.position is
  'Dense, one-based public display order. The 1-5 check plus per-club uniqueness enforces at most five cards.';

create index if not exists club_information_cards_created_by_idx
  on public.club_information_cards (created_by)
  where created_by is not null;

create index if not exists club_information_cards_updated_by_idx
  on public.club_information_cards (updated_by)
  where updated_by is not null;

drop trigger if exists set_club_information_cards_updated_at
  on public.club_information_cards;
create trigger set_club_information_cards_updated_at
  before update on public.club_information_cards
  for each row execute function private.set_updated_at();

alter table public.club_information_cards enable row level security;

revoke all privileges on table public.club_information_cards
  from anon, authenticated;
revoke all privileges on sequence public.club_information_cards_id_seq
  from anon, authenticated;
grant select (
  id,
  club_id,
  title,
  content,
  position,
  created_at,
  updated_at
) on table public.club_information_cards to authenticated;

drop policy if exists "Authenticated users can read active club information"
  on public.club_information_cards;
create policy "Authenticated users can read active club information"
on public.club_information_cards
for select
to authenticated
using (
  exists (
    select 1
    from public.clubs as club
    where club.id = club_information_cards.club_id
      and club.status = 'active'
  )
);

create or replace function public.create_club_information_card(
  p_club_id bigint,
  p_title text,
  p_content text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
  v_content text := btrim(coalesce(p_content, ''));
  v_position smallint;
  v_card_id bigint;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_title) not between 1 and 120
    or char_length(v_content) not between 1 and 20000 then
    raise exception 'Card title or content is invalid.' using errcode = '22023';
  end if;

  perform club.id
  from public.clubs as club
  where club.id = p_club_id
    and club.status = 'active'
  for update;

  if not found then
    raise exception 'Active club not found.' using errcode = 'P0002';
  end if;

  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.role = 'owner'
    and membership.status = 'active'
  for share;

  if not found then
    raise exception 'Only this club owner can create information cards.'
      using errcode = '42501';
  end if;

  select (count(*) + 1)::smallint
  into v_position
  from public.club_information_cards as card
  where card.club_id = p_club_id;

  if v_position > 5 then
    raise exception 'A club can publish at most five information cards.'
      using errcode = '54000';
  end if;

  insert into public.club_information_cards (
    club_id,
    title,
    content,
    position,
    created_by,
    updated_by
  )
  values (
    p_club_id,
    v_title,
    v_content,
    v_position,
    v_actor_id,
    v_actor_id
  )
  returning id into v_card_id;

  return v_card_id;
end;
$$;

create or replace function public.update_club_information_card(
  p_club_id bigint,
  p_card_id bigint,
  p_title text,
  p_content text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_title, ''));
  v_content text := btrim(coalesce(p_content, ''));
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if char_length(v_title) not between 1 and 120
    or char_length(v_content) not between 1 and 20000 then
    raise exception 'Card title or content is invalid.' using errcode = '22023';
  end if;

  perform club.id
  from public.clubs as club
  where club.id = p_club_id
    and club.status = 'active'
  for update;

  if not found then
    raise exception 'Active club not found.' using errcode = 'P0002';
  end if;

  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.role = 'owner'
    and membership.status = 'active'
  for share;

  if not found then
    raise exception 'Only this club owner can update information cards.'
      using errcode = '42501';
  end if;

  update public.club_information_cards as card
  set title = v_title,
      content = v_content,
      updated_by = v_actor_id
  where card.id = p_card_id
    and card.club_id = p_club_id;

  if not found then
    raise exception 'Information card not found in this club.'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.delete_club_information_card(
  p_club_id bigint,
  p_card_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_deleted_position smallint;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  perform club.id
  from public.clubs as club
  where club.id = p_club_id
    and club.status = 'active'
  for update;

  if not found then
    raise exception 'Active club not found.' using errcode = 'P0002';
  end if;

  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.role = 'owner'
    and membership.status = 'active'
  for share;

  if not found then
    raise exception 'Only this club owner can delete information cards.'
      using errcode = '42501';
  end if;

  select card.position
  into v_deleted_position
  from public.club_information_cards as card
  where card.id = p_card_id
    and card.club_id = p_club_id
  for update;

  if v_deleted_position is null then
    raise exception 'Information card not found in this club.'
      using errcode = 'P0002';
  end if;

  set constraints public.club_information_cards_club_position_unique deferred;

  delete from public.club_information_cards as card
  where card.id = p_card_id
    and card.club_id = p_club_id;

  update public.club_information_cards as card
  set position = card.position - 1,
      updated_by = v_actor_id
  where card.club_id = p_club_id
    and card.position > v_deleted_position;
end;
$$;

create or replace function public.reorder_club_information_cards(
  p_club_id bigint,
  p_card_ids bigint[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  perform club.id
  from public.clubs as club
  where club.id = p_club_id
    and club.status = 'active'
  for update;

  if not found then
    raise exception 'Active club not found.' using errcode = 'P0002';
  end if;

  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.role = 'owner'
    and membership.status = 'active'
  for share;

  if not found then
    raise exception 'Only this club owner can reorder information cards.'
      using errcode = '42501';
  end if;

  select count(*)::integer
  into v_current_count
  from public.club_information_cards as card
  where card.club_id = p_club_id;

  select count(distinct supplied.card_id)::integer
  into v_unique_count
  from unnest(p_card_ids) as supplied(card_id);

  select count(*)::integer
  into v_matching_count
  from public.club_information_cards as card
  where card.club_id = p_club_id
    and card.id = any(p_card_ids);

  if cardinality(p_card_ids) <> v_current_count
    or v_unique_count <> v_current_count
    or v_matching_count <> v_current_count then
    raise exception 'Card order must contain every current card exactly once.'
      using errcode = '22023';
  end if;

  set constraints public.club_information_cards_club_position_unique deferred;

  update public.club_information_cards as card
  set position = supplied.position::smallint,
      updated_by = v_actor_id
  from unnest(p_card_ids) with ordinality as supplied(card_id, position)
  where card.id = supplied.card_id
    and card.club_id = p_club_id;
end;
$$;

revoke execute on function public.create_club_information_card(bigint, text, text)
  from public, anon, authenticated;
revoke execute on function public.update_club_information_card(bigint, bigint, text, text)
  from public, anon, authenticated;
revoke execute on function public.delete_club_information_card(bigint, bigint)
  from public, anon, authenticated;
revoke execute on function public.reorder_club_information_cards(bigint, bigint[])
  from public, anon, authenticated;

grant execute on function public.create_club_information_card(bigint, text, text)
  to authenticated;
grant execute on function public.update_club_information_card(bigint, bigint, text, text)
  to authenticated;
grant execute on function public.delete_club_information_card(bigint, bigint)
  to authenticated;
grant execute on function public.reorder_club_information_cards(bigint, bigint[])
  to authenticated;

commit;
