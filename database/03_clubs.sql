-- Canonical fresh-install schema: clubs.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."club_information_cards" (
  "id" bigint generated always as identity not null,
  "club_id" bigint not null,
  "title" text not null,
  "content" text not null,
  "position" smallint not null,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."club_memberships" (
  "id" bigint generated always as identity not null,
  "club_id" bigint not null,
  "user_id" uuid not null,
  "status" text default 'pending'::text not null,
  "role" text default 'member'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."club_team_roster_members" (
  "club_team_id" bigint not null,
  "position" integer not null,
  "club_membership_id" bigint not null,
  "created_at" timestamp with time zone default now() not null
);

create table "public"."club_teams" (
  "id" bigint generated always as identity not null,
  "club_id" bigint not null,
  "name" text not null,
  "display_order" integer not null,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid,
  "updated_by" uuid,
  "unit_type" text,
  "fixed_size" integer
);

create table "public"."clubs" (
  "id" bigint generated always as identity not null,
  "name" text not null,
  "slug" text not null,
  "town" text,
  "county" text,
  "postcode" text,
  "website" text,
  "status" text default 'active'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "search_document" tsvector generated always as ((setweight(to_tsvector('simple'::regconfig, COALESCE(name, ''::text)), 'A'::"char") || setweight(to_tsvector('simple'::regconfig, ((((COALESCE(town, ''::text) || ' '::text) || COALESCE(county, ''::text)) || ' '::text) || COALESCE(postcode, ''::text))), 'B'::"char"))) stored,
  "about_content" text
);

CREATE OR REPLACE FUNCTION private.club_team_management_json(p_club_team_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', team.id,
    'club_id', team.club_id,
    'name', team.name,
    'unit_type', team.unit_type,
    'fixed_size', team.fixed_size,
    'is_complete', team.unit_type is not null
      and (
        select count(*)
        from public.club_team_roster_members as complete_roster
        join public.club_memberships as complete_membership
          on complete_membership.id = complete_roster.club_membership_id
        where complete_roster.club_team_id = team.id
          and complete_membership.club_id = team.club_id
          and complete_membership.status = 'active'
      ) = team.fixed_size,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', roster.position,
        'membership_id', membership.id,
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'membership_status', membership.status
      ) order by roster.position)
      from public.club_team_roster_members as roster
      join public.club_memberships as membership
        on membership.id = roster.club_membership_id
      join public.profiles as profile on profile.id = membership.user_id
      where roster.club_team_id = team.id
    ), '[]'::jsonb),
    'display_order', team.display_order,
    'archived_at', team.archived_at,
    'competition_usage_count', (
      select count(*) from public.competition_entrants as entrant
      where entrant.club_team_id = team.id
    ),
    'submitted_usage_count', (
      select count(*)
      from public.competition_entrants as entrant
      join public.club_competition_entries as entry
        on entry.id = entrant.club_competition_entry_id
      where entrant.club_team_id = team.id and entry.status = 'submitted'
    ),
    'created_at', team.created_at,
    'updated_at', team.updated_at
  )
  from public.club_teams as team
  where team.id = p_club_team_id
$function$;

CREATE OR REPLACE FUNCTION private.enforce_authenticated_membership_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.normalise_club_team_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.name := pg_catalog.regexp_replace(
    pg_catalog.btrim(coalesce(new.name, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_club_team_type_size()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.unit_type is not null and (
    new.unit_type is distinct from old.unit_type
    or new.fixed_size is distinct from old.fixed_size
  ) then
    raise exception 'A Club Pair or Team type and size cannot be changed after setup. Create another unit for a different size.'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.require_club_team_member(p_club_id bigint, p_require_manager boolean)
 RETURNS TABLE(actor_id uuid, club_role text)
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
  select v_actor_id, membership.role
  from public.club_memberships as membership
  join public.clubs as club on club.id = membership.club_id
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.status = 'active'
    and club.status = 'active'
    and (not p_require_manager or membership.role in ('owner', 'official'))
  for share of membership, club;

  if not found then
    if p_require_manager then
      raise exception 'Only an active owner or official of this exact club can manage Club Teams.'
        using errcode = '42501';
    end if;
    raise exception 'Active membership of this exact club is required to view Club Teams.'
      using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_club_team_roster_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_team_id bigint;
  v_unit_type text;
  v_fixed_size integer;
  v_roster_count integer;
begin
  if tg_table_name = 'club_teams' then
    v_team_id := coalesce(
      (pg_catalog.to_jsonb(new) ->> 'id')::bigint,
      (pg_catalog.to_jsonb(old) ->> 'id')::bigint
    );
  else
    v_team_id := coalesce(
      (pg_catalog.to_jsonb(new) ->> 'club_team_id')::bigint,
      (pg_catalog.to_jsonb(old) ->> 'club_team_id')::bigint
    );
  end if;

  select team.unit_type, team.fixed_size
  into v_unit_type, v_fixed_size
  from public.club_teams as team
  where team.id = v_team_id;
  if not found then return null; end if;

  select count(*)::integer into v_roster_count
  from public.club_team_roster_members as roster
  where roster.club_team_id = v_team_id;

  if v_unit_type is null then
    if v_roster_count <> 0 then
      raise exception 'An incomplete V1 Club Team cannot have roster rows until setup is completed.'
        using errcode = '23514';
    end if;
  elsif v_roster_count <> v_fixed_size then
    raise exception 'A Club Pair or Team must always have exactly % current roster members.',
      v_fixed_size using errcode = '23514';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_club_team_roster_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_team_club_id bigint;
  v_fixed_size integer;
  v_membership_club_id bigint;
  v_membership_status text;
begin
  select team.club_id, team.fixed_size
  into v_team_club_id, v_fixed_size
  from public.club_teams as team
  where team.id = new.club_team_id
  for share;

  if v_fixed_size is null then
    raise exception 'Complete the Club Pair or Team type and size before assigning its roster.'
      using errcode = '23514';
  end if;

  if new.position > v_fixed_size then
    raise exception 'Roster positions must fit the Club Pair or Team fixed size.'
      using errcode = '23514';
  end if;

  select membership.club_id, membership.status
  into v_membership_club_id, v_membership_status
  from public.club_memberships as membership
  where membership.id = new.club_membership_id
  for share;

  if v_membership_club_id is null then
    raise exception 'A selected roster member no longer exists.' using errcode = '22023';
  end if;
  if v_membership_club_id <> v_team_club_id then
    raise exception 'Every roster member must belong to the same Club as the Pair or Team.'
      using errcode = '23514';
  end if;
  if v_membership_status <> 'active' then
    raise exception 'Every roster member must be an active member of this Club.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_entrant_club_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_entry_status text;
  v_entry_format text;
  v_competition_size integer;
  v_entry_club_id bigint;
  v_team_club_id bigint;
  v_team_name text;
  v_team_archived_at timestamptz;
  v_unit_type text;
  v_fixed_size integer;
  v_active_roster_count integer;
begin
  if new.club_team_id is null then
    new.club_team_name_snapshot := null;
    return new;
  end if;

  select entry.status, competition.entry_format, competition.team_size,
    entry.club_id
  into v_entry_status, v_entry_format, v_competition_size, v_entry_club_id
  from public.club_competition_entries as entry
  join public.competitions as competition on competition.id = entry.competition_id
  where entry.id = new.club_competition_entry_id;

  if v_entry_status is null then
    raise exception 'Club competition entry not found.' using errcode = 'P0002';
  end if;

  if v_entry_format not in ('pairs', 'team') then
    raise exception 'Club Pairs or Club Teams can only be linked to matching Pair or Team Competition entrants.'
      using errcode = '23514';
  end if;

  select team.club_id, team.name, team.archived_at, team.unit_type,
    team.fixed_size
  into v_team_club_id, v_team_name, v_team_archived_at, v_unit_type,
    v_fixed_size
  from public.club_teams as team
  where team.id = new.club_team_id
  for share;

  if v_team_club_id is null then
    raise exception 'The selected Club Team does not exist.' using errcode = '22023';
  end if;

  if v_team_club_id <> v_entry_club_id then
    raise exception 'The selected Club Pair or Team belongs to a different club.' using errcode = '23514';
  end if;

  if v_unit_type is null or v_fixed_size is null then
    raise exception 'Complete this Club Pair or Team setup before using it in a Competition entry.'
      using errcode = '22023';
  end if;

  if (v_entry_format = 'pairs' and v_unit_type <> 'pair')
    or (v_entry_format = 'team' and v_unit_type <> 'team')
    or v_fixed_size <> v_competition_size then
    raise exception 'The selected Club Pair or Team type and size are not compatible with this Competition.'
      using errcode = '23514';
  end if;

  select count(*)::integer into v_active_roster_count
  from public.club_team_roster_members as roster
  join public.club_memberships as membership
    on membership.id = roster.club_membership_id
  where roster.club_team_id = new.club_team_id
    and membership.club_id = v_entry_club_id
    and membership.status = 'active';

  if v_active_roster_count <> v_fixed_size then
    raise exception 'Update this Club Pair or Team so its complete current roster contains active Club members.'
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and v_entry_status <> 'draft' and (
    new.club_team_id is distinct from old.club_team_id
    or new.club_competition_entry_id is distinct from old.club_competition_entry_id
    or new.club_team_name_snapshot is distinct from old.club_team_name_snapshot
  ) then
    raise exception 'A submitted entrant''s persistent Pair/Team link and name snapshot are historical and cannot be changed.'
      using errcode = '23514';
  end if;

  if v_team_archived_at is not null and (
    tg_op = 'INSERT'
    or new.club_team_id is distinct from old.club_team_id
    or v_entry_status = 'draft'
  ) then
    raise exception 'The selected Club Pair or Team is archived. Unarchive it or choose another unit.'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' or v_entry_status = 'draft' then
    new.club_team_name_snapshot := v_team_name;
  else
    new.club_team_name_snapshot := old.club_team_name_snapshot;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_club_team(p_club_team_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club_id bigint;
  v_access record;
  v_team public.club_teams%rowtype;
begin
  select team.club_id into v_club_id
  from public.club_teams as team
  where team.id = p_club_team_id;
  if v_club_id is null then
    raise exception 'Club Pair or Team not found.' using errcode = 'P0002';
  end if;

  select * into v_access
  from private.require_club_team_member(v_club_id, true);

  select * into v_team
  from public.club_teams as team
  where team.id = p_club_team_id
  for update;

  if v_team.archived_at is null and exists (
    select 1
    from public.competition_entrants as entrant
    join public.club_competition_entries as entry
      on entry.id = entrant.club_competition_entry_id
    where entrant.club_team_id = p_club_team_id
      and entry.status = 'draft'
  ) then
    raise exception 'Unlink or change this Club Pair or Team in its draft Competition entry before archiving it.'
      using errcode = '22023';
  end if;

  update public.club_teams as team
  set archived_at = coalesce(team.archived_at, now()),
      updated_by = v_access.actor_id
  where team.id = p_club_team_id
  returning * into v_team;

  return private.club_team_management_json(v_team.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_club_information_card(p_club_id bigint, p_title text, p_content text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.create_club_team(p_club_id bigint, p_name text, p_unit_type text, p_roster_membership_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_access record;
  v_display_order integer;
  v_team_number integer;
  v_name text;
  v_team public.club_teams%rowtype;
  v_size integer;
begin
  select * into v_access
  from private.require_club_team_member(p_club_id, true);

  if p_unit_type not in ('pair', 'team') then
    raise exception 'Choose Pair or Team.' using errcode = '22023';
  end if;
  if p_roster_membership_ids is null
    or array_position(p_roster_membership_ids, null) is not null then
    raise exception 'Choose every current roster member.' using errcode = '22023';
  end if;
  v_size := cardinality(p_roster_membership_ids);
  if (p_unit_type = 'pair' and v_size <> 2)
    or (p_unit_type = 'team' and v_size not between 3 and 20) then
    raise exception 'A Pair needs exactly 2 shooters; a Team needs between 3 and 20.'
      using errcode = '23514';
  end if;
  if (select count(distinct member_id) from unnest(p_roster_membership_ids) as member_id)
    <> v_size then
    raise exception 'A shooter cannot appear twice in one Club Pair or Team.'
      using errcode = '22023';
  end if;

  perform club.id from public.clubs as club
  where club.id = p_club_id
  for update;

  perform membership.id
  from public.club_memberships as membership
  where membership.id = any(p_roster_membership_ids)
  order by membership.id
  for share;
  if (
    select count(*)
    from public.club_memberships as membership
    where membership.id = any(p_roster_membership_ids)
      and membership.club_id = p_club_id
      and membership.status = 'active'
  ) <> v_size then
    raise exception 'Every roster member must be an active member of this Club.'
      using errcode = '22023';
  end if;

  select coalesce(max(team.display_order), 0) + 1
  into v_display_order
  from public.club_teams as team
  where team.club_id = p_club_id;

  v_name := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(p_name, '')),
      '[[:space:]]+', ' ', 'g'
    ),
    ''
  );
  if v_name is null then
    v_team_number := 1;
    while exists (
      select 1
      from public.club_teams as team
      where team.club_id = p_club_id
        and lower(team.name) = lower(
          case when p_unit_type = 'pair' then 'Pair ' else 'Team ' end
          || v_team_number::text
        )
    ) loop
      v_team_number := v_team_number + 1;
    end loop;
    v_name := case when p_unit_type = 'pair' then 'Pair ' else 'Team ' end
      || v_team_number::text;
  end if;

  insert into public.club_teams(
    club_id, name, unit_type, fixed_size, display_order, created_by, updated_by
  ) values (
    p_club_id, v_name, p_unit_type, v_size, v_display_order,
    v_access.actor_id, v_access.actor_id
  ) returning * into v_team;

  insert into public.club_team_roster_members(
    club_team_id, position, club_membership_id
  )
  select v_team.id, roster.ordinality::integer, roster.membership_id
  from unnest(p_roster_membership_ids) with ordinality
    as roster(membership_id, ordinality);

  return private.club_team_management_json(v_team.id);
exception
  when unique_violation then
    raise exception 'That Club Pair or Team name or roster contains a duplicate. Archived names cannot be reused.'
      using errcode = '23505';
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_club_information_card(p_club_id bigint, p_card_id bigint)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_club_members(p_club_id bigint)
 RETURNS TABLE(membership_id bigint, first_name text, last_name text, membership_status text, club_role text, created_at timestamp with time zone, updated_at timestamp with time zone)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_club_teams(p_club_id bigint, p_include_archived boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_access record;
  v_result jsonb;
begin
  select * into v_access
  from private.require_club_team_member(p_club_id, false);

  select jsonb_build_object(
    'club_id', p_club_id,
    'can_manage', v_access.club_role in ('owner', 'official'),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', team.id,
          'club_id', team.club_id,
          'name', team.name,
          'unit_type', team.unit_type,
          'fixed_size', team.fixed_size,
          'is_complete', team.unit_type is not null
            and (
              select count(*)
              from public.club_team_roster_members as complete_roster
              join public.club_memberships as complete_membership
                on complete_membership.id = complete_roster.club_membership_id
              where complete_roster.club_team_id = team.id
                and complete_membership.club_id = team.club_id
                and complete_membership.status = 'active'
            ) = team.fixed_size,
          'roster', coalesce((
            select jsonb_agg(jsonb_build_object(
              'position', roster.position,
              'membership_id', membership.id,
              'first_name', profile.first_name,
              'last_name', profile.last_name,
              'membership_status', membership.status
            ) order by roster.position)
            from public.club_team_roster_members as roster
            join public.club_memberships as membership
              on membership.id = roster.club_membership_id
            join public.profiles as profile on profile.id = membership.user_id
            where roster.club_team_id = team.id
          ), '[]'::jsonb),
          'display_order', team.display_order,
          'archived_at', team.archived_at,
          'competition_usage_count', (
            select count(*)
            from public.competition_entrants as entrant
            where entrant.club_team_id = team.id
          ),
          'submitted_usage_count', (
            select count(*)
            from public.competition_entrants as entrant
            join public.club_competition_entries as entry
              on entry.id = entrant.club_competition_entry_id
            where entrant.club_team_id = team.id
              and entry.status = 'submitted'
          ),
          'created_at', team.created_at,
          'updated_at', team.updated_at
        ) order by team.archived_at nulls first, team.display_order, team.id
      )
      from public.club_teams as team
      where team.club_id = p_club_id
        and (p_include_archived or team.archived_at is null)
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.process_club_membership_request(p_membership_id bigint, p_decision text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.register_club(p_name text, p_town text, p_county text, p_postcode text, p_website text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.rename_club_team(p_club_team_id bigint, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club_id bigint;
  v_access record;
  v_team public.club_teams%rowtype;
begin
  select team.club_id into v_club_id
  from public.club_teams as team
  where team.id = p_club_team_id;
  if v_club_id is null then
    raise exception 'Club Pair or Team not found.' using errcode = 'P0002';
  end if;

  select * into v_access
  from private.require_club_team_member(v_club_id, true);

  update public.club_teams as team
  set name = p_name, updated_by = v_access.actor_id
  where team.id = p_club_team_id
  returning * into v_team;

  return private.club_team_management_json(v_team.id);
exception
  when unique_violation then
    raise exception 'A Club Pair or Team with that name already exists. Archived names cannot be reused.'
      using errcode = '23505';
end;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_club_information_cards(p_club_id bigint, p_card_ids bigint[])
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
$function$;

CREATE OR REPLACE FUNCTION public.set_club_member_role(p_membership_id bigint, p_role text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.transfer_club_ownership(p_club_id bigint, p_target_membership_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.unarchive_club_team(p_club_team_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_club_id bigint;
  v_access record;
  v_team public.club_teams%rowtype;
begin
  select team.club_id into v_club_id
  from public.club_teams as team
  where team.id = p_club_team_id;
  if v_club_id is null then
    raise exception 'Club Pair or Team not found.' using errcode = 'P0002';
  end if;

  select * into v_access
  from private.require_club_team_member(v_club_id, true);

  update public.club_teams as team
  set archived_at = null, updated_by = v_access.actor_id
  where team.id = p_club_team_id
  returning * into v_team;

  return private.club_team_management_json(v_team.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_club_about(p_club_id bigint, p_about_content text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_club_details(p_club_id bigint, p_name text, p_town text, p_county text, p_postcode text, p_website text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_club_information_card(p_club_id bigint, p_card_id bigint, p_title text, p_content text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.update_club_team(p_club_team_id bigint, p_name text, p_unit_type text, p_roster_membership_ids bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_team public.club_teams%rowtype;
  v_access record;
  v_size integer;
begin
  select * into v_team
  from public.club_teams as team
  where team.id = p_club_team_id
  for update;
  if not found then
    raise exception 'Club Pair or Team not found.' using errcode = 'P0002';
  end if;

  select * into v_access
  from private.require_club_team_member(v_team.club_id, true);

  if p_unit_type not in ('pair', 'team') then
    raise exception 'Choose Pair or Team.' using errcode = '22023';
  end if;
  if p_roster_membership_ids is null
    or array_position(p_roster_membership_ids, null) is not null then
    raise exception 'Choose every current roster member.' using errcode = '22023';
  end if;
  v_size := cardinality(p_roster_membership_ids);
  if (p_unit_type = 'pair' and v_size <> 2)
    or (p_unit_type = 'team' and v_size not between 3 and 20) then
    raise exception 'A Pair needs exactly 2 shooters; a Team needs between 3 and 20.'
      using errcode = '23514';
  end if;
  if v_team.unit_type is not null and (
    p_unit_type <> v_team.unit_type or v_size <> v_team.fixed_size
  ) then
    raise exception 'A Club Pair or Team type and size cannot be changed after setup. Create another unit for a different size.'
      using errcode = '23514';
  end if;
  if (select count(distinct member_id) from unnest(p_roster_membership_ids) as member_id)
    <> v_size then
    raise exception 'A shooter cannot appear twice in one Club Pair or Team.'
      using errcode = '22023';
  end if;

  perform membership.id
  from public.club_memberships as membership
  where membership.id = any(p_roster_membership_ids)
  order by membership.id
  for share;
  if (
    select count(*)
    from public.club_memberships as membership
    where membership.id = any(p_roster_membership_ids)
      and membership.club_id = v_team.club_id
      and membership.status = 'active'
  ) <> v_size then
    raise exception 'Every roster member must be an active member of this Club.'
      using errcode = '22023';
  end if;

  delete from public.club_team_roster_members as roster
  where roster.club_team_id = p_club_team_id;

  update public.club_teams as team
  set name = p_name,
      unit_type = coalesce(team.unit_type, p_unit_type),
      fixed_size = coalesce(team.fixed_size, v_size),
      updated_by = v_access.actor_id
  where team.id = p_club_team_id;

  insert into public.club_team_roster_members(
    club_team_id, position, club_membership_id
  )
  select p_club_team_id, roster.ordinality::integer, roster.membership_id
  from unnest(p_roster_membership_ids) with ordinality
    as roster(membership_id, ordinality);

  return private.club_team_management_json(p_club_team_id);
exception
  when unique_violation then
    raise exception 'That Club Pair or Team name or roster contains a duplicate. Archived names cannot be reused.'
      using errcode = '23505';
end;
$function$;


commit;

