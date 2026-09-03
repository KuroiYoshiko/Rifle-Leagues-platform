-- Run after database/user-profiles.sql, database/organisations.sql,
-- database/organisation-staff.sql, database/clubs-and-memberships.sql,
-- database/league-seasons.sql, and database/competition-rounds.sql.
-- Adds club-official-managed competition entries only. Divisions, seeding,
-- scores, standings, results, payments, and member self-entry are out of scope.

begin;

create table if not exists public.club_competition_entries (
  id bigint generated always as identity primary key,
  competition_id bigint not null
    references public.competitions (id) on delete cascade,
  club_id bigint not null
    references public.clubs (id) on delete cascade,
  status text not null default 'draft',
  submitted_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_competition_entries_status_value check (
    status in ('draft', 'submitted', 'withdrawn')
  ),
  constraint club_competition_entries_submission_time check (
    (status = 'submitted' and submitted_at is not null)
    or (status <> 'submitted' and submitted_at is null)
  ),
  constraint club_competition_entries_competition_club_unique unique (
    competition_id,
    club_id
  )
);

comment on table public.club_competition_entries is
  'One durable club-level submission for one competition. Only active club owners and officials may mutate it.';

comment on column public.club_competition_entries.status is
  'Lifecycle: draft, submitted, or withdrawn. Editing submitted composition returns the entry to draft.';

create table if not exists public.competition_entrants (
  id bigint generated always as identity primary key,
  club_competition_entry_id bigint not null
    references public.club_competition_entries (id) on delete cascade,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_entrants_position_value check (
    position between 1 and 1000
  ),
  constraint competition_entrants_entry_position_unique unique (
    club_competition_entry_id,
    position
  ),
  constraint competition_entrants_id_entry_unique unique (
    id,
    club_competition_entry_id
  )
);

comment on table public.competition_entrants is
  'One competitive unit inside a club submission. Its required size is derived from the parent competition.';

create table if not exists public.competition_entrant_participants (
  id bigint generated always as identity primary key,
  club_competition_entry_id bigint not null
    references public.club_competition_entries (id) on delete cascade,
  competition_entrant_id bigint not null,
  club_membership_id bigint not null
    references public.club_memberships (id),
  slot_number integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_entrant_participants_slot_value check (
    slot_number between 1 and 20
  ),
  constraint competition_entrant_participants_entrant_entry_fkey foreign key (
    competition_entrant_id,
    club_competition_entry_id
  ) references public.competition_entrants (
    id,
    club_competition_entry_id
  ) on delete cascade,
  constraint competition_entrant_participants_entry_membership_unique unique (
    club_competition_entry_id,
    club_membership_id
  ),
  constraint competition_entrant_participants_entrant_slot_unique unique (
    competition_entrant_id,
    slot_number
  )
);

comment on table public.competition_entrant_participants is
  'Shooter slots for Individual, Pair, and Team entrant units. Membership status changes do not delete historical participation.';

create index if not exists club_competition_entries_club_status_competition_idx
  on public.club_competition_entries (club_id, status, competition_id);

create index if not exists club_competition_entries_created_by_idx
  on public.club_competition_entries (created_by)
  where created_by is not null;

create index if not exists club_competition_entries_updated_by_idx
  on public.club_competition_entries (updated_by)
  where updated_by is not null;

create index if not exists competition_entrant_participants_membership_idx
  on public.competition_entrant_participants (club_membership_id);

drop trigger if exists set_club_competition_entries_updated_at
  on public.club_competition_entries;
create trigger set_club_competition_entries_updated_at
  before update on public.club_competition_entries
  for each row execute function private.set_updated_at();

drop trigger if exists set_competition_entrants_updated_at
  on public.competition_entrants;
create trigger set_competition_entrants_updated_at
  before update on public.competition_entrants
  for each row execute function private.set_updated_at();

drop trigger if exists set_competition_entrant_participants_updated_at
  on public.competition_entrant_participants;
create trigger set_competition_entrant_participants_updated_at
  before update on public.competition_entrant_participants
  for each row execute function private.set_updated_at();

-- A participant must be an active member of the entry club when a slot is
-- inserted or changed. No trigger is installed on membership status changes,
-- so a later departure cannot erase or invalidate historical participation.
create or replace function private.validate_competition_entry_participant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_club_id bigint;
  v_team_size integer;
begin
  select entry.club_id, competition.team_size
  into v_club_id, v_team_size
  from public.club_competition_entries as entry
  join public.competitions as competition
    on competition.id = entry.competition_id
  where entry.id = new.club_competition_entry_id;

  if v_club_id is null then
    raise exception 'Club competition entry not found for participant.'
      using errcode = '23503';
  end if;

  if new.slot_number > v_team_size then
    raise exception 'Participant slot exceeds the competition entry size.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.club_memberships as membership
    where membership.id = new.club_membership_id
      and membership.club_id = v_club_id
      and membership.status = 'active'
  ) then
    raise exception 'Every selected shooter must be an active member of this club.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function private.validate_competition_entry_participant()
  from public, anon, authenticated;

drop trigger if exists validate_competition_entry_participant
  on public.competition_entrant_participants;
create trigger validate_competition_entry_participant
  before insert or update of club_competition_entry_id, competition_entrant_id,
    club_membership_id, slot_number
  on public.competition_entrant_participants
  for each row execute function private.validate_competition_entry_participant();

-- Once a club has started an entry, changing the configured format or size
-- would reinterpret persisted entrant units. Other competition fields remain
-- governed by the existing competition RPC.
create or replace function private.protect_competition_entry_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.entry_format, new.team_size) is not distinct from
    (old.entry_format, old.team_size) then
    return new;
  end if;

  if exists (
    select 1
    from public.club_competition_entries as entry
    where entry.competition_id = old.id
  ) then
    raise exception 'Entry format and team size cannot change after a club entry has started.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke execute on function private.protect_competition_entry_shape()
  from public, anon, authenticated;

drop trigger if exists protect_competition_entry_shape on public.competitions;
create trigger protect_competition_entry_shape
  before update of entry_format, team_size on public.competitions
  for each row execute function private.protect_competition_entry_shape();

-- Central mutation guard. Every entry-changing RPC uses this helper, which
-- locks and rechecks the exact caller, club, competition, season, and window.
create or replace function private.get_club_competition_entry_mutation_context(
  p_club_competition_entry_id bigint,
  p_require_open boolean default true
)
returns table (
  actor_id uuid,
  club_id bigint,
  competition_id bigint,
  entry_format text,
  team_size integer,
  entry_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_context record;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select
    entry.club_id,
    entry.competition_id,
    competition.entry_format,
    competition.team_size,
    entry.status,
    competition.status as competition_status,
    season.status as season_status,
    season.entry_opens_at,
    season.entry_closes_at
  into v_context
  from public.club_competition_entries as entry
  join public.clubs as club on club.id = entry.club_id
  join public.club_memberships as actor_membership
    on actor_membership.club_id = entry.club_id
   and actor_membership.user_id = v_actor_id
   and actor_membership.status = 'active'
   and actor_membership.role in ('owner', 'official')
  join public.competitions as competition
    on competition.id = entry.competition_id
  join public.league_seasons as season
    on season.id = competition.league_season_id
  join public.organisations as organisation
    on organisation.id = season.organisation_id
  where entry.id = p_club_competition_entry_id
    and club.status = 'active'
    and organisation.status = 'active'
  for update of entry, actor_membership;

  if not found then
    raise exception 'You do not have permission to manage this club competition entry.'
      using errcode = '42501';
  end if;

  if p_require_open and not (
    v_context.competition_status = 'published'
    and v_context.season_status = 'open'
    and v_context.entry_opens_at is not null
    and v_context.entry_closes_at is not null
    and current_date between v_context.entry_opens_at and v_context.entry_closes_at
  ) then
    raise exception 'Competition entries are not currently open.'
      using errcode = '22023';
  end if;

  return query select
    v_actor_id,
    v_context.club_id,
    v_context.competition_id,
    v_context.entry_format,
    v_context.team_size,
    v_context.status;
end;
$$;

revoke execute on function private.get_club_competition_entry_mutation_context(bigint, boolean)
  from public, anon, authenticated;

alter table public.club_competition_entries enable row level security;
alter table public.competition_entrants enable row level security;
alter table public.competition_entrant_participants enable row level security;

revoke all privileges on table public.club_competition_entries
  from anon, authenticated;
revoke all privileges on sequence public.club_competition_entries_id_seq
  from anon, authenticated;
grant select (
  id, competition_id, club_id, status, submitted_at, created_at, updated_at
) on table public.club_competition_entries to authenticated;

revoke all privileges on table public.competition_entrants
  from anon, authenticated;
revoke all privileges on sequence public.competition_entrants_id_seq
  from anon, authenticated;
grant select (
  id, club_competition_entry_id, position, created_at, updated_at
) on table public.competition_entrants to authenticated;

revoke all privileges on table public.competition_entrant_participants
  from anon, authenticated;
revoke all privileges on sequence public.competition_entrant_participants_id_seq
  from anon, authenticated;
grant select (
  id, club_competition_entry_id, competition_entrant_id,
  club_membership_id, slot_number, created_at, updated_at
) on table public.competition_entrant_participants to authenticated;

drop policy if exists "Club members can read permitted competition entries"
  on public.club_competition_entries;
create policy "Club members can read permitted competition entries"
on public.club_competition_entries
for select
to authenticated
using (
  exists (
    select 1
    from public.club_memberships as membership
    join public.clubs as club on club.id = membership.club_id
    where membership.club_id = club_competition_entries.club_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and club.status = 'active'
      and (
        membership.role in ('owner', 'official')
        or club_competition_entries.status = 'submitted'
      )
  )
);

drop policy if exists "Club members can read permitted competition entrants"
  on public.competition_entrants;
create policy "Club members can read permitted competition entrants"
on public.competition_entrants
for select
to authenticated
using (
  exists (
    select 1
    from public.club_competition_entries as entry
    join public.club_memberships as membership
      on membership.club_id = entry.club_id
    join public.clubs as club on club.id = entry.club_id
    where entry.id = competition_entrants.club_competition_entry_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and club.status = 'active'
      and (
        membership.role in ('owner', 'official')
        or entry.status = 'submitted'
      )
  )
);

drop policy if exists "Club management or entered shooter can read participants"
  on public.competition_entrant_participants;
create policy "Club management or entered shooter can read participants"
on public.competition_entrant_participants
for select
to authenticated
using (
  exists (
    select 1
    from public.club_competition_entries as entry
    join public.club_memberships as actor_membership
      on actor_membership.club_id = entry.club_id
    join public.clubs as club on club.id = entry.club_id
    left join public.club_memberships as participant_membership
      on participant_membership.id = competition_entrant_participants.club_membership_id
    where entry.id = competition_entrant_participants.club_competition_entry_id
      and actor_membership.user_id = (select auth.uid())
      and actor_membership.status = 'active'
      and club.status = 'active'
      and (
        actor_membership.role in ('owner', 'official')
        or (
          entry.status = 'submitted'
          and participant_membership.user_id = (select auth.uid())
        )
      )
  )
);

create or replace function public.start_club_competition_entry(
  p_competition_id bigint,
  p_club_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_context record;
  v_entry_id bigint;
  v_entry_status text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  perform membership.id
  from public.club_memberships as membership
  join public.clubs as club on club.id = membership.club_id
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.status = 'active'
    and membership.role in ('owner', 'official')
    and club.status = 'active'
  for share of membership, club;

  if not found then
    raise exception 'You do not have permission to enter this competition for that club.'
      using errcode = '42501';
  end if;

  select
    competition.status as competition_status,
    season.status as season_status,
    season.entry_opens_at,
    season.entry_closes_at,
    organisation.slug as organisation_slug,
    season.slug as season_slug,
    competition.slug as competition_slug
  into v_context
  from public.competitions as competition
  join public.league_seasons as season
    on season.id = competition.league_season_id
  join public.organisations as organisation
    on organisation.id = season.organisation_id
  where competition.id = p_competition_id
    and organisation.status = 'active'
  for share of competition, season, organisation;

  if not found then
    raise exception 'Published competition not found.' using errcode = 'P0002';
  end if;

  if not (
    v_context.competition_status = 'published'
    and v_context.season_status = 'open'
    and v_context.entry_opens_at is not null
    and v_context.entry_closes_at is not null
    and current_date between v_context.entry_opens_at and v_context.entry_closes_at
  ) then
    raise exception 'Competition entries are not currently open.'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_competition_id::text || ':' || p_club_id::text, 0)
  );

  insert into public.club_competition_entries (
    competition_id, club_id, status, created_by, updated_by
  )
  values (
    p_competition_id, p_club_id, 'draft', v_actor_id, v_actor_id
  )
  on conflict (competition_id, club_id) do update
  set status = case
        when club_competition_entries.status = 'withdrawn' then 'draft'
        else club_competition_entries.status
      end,
      submitted_at = case
        when club_competition_entries.status = 'withdrawn' then null
        else club_competition_entries.submitted_at
      end,
      updated_by = v_actor_id
  returning id, status into v_entry_id, v_entry_status;

  return jsonb_build_object(
    'id', v_entry_id,
    'status', v_entry_status,
    'organisation_slug', v_context.organisation_slug,
    'season_slug', v_context.season_slug,
    'competition_slug', v_context.competition_slug
  );
end;
$$;

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
    if jsonb_typeof(v_unit.value) <> 'array'
      or jsonb_array_length(v_unit.value) <> v_context.team_size then
      raise exception 'Every entrant must contain exactly % shooter slots.',
        v_context.team_size using errcode = '22023';
    end if;

    for v_slot in
      select value, ordinality::integer as slot_number
      from jsonb_array_elements(v_unit.value) with ordinality
    loop
      if jsonb_typeof(v_slot.value) not in ('number', 'null') then
        raise exception 'Shooter selections must use valid club membership IDs.'
          using errcode = '22023';
      end if;

      if jsonb_typeof(v_slot.value) = 'number'
        and v_slot.value::text !~ '^[1-9][0-9]*$' then
        raise exception 'Shooter selections must use valid club membership IDs.'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  select count(*)::integer into v_selected_count
  from jsonb_array_elements(p_entrants) as unit(value)
  cross join lateral jsonb_array_elements(unit.value) as slot(value)
  where jsonb_typeof(slot.value) = 'number';

  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = v_context.club_id
    and membership.id in (
      select slot.value::text::bigint
      from jsonb_array_elements(p_entrants) as unit(value)
      cross join lateral jsonb_array_elements(unit.value) as slot(value)
      where jsonb_typeof(slot.value) = 'number'
    )
  order by membership.id
  for share;

  if (
    select count(distinct slot.value::text)::integer
    from jsonb_array_elements(p_entrants) as unit(value)
    cross join lateral jsonb_array_elements(unit.value) as slot(value)
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
        from jsonb_array_elements(p_entrants) as unit(value)
        cross join lateral jsonb_array_elements(unit.value) as slot(value)
        where jsonb_typeof(slot.value) = 'number'
      )
  ) <> v_selected_count then
    raise exception 'Every selected shooter must be an active member of this club.'
      using errcode = '22023';
  end if;

  delete from public.competition_entrants
  where club_competition_entry_id = p_club_competition_entry_id;

  for v_unit in
    select value, ordinality::integer as position
    from jsonb_array_elements(p_entrants) with ordinality
  loop
    insert into public.competition_entrants (
      club_competition_entry_id,
      position
    )
    values (
      p_club_competition_entry_id,
      v_unit.position
    )
    returning id into v_entrant_id;

    for v_slot in
      select value, ordinality::integer as slot_number
      from jsonb_array_elements(v_unit.value) with ordinality
    loop
      if jsonb_typeof(v_slot.value) = 'number' then
        insert into public.competition_entrant_participants (
          club_competition_entry_id,
          competition_entrant_id,
          club_membership_id,
          slot_number
        )
        values (
          p_club_competition_entry_id,
          v_entrant_id,
          v_slot.value::text::bigint,
          v_slot.slot_number
        );
      end if;
    end loop;
  end loop;

  update public.club_competition_entries
  set status = 'draft',
      submitted_at = null,
      updated_by = v_context.actor_id
  where id = p_club_competition_entry_id;

  return jsonb_build_object(
    'id', p_club_competition_entry_id,
    'status', 'draft',
    'entrant_count', jsonb_array_length(p_entrants),
    'participant_count', v_selected_count
  );
exception
  when unique_violation then
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

  select count(*)::integer into v_entrant_count
  from public.competition_entrants
  where club_competition_entry_id = p_club_competition_entry_id;

  if v_entrant_count = 0 then
    v_errors := v_errors || jsonb_build_array('Add at least one entrant.');
  end if;

  for v_error in
    select
      entrant.position,
      count(participant.id)::integer as participant_count
    from public.competition_entrants as entrant
    left join public.competition_entrant_participants as participant
      on participant.competition_entrant_id = entrant.id
     and participant.club_competition_entry_id = entrant.club_competition_entry_id
    where entrant.club_competition_entry_id = p_club_competition_entry_id
    group by entrant.id, entrant.position
    having count(participant.id) <> v_context.team_size
    order by entrant.position
  loop
    v_unit_label := case v_context.entry_format
      when 'individual' then format('Individual entry %s', v_error.position)
      when 'pairs' then format('Pair %s', v_error.position)
      else format('Team %s', v_error.position)
    end;

    if v_error.participant_count < v_context.team_size then
      v_errors := v_errors || jsonb_build_array(
        format(
          '%s needs %s more shooter%s.',
          v_unit_label,
          v_context.team_size - v_error.participant_count,
          case when v_context.team_size - v_error.participant_count = 1 then '' else 's' end
        )
      );
    else
      v_errors := v_errors || jsonb_build_array(
        format(
          '%s has %s too many shooter%s.',
          v_unit_label,
          v_error.participant_count - v_context.team_size,
          case when v_error.participant_count - v_context.team_size = 1 then '' else 's' end
        )
      );
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
    select
      coalesce(
        nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        'A selected shooter'
      ) as shooter_name
    from public.competition_entrant_participants as participant
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
    join public.profiles as profile on profile.id = membership.user_id
    where participant.club_competition_entry_id = p_club_competition_entry_id
      and (
        membership.club_id <> v_context.club_id
        or membership.status <> 'active'
      )
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
  set status = 'submitted',
      submitted_at = now(),
      updated_by = v_context.actor_id
  where id = p_club_competition_entry_id;

  return jsonb_build_object(
    'id', p_club_competition_entry_id,
    'status', 'submitted',
    'entrant_count', v_entrant_count,
    'participant_count', v_participant_count
  );
end;
$$;

-- Saving and submitting in one database call prevents an invalid latest edit
-- from being partially saved while still failing submission validation.
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

  return public.submit_club_competition_entry(
    p_club_competition_entry_id
  );
end;
$$;

create or replace function public.withdraw_club_competition_entry(
  p_club_competition_entry_id bigint
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
  from private.get_club_competition_entry_mutation_context(
    p_club_competition_entry_id,
    true
  );

  if v_context.entry_status = 'withdrawn' then
    return jsonb_build_object(
      'id', p_club_competition_entry_id,
      'status', 'withdrawn'
    );
  end if;

  update public.club_competition_entries
  set status = 'withdrawn',
      submitted_at = null,
      updated_by = v_context.actor_id
  where id = p_club_competition_entry_id;

  return jsonb_build_object(
    'id', p_club_competition_entry_id,
    'status', 'withdrawn'
  );
end;
$$;

create or replace function public.get_competition_club_entry_context(
  p_competition_id bigint
)
returns table (
  club_id bigint,
  club_name text,
  club_slug text,
  club_role text,
  entry_id bigint,
  entry_status text,
  entrant_count bigint,
  participant_count bigint,
  is_user_entered boolean,
  can_manage boolean,
  entry_window_state text,
  database_today date
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
    club.id,
    club.name,
    club.slug,
    membership.role,
    entry.id,
    entry.status,
    coalesce((
      select count(*)
      from public.competition_entrants as entrant
      where entrant.club_competition_entry_id = entry.id
    ), 0),
    coalesce((
      select count(*)
      from public.competition_entrant_participants as participant
      where participant.club_competition_entry_id = entry.id
    ), 0),
    coalesce(exists (
      select 1
      from public.competition_entrant_participants as participant
      join public.club_memberships as selected_membership
        on selected_membership.id = participant.club_membership_id
      where participant.club_competition_entry_id = entry.id
        and selected_membership.user_id = v_actor_id
    ), false),
    membership.role in ('owner', 'official'),
    case
      when season.status = 'open'
        and season.entry_opens_at is not null
        and current_date < season.entry_opens_at then 'upcoming'
      when season.status = 'open'
        and season.entry_opens_at is not null
        and season.entry_closes_at is not null
        and current_date between season.entry_opens_at and season.entry_closes_at
        then 'open'
      else 'closed'
    end,
    current_date
  from public.competitions as competition
  join public.league_seasons as season
    on season.id = competition.league_season_id
  join public.organisations as organisation
    on organisation.id = season.organisation_id
  join public.club_memberships as membership
    on membership.user_id = v_actor_id
   and membership.status = 'active'
  join public.clubs as club
    on club.id = membership.club_id
   and club.status = 'active'
  left join public.club_competition_entries as entry
    on entry.competition_id = competition.id
   and entry.club_id = club.id
  where competition.id = p_competition_id
    and competition.status = 'published'
    and season.status in ('open', 'active', 'completed')
    and organisation.status = 'active'
    and (
      membership.role in ('owner', 'official')
      or entry.status = 'submitted'
    )
  order by club.name, club.id;
end;
$$;

drop function if exists public.get_club_competition_entries(bigint);
create function public.get_club_competition_entries(
  p_club_id bigint
)
returns table (
  entry_id bigint,
  entry_status text,
  submitted_at timestamptz,
  entry_updated_at timestamptz,
  competition_id bigint,
  competition_name text,
  competition_slug text,
  entry_format text,
  team_size integer,
  league_season_name text,
  league_season_slug text,
  league_season_starts_at date,
  league_season_ends_at date,
  organisation_name text,
  organisation_slug text,
  entrant_count bigint,
  participant_count bigint,
  is_user_entered boolean,
  can_manage boolean,
  entry_window_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select membership.role into v_role
  from public.club_memberships as membership
  join public.clubs as club on club.id = membership.club_id
  where membership.club_id = p_club_id
    and membership.user_id = v_actor_id
    and membership.status = 'active'
    and club.status = 'active';

  if v_role is null then
    raise exception 'Active club membership is required.' using errcode = '42501';
  end if;

  return query
  select
    entry.id,
    entry.status,
    entry.submitted_at,
    entry.updated_at,
    competition.id,
    competition.name,
    competition.slug,
    competition.entry_format,
    competition.team_size,
    season.name,
    season.slug,
    season.starts_at,
    season.ends_at,
    organisation.name,
    organisation.slug,
    (select count(*) from public.competition_entrants as entrant
      where entrant.club_competition_entry_id = entry.id),
    (select count(*) from public.competition_entrant_participants as participant
      where participant.club_competition_entry_id = entry.id),
    exists (
      select 1
      from public.competition_entrant_participants as participant
      join public.club_memberships as selected_membership
        on selected_membership.id = participant.club_membership_id
      where participant.club_competition_entry_id = entry.id
        and selected_membership.user_id = v_actor_id
    ),
    v_role in ('owner', 'official'),
    case
      when season.status = 'open'
        and season.entry_opens_at is not null
        and current_date < season.entry_opens_at then 'upcoming'
      when season.status = 'open'
        and season.entry_opens_at is not null
        and season.entry_closes_at is not null
        and current_date between season.entry_opens_at and season.entry_closes_at
        then 'open'
      else 'closed'
    end
  from public.club_competition_entries as entry
  join public.competitions as competition on competition.id = entry.competition_id
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  where entry.club_id = p_club_id
    and organisation.status = 'active'
    and entry.status <> 'withdrawn'
    and (
      v_role in ('owner', 'official')
      or entry.status = 'submitted'
    )
  order by season.starts_at desc nulls last, competition.name, entry.id;
end;
$$;

create or replace function public.get_club_competition_entry_management(
  p_club_competition_entry_id bigint
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
  from private.get_club_competition_entry_mutation_context(
    p_club_competition_entry_id,
    false
  );

  select jsonb_build_object(
    'entry', jsonb_build_object(
      'id', entry.id,
      'status', entry.status,
      'submitted_at', entry.submitted_at
    ),
    'club', jsonb_build_object(
      'id', club.id,
      'name', club.name,
      'slug', club.slug
    ),
    'competition', jsonb_build_object(
      'id', competition.id,
      'name', competition.name,
      'slug', competition.slug,
      'entry_format', competition.entry_format,
      'team_size', competition.team_size
    ),
    'season', jsonb_build_object(
      'id', season.id,
      'name', season.name,
      'slug', season.slug,
      'status', season.status,
      'entry_opens_at', season.entry_opens_at,
      'entry_closes_at', season.entry_closes_at
    ),
    'organisation', jsonb_build_object(
      'id', organisation.id,
      'name', organisation.name,
      'slug', organisation.slug
    ),
    'entry_window_state', case
      when competition.status = 'published'
        and season.status = 'open'
        and season.entry_opens_at is not null
        and current_date < season.entry_opens_at then 'upcoming'
      when competition.status = 'published'
        and season.status = 'open'
        and season.entry_opens_at is not null
        and season.entry_closes_at is not null
        and current_date between season.entry_opens_at and season.entry_closes_at
        then 'open'
      else 'closed'
    end,
    'database_today', current_date,
    'entrants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', entrant.id,
          'position', entrant.position,
          'participants', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'slot_number', participant.slot_number,
                'membership_id', membership.id,
                'first_name', profile.first_name,
                'last_name', profile.last_name,
                'membership_status', membership.status
              ) order by participant.slot_number
            )
            from public.competition_entrant_participants as participant
            join public.club_memberships as membership
              on membership.id = participant.club_membership_id
            join public.profiles as profile on profile.id = membership.user_id
            where participant.competition_entrant_id = entrant.id
              and participant.club_competition_entry_id = entry.id
          ), '[]'::jsonb)
        ) order by entrant.position
      )
      from public.competition_entrants as entrant
      where entrant.club_competition_entry_id = entry.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.club_competition_entries as entry
  join public.clubs as club on club.id = entry.club_id
  join public.competitions as competition on competition.id = entry.competition_id
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  where entry.id = p_club_competition_entry_id;

  if v_result is null then
    raise exception 'Club competition entry not found.' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

create or replace function public.search_club_competition_entry_members(
  p_club_competition_entry_id bigint,
  p_query text default '',
  p_limit integer default 30
)
returns table (
  membership_id bigint,
  first_name text,
  last_name text,
  club_role text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
begin
  select * into v_context
  from private.get_club_competition_entry_mutation_context(
    p_club_competition_entry_id,
    false
  );

  return query
  select membership.id, profile.first_name, profile.last_name, membership.role
  from public.club_memberships as membership
  join public.profiles as profile on profile.id = membership.user_id
  where membership.club_id = v_context.club_id
    and membership.status = 'active'
    and (
      v_query = ''
      or lower(concat_ws(' ', profile.first_name, profile.last_name)) like '%' || v_query || '%'
      or lower(coalesce(profile.last_name, '')) like v_query || '%'
    )
  order by profile.last_name nulls last, profile.first_name nulls last, membership.id
  limit v_limit;
end;
$$;

create or replace function public.get_my_organisations()
returns table (
  id bigint,
  name text,
  slug text,
  management_role text
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
$$;

comment on function public.start_club_competition_entry(bigint, bigint) is
  'Starts or resumes the unique club submission after exact club-role and authoritative entry-window checks.';
comment on function public.save_club_competition_entry(bigint, jsonb) is
  'Atomically replaces draft entrant composition; selected membership IDs must be unique active members of the exact club.';
comment on function public.submit_club_competition_entry(bigint) is
  'Validates every Individual, Pair, or Team unit against competition configuration before atomically submitting.';
comment on function public.save_and_submit_club_competition_entry(bigint, jsonb) is
  'Atomically replaces and validates the latest composition so an invalid edit cannot partially submit.';
comment on function public.withdraw_club_competition_entry(bigint) is
  'Withdraws the exact club submission before entry close while preserving its durable row and entrant composition.';
comment on function public.get_competition_club_entry_context(bigint) is
  'Returns safe competition entry context for the caller active clubs without exposing another club roster.';
comment on function public.get_club_competition_entries(bigint) is
  'Returns safe active club competition cards: submitted to active members and submitted or draft to active club management; withdrawn rows remain stored but are omitted.';
comment on function public.get_club_competition_entry_management(bigint) is
  'Returns the roster and exact competition configuration only to an active owner or official of the entry club.';
comment on function public.search_club_competition_entry_members(bigint, text, integer) is
  'Searches safe profile-name fields for active members of the exact managed club, capped at 50 results.';
comment on function public.get_my_organisations() is
  'Deduplicates manual follows, active staff access, and submitted competition participation through active club membership.';

revoke execute on function public.start_club_competition_entry(bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.start_club_competition_entry(bigint, bigint)
  to authenticated;

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

revoke execute on function public.withdraw_club_competition_entry(bigint)
  from public, anon, authenticated;
grant execute on function public.withdraw_club_competition_entry(bigint)
  to authenticated;

revoke execute on function public.get_competition_club_entry_context(bigint)
  from public, anon, authenticated;
grant execute on function public.get_competition_club_entry_context(bigint)
  to authenticated;

revoke execute on function public.get_club_competition_entries(bigint)
  from public, anon, authenticated;
grant execute on function public.get_club_competition_entries(bigint)
  to authenticated;

revoke execute on function public.get_club_competition_entry_management(bigint)
  from public, anon, authenticated;
grant execute on function public.get_club_competition_entry_management(bigint)
  to authenticated;

revoke execute on function public.search_club_competition_entry_members(bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_club_competition_entry_members(bigint, text, integer)
  to authenticated;

revoke execute on function public.get_my_organisations()
  from public, anon, authenticated;
grant execute on function public.get_my_organisations()
  to authenticated;

commit;
