-- Persistent Club-owned Team identities linked optionally to edition-local
-- Competition entrants. Run after database/competition-entries.sql.
-- Additive, safe to rerun, and intentionally does not infer historical links.
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

comment on table public.club_teams is
  'Persistent Club-owned Team identity. Rosters, Divisions, averages, scores and Results remain on edition-local Competition entrant participation.';
comment on column public.club_teams.name is
  'Current editable Team name. Submitted entrants retain an edition-specific name snapshot.';
comment on column public.club_teams.archived_at is
  'Archived Teams remain available to historical entrant and Results projections but cannot be selected for a new draft entrant.';

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
  'Optional persistent Club Team identity for Team-format entrants only. NULL preserves legacy and intentionally unlinked Team entrants.';
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
  v_entry_club_id bigint;
  v_team_club_id bigint;
  v_team_name text;
  v_team_archived_at timestamptz;
begin
  if new.club_team_id is null then
    new.club_team_name_snapshot := null;
    return new;
  end if;

  select entry.status, competition.entry_format, entry.club_id
  into v_entry_status, v_entry_format, v_entry_club_id
  from public.club_competition_entries as entry
  join public.competitions as competition on competition.id = entry.competition_id
  where entry.id = new.club_competition_entry_id;

  if v_entry_status is null then
    raise exception 'Club competition entry not found.' using errcode = 'P0002';
  end if;

  if v_entry_format <> 'team' then
    raise exception 'Persistent Club Teams can only be linked to Team-format Competition entrants.'
      using errcode = '23514';
  end if;

  select team.club_id, team.name, team.archived_at
  into v_team_club_id, v_team_name, v_team_archived_at
  from public.club_teams as team
  where team.id = new.club_team_id
  for share;

  if v_team_club_id is null then
    raise exception 'The selected Club Team does not exist.' using errcode = '22023';
  end if;

  if v_team_club_id <> v_entry_club_id then
    raise exception 'The selected Club Team belongs to a different club.' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and v_entry_status <> 'draft' and (
    new.club_team_id is distinct from old.club_team_id
    or new.club_competition_entry_id is distinct from old.club_competition_entry_id
    or new.club_team_name_snapshot is distinct from old.club_team_name_snapshot
  ) then
    raise exception 'A submitted entrant''s persistent Team link and name snapshot are historical and cannot be changed.'
      using errcode = '23514';
  end if;

  if v_team_archived_at is not null and (
    tg_op = 'INSERT'
    or new.club_team_id is distinct from old.club_team_id
    or v_entry_status = 'draft'
  ) then
    raise exception 'The selected Club Team is archived. Unarchive it or choose another Team.'
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
    when 'pairs' then 'Pair ' || p_position::text
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

create or replace function public.create_club_team(
  p_club_id bigint,
  p_name text default null
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
begin
  select * into v_access
  from private.require_club_team_member(p_club_id, true);

  perform club.id from public.clubs as club
  where club.id = p_club_id
  for update;

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
        and lower(team.name) = lower('Team ' || v_team_number::text)
    ) loop
      v_team_number := v_team_number + 1;
    end loop;
    v_name := 'Team ' || v_team_number::text;
  end if;

  insert into public.club_teams(
    club_id, name, display_order, created_by, updated_by
  ) values (
    p_club_id, v_name, v_display_order, v_access.actor_id, v_access.actor_id
  ) returning * into v_team;

  return jsonb_build_object(
    'id', v_team.id,
    'club_id', v_team.club_id,
    'name', v_team.name,
    'display_order', v_team.display_order,
    'archived_at', v_team.archived_at,
    'competition_usage_count', 0,
    'submitted_usage_count', 0,
    'created_at', v_team.created_at,
    'updated_at', v_team.updated_at
  );
exception
  when unique_violation then
    raise exception 'A Club Team with that name already exists. Archived Team names cannot be reused.'
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
    raise exception 'Club Team not found.' using errcode = 'P0002';
  end if;

  select * into v_access
  from private.require_club_team_member(v_club_id, true);

  update public.club_teams as team
  set name = p_name, updated_by = v_access.actor_id
  where team.id = p_club_team_id
  returning * into v_team;

  return jsonb_build_object(
    'id', v_team.id,
    'club_id', v_team.club_id,
    'name', v_team.name,
    'display_order', v_team.display_order,
    'archived_at', v_team.archived_at,
    'updated_at', v_team.updated_at
  );
exception
  when unique_violation then
    raise exception 'A Club Team with that name already exists. Archived Team names cannot be reused.'
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
    raise exception 'Club Team not found.' using errcode = 'P0002';
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
    raise exception 'Unlink or change this Club Team in its draft Competition entry before archiving it.'
      using errcode = '22023';
  end if;

  update public.club_teams as team
  set archived_at = coalesce(team.archived_at, now()),
      updated_by = v_access.actor_id
  where team.id = p_club_team_id
  returning * into v_team;

  return jsonb_build_object(
    'id', v_team.id,
    'club_id', v_team.club_id,
    'name', v_team.name,
    'display_order', v_team.display_order,
    'archived_at', v_team.archived_at,
    'updated_at', v_team.updated_at
  );
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
    raise exception 'Club Team not found.' using errcode = 'P0002';
  end if;

  select * into v_access
  from private.require_club_team_member(v_club_id, true);

  update public.club_teams as team
  set archived_at = null, updated_by = v_access.actor_id
  where team.id = p_club_team_id
  returning * into v_team;

  return jsonb_build_object(
    'id', v_team.id,
    'club_id', v_team.club_id,
    'name', v_team.name,
    'display_order', v_team.display_order,
    'archived_at', v_team.archived_at,
    'updated_at', v_team.updated_at
  );
end;
$$;

alter table public.club_teams enable row level security;
revoke all privileges on table public.club_teams from public, anon, authenticated;
revoke all privileges on sequence public.club_teams_id_seq from public, anon, authenticated;
grant select (
  id, club_id, name, display_order, archived_at, created_at, updated_at
) on table public.club_teams to authenticated;

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

revoke execute on function public.get_club_teams(bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.get_club_teams(bigint, boolean)
  to authenticated;
revoke execute on function public.create_club_team(bigint, text)
  from public, anon, authenticated;
grant execute on function public.create_club_team(bigint, text)
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

-- Backward-compatible entrant save: legacy arrays stay valid. Team callers may
-- supply {"club_team_id": number|null, "participants": [...]} without an RPC
-- overload. The database derives every name snapshot from the selected Team.
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
    if jsonb_typeof(v_unit.value) = 'array' then
      v_participants := v_unit.value;
    elsif jsonb_typeof(v_unit.value) = 'object'
      and v_context.entry_format = 'team' then
      v_participants := v_unit.value -> 'participants';
      v_team_value := v_unit.value -> 'club_team_id';
      if v_team_value is not null and jsonb_typeof(v_team_value) <> 'null' then
        if jsonb_typeof(v_team_value) <> 'number'
          or v_team_value::text !~ '^[1-9][0-9]*$' then
          raise exception 'Club Team selections must use a valid persistent Team ID.'
            using errcode = '22023';
        end if;
        v_team_id := v_team_value::text::bigint;
      end if;
    else
      raise exception 'Individual and Pair entrants must use the existing participant-list format.'
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

  select count(*)::integer into v_selected_team_count
  from jsonb_array_elements(v_normalised) as unit(value)
  where jsonb_typeof(unit.value -> 'club_team_id') = 'number';

  if (
    select count(distinct (unit.value ->> 'club_team_id'))::integer
    from jsonb_array_elements(v_normalised) as unit(value)
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
  ) <> v_selected_team_count then
    raise exception 'A persistent Club Team can only be used once in this club entry.'
      using errcode = '23505',
        constraint = 'competition_entrants_entry_club_team_unique';
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
    raise exception 'A selected Club Team no longer exists.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_normalised) as unit(value)
    join public.club_teams as team
      on team.id = (unit.value ->> 'club_team_id')::bigint
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
      and team.club_id <> v_context.club_id
  ) then
    raise exception 'A selected Club Team belongs to a different club.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_normalised) as unit(value)
    join public.club_teams as team
      on team.id = (unit.value ->> 'club_team_id')::bigint
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
      and team.archived_at is not null
  ) then
    raise exception 'A selected Club Team is archived. Unarchive it or choose another Team.'
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
      raise exception 'A persistent Club Team can only be used once in this club entry.'
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
      when 'pairs' then format('Pair %s', v_error.position)
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
  'Atomically replaces draft entrant composition. Legacy participant arrays remain supported; Team objects may carry a same-Club persistent Team ID and database-derived edition name snapshot.';
comment on function public.submit_club_competition_entry(bigint) is
  'Validates and submits exact local entrant slots, refreshing linked Team name snapshots immediately before a Draft becomes historical.';
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
