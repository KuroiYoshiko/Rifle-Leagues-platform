-- Run after database/competition-entries.sql.
-- Adds manual competition division planning and publication only. No seeding,
-- averages, scoring, standings, payments, promotion, or relegation are included.

begin;

create table if not exists public.competition_division_configs (
  competition_id bigint primary key
    references public.competitions (id) on delete cascade,
  target_size integer not null,
  status text not null default 'draft',
  published_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_division_configs_target_size_value check (
    target_size between 1 and 1000
  ),
  constraint competition_division_configs_status_value check (
    status in ('draft', 'published')
  ),
  constraint competition_division_configs_publication_time check (
    (status = 'published' and published_at is not null)
    or (status = 'draft' and published_at is null)
  )
);

comment on table public.competition_division_configs is
  'Competition-scoped manual division workflow. Target size is a planning aid measured in entrant units.';

create table if not exists public.competition_divisions (
  id bigint generated always as identity primary key,
  competition_id bigint not null
    references public.competition_division_configs (competition_id)
    on delete cascade,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_divisions_name_value check (
    char_length(name) between 1 and 80 and name = btrim(name)
  ),
  constraint competition_divisions_position_value check (
    position between 1 and 200
  ),
  constraint competition_divisions_competition_position_unique unique (
    competition_id,
    position
  ),
  constraint competition_divisions_id_competition_unique unique (
    id,
    competition_id
  )
);

comment on table public.competition_divisions is
  'Ordered division containers for one competition. Names are organiser-controlled and bounded.';

create unique index if not exists competition_divisions_competition_lower_name_unique_idx
  on public.competition_divisions (competition_id, lower(name));

create table if not exists public.competition_division_assignments (
  competition_entrant_id bigint primary key
    references public.competition_entrants (id) on delete cascade,
  competition_id bigint not null,
  competition_division_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_division_assignments_division_competition_fkey
    foreign key (competition_division_id, competition_id)
    references public.competition_divisions (id, competition_id)
    on delete cascade
);

comment on table public.competition_division_assignments is
  'Assigns one existing entrant unit atomically to at most one division. Participant names remain sourced from entrant participants and profiles.';

create index if not exists competition_division_configs_created_by_idx
  on public.competition_division_configs (created_by)
  where created_by is not null;

create index if not exists competition_division_configs_updated_by_idx
  on public.competition_division_configs (updated_by)
  where updated_by is not null;

create index if not exists competition_division_assignments_competition_division_idx
  on public.competition_division_assignments (
    competition_id,
    competition_division_id,
    competition_entrant_id
  );

drop trigger if exists set_competition_division_configs_updated_at
  on public.competition_division_configs;
create trigger set_competition_division_configs_updated_at
  before update on public.competition_division_configs
  for each row execute function private.set_updated_at();

drop trigger if exists set_competition_divisions_updated_at
  on public.competition_divisions;
create trigger set_competition_divisions_updated_at
  before update on public.competition_divisions
  for each row execute function private.set_updated_at();

drop trigger if exists set_competition_division_assignments_updated_at
  on public.competition_division_assignments;
create trigger set_competition_division_assignments_updated_at
  before update on public.competition_division_assignments
  for each row execute function private.set_updated_at();

create or replace function private.validate_competition_division_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.competition_entrants as entrant
    join public.club_competition_entries as entry
      on entry.id = entrant.club_competition_entry_id
    where entrant.id = new.competition_entrant_id
      and entry.competition_id = new.competition_id
      and entry.status = 'submitted'
  ) then
    raise exception 'Only entrant units from submitted entries in this exact competition may be assigned.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function private.validate_competition_division_assignment()
  from public, anon, authenticated;

drop trigger if exists validate_competition_division_assignment
  on public.competition_division_assignments;
create trigger validate_competition_division_assignment
  before insert or update of competition_entrant_id, competition_id,
    competition_division_id
  on public.competition_division_assignments
  for each row execute function private.validate_competition_division_assignment();

-- Shared exact-parent and active owner/manager guard for all management RPCs.
create or replace function private.require_competition_division_manager(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns table (
  actor_id uuid,
  organisation_slug text,
  season_slug text,
  competition_slug text,
  entry_closes_at date
)
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
  select
    v_actor_id,
    organisation.slug,
    season.slug,
    competition.slug,
    season.entry_closes_at
  from public.organisation_staff as staff
  join public.organisations as organisation
    on organisation.id = staff.organisation_id
  join public.league_seasons as season
    on season.organisation_id = organisation.id
  join public.competitions as competition
    on competition.league_season_id = season.id
  where staff.user_id = v_actor_id
    and staff.organisation_id = p_organisation_id
    and staff.status = 'active'
    and staff.role in ('owner', 'manager')
    and organisation.id = p_organisation_id
    and organisation.status = 'active'
    and season.id = p_league_season_id
    and competition.id = p_competition_id
  for share of staff, organisation, season, competition;

  if not found then
    raise exception 'Only an active owner or manager of this exact organisation can manage these divisions.'
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.require_competition_division_manager(bigint, bigint, bigint)
  from public, anon, authenticated;

alter table public.competition_division_configs enable row level security;
alter table public.competition_divisions enable row level security;
alter table public.competition_division_assignments enable row level security;

revoke all privileges on table public.competition_division_configs
  from anon, authenticated;
grant select (
  competition_id,
  target_size,
  status,
  published_at,
  created_at,
  updated_at
) on table public.competition_division_configs to authenticated;

revoke all privileges on table public.competition_divisions
  from anon, authenticated;
revoke all privileges on sequence public.competition_divisions_id_seq
  from anon, authenticated;
grant select on table public.competition_divisions to authenticated;

revoke all privileges on table public.competition_division_assignments
  from anon, authenticated;
grant select on table public.competition_division_assignments to authenticated;

-- Management can read drafts. Once published, any active member of a club with
-- a submitted entry in the competition can read the division records.
drop policy if exists "Permitted users can read competition division configs"
  on public.competition_division_configs;
create policy "Permitted users can read competition division configs"
on public.competition_division_configs
for select
to authenticated
using (
  exists (
    select 1
    from public.competitions as competition
    join public.league_seasons as season
      on season.id = competition.league_season_id
    join public.organisations as organisation
      on organisation.id = season.organisation_id
    join public.organisation_staff as staff
      on staff.organisation_id = season.organisation_id
    where competition.id = competition_division_configs.competition_id
      and staff.user_id = (select auth.uid())
      and staff.status = 'active'
      and staff.role in ('owner', 'manager')
      and organisation.status = 'active'
  )
  or (
    status = 'published'
    and exists (
      select 1
      from public.club_competition_entries as entry
      join public.clubs as club
        on club.id = entry.club_id
      join public.club_memberships as membership
        on membership.club_id = entry.club_id
      where entry.competition_id = competition_division_configs.competition_id
        and entry.status = 'submitted'
        and club.status = 'active'
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and (
          membership.role in ('owner', 'official')
          or exists (
            select 1
            from public.competition_entrant_participants as participant
            where participant.club_competition_entry_id = entry.id
              and participant.club_membership_id = membership.id
          )
        )
    )
  )
);

drop policy if exists "Permitted users can read competition divisions"
  on public.competition_divisions;
create policy "Permitted users can read competition divisions"
on public.competition_divisions
for select
to authenticated
using (
  exists (
    select 1
    from public.competition_division_configs as config
    where config.competition_id = competition_divisions.competition_id
  )
);

drop policy if exists "Permitted users can read competition division assignments"
  on public.competition_division_assignments;
create policy "Permitted users can read competition division assignments"
on public.competition_division_assignments
for select
to authenticated
using (
  exists (
    select 1
    from public.competition_division_configs as config
    where config.competition_id = competition_division_assignments.competition_id
  )
);

create or replace function public.get_competition_division_management(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_result jsonb;
begin
  select * into v_context
  from private.require_competition_division_manager(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  select jsonb_build_object(
    'competition_id', competition.id,
    'entry_format', competition.entry_format,
    'team_size', competition.team_size,
    'database_today', current_date,
    'entry_closes_at', season.entry_closes_at,
    'entry_window_closed', (
      season.entry_closes_at is not null
      and current_date > season.entry_closes_at
    ),
    'entrant_count', (
      select count(*)
      from public.competition_entrants as entrant
      join public.club_competition_entries as entry
        on entry.id = entrant.club_competition_entry_id
      where entry.competition_id = competition.id
        and entry.status = 'submitted'
    ),
    'club_count', (
      select count(*)
      from public.club_competition_entries as entry
      where entry.competition_id = competition.id
        and entry.status = 'submitted'
    ),
    'config', (
      select jsonb_build_object(
        'target_size', config.target_size,
        'status', config.status,
        'published_at', config.published_at,
        'updated_at', config.updated_at
      )
      from public.competition_division_configs as config
      where config.competition_id = competition.id
    ),
    'entrants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', entrant.id,
          'club_id', club.id,
          'club_name', club.name,
          'entry_position', entrant.position,
          'participants', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'first_name', profile.first_name,
                'last_name', profile.last_name,
                'slot_number', participant.slot_number
              ) order by participant.slot_number
            )
            from public.competition_entrant_participants as participant
            join public.club_memberships as membership
              on membership.id = participant.club_membership_id
            join public.profiles as profile on profile.id = membership.user_id
            where participant.competition_entrant_id = entrant.id
          ), '[]'::jsonb)
        ) order by club.name, entry.id, entrant.position, entrant.id
      )
      from public.competition_entrants as entrant
      join public.club_competition_entries as entry
        on entry.id = entrant.club_competition_entry_id
      join public.clubs as club on club.id = entry.club_id
      where entry.competition_id = competition.id
        and entry.status = 'submitted'
    ), '[]'::jsonb),
    'divisions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', division.id,
          'name', division.name,
          'position', division.position,
          'entrant_ids', coalesce((
            select jsonb_agg(assignment.competition_entrant_id order by assignment.competition_entrant_id)
            from public.competition_division_assignments as assignment
            join public.competition_entrants as assigned_entrant
              on assigned_entrant.id = assignment.competition_entrant_id
            join public.club_competition_entries as assigned_entry
              on assigned_entry.id = assigned_entrant.club_competition_entry_id
            where assignment.competition_division_id = division.id
              and assignment.competition_id = competition.id
              and assigned_entry.competition_id = competition.id
              and assigned_entry.status = 'submitted'
          ), '[]'::jsonb)
        ) order by division.position, division.id
      )
      from public.competition_divisions as division
      where division.competition_id = competition.id
    ), '[]'::jsonb)
  ) into v_result
  from public.competitions as competition
  join public.league_seasons as season
    on season.id = competition.league_season_id
  where competition.id = p_competition_id
    and season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;

  return v_result;
end;
$$;

create or replace function public.save_competition_division_draft(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_target_size integer,
  p_divisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_division record;
  v_entrant_value jsonb;
  v_division_id bigint;
  v_requested_assignment_count integer;
begin
  select * into v_context
  from private.require_competition_division_manager(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('competition-divisions:' || p_competition_id::text, 0)
  );

  if p_target_size is null or p_target_size not between 1 and 1000 then
    raise exception 'Target division size must be between 1 and 1,000 entrant units.'
      using errcode = '22023';
  end if;

  if p_divisions is null or jsonb_typeof(p_divisions) <> 'array' then
    raise exception 'Divisions must be supplied as a list.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_divisions) > 200 then
    raise exception 'A competition cannot contain more than 200 divisions.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.competition_division_configs as config
    where config.competition_id = p_competition_id
      and config.status = 'published'
  ) then
    raise exception 'Choose Edit divisions before changing a published allocation.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_divisions) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or char_length(btrim(coalesce(item.value ->> 'name', ''))) not between 1 and 80
      or jsonb_typeof(coalesce(item.value -> 'entrant_ids', 'null'::jsonb)) <> 'array'
  ) then
    raise exception 'Every division needs a name between 1 and 80 characters and an entrant list.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select lower(btrim(item.value ->> 'name')) as division_name
      from jsonb_array_elements(p_divisions) as item(value)
      group by lower(btrim(item.value ->> 'name'))
      having count(*) > 1
    ) as duplicate_names
  ) then
    raise exception 'Division names must be unique within the competition.'
      using errcode = '22023';
  end if;

  select count(*)::integer into v_requested_assignment_count
  from jsonb_array_elements(p_divisions) as division(value)
  cross join lateral jsonb_array_elements(division.value -> 'entrant_ids') as entrant(value);

  if v_requested_assignment_count > 20000 then
    raise exception 'A division draft cannot contain more than 20,000 assignments.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_divisions) as division(value)
    cross join lateral jsonb_array_elements(division.value -> 'entrant_ids') as entrant(value)
    where jsonb_typeof(entrant.value) <> 'number'
      or (entrant.value #>> '{}') !~ '^[1-9][0-9]{0,18}$'
  ) then
    raise exception 'Every assignment must reference a valid entrant unit.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select entrant.value #>> '{}' as entrant_id
      from jsonb_array_elements(p_divisions) as division(value)
      cross join lateral jsonb_array_elements(division.value -> 'entrant_ids') as entrant(value)
      group by entrant.value #>> '{}'
      having count(*) > 1
    ) as duplicates
  ) then
    raise exception 'An entrant unit can only appear in one division.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_divisions) as division(value)
    cross join lateral jsonb_array_elements(division.value -> 'entrant_ids') as requested(value)
    left join public.competition_entrants as entrant
      on entrant.id = (requested.value #>> '{}')::bigint
    left join public.club_competition_entries as entry
      on entry.id = entrant.club_competition_entry_id
    where entrant.id is null
      or entry.competition_id <> p_competition_id
      or entry.status <> 'submitted'
  ) then
    raise exception 'Only currently submitted entrant units from this exact competition may be assigned.'
      using errcode = '22023';
  end if;

  insert into public.competition_division_configs (
    competition_id,
    target_size,
    status,
    published_at,
    created_by,
    updated_by
  ) values (
    p_competition_id,
    p_target_size,
    'draft',
    null,
    v_context.actor_id,
    v_context.actor_id
  )
  on conflict (competition_id) do update
  set target_size = excluded.target_size,
      status = 'draft',
      published_at = null,
      updated_by = excluded.updated_by;

  delete from public.competition_divisions
  where competition_id = p_competition_id;

  for v_division in
    select item.value, item.ordinality::integer as position
    from jsonb_array_elements(p_divisions) with ordinality as item(value, ordinality)
  loop
    insert into public.competition_divisions (
      competition_id,
      name,
      position
    ) values (
      p_competition_id,
      btrim(v_division.value ->> 'name'),
      v_division.position
    ) returning id into v_division_id;

    for v_entrant_value in
      select value
      from jsonb_array_elements(v_division.value -> 'entrant_ids')
    loop
      insert into public.competition_division_assignments (
        competition_entrant_id,
        competition_id,
        competition_division_id
      ) values (
        (v_entrant_value #>> '{}')::bigint,
        p_competition_id,
        v_division_id
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'status', 'draft',
    'division_count', jsonb_array_length(p_divisions),
    'assignment_count', v_requested_assignment_count
  );
end;
$$;

create or replace function public.publish_competition_divisions(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_entrant_count integer;
  v_division_count integer;
  v_assignment_count integer;
begin
  select * into v_context
  from private.require_competition_division_manager(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('competition-divisions:' || p_competition_id::text, 0)
  );

  perform config.competition_id
  from public.competition_division_configs as config
  where config.competition_id = p_competition_id
  for update;

  if not found then
    raise exception 'Save a division draft before publishing.' using errcode = '22023';
  end if;

  if v_context.entry_closes_at is null
    or current_date <= v_context.entry_closes_at then
    raise exception 'Divisions cannot be published until the competition entry window has closed.'
      using errcode = '22023';
  end if;

  -- Club entry mutations lock the same rows. Holding every competition entry
  -- stable makes the eligible entrant set authoritative for this publication.
  perform entry.id
  from public.club_competition_entries as entry
  where entry.competition_id = p_competition_id
  order by entry.id
  for update;

  select count(*)::integer into v_entrant_count
  from public.competition_entrants as entrant
  join public.club_competition_entries as entry
    on entry.id = entrant.club_competition_entry_id
  where entry.competition_id = p_competition_id
    and entry.status = 'submitted';

  if v_entrant_count = 0 then
    raise exception 'At least one submitted entrant unit is required before publishing.'
      using errcode = '22023';
  end if;

  select count(*)::integer into v_division_count
  from public.competition_divisions
  where competition_id = p_competition_id;

  if v_division_count = 0 then
    raise exception 'Create at least one division before publishing.'
      using errcode = '22023';
  end if;

  select count(*)::integer into v_assignment_count
  from public.competition_division_assignments as assignment
  join public.competition_divisions as division
    on division.id = assignment.competition_division_id
   and division.competition_id = assignment.competition_id
  join public.competition_entrants as entrant
    on entrant.id = assignment.competition_entrant_id
  join public.club_competition_entries as entry
    on entry.id = entrant.club_competition_entry_id
  where assignment.competition_id = p_competition_id
    and division.competition_id = p_competition_id
    and entry.competition_id = p_competition_id
    and entry.status = 'submitted';

  if v_assignment_count <> v_entrant_count
    or exists (
      select 1
      from public.competition_entrants as entrant
      join public.club_competition_entries as entry
        on entry.id = entrant.club_competition_entry_id
      left join public.competition_division_assignments as assignment
        on assignment.competition_entrant_id = entrant.id
       and assignment.competition_id = p_competition_id
      where entry.competition_id = p_competition_id
        and entry.status = 'submitted'
        and assignment.competition_entrant_id is null
    )
    or exists (
      select 1
      from public.competition_division_assignments as assignment
      left join public.competition_entrants as entrant
        on entrant.id = assignment.competition_entrant_id
      left join public.club_competition_entries as entry
        on entry.id = entrant.club_competition_entry_id
      where assignment.competition_id = p_competition_id
        and (
          entrant.id is null
          or entry.competition_id <> p_competition_id
          or entry.status <> 'submitted'
        )
    ) then
    raise exception 'Every currently submitted entrant unit must be assigned to exactly one division before publishing.'
      using errcode = '22023';
  end if;

  update public.competition_division_configs
  set status = 'published',
      published_at = now(),
      updated_by = v_context.actor_id
  where competition_id = p_competition_id;

  return jsonb_build_object(
    'status', 'published',
    'entrant_count', v_entrant_count,
    'division_count', v_division_count,
    'published_at', now()
  );
end;
$$;

create or replace function public.edit_competition_divisions(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
begin
  select * into v_context
  from private.require_competition_division_manager(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('competition-divisions:' || p_competition_id::text, 0)
  );

  update public.competition_division_configs
  set status = 'draft',
      published_at = null,
      updated_by = v_context.actor_id
  where competition_id = p_competition_id
    and status = 'published';

  if not found then
    raise exception 'Published divisions were not found.' using errcode = '22023';
  end if;

  return jsonb_build_object('status', 'draft');
end;
$$;

-- Saves the exact client layout and publishes it in the same database
-- transaction. Any publication validation failure rolls the draft write back.
create or replace function public.save_and_publish_competition_divisions(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_target_size integer,
  p_divisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.save_competition_division_draft(
    p_organisation_id,
    p_league_season_id,
    p_competition_id,
    p_target_size,
    p_divisions
  );

  return public.publish_competition_divisions(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );
end;
$$;

-- Returns only published allocations for active members of participating clubs.
-- Organisation managers use the richer management RPC above.
create or replace function public.get_published_competition_divisions(
  p_competition_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.competition_division_configs as config
    join public.club_competition_entries as entry
      on entry.competition_id = config.competition_id
     and entry.status = 'submitted'
    join public.clubs as club
      on club.id = entry.club_id
     and club.status = 'active'
    join public.club_memberships as membership
      on membership.club_id = entry.club_id
     and membership.user_id = v_actor_id
     and membership.status = 'active'
    where config.competition_id = p_competition_id
      and config.status = 'published'
      and (
        membership.role in ('owner', 'official')
        or exists (
          select 1
          from public.competition_entrant_participants as participant
          where participant.club_competition_entry_id = entry.id
            and participant.club_membership_id = membership.id
        )
      )
  ) then
    return null;
  end if;

  select jsonb_build_object(
    'status', config.status,
    'divisions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', division.id,
          'name', division.name,
          'position', division.position,
          'entrants', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', entrant.id,
                'club_name', club.name,
                'is_current_user', exists (
                  select 1
                  from public.competition_entrant_participants as own_participant
                  join public.club_memberships as own_membership
                    on own_membership.id = own_participant.club_membership_id
                  where own_participant.competition_entrant_id = entrant.id
                    and own_membership.user_id = v_actor_id
                ),
                'participants', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'first_name', profile.first_name,
                      'last_name', profile.last_name,
                      'slot_number', participant.slot_number
                    ) order by participant.slot_number
                  )
                  from public.competition_entrant_participants as participant
                  join public.club_memberships as participant_membership
                    on participant_membership.id = participant.club_membership_id
                  join public.profiles as profile
                    on profile.id = participant_membership.user_id
                  where participant.competition_entrant_id = entrant.id
                ), '[]'::jsonb)
              ) order by club.name, entrant.position, entrant.id
            )
            from public.competition_division_assignments as assignment
            join public.competition_entrants as entrant
              on entrant.id = assignment.competition_entrant_id
            join public.club_competition_entries as entry
              on entry.id = entrant.club_competition_entry_id
             and entry.status = 'submitted'
            join public.clubs as club on club.id = entry.club_id
            where assignment.competition_division_id = division.id
              and assignment.competition_id = p_competition_id
              and exists (
                select 1
                from public.club_memberships as viewer_membership
                where viewer_membership.club_id = entry.club_id
                  and viewer_membership.user_id = v_actor_id
                  and viewer_membership.status = 'active'
                  and (
                    viewer_membership.role in ('owner', 'official')
                    or exists (
                      select 1
                      from public.competition_entrant_participants as viewer_participant
                      where viewer_participant.competition_entrant_id = entrant.id
                        and viewer_participant.club_membership_id = viewer_membership.id
                    )
                  )
              )
          ), '[]'::jsonb)
        ) order by division.position, division.id
      )
      from public.competition_divisions as division
      where division.competition_id = config.competition_id
    ), '[]'::jsonb)
  ) into v_result
  from public.competition_division_configs as config
  where config.competition_id = p_competition_id
    and config.status = 'published';

  return v_result;
end;
$$;

comment on function public.get_competition_division_management(bigint, bigint, bigint) is
  'Returns submitted entrant-unit names, clubs, and draft/published division layout only to an active owner or manager of the exact organisation.';
comment on function public.save_competition_division_draft(bigint, bigint, bigint, integer, jsonb) is
  'Atomically replaces one editable division draft after exact active owner/manager and entrant relationship validation.';
comment on function public.publish_competition_divisions(bigint, bigint, bigint) is
  'Atomically publishes a complete exact-competition allocation only after the database entry-close date.';
comment on function public.edit_competition_divisions(bigint, bigint, bigint) is
  'Returns one published division allocation to draft after exact active owner/manager authorization.';
comment on function public.save_and_publish_competition_divisions(bigint, bigint, bigint, integer, jsonb) is
  'Atomically saves and publishes one complete division allocation; failed publication validation rolls back the supplied draft.';
comment on function public.get_published_competition_divisions(bigint) is
  'Returns published division allocations only for the caller active participating clubs, exposing names but no contact data.';

revoke execute on function public.get_competition_division_management(bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.get_competition_division_management(bigint, bigint, bigint)
  to authenticated;

revoke execute on function public.save_competition_division_draft(bigint, bigint, bigint, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_competition_division_draft(bigint, bigint, bigint, integer, jsonb)
  to authenticated;

revoke execute on function public.publish_competition_divisions(bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.publish_competition_divisions(bigint, bigint, bigint)
  to authenticated;

revoke execute on function public.edit_competition_divisions(bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.edit_competition_divisions(bigint, bigint, bigint)
  to authenticated;

revoke execute on function public.save_and_publish_competition_divisions(bigint, bigint, bigint, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_and_publish_competition_divisions(bigint, bigint, bigint, integer, jsonb)
  to authenticated;

revoke execute on function public.get_published_competition_divisions(bigint)
  from public, anon, authenticated;
grant execute on function public.get_published_competition_divisions(bigint)
  to authenticated;

commit;
