-- Canonical fresh-install schema: entries.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."club_competition_entries" (
  "id" bigint generated always as identity not null,
  "competition_id" bigint not null,
  "club_id" bigint not null,
  "status" text default 'draft'::text not null,
  "submitted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."competition_entrant_participants" (
  "id" bigint generated always as identity not null,
  "club_competition_entry_id" bigint not null,
  "competition_entrant_id" bigint not null,
  "club_membership_id" bigint not null,
  "slot_number" integer not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."competition_entrants" (
  "id" bigint generated always as identity not null,
  "club_competition_entry_id" bigint not null,
  "position" integer not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "club_team_id" bigint,
  "club_team_name_snapshot" text
);

CREATE OR REPLACE FUNCTION private.get_club_competition_entry_mutation_context(p_club_competition_entry_id bigint, p_require_open boolean DEFAULT true)
 RETURNS TABLE(actor_id uuid, club_id bigint, competition_id bigint, entry_format text, team_size integer, entry_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_context record;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select entry.club_id, entry.competition_id, competition.entry_format,
    competition.team_size, entry.status,
    competition.status as competition_status,
    season.status as season_status,
    effective.effective_entry_opens_at,
    effective.effective_entry_closes_at
  into v_context
  from public.club_competition_entries as entry
  join public.clubs as club on club.id = entry.club_id
  join public.club_memberships as actor_membership
    on actor_membership.club_id = entry.club_id
   and actor_membership.user_id = v_actor_id
   and actor_membership.status = 'active'
   and actor_membership.role in ('owner', 'official')
  join public.competitions as competition on competition.id = entry.competition_id
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
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
    and v_context.effective_entry_opens_at is not null
    and v_context.effective_entry_closes_at is not null
    and current_date between v_context.effective_entry_opens_at
      and v_context.effective_entry_closes_at
  ) then
    raise exception 'Competition entries are not currently open.' using errcode = '22023';
  end if;

  return query select v_actor_id, v_context.club_id, v_context.competition_id,
    v_context.entry_format, v_context.team_size, v_context.status;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_competition_entry_shape()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.protect_draft_entry_from_archived_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.protect_scored_competition_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if exists (
    select 1
    from public.competition_score_usages as usage
    join public.competition_entrant_participants as participant
      on participant.id = usage.competition_entrant_participant_id
    where participant.club_competition_entry_id = old.id
  ) then
    raise exception 'A Competition entry with recorded scores cannot change submission status.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_entry_participant()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_club_competition_entry_management(p_club_competition_entry_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'team_size', competition.team_size,
      'entry_window_mode', competition.entry_window_mode,
      'effective_entry_opens_at', effective.effective_entry_opens_at,
      'effective_entry_closes_at', effective.effective_entry_closes_at,
      'effective_starts_at', effective.effective_starts_at
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
        and effective.effective_entry_opens_at is not null
        and current_date < effective.effective_entry_opens_at then 'upcoming'
      when competition.status = 'published'
        and season.status = 'open'
        and effective.effective_entry_opens_at is not null
        and effective.effective_entry_closes_at is not null
        and current_date between effective.effective_entry_opens_at
          and effective.effective_entry_closes_at then 'open'
      else 'closed'
    end,
    'database_today', current_date,
    'entrants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', entrant.id,
          'position', entrant.position,
          'club_team_id', entrant.club_team_id,
          'club_team_name_snapshot', entrant.club_team_name_snapshot,
          'entrant_label', private.competition_entrant_label(
            competition.entry_format,
            entrant.position,
            entrant.club_team_name_snapshot
          ),
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
  ) into v_result
  from public.club_competition_entries as entry
  join public.clubs as club on club.id = entry.club_id
  join public.competitions as competition on competition.id = entry.competition_id
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where entry.id = p_club_competition_entry_id;

  if v_result is null then
    raise exception 'Club competition entry not found.' using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_club_entry_context(p_competition_id bigint)
 RETURNS TABLE(club_id bigint, club_name text, club_slug text, club_role text, entry_id bigint, entry_status text, entrant_count bigint, participant_count bigint, is_user_entered boolean, can_manage boolean, entry_window_state text, database_today date)
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
  select club.id, club.name, club.slug, membership.role, entry.id, entry.status,
    coalesce((select count(*) from public.competition_entrants as entrant
      where entrant.club_competition_entry_id = entry.id), 0),
    coalesce((select count(*) from public.competition_entrant_participants as participant
      where participant.club_competition_entry_id = entry.id), 0),
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
        and effective.effective_entry_opens_at is not null
        and current_date < effective.effective_entry_opens_at then 'upcoming'
      when season.status = 'open'
        and effective.effective_entry_opens_at is not null
        and effective.effective_entry_closes_at is not null
        and current_date between effective.effective_entry_opens_at
          and effective.effective_entry_closes_at then 'open'
      else 'closed'
    end,
    current_date
  from public.competitions as competition
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  join public.club_memberships as membership
    on membership.user_id = v_actor_id and membership.status = 'active'
  join public.clubs as club on club.id = membership.club_id and club.status = 'active'
  left join public.club_competition_entries as entry
    on entry.competition_id = competition.id and entry.club_id = club.id
  where competition.id = p_competition_id
    and competition.status = 'published'
    and season.status in ('open', 'active', 'completed')
    and organisation.status = 'active'
    and (membership.role in ('owner', 'official') or entry.status = 'submitted')
  order by club.name, club.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_and_submit_club_competition_entry(p_club_competition_entry_id bigint, p_entrants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.save_club_competition_entry(
    p_club_competition_entry_id,
    p_entrants
  );
  return public.submit_club_competition_entry(p_club_competition_entry_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_club_competition_entry(p_club_competition_entry_id bigint, p_entrants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.search_club_competition_entry_members(p_club_competition_entry_id bigint, p_query text DEFAULT ''::text, p_limit integer DEFAULT 30)
 RETURNS TABLE(membership_id bigint, first_name text, last_name text, club_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.start_club_competition_entry(p_competition_id bigint, p_club_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  select competition.status as competition_status,
    season.status as season_status,
    effective.effective_entry_opens_at,
    effective.effective_entry_closes_at,
    organisation.slug as organisation_slug,
    season.slug as season_slug,
    competition.slug as competition_slug
  into v_context
  from public.competitions as competition
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where competition.id = p_competition_id
    and organisation.status = 'active'
  for share of competition, season, organisation;
  if not found then
    raise exception 'Published competition not found.' using errcode = 'P0002';
  end if;

  if not (
    v_context.competition_status = 'published'
    and v_context.season_status = 'open'
    and v_context.effective_entry_opens_at is not null
    and v_context.effective_entry_closes_at is not null
    and current_date between v_context.effective_entry_opens_at
      and v_context.effective_entry_closes_at
  ) then
    raise exception 'Competition entries are not currently open.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_competition_id::text || ':' || p_club_id::text, 0)
  );

  insert into public.club_competition_entries (
    competition_id, club_id, status, created_by, updated_by
  ) values (
    p_competition_id, p_club_id, 'draft', v_actor_id, v_actor_id
  )
  on conflict (competition_id, club_id) do update
  set status = case when club_competition_entries.status = 'withdrawn' then 'draft'
        else club_competition_entries.status end,
      submitted_at = case when club_competition_entries.status = 'withdrawn' then null
        else club_competition_entries.submitted_at end,
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
$function$;

CREATE OR REPLACE FUNCTION public.submit_club_competition_entry(p_club_competition_entry_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_club_competition_entry(p_club_competition_entry_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;


commit;

