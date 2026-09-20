-- Canonical fresh-install schema: scoring.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."competition_score_usages" (
  "id" bigint generated always as identity not null,
  "shooting_score_source_id" bigint not null,
  "competition_id" bigint not null,
  "competition_round_id" bigint not null,
  "competition_entrant_participant_id" bigint not null,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."shooting_score_sources" (
  "id" bigint generated always as identity not null,
  "shooter_profile_id" uuid not null,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "concurrent_shooting_round_id" bigint,
  "version" bigint default 1 not null
);

create table "public"."shooting_score_values" (
  "id" bigint generated always as identity not null,
  "shooting_score_source_id" bigint not null,
  "set_number" integer not null,
  "component_position" integer not null,
  "achieved_score" numeric(10,2) not null,
  "x_count" integer,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

CREATE OR REPLACE FUNCTION private.protect_scored_competition_component()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_competition_id bigint := coalesce(new.competition_id, old.competition_id);
begin
  if exists (
    select 1
    from public.competition_score_usages as usage
    where usage.competition_id = v_competition_id
  ) then
    raise exception 'Course of Fire score components cannot change after scores have been recorded.'
      using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_scored_competition_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if (new.sets_per_round, new.uses_x_score, new.shots_per_round)
    is not distinct from
    (old.sets_per_round, old.uses_x_score, old.shots_per_round) then
    return new;
  end if;

  if exists (
    select 1
    from public.competition_score_usages as usage
    where usage.competition_id = old.id
  ) then
    raise exception 'Course of Fire and X configuration cannot change after scores have been recorded.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_score_usage()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_source_shooter_id uuid;
  v_participant_shooter_id uuid;
  v_entry_competition_id bigint;
  v_entry_status text;
  v_round_competition_id bigint;
  v_sets_per_round integer;
  v_uses_x_score boolean;
  v_shots_per_round integer;
begin
  select source.shooter_profile_id
  into v_source_shooter_id
  from public.shooting_score_sources as source
  where source.id = new.shooting_score_source_id;

  select membership.user_id, entry.competition_id, entry.status
  into v_participant_shooter_id, v_entry_competition_id, v_entry_status
  from public.competition_entrant_participants as participant
  join public.club_competition_entries as entry
    on entry.id = participant.club_competition_entry_id
  join public.competition_entrants as entrant
    on entrant.id = participant.competition_entrant_id
   and entrant.club_competition_entry_id = participant.club_competition_entry_id
  join public.club_memberships as membership
    on membership.id = participant.club_membership_id
  where participant.id = new.competition_entrant_participant_id;

  select round.competition_id
  into v_round_competition_id
  from public.competition_rounds as round
  where round.id = new.competition_round_id;

  select
    competition.sets_per_round,
    competition.uses_x_score,
    competition.shots_per_round
  into v_sets_per_round, v_uses_x_score, v_shots_per_round
  from public.competitions as competition
  where competition.id = new.competition_id;

  if v_source_shooter_id is null
    or v_participant_shooter_id is null
    or v_sets_per_round is null
    or v_round_competition_id is null then
    raise exception 'Score usage references an unavailable source, participant, Competition, or Round.'
      using errcode = '23503';
  end if;

  if v_source_shooter_id <> v_participant_shooter_id then
    raise exception 'Source score shooter does not match the Competition participant.'
      using errcode = '22023';
  end if;

  if v_entry_competition_id <> new.competition_id
    or v_round_competition_id <> new.competition_id then
    raise exception 'Score usage Competition, Round, entry, and participant do not match.'
      using errcode = '22023';
  end if;

  if v_entry_status <> 'submitted' then
    raise exception 'Only participants in a submitted Competition entry may have score usage.'
      using errcode = '22023';
  end if;

  -- The same source may later be linked to several compatible Competitions.
  -- Positions and maxima define canonical value slots; labels and entry method
  -- do not, because points-scored and points-dropped are UI representations of
  -- the same achieved score.
  if exists (
    select 1
    from public.competition_score_usages as existing_usage
    join public.competitions as existing_competition
      on existing_competition.id = existing_usage.competition_id
    where existing_usage.shooting_score_source_id = new.shooting_score_source_id
      and existing_usage.id <> new.id
      and (
        existing_competition.sets_per_round <> v_sets_per_round
        or exists (
          select existing_component.position, existing_component.maximum_score
          from public.competition_score_components as existing_component
          where existing_component.competition_id = existing_usage.competition_id
          except
          select target_component.position, target_component.maximum_score
          from public.competition_score_components as target_component
          where target_component.competition_id = new.competition_id
        )
        or exists (
          select target_component.position, target_component.maximum_score
          from public.competition_score_components as target_component
          where target_component.competition_id = new.competition_id
          except
          select existing_component.position, existing_component.maximum_score
          from public.competition_score_components as existing_component
          where existing_component.competition_id = existing_usage.competition_id
        )
      )
  ) then
    raise exception 'The source score Course of Fire is not compatible with this Competition.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.shooting_score_values as value
    left join public.competition_score_components as component
      on component.competition_id = new.competition_id
     and component.position = value.component_position
    where value.shooting_score_source_id = new.shooting_score_source_id
      and (
        value.set_number > v_sets_per_round
        or component.id is null
        or value.achieved_score > component.maximum_score
      )
  ) then
    raise exception 'The source score is not compatible with this Competition Course of Fire.'
      using errcode = '22023';
  end if;

  if v_uses_x_score
    and v_shots_per_round is not null
    and (
      select coalesce(sum(value.x_count), 0)
      from public.shooting_score_values as value
      where value.shooting_score_source_id = new.shooting_score_source_id
    ) > v_shots_per_round then
    raise exception 'The source score X total exceeds this Competition shot count.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_shooting_score_value()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1
    from public.competition_score_usages as usage
    where usage.shooting_score_source_id = new.shooting_score_source_id
  ) then
    raise exception 'A source score value requires at least one Competition usage.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.competition_score_usages as usage
    join public.competitions as competition
      on competition.id = usage.competition_id
    left join public.competition_score_components as component
      on component.competition_id = usage.competition_id
     and component.position = new.component_position
    where usage.shooting_score_source_id = new.shooting_score_source_id
      and (
        new.set_number > competition.sets_per_round
        or component.id is null
        or new.achieved_score > component.maximum_score
      )
  ) then
    raise exception 'Source score value is outside a linked Competition Course of Fire.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_shooting_score_x_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1
    from public.competition_score_usages as usage
    join public.competitions as competition
      on competition.id = usage.competition_id
    where usage.shooting_score_source_id = new.shooting_score_source_id
      and competition.uses_x_score
      and competition.shots_per_round is not null
      and (
        select coalesce(sum(value.x_count), 0)
        from public.shooting_score_values as value
        where value.shooting_score_source_id = new.shooting_score_source_id
      ) > competition.shots_per_round
  ) then
    raise exception 'Source score X total exceeds a linked Competition shot count.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;


commit;

