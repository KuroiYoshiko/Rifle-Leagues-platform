-- Persistent Club-owned Pair/Team identities with current rosters, linked
-- optionally to edition-local Competition entrants. Run after
-- database/competition-entries.sql. Additive, safe to rerun, and intentionally
-- does not infer type, size, or roster for existing V1 identities.
begin;

create table if not exists public.club_teams (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs(id) on delete cascade,
  name text not null,
  display_order integer not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint club_teams_name_length check (char_length(name) between 1 and 120),
  constraint club_teams_display_order_value check (display_order between 1 and 1000000),
  constraint club_teams_club_display_order_unique unique (club_id, display_order)
);

alter table public.club_teams
  add column if not exists unit_type text,
  add column if not exists fixed_size integer;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'club_teams_type_size_check'
      and conrelid = 'public.club_teams'::regclass
  ) then
    alter table public.club_teams
      add constraint club_teams_type_size_check check (
        (unit_type is null and fixed_size is null)
        or (unit_type = 'pair' and fixed_size = 2)
        or (unit_type = 'team' and fixed_size between 3 and 20)
      );
  end if;
end;
$$;

create table if not exists public.club_team_roster_members (
  club_team_id bigint not null
    references public.club_teams(id) on delete cascade,
  position integer not null,
  club_membership_id bigint not null
    references public.club_memberships(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (club_team_id, position),
  constraint club_team_roster_members_position_check
    check (position between 1 and 20),
  constraint club_team_roster_members_team_membership_unique
    unique (club_team_id, club_membership_id)
);

create index if not exists club_team_roster_members_membership_idx
  on public.club_team_roster_members(club_membership_id);

comment on table public.club_teams is
  'Persistent Club-owned Pair/Team identity with a current roster. Competition entrants retain edition-local historical participant snapshots.';
comment on column public.club_teams.name is
  'Current editable Pair/Team name. Submitted entrants retain an edition-specific name snapshot.';
comment on column public.club_teams.archived_at is
  'Archived units remain available to historical entrant and Results projections but cannot be selected for a new draft entrant.';
comment on column public.club_teams.unit_type is
  'Persistent unit type: pair or team. NULL marks an existing V1 identity that still needs manager setup.';
comment on column public.club_teams.fixed_size is
  'Immutable roster size after setup. Pair is exactly 2; Team is between 3 and 20.';
comment on table public.club_team_roster_members is
  'Current persistent Club Pair/Team roster. Edition-local Competition participant rows remain the historical record.';

create or replace function private.protect_club_team_type_size()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.protect_club_team_type_size()
  from public, anon, authenticated;

drop trigger if exists protect_club_team_type_size on public.club_teams;
create trigger protect_club_team_type_size
  before update of unit_type, fixed_size on public.club_teams
  for each row execute function private.protect_club_team_type_size();

create or replace function private.validate_club_team_roster_member()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.validate_club_team_roster_member()
  from public, anon, authenticated;

drop trigger if exists validate_club_team_roster_member
  on public.club_team_roster_members;
create trigger validate_club_team_roster_member
  before insert or update of club_team_id, position, club_membership_id
  on public.club_team_roster_members
  for each row execute function private.validate_club_team_roster_member();

create or replace function private.validate_club_team_roster_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.validate_club_team_roster_complete()
  from public, anon, authenticated;

drop trigger if exists validate_club_team_roster_complete_from_team
  on public.club_teams;
create constraint trigger validate_club_team_roster_complete_from_team
  after insert or update of unit_type, fixed_size on public.club_teams
  deferrable initially deferred
  for each row execute function private.validate_club_team_roster_complete();

drop trigger if exists validate_club_team_roster_complete_from_member
  on public.club_team_roster_members;
create constraint trigger validate_club_team_roster_complete_from_member
  after insert or update or delete on public.club_team_roster_members
  deferrable initially deferred
  for each row execute function private.validate_club_team_roster_complete();

create index if not exists club_teams_club_archive_order_idx
  on public.club_teams(club_id, archived_at, display_order, id);
create index if not exists club_teams_created_by_idx
  on public.club_teams(created_by)
  where created_by is not null;
create index if not exists club_teams_updated_by_idx
  on public.club_teams(updated_by)
  where updated_by is not null;
create unique index if not exists club_teams_club_name_ci_unique
  on public.club_teams(club_id, lower(name));

create or replace function private.normalise_club_team_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := pg_catalog.regexp_replace(
    pg_catalog.btrim(coalesce(new.name, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  return new;
end;
$$;

revoke execute on function private.normalise_club_team_name()
  from public, anon, authenticated;

drop trigger if exists normalise_club_team_name on public.club_teams;
create trigger normalise_club_team_name
  before insert or update of name on public.club_teams
  for each row execute function private.normalise_club_team_name();

drop trigger if exists set_club_teams_updated_at on public.club_teams;
create trigger set_club_teams_updated_at
  before update on public.club_teams
  for each row execute function private.set_updated_at();

alter table public.competition_entrants
  add column if not exists club_team_id bigint,
  add column if not exists club_team_name_snapshot text;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'competition_entrants_club_team_fkey'
      and conrelid = 'public.competition_entrants'::regclass
  ) then
    alter table public.competition_entrants
      add constraint competition_entrants_club_team_fkey
      foreign key (club_team_id) references public.club_teams(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'competition_entrants_club_team_snapshot_check'
      and conrelid = 'public.competition_entrants'::regclass
  ) then
    alter table public.competition_entrants
      add constraint competition_entrants_club_team_snapshot_check check (
        (club_team_id is null and club_team_name_snapshot is null)
        or (
          club_team_id is not null
          and club_team_name_snapshot is not null
          and char_length(club_team_name_snapshot) between 1 and 120
        )
      );
  end if;
end;
$$;

create index if not exists competition_entrants_club_team_idx
  on public.competition_entrants(club_team_id)
  where club_team_id is not null;
create unique index if not exists competition_entrants_entry_club_team_unique
  on public.competition_entrants(club_competition_entry_id, club_team_id)
  where club_team_id is not null;

comment on column public.competition_entrants.club_team_id is
  'Optional persistent Club Pair/Team identity for matching Pair/Team entrants. NULL preserves legacy and intentionally unlinked entrants.';
comment on column public.competition_entrants.club_team_name_snapshot is
  'Database-derived edition display name. Draft saves refresh it; submitted historical display is unaffected by later Team renames.';

create or replace function private.validate_competition_entrant_club_team()
returns trigger
language plpgsql
set search_path = ''
as $$
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
    raise exception 'Persistent Club Pairs or Teams can only be linked to matching Pair/Team Competition entrants.'
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
$$;

revoke execute on function private.validate_competition_entrant_club_team()
  from public, anon, authenticated;

drop trigger if exists validate_competition_entrant_club_team
  on public.competition_entrants;
create trigger validate_competition_entrant_club_team
  before insert or update of club_competition_entry_id, club_team_id,
    club_team_name_snapshot
  on public.competition_entrants
  for each row execute function private.validate_competition_entrant_club_team();

create or replace function private.protect_draft_entry_from_archived_team()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'draft' and old.status is distinct from 'draft' and exists (
    select 1
    from public.competition_entrants as entrant
    join public.club_teams as team on team.id = entrant.club_team_id
    where entrant.club_competition_entry_id = new.id
      and team.archived_at is not null
  ) then
    raise exception 'Unarchive the linked Club Team before returning this entry to Draft.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_draft_entry_from_archived_team()
  from public, anon, authenticated;

drop trigger if exists protect_draft_entry_from_archived_team
  on public.club_competition_entries;
create trigger protect_draft_entry_from_archived_team
  before update of status on public.club_competition_entries
  for each row execute function private.protect_draft_entry_from_archived_team();

create or replace function private.competition_entrant_label(
  p_entry_format text,
  p_position integer,
  p_club_team_name_snapshot text default null
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_entry_format
    when 'pairs' then coalesce(
      nullif(pg_catalog.btrim(p_club_team_name_snapshot), ''),
      'Pair ' || p_position::text
    )
    when 'team' then coalesce(
      nullif(pg_catalog.btrim(p_club_team_name_snapshot), ''),
      'Team ' || p_position::text
    )
    else 'Individual ' || p_position::text
  end
$$;

revoke execute on function private.competition_entrant_label(text, integer, text)
  from public, anon, authenticated;

create or replace function private.require_club_team_member(
  p_club_id bigint,
  p_require_manager boolean
)
returns table(actor_id uuid, club_role text)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function private.require_club_team_member(bigint, boolean)
  from public, anon, authenticated;

create or replace function public.get_club_teams(
  p_club_id bigint,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.club_team_management_json(p_club_team_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function private.club_team_management_json(bigint)
  from public, anon, authenticated;

drop function if exists public.create_club_team(bigint, text);
create or replace function public.create_club_team(
  p_club_id bigint,
  p_name text,
  p_unit_type text,
  p_roster_membership_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.update_club_team(
  p_club_team_id bigint,
  p_name text,
  p_unit_type text,
  p_roster_membership_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.rename_club_team(
  p_club_team_id bigint,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.archive_club_team(p_club_team_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.unarchive_club_team(p_club_team_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

alter table public.club_teams enable row level security;
alter table public.club_team_roster_members enable row level security;
revoke all privileges on table public.club_teams from public, anon, authenticated;
revoke all privileges on table public.club_team_roster_members
  from public, anon, authenticated;
revoke all privileges on sequence public.club_teams_id_seq from public, anon, authenticated;
grant select (
  id, club_id, name, unit_type, fixed_size, display_order, archived_at,
  created_at, updated_at
) on table public.club_teams to authenticated;
grant select (
  club_team_id, position, club_membership_id, created_at
) on table public.club_team_roster_members to authenticated;

drop policy if exists "Active club members can read Club Teams"
  on public.club_teams;
create policy "Active club members can read Club Teams"
on public.club_teams
for select
to authenticated
using (
  exists (
    select 1
    from public.club_memberships as membership
    join public.clubs as club on club.id = membership.club_id
    where membership.club_id = club_teams.club_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and club.status = 'active'
  )
);

drop policy if exists "Active club members can read Club Team rosters"
  on public.club_team_roster_members;
create policy "Active club members can read Club Team rosters"
on public.club_team_roster_members
for select
to authenticated
using (
  exists (
    select 1
    from public.club_teams as team
    join public.club_memberships as membership
      on membership.club_id = team.club_id
    join public.clubs as club on club.id = team.club_id
    where team.id = club_team_roster_members.club_team_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and club.status = 'active'
  )
);

revoke execute on function public.get_club_teams(bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.get_club_teams(bigint, boolean)
  to authenticated;
revoke execute on function public.create_club_team(bigint, text, text, bigint[])
  from public, anon, authenticated;
grant execute on function public.create_club_team(bigint, text, text, bigint[])
  to authenticated;
revoke execute on function public.update_club_team(bigint, text, text, bigint[])
  from public, anon, authenticated;
grant execute on function public.update_club_team(bigint, text, text, bigint[])
  to authenticated;
revoke execute on function public.rename_club_team(bigint, text)
  from public, anon, authenticated;
grant execute on function public.rename_club_team(bigint, text)
  to authenticated;
revoke execute on function public.archive_club_team(bigint)
  from public, anon, authenticated;
grant execute on function public.archive_club_team(bigint)
  to authenticated;
revoke execute on function public.unarchive_club_team(bigint)
  from public, anon, authenticated;
grant execute on function public.unarchive_club_team(bigint)
  to authenticated;

-- Backward-compatible entrant save: legacy arrays stay valid. Pair/Team callers
-- may supply {"club_team_id": number|null, "participants": [...]} without an
-- RPC overload. Linked units ignore client participants and derive both the
-- current roster and name snapshot from the selected persistent unit.
create or replace function public.save_club_competition_entry(
  p_club_competition_entry_id bigint,
  p_entrants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_unit record;
  v_slot record;
  v_entrant_id bigint;
  v_selected_count integer;
  v_selected_team_count integer;
  v_participants jsonb;
  v_team_value jsonb;
  v_team_id bigint;
  v_normalised jsonb := '[]'::jsonb;
  v_constraint_name text;
begin
  select * into v_context
  from private.get_club_competition_entry_mutation_context(
    p_club_competition_entry_id,
    true
  );

  if v_context.entry_status = 'withdrawn' then
    raise exception 'Restart this withdrawn entry before editing it.'
      using errcode = '22023';
  end if;

  if p_entrants is null or jsonb_typeof(p_entrants) <> 'array' then
    raise exception 'Competition entrants must be supplied as a list.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_entrants) > 1000 then
    raise exception 'A club entry cannot contain more than 1,000 entrant units.'
      using errcode = '22023';
  end if;

  for v_unit in
    select value, ordinality::integer as position
    from jsonb_array_elements(p_entrants) with ordinality
  loop
    v_team_id := null;
    v_team_value := null;
    if jsonb_typeof(v_unit.value) = 'array' then
      v_participants := v_unit.value;
    elsif jsonb_typeof(v_unit.value) = 'object'
      and v_context.entry_format in ('pairs', 'team') then
      v_team_value := v_unit.value -> 'club_team_id';
      if v_team_value is not null and jsonb_typeof(v_team_value) <> 'null' then
        if jsonb_typeof(v_team_value) <> 'number'
          or v_team_value::text !~ '^[1-9][0-9]*$' then
          raise exception 'Club Pair or Team selections must use a valid persistent unit ID.'
            using errcode = '22023';
        end if;
        v_team_id := v_team_value::text::bigint;
      end if;
      if v_team_id is null then
        v_participants := v_unit.value -> 'participants';
      else
        perform team.id
        from public.club_teams as team
        where team.id = v_team_id
        for share;
        if not found then
          raise exception 'A selected Club Pair or Team no longer exists.'
            using errcode = '22023';
        end if;
        if exists (
          select 1 from public.club_teams as team
          where team.id = v_team_id and team.club_id <> v_context.club_id
        ) then
          raise exception 'A selected Club Pair or Team belongs to a different club.'
            using errcode = '23514';
        end if;
        if exists (
          select 1 from public.club_teams as team
          where team.id = v_team_id and team.archived_at is not null
        ) then
          raise exception 'A selected Club Pair or Team is archived. Unarchive it or choose another unit.'
            using errcode = '22023';
        end if;
        if not exists (
          select 1
          from public.club_teams as team
          where team.id = v_team_id
            and team.fixed_size = v_context.team_size
            and (
              (v_context.entry_format = 'pairs' and team.unit_type = 'pair')
              or (v_context.entry_format = 'team' and team.unit_type = 'team')
            )
        ) then
          raise exception 'The selected Club Pair or Team type and size are not compatible with this Competition.'
            using errcode = '23514';
        end if;

        select coalesce(jsonb_agg(
          to_jsonb(roster.club_membership_id) order by roster.position
        ), '[]'::jsonb)
        into v_participants
        from public.club_team_roster_members as roster
        join public.club_memberships as membership
          on membership.id = roster.club_membership_id
        where roster.club_team_id = v_team_id
          and membership.club_id = v_context.club_id
          and membership.status = 'active';
      end if;
    else
      raise exception 'Individual entrants use participant lists; Pair and Team entrants use a persistent unit selection or a legacy participant list.'
        using errcode = '22023';
    end if;

    if v_participants is null
      or jsonb_typeof(v_participants) <> 'array'
      or jsonb_array_length(v_participants) <> v_context.team_size then
      raise exception 'Every entrant must contain exactly % shooter slots.',
        v_context.team_size using errcode = '22023';
    end if;

    for v_slot in
      select value from jsonb_array_elements(v_participants)
    loop
      if jsonb_typeof(v_slot.value) not in ('number', 'null')
        or (
          jsonb_typeof(v_slot.value) = 'number'
          and v_slot.value::text !~ '^[1-9][0-9]*$'
        ) then
        raise exception 'Shooter selections must use valid club membership IDs.'
          using errcode = '22023';
      end if;
    end loop;

    v_normalised := v_normalised || jsonb_build_array(jsonb_build_object(
      'club_team_id', v_team_id,
      'participants', v_participants
    ));
  end loop;

  select count(*)::integer into v_selected_team_count
  from jsonb_array_elements(v_normalised) as unit(value)
  where jsonb_typeof(unit.value -> 'club_team_id') = 'number';

  if (
    select count(distinct (unit.value ->> 'club_team_id'))::integer
    from jsonb_array_elements(v_normalised) as unit(value)
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
  ) <> v_selected_team_count then
    raise exception 'A persistent Club Pair or Team can only be used once in this club entry.'
      using errcode = '23505',
        constraint = 'competition_entrants_entry_club_team_unique';
  end if;

  select count(*)::integer into v_selected_count
  from jsonb_array_elements(v_normalised) as unit(value)
  cross join lateral jsonb_array_elements(unit.value -> 'participants') as slot(value)
  where jsonb_typeof(slot.value) = 'number';

  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = v_context.club_id
    and membership.id in (
      select slot.value::text::bigint
      from jsonb_array_elements(v_normalised) as unit(value)
      cross join lateral jsonb_array_elements(unit.value -> 'participants') as slot(value)
      where jsonb_typeof(slot.value) = 'number'
    )
  order by membership.id
  for share;

  if (
    select count(distinct slot.value::text)::integer
    from jsonb_array_elements(v_normalised) as unit(value)
    cross join lateral jsonb_array_elements(unit.value -> 'participants') as slot(value)
    where jsonb_typeof(slot.value) = 'number'
  ) <> v_selected_count then
    raise exception 'A shooter can only be selected once in this club entry.'
      using errcode = '23505';
  end if;

  if (
    select count(*)::integer
    from public.club_memberships as membership
    where membership.club_id = v_context.club_id
      and membership.status = 'active'
      and membership.id in (
        select slot.value::text::bigint
        from jsonb_array_elements(v_normalised) as unit(value)
        cross join lateral jsonb_array_elements(unit.value -> 'participants') as slot(value)
        where jsonb_typeof(slot.value) = 'number'
      )
  ) <> v_selected_count then
    raise exception 'Every selected shooter must be an active member of this club.'
      using errcode = '22023';
  end if;

  perform team.id
  from public.club_teams as team
  where team.id in (
    select (unit.value ->> 'club_team_id')::bigint
    from jsonb_array_elements(v_normalised) as unit(value)
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
  )
  order by team.id
  for share;

  if exists (
    select 1
    from jsonb_array_elements(v_normalised) as unit(value)
    left join public.club_teams as team
      on team.id = (unit.value ->> 'club_team_id')::bigint
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
      and team.id is null
  ) then
    raise exception 'A selected Club Pair or Team no longer exists.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_normalised) as unit(value)
    join public.club_teams as team
      on team.id = (unit.value ->> 'club_team_id')::bigint
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
      and team.club_id <> v_context.club_id
  ) then
    raise exception 'A selected Club Pair or Team belongs to a different club.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_normalised) as unit(value)
    join public.club_teams as team
      on team.id = (unit.value ->> 'club_team_id')::bigint
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
      and team.archived_at is not null
  ) then
    raise exception 'A selected Club Pair or Team is archived. Unarchive it or choose another unit.'
      using errcode = '22023';
  end if;

  delete from public.competition_entrants
  where club_competition_entry_id = p_club_competition_entry_id;

  for v_unit in
    select value, ordinality::integer as position
    from jsonb_array_elements(v_normalised) with ordinality
  loop
    insert into public.competition_entrants(
      club_competition_entry_id,
      position,
      club_team_id,
      club_team_name_snapshot
    ) values (
      p_club_competition_entry_id,
      v_unit.position,
      (v_unit.value ->> 'club_team_id')::bigint,
      null
    ) returning id into v_entrant_id;

    for v_slot in
      select value, ordinality::integer as slot_number
      from jsonb_array_elements(v_unit.value -> 'participants') with ordinality
    loop
      if jsonb_typeof(v_slot.value) = 'number' then
        insert into public.competition_entrant_participants(
          club_competition_entry_id,
          competition_entrant_id,
          club_membership_id,
          slot_number
        ) values (
          p_club_competition_entry_id,
          v_entrant_id,
          v_slot.value::text::bigint,
          v_slot.slot_number
        );
      end if;
    end loop;
  end loop;

  update public.club_competition_entries
  set status = 'draft', submitted_at = null, updated_by = v_context.actor_id
  where id = p_club_competition_entry_id;

  return jsonb_build_object(
    'id', p_club_competition_entry_id,
    'status', 'draft',
    'entrant_count', jsonb_array_length(v_normalised),
    'participant_count', v_selected_count
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'competition_entrants_entry_club_team_unique' then
      raise exception 'A persistent Club Pair or Team can only be used once in this club entry.'
        using errcode = '23505';
    end if;
    raise exception 'A shooter can only be selected once in this club entry.'
      using errcode = '23505';
end;
$$;

create or replace function public.submit_club_competition_entry(
  p_club_competition_entry_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_errors jsonb := '[]'::jsonb;
  v_error record;
  v_entrant_count integer;
  v_participant_count integer;
  v_unit_label text;
begin
  select * into v_context
  from private.get_club_competition_entry_mutation_context(
    p_club_competition_entry_id,
    true
  );

  if v_context.entry_status = 'withdrawn' then
    raise exception 'Restart this withdrawn entry before submitting it.'
      using errcode = '22023';
  end if;

  if v_context.entry_status = 'draft' then
    perform team.id
    from public.club_teams as team
    join public.competition_entrants as entrant
      on entrant.club_team_id = team.id
    where entrant.club_competition_entry_id = p_club_competition_entry_id
    order by team.id
    for share of team;

    update public.competition_entrants as entrant
    set club_team_name_snapshot = team.name
    from public.club_teams as team
    where entrant.club_competition_entry_id = p_club_competition_entry_id
      and team.id = entrant.club_team_id;
  end if;

  select count(*)::integer into v_entrant_count
  from public.competition_entrants
  where club_competition_entry_id = p_club_competition_entry_id;

  if v_entrant_count = 0 then
    v_errors := v_errors || jsonb_build_array('Add at least one entrant.');
  end if;

  for v_error in
    select entrant.position, entrant.club_team_name_snapshot,
      count(participant.id)::integer as participant_count
    from public.competition_entrants as entrant
    left join public.competition_entrant_participants as participant
      on participant.competition_entrant_id = entrant.id
     and participant.club_competition_entry_id = entrant.club_competition_entry_id
    where entrant.club_competition_entry_id = p_club_competition_entry_id
    group by entrant.id, entrant.position, entrant.club_team_name_snapshot
    having count(participant.id) <> v_context.team_size
    order by entrant.position
  loop
    v_unit_label := case v_context.entry_format
      when 'individual' then format('Individual entry %s', v_error.position)
      when 'pairs' then coalesce(
        v_error.club_team_name_snapshot,
        format('Pair %s', v_error.position)
      )
      else coalesce(
        v_error.club_team_name_snapshot,
        format('Team %s', v_error.position)
      )
    end;

    if v_error.participant_count < v_context.team_size then
      v_errors := v_errors || jsonb_build_array(format(
        '%s needs %s more shooter%s.',
        v_unit_label,
        v_context.team_size - v_error.participant_count,
        case when v_context.team_size - v_error.participant_count = 1 then '' else 's' end
      ));
    else
      v_errors := v_errors || jsonb_build_array(format(
        '%s has %s too many shooter%s.',
        v_unit_label,
        v_error.participant_count - v_context.team_size,
        case when v_error.participant_count - v_context.team_size = 1 then '' else 's' end
      ));
    end if;
  end loop;

  perform membership.id
  from public.club_memberships as membership
  join public.competition_entrant_participants as participant
    on participant.club_membership_id = membership.id
  where participant.club_competition_entry_id = p_club_competition_entry_id
  order by membership.id
  for share of membership;

  for v_error in
    select coalesce(
      nullif(pg_catalog.btrim(pg_catalog.concat_ws(
        ' ', profile.first_name, profile.last_name
      )), ''),
      'A selected shooter'
    ) as shooter_name
    from public.competition_entrant_participants as participant
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
    join public.profiles as profile on profile.id = membership.user_id
    where participant.club_competition_entry_id = p_club_competition_entry_id
      and (membership.club_id <> v_context.club_id or membership.status <> 'active')
    order by participant.id
  loop
    v_errors := v_errors || jsonb_build_array(
      format('%s is no longer an active member of this club.', v_error.shooter_name)
    );
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'This entry isn''t ready to submit.'
      using errcode = '22023', detail = v_errors::text;
  end if;

  select count(*)::integer into v_participant_count
  from public.competition_entrant_participants
  where club_competition_entry_id = p_club_competition_entry_id;

  update public.club_competition_entries
  set status = 'submitted', submitted_at = now(), updated_by = v_context.actor_id
  where id = p_club_competition_entry_id;

  return jsonb_build_object(
    'id', p_club_competition_entry_id,
    'status', 'submitted',
    'entrant_count', v_entrant_count,
    'participant_count', v_participant_count
  );
end;
$$;

create or replace function public.save_and_submit_club_competition_entry(
  p_club_competition_entry_id bigint,
  p_entrants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.save_club_competition_entry(
    p_club_competition_entry_id,
    p_entrants
  );
  return public.submit_club_competition_entry(p_club_competition_entry_id);
end;
$$;

comment on function public.save_club_competition_entry(bigint, jsonb) is
  'Atomically replaces draft entrant composition. Legacy participant arrays remain supported; linked Pair/Team objects carry only a persistent unit ID and the database copies its current roster and name snapshot.';
comment on function public.submit_club_competition_entry(bigint) is
  'Validates and submits exact local entrant slots, refreshing linked Pair/Team name snapshots immediately before a Draft becomes historical.';
comment on function public.save_and_submit_club_competition_entry(bigint, jsonb) is
  'Atomically saves the backward-compatible entrant payload and submits it without changing participant-level score ownership.';

revoke execute on function public.save_club_competition_entry(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_club_competition_entry(bigint, jsonb)
  to authenticated;
revoke execute on function public.submit_club_competition_entry(bigint)
  from public, anon, authenticated;
grant execute on function public.submit_club_competition_entry(bigint)
  to authenticated;
revoke execute on function public.save_and_submit_club_competition_entry(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_and_submit_club_competition_entry(bigint, jsonb)
  to authenticated;

commit;
