begin;

create table if not exists public.organisation_information_cards (
  id bigint generated always as identity primary key,
  organisation_id bigint not null
    references public.organisations (id) on delete cascade,
  title text not null,
  content text not null,
  position smallint not null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_information_cards_title_value check (
    char_length(title) between 1 and 120
    and title = btrim(title)
  ),
  constraint organisation_information_cards_content_value check (
    char_length(content) between 1 and 20000
    and content = btrim(content)
  ),
  constraint organisation_information_cards_position_value check (
    position between 1 and 5
  ),
  constraint organisation_information_cards_organisation_position_unique
    unique (organisation_id, position)
    deferrable initially immediate
);

comment on table public.organisation_information_cards is
  'Owner-authored public long-form information cards for an organisation. Content is constrained Markdown, not HTML.';

comment on column public.organisation_information_cards.position is
  'Dense, one-based public display order. The 1-5 check plus per-organisation uniqueness enforces at most five cards.';

-- The organisation/position unique constraint indexes the organisation foreign
-- key. These indexes cover the two nullable profile audit foreign keys.
create index if not exists organisation_information_cards_created_by_idx
  on public.organisation_information_cards (created_by)
  where created_by is not null;

create index if not exists organisation_information_cards_updated_by_idx
  on public.organisation_information_cards (updated_by)
  where updated_by is not null;

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

drop trigger if exists set_organisation_information_cards_updated_at
  on public.organisation_information_cards;
create trigger set_organisation_information_cards_updated_at
  before update on public.organisation_information_cards
  for each row execute function private.set_updated_at();

alter table public.organisation_information_cards enable row level security;

-- Public information is read-only through the Data API. All writes go through
-- the owner-authorised RPCs below.
revoke all privileges on table public.organisation_information_cards
  from anon, authenticated;
revoke all privileges on sequence public.organisation_information_cards_id_seq
  from anon, authenticated;
grant select (
  id,
  organisation_id,
  title,
  content,
  position,
  created_at,
  updated_at
) on table public.organisation_information_cards to authenticated;

drop policy if exists "Authenticated users can read active organisation information"
  on public.organisation_information_cards;
create policy "Authenticated users can read active organisation information"
on public.organisation_information_cards
for select
to authenticated
using (
  exists (
    select 1
    from public.organisations as organisation
    where organisation.id = organisation_information_cards.organisation_id
      and organisation.status = 'active'
  )
);

create or replace function public.create_organisation_information_card(
  p_organisation_id bigint,
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
$$;

create or replace function public.update_organisation_information_card(
  p_organisation_id bigint,
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
$$;

create or replace function public.delete_organisation_information_card(
  p_organisation_id bigint,
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
$$;

create or replace function public.reorder_organisation_information_cards(
  p_organisation_id bigint,
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
$$;

revoke execute on function public.create_organisation_information_card(bigint, text, text)
  from public, anon, authenticated;
revoke execute on function public.update_organisation_information_card(bigint, bigint, text, text)
  from public, anon, authenticated;
revoke execute on function public.delete_organisation_information_card(bigint, bigint)
  from public, anon, authenticated;
revoke execute on function public.reorder_organisation_information_cards(bigint, bigint[])
  from public, anon, authenticated;

grant execute on function public.create_organisation_information_card(bigint, text, text)
  to authenticated;
grant execute on function public.update_organisation_information_card(bigint, bigint, text, text)
  to authenticated;
grant execute on function public.delete_organisation_information_card(bigint, bigint)
  to authenticated;
grant execute on function public.reorder_organisation_information_cards(bigint, bigint[])
  to authenticated;

commit;
