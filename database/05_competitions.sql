-- Canonical fresh-install schema: competitions.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."competition_rounds" (
  "id" bigint generated always as identity not null,
  "competition_id" bigint not null,
  "round_number" integer not null,
  "deadline" date not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "shoot_by_date" date
);

create table "public"."competition_score_components" (
  "id" bigint generated always as identity not null,
  "competition_id" bigint not null,
  "position" integer not null,
  "short_label" text,
  "maximum_score" numeric(10,2) not null,
  "score_method" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "shooting_position_mode" text,
  "shooting_position_code" text,
  "organisation_shooting_position_id" bigint,
  "distance_mode" text,
  "distance_value" numeric(12,3),
  "distance_unit" text,
  "shots" integer
);

create table "public"."competitions" (
  "id" bigint generated always as identity not null,
  "league_season_id" bigint not null,
  "name" text not null,
  "slug" text not null,
  "description" text,
  "status" text default 'draft'::text not null,
  "entry_format" text not null,
  "team_size" integer not null,
  "scoring_method" text not null,
  "maximum_score_per_round" integer,
  "shots_per_round" integer,
  "uses_x_score" boolean default false not null,
  "number_of_rounds" integer not null,
  "entry_fee" numeric(8,2),
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "entry_window_mode" text default 'season_default'::text not null,
  "custom_entry_opens_at" date,
  "custom_entry_closes_at" date,
  "start_date_mode" text default 'season_default'::text not null,
  "custom_starts_at" date,
  "sets_per_round" integer default 1 not null,
  "ranking_method" text default 'aggregate'::text not null,
  "best_rounds_count" integer,
  "local_scoring_enabled" boolean default true not null,
  "competition_series_id" bigint,
  "configuration_source_competition_id" bigint,
  "configuration_source_version" text,
  "discipline_code" text,
  "discipline_detail" text,
  "shooting_details_version" smallint,
  "equipment_type_code" text,
  "organisation_equipment_type_id" bigint
);

CREATE OR REPLACE FUNCTION private.competition_has_participation(p_competition_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    exists (select 1 from public.club_competition_entries where competition_id = p_competition_id)
    or exists (
      select 1 from public.competition_entrants as entrant
      join public.club_competition_entries as entry on entry.id = entrant.club_competition_entry_id
      where entry.competition_id = p_competition_id
    )
    or exists (
      select 1 from public.competition_entrant_participants as participant
      join public.club_competition_entries as entry on entry.id = participant.club_competition_entry_id
      where entry.competition_id = p_competition_id
    )
    or exists (select 1 from public.competition_division_configs where competition_id = p_competition_id)
    or exists (select 1 from public.competition_divisions where competition_id = p_competition_id)
    or exists (select 1 from public.competition_division_assignments where competition_id = p_competition_id)
    or exists (
      select 1
      from public.concurrent_shooting_group_competitions as member
      join public.concurrent_shooting_groups as group_row
        on group_row.id = member.concurrent_shooting_group_id
      where member.competition_id = p_competition_id
        and group_row.status in ('active', 'archived')
    )
$function$;

CREATE OR REPLACE FUNCTION private.get_competition_effective_dates(p_competition_id bigint)
 RETURNS TABLE(effective_entry_opens_at date, effective_entry_closes_at date, effective_starts_at date, season_ends_at date)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    case competition.entry_window_mode
      when 'custom' then competition.custom_entry_opens_at
      else season.entry_opens_at
    end,
    case competition.entry_window_mode
      when 'custom' then competition.custom_entry_closes_at
      else season.entry_closes_at
    end,
    case competition.start_date_mode
      when 'custom' then competition.custom_starts_at
      else season.starts_at
    end,
    season.ends_at
  from public.competitions as competition
  join public.league_seasons as season
    on season.id = competition.league_season_id
  where competition.id = p_competition_id
$function$;

CREATE OR REPLACE FUNCTION private.protect_competition_season_bounds()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_invalid_competition_name text;
  v_invalid_round_number integer;
begin
  if new.entry_opens_at is distinct from old.entry_opens_at
    or new.entry_closes_at is distinct from old.entry_closes_at then
    select competition.name into v_invalid_competition_name
    from public.competitions as competition
    where competition.league_season_id = new.id
      and competition.status = 'published'
      and competition.entry_window_mode = 'season_default'
      and (
        new.entry_opens_at is null
        or new.entry_closes_at is null
        or new.entry_closes_at < new.entry_opens_at
      )
    order by competition.id
    limit 1;

    if v_invalid_competition_name is not null then
      raise exception 'Season default entry dates must remain complete for published Competition "%".',
        v_invalid_competition_name using errcode = '22023';
    end if;
  end if;

  v_invalid_competition_name := null;
  if new.starts_at is distinct from old.starts_at then
    select competition.name into v_invalid_competition_name
    from public.competitions as competition
    where competition.league_season_id = new.id
      and competition.status = 'published'
      and competition.start_date_mode = 'season_default'
      and new.starts_at is null
    order by competition.id
    limit 1;

    if v_invalid_competition_name is not null then
      raise exception 'Season start must remain set for published Competition "%".',
        v_invalid_competition_name using errcode = '22023';
    end if;
  end if;

  v_invalid_competition_name := null;
  select competition.name into v_invalid_competition_name
  from public.competitions as competition
  where competition.league_season_id = new.id
    and competition.status = 'published'
    and competition.ranking_method = 'round_robin'
    and (
      case when competition.entry_window_mode = 'custom'
        then competition.custom_entry_closes_at else new.entry_closes_at end
    ) >= (
      case when competition.start_date_mode = 'custom'
        then competition.custom_starts_at else new.starts_at end
    )
  order by competition.id
  limit 1;

  if v_invalid_competition_name is not null then
    raise exception 'Round Robin Competition "%" requires Competition Start to remain after Entry Close.',
      v_invalid_competition_name using errcode = '22023';
  end if;

  select competition_round.round_number into v_invalid_round_number
  from public.competitions as competition
  join public.competition_rounds as competition_round
    on competition_round.competition_id = competition.id
  where competition.league_season_id = new.id
    and (
      (
        competition.start_date_mode = 'season_default'
        and new.starts_at is not null
        and (
          (competition_round.round_number = 1 and competition_round.deadline <= new.starts_at)
          or (competition_round.round_number > 1 and competition_round.deadline < new.starts_at)
        )
      )
      or (new.ends_at is not null and competition_round.deadline > new.ends_at)
    )
  order by competition.id, competition_round.round_number
  limit 1;

  if v_invalid_round_number is not null then
    raise exception 'Season dates would exclude round % of a configured Competition.',
      v_invalid_round_number using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_published_competition_component()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and (
    new.competition_id, new.position, new.short_label, new.maximum_score,
    new.score_method, new.shooting_position_mode, new.shooting_position_code,
    new.organisation_shooting_position_id, new.distance_mode,
    new.distance_value, new.distance_unit, new.shots
  ) is not distinct from (
    old.competition_id, old.position, old.short_label, old.maximum_score,
    old.score_method, old.shooting_position_mode, old.shooting_position_code,
    old.organisation_shooting_position_id, old.distance_mode,
    old.distance_value, old.distance_unit, old.shots
  ) then
    return new;
  end if;
  perform competition.id from public.competitions competition
  where competition.status = 'published' and competition.id = any(
    case tg_op
      when 'INSERT' then array[new.competition_id]
      when 'DELETE' then array[old.competition_id]
      else array[old.competition_id, new.competition_id]
    end
  ) for share;
  if found then
    raise exception 'Published Competition Course of Fire is locked. Return the Competition to draft before changing it.'
      using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_published_competition_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status = 'published' and (
    new.entry_format, new.team_size, new.sets_per_round, new.shots_per_round,
    new.scoring_method, new.maximum_score_per_round, new.ranking_method,
    new.best_rounds_count, new.uses_x_score, new.number_of_rounds,
    new.shooting_details_version, new.equipment_type_code,
    new.organisation_equipment_type_id
  ) is distinct from (
    old.entry_format, old.team_size, old.sets_per_round, old.shots_per_round,
    old.scoring_method, old.maximum_score_per_round, old.ranking_method,
    old.best_rounds_count, old.uses_x_score, old.number_of_rounds,
    old.shooting_details_version, old.equipment_type_code,
    old.organisation_equipment_type_id
  ) then
    raise exception 'Published Competition sporting configuration is locked. Return the Competition to draft before changing it.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.require_competition_author(p_organisation_id bigint, p_owner_only boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('competition-author:'||p_organisation_id::text,0));
  perform s.id from public.organisation_staff s join public.organisations o on o.id=s.organisation_id
    where o.id=p_organisation_id and o.status='active' and s.user_id=actor and s.status='active'
      and (s.role='owner' or (not p_owner_only and s.role='manager')) for share of s,o;
  if not found then raise exception 'Active contextual Organisation author permission is required.' using errcode='42501'; end if;
  return actor;
end $function$;

CREATE OR REPLACE FUNCTION private.require_competition_lifecycle_owner(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS TABLE(actor_id uuid, organisation_slug text, season_slug text, competition_slug text, competition_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  perform private.require_competition_author(p_organisation_id, true);
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  select
    v_actor_id,
    organisation.slug,
    season.slug,
    competition.slug,
    competition.status
  from public.organisation_staff as staff
  join public.organisations as organisation
    on organisation.id = staff.organisation_id
  join public.league_seasons as season
    on season.organisation_id = organisation.id
  join public.competitions as competition
    on competition.league_season_id = season.id
  where staff.user_id = v_actor_id
    and staff.organisation_id = p_organisation_id
    and staff.role = 'owner'
    and staff.status = 'active'
    and organisation.id = p_organisation_id
    and organisation.status = 'active'
    and season.id = p_league_season_id
    and competition.id = p_competition_id
  for update of staff, organisation, season, competition;

  if not found then
    raise exception 'Only this organisation owner can manage this Competition lifecycle.'
      using errcode = '42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_configuration(p_status text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_effective_entry_opens_at date, p_effective_entry_closes_at date, p_effective_starts_at date, p_season_ends_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_component record;
  v_label text;
  v_maximum_text text;
  v_maximum numeric;
  v_method text;
  v_round_deadlines date[] := coalesce(p_round_deadlines, array[]::date[]);
  v_round_shoot_by_dates date[] := coalesce(p_round_shoot_by_dates, array[]::date[]);
  v_round_number integer;
  v_previous_deadline date;
begin
  if p_status not in ('draft', 'published') then
    raise exception 'Select a valid competition status.' using errcode = '22023';
  end if;

  if p_entry_format not in ('individual', 'pairs', 'team') then
    raise exception 'Select a valid entry format.' using errcode = '22023';
  end if;

  if not (
    (p_entry_format = 'individual' and p_team_size = 1)
    or (p_entry_format = 'pairs' and p_team_size = 2)
    or (p_entry_format = 'team' and p_team_size between 3 and 20)
  ) then
    raise exception 'Team entries must contain between 3 and 20 shooters.'
      using errcode = '22023';
  end if;

  if p_shots_per_round is not null
    and p_shots_per_round not between 1 and 10000 then
    raise exception 'Shots per round must be between 1 and 10,000.'
      using errcode = '22023';
  end if;

  if p_uses_x_score is null then
    raise exception 'Choose whether X scores are recorded.' using errcode = '22023';
  end if;

  if p_number_of_rounds is null or p_number_of_rounds not between 1 and 100 then
    raise exception 'Number of rounds must be between 1 and 100.'
      using errcode = '22023';
  end if;

  if p_entry_fee is not null and (
    p_entry_fee < 0
    or p_entry_fee > 10000
    or p_entry_fee <> round(p_entry_fee, 2)
  ) then
    raise exception 'Entry fee must be between £0 and £10,000 with no more than two decimal places.'
      using errcode = '22023';
  end if;

  if p_entry_window_mode not in ('season_default', 'custom') then
    raise exception 'Select how this competition gets its entry window.'
      using errcode = '22023';
  end if;

  if p_entry_window_mode = 'season_default'
    and (p_custom_entry_opens_at is not null or p_custom_entry_closes_at is not null) then
    raise exception 'Custom entry dates must be empty when using the Season default.'
      using errcode = '22023';
  end if;

  if p_custom_entry_opens_at is not null
    and p_custom_entry_opens_at not between date '1900-01-01' and date '2200-12-31' then
    raise exception 'Entries open must use a supported date.' using errcode = '22023';
  end if;

  if p_custom_entry_closes_at is not null
    and p_custom_entry_closes_at not between date '1900-01-01' and date '2200-12-31' then
    raise exception 'Entries close must use a supported date.' using errcode = '22023';
  end if;

  if p_effective_entry_opens_at is not null
    and p_effective_entry_closes_at is not null
    and p_effective_entry_closes_at < p_effective_entry_opens_at then
    raise exception 'Entries close must be on or after Entries open.'
      using errcode = '22023';
  end if;

  if p_start_date_mode not in ('season_default', 'custom') then
    raise exception 'Select how this competition gets its start date.'
      using errcode = '22023';
  end if;

  if p_start_date_mode = 'season_default' and p_custom_starts_at is not null then
    raise exception 'Custom Competition Start must be empty when using the Season start.'
      using errcode = '22023';
  end if;

  if p_custom_starts_at is not null
    and p_custom_starts_at not between date '1900-01-01' and date '2200-12-31' then
    raise exception 'Competition Start must use a supported date.' using errcode = '22023';
  end if;

  if p_sets_per_round is null or p_sets_per_round not between 1 and 100 then
    raise exception 'Sets per round must be between 1 and 100.'
      using errcode = '22023';
  end if;

  if p_score_components is null or jsonb_typeof(p_score_components) <> 'array' then
    raise exception 'Course of Fire score components must be supplied as a list.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_score_components) > 20 then
    raise exception 'A Course of Fire cannot contain more than 20 score components per set.'
      using errcode = '22023';
  end if;

  for v_component in
    select value, ordinality::integer as position
    from jsonb_array_elements(p_score_components) with ordinality
  loop
    if jsonb_typeof(v_component.value) <> 'object' then
      raise exception 'Course of Fire component % is invalid.', v_component.position
        using errcode = '22023';
    end if;

    v_label := nullif(btrim(coalesce(v_component.value ->> 'short_label', '')), '');
    v_maximum_text := btrim(coalesce(v_component.value ->> 'maximum_score', ''));
    v_method := btrim(coalesce(v_component.value ->> 'score_method', ''));

    if v_label is not null and char_length(v_label) > 30 then
      raise exception 'Course of Fire component % label must be 30 characters or fewer.', v_component.position
        using errcode = '22023';
    end if;

    if v_maximum_text !~ '^[0-9]{1,7}([.][0-9]{1,2})?$' then
      raise exception 'Course of Fire component % needs a valid maximum with up to two decimal places.', v_component.position
        using errcode = '22023';
    end if;
    v_maximum := v_maximum_text::numeric;
    if v_maximum not between 0.01 and 1000000 then
      raise exception 'Course of Fire component % maximum must be between 0.01 and 1,000,000.', v_component.position
        using errcode = '22023';
    end if;

    if v_method not in ('points_scored', 'points_dropped') then
      raise exception 'Course of Fire component % needs a valid scoring method.', v_component.position
        using errcode = '22023';
    end if;
  end loop;

  if p_ranking_method not in ('aggregate', 'best_n_average', 'round_robin', 'gun_score') then
    raise exception 'Select a valid ranking method.' using errcode = '22023';
  end if;

  if p_ranking_method = 'best_n_average' then
    if p_best_rounds_count is null
      or p_best_rounds_count not between 1 and p_number_of_rounds then
      raise exception 'Best rounds count must be between 1 and the number of rounds.'
        using errcode = '22023';
    end if;
    if p_uses_x_score then
      raise exception 'X-based ranking is not currently defined for Best N Average competitions.'
        using errcode = '22023';
    end if;
  elsif p_best_rounds_count is not null then
    raise exception 'Best rounds count must be empty for this ranking method.'
      using errcode = '22023';
  end if;

  if p_local_scoring_enabled is null then
    raise exception 'Select who can enter scores.' using errcode = '22023';
  end if;

  if cardinality(v_round_deadlines) not in (0, p_number_of_rounds)
    or (cardinality(v_round_deadlines) > 0 and array_lower(v_round_deadlines, 1) <> 1) then
    raise exception 'Round End dates must contain either zero items or exactly one position per configured round.'
      using errcode = '22023';
  end if;

  if cardinality(v_round_shoot_by_dates) not in (0, p_number_of_rounds)
    or (cardinality(v_round_shoot_by_dates) > 0 and array_lower(v_round_shoot_by_dates, 1) <> 1) then
    raise exception 'Shoot-by dates must contain either zero items or exactly one position per configured round.'
      using errcode = '22023';
  end if;

  if cardinality(v_round_shoot_by_dates) > 0
    and cardinality(v_round_deadlines) = 0
    and exists (select 1 from unnest(v_round_shoot_by_dates) as supplied(value) where supplied.value is not null) then
    raise exception 'Set a Round End before adding its Shoot-by date.' using errcode = '22023';
  end if;

  if cardinality(v_round_deadlines) > 0 then
    for v_round_number in 1..p_number_of_rounds loop
      if v_round_deadlines[v_round_number] is null then
        if cardinality(v_round_shoot_by_dates) > 0
          and v_round_shoot_by_dates[v_round_number] is not null then
          raise exception 'Round % needs a Round End before its Shoot-by date.', v_round_number
            using errcode = '22023';
        end if;
        continue;
      end if;

      if v_round_deadlines[v_round_number] not between date '1900-01-01' and date '2200-12-31' then
        raise exception 'Round % has an unsupported Round End.', v_round_number
          using errcode = '22023';
      end if;

      if p_effective_starts_at is not null
        and (
          (v_round_number = 1 and v_round_deadlines[v_round_number] <= p_effective_starts_at)
          or (v_round_number > 1 and v_round_deadlines[v_round_number] < p_effective_starts_at)
        ) then
        if v_round_number = 1 then
          raise exception 'Round 1 End must be after the effective Competition Start.'
            using errcode = '22023';
        end if;
        raise exception 'Round % must end on or after the effective Competition Start.', v_round_number
          using errcode = '22023';
      end if;

      if p_season_ends_at is not null
        and v_round_deadlines[v_round_number] > p_season_ends_at then
        raise exception 'Round % must end on or before the Season end.', v_round_number
          using errcode = '22023';
      end if;

      if v_previous_deadline is not null
        and v_round_deadlines[v_round_number] < v_previous_deadline then
        raise exception 'Round End dates cannot move backwards.' using errcode = '22023';
      end if;

      if cardinality(v_round_shoot_by_dates) > 0
        and v_round_shoot_by_dates[v_round_number] is not null then
        if v_round_shoot_by_dates[v_round_number] not between date '1900-01-01' and date '2200-12-31' then
          raise exception 'Round % has an unsupported Shoot-by date.', v_round_number
            using errcode = '22023';
        end if;
        if v_round_shoot_by_dates[v_round_number] > v_round_deadlines[v_round_number] then
          raise exception 'Round % Shoot-by date must be on or before Round End.', v_round_number
            using errcode = '22023';
        end if;
      end if;

      v_previous_deadline := v_round_deadlines[v_round_number];
    end loop;
  end if;

  if p_status = 'published' then
    if p_effective_entry_opens_at is null or p_effective_entry_closes_at is null then
      raise exception 'Set a complete effective Competition entry window before publishing.'
        using errcode = '22023';
    end if;
    if p_effective_starts_at is null then
      raise exception 'Set an effective Competition Start before publishing.'
        using errcode = '22023';
    end if;
    if p_ranking_method = 'round_robin'
      and p_effective_entry_closes_at >= p_effective_starts_at then
      raise exception 'Round Robin requires time to finalise divisions after entries close. Competition Start must be after the Entry Close date.'
        using errcode = '22023';
    end if;
    if jsonb_array_length(p_score_components) = 0 then
      raise exception 'Add at least one Course of Fire score component before publishing.'
        using errcode = '22023';
    end if;
    if p_ranking_method = 'best_n_average' and p_best_rounds_count is null then
      raise exception 'Set how many rounds count for Best N rounds average.'
        using errcode = '22023';
    end if;
    if cardinality(v_round_deadlines) <> p_number_of_rounds
      or exists (select 1 from unnest(v_round_deadlines) as supplied(value) where supplied.value is null) then
      raise exception 'Set a Round End for every configured round before publishing.'
        using errcode = '22023';
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_round()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_number_of_rounds integer;
  v_effective_starts_at date;
  v_season_ends_at date;
begin
  select competition.number_of_rounds,
    effective.effective_starts_at,
    effective.season_ends_at
  into v_number_of_rounds, v_effective_starts_at, v_season_ends_at
  from public.competitions as competition
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where competition.id = new.competition_id;

  if v_number_of_rounds is null then
    raise exception 'Competition not found for round schedule.'
      using errcode = '23503';
  end if;

  if new.round_number > v_number_of_rounds then
    raise exception 'Round number exceeds the competition round count.'
      using errcode = '22023';
  end if;

  if v_effective_starts_at is not null
    and (
      (new.round_number = 1 and new.deadline <= v_effective_starts_at)
      or (new.round_number > 1 and new.deadline < v_effective_starts_at)
    ) then
    if new.round_number = 1 then
      raise exception 'Round 1 End must be after the effective Competition Start.'
        using errcode = '22023';
    end if;
    raise exception 'Round End cannot fall before the effective Competition Start.'
      using errcode = '22023';
  end if;

  if v_season_ends_at is not null and new.deadline > v_season_ends_at then
    raise exception 'Round End cannot fall after the Season end.'
      using errcode = '22023';
  end if;

  if new.shoot_by_date is not null and new.shoot_by_date > new.deadline then
    raise exception 'Shoot-by date cannot fall after Round End.'
      using errcode = '22023';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_final_competition_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_competition_id bigint;
  v_number_of_rounds integer;
  v_effective_starts_at date;
begin
  if tg_table_name = 'competitions' then
    v_competition_id := coalesce(new.id, old.id);
  else
    v_competition_id := coalesce(new.competition_id, old.competition_id);
  end if;

  select competition.number_of_rounds, effective.effective_starts_at
  into v_number_of_rounds, v_effective_starts_at
  from public.competitions as competition
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where competition.id = v_competition_id;

  if v_number_of_rounds is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if exists (
    select 1
    from (
      select round.round_number, round.deadline,
        lag(round.deadline) over (order by round.round_number) as previous_deadline
      from public.competition_rounds as round
      where round.competition_id = v_competition_id
    ) as schedule
    where schedule.round_number > v_number_of_rounds
      or (schedule.previous_deadline is not null and schedule.deadline < schedule.previous_deadline)
      or (
        v_effective_starts_at is not null
        and (
          (schedule.round_number = 1 and schedule.deadline <= v_effective_starts_at)
          or (schedule.round_number > 1 and schedule.deadline < v_effective_starts_at)
        )
      )
  ) then
    raise exception 'The final round schedule is outside the Competition bounds or moves backwards.'
      using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_competition(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if btrim(coalesce(p_scoring_method, '')) not in ('points_scored', 'points_dropped') then
    raise exception 'Select a valid scoring method.' using errcode = '22023';
  end if;

  return public.create_competition(
    p_organisation_id,
    p_league_season_id,
    p_name,
    p_description,
    p_entry_format,
    p_team_size,
    p_shots_per_round,
    p_uses_x_score,
    p_number_of_rounds,
    p_entry_fee,
    'season_default',
    null,
    null,
    'season_default',
    null,
    1,
    case when p_maximum_score_per_round is null then '[]'::jsonb else
      jsonb_build_array(jsonb_build_object(
        'short_label', null,
        'maximum_score', p_maximum_score_per_round::text,
        'score_method', p_scoring_method
      )) end,
    'aggregate',
    null,
    true,
    p_round_deadlines,
    array[]::date[]
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_competition(p_organisation_id bigint, p_league_season_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_entry_format text := btrim(coalesce(p_entry_format, ''));
  v_entry_window_mode text := btrim(coalesce(p_entry_window_mode, ''));
  v_start_date_mode text := btrim(coalesce(p_start_date_mode, ''));
  v_ranking_method text := btrim(coalesce(p_ranking_method, ''));
  v_team_size integer;
  v_components jsonb := coalesce(p_score_components, '[]'::jsonb);
  v_deadlines date[] := coalesce(p_round_deadlines, array[]::date[]);
  v_shoot_by_dates date[] := coalesce(p_round_shoot_by_dates, array[]::date[]);
  v_slug text;
  v_organisation_slug text;
  v_season_slug text;
  v_season_entry_opens_at date;
  v_season_entry_closes_at date;
  v_season_starts_at date;
  v_season_ends_at date;
  v_effective_entry_opens_at date;
  v_effective_entry_closes_at date;
  v_effective_starts_at date;
  v_competition_id bigint;
  v_legacy_method text;
  v_derived_maximum numeric;
begin
  perform private.require_competition_author(p_organisation_id);
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 160 then
    raise exception 'Competition name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Competition description must not exceed 2,000 characters.' using errcode = '22023';
  end if;

  v_team_size := case v_entry_format
    when 'individual' then 1
    when 'pairs' then 2
    else p_team_size
  end;

  select organisation.slug into v_organisation_slug
  from public.organisations as organisation
  where organisation.id = p_organisation_id and organisation.status = 'active'
  for share;
  if v_organisation_slug is null then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  perform staff.id
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and staff.user_id = v_actor_id
    and staff.role in ('owner', 'manager')
    and staff.status = 'active'
  for share;
  if not found then
    raise exception 'Only this organisation owner can create competitions.' using errcode = '42501';
  end if;

  select season.slug, season.entry_opens_at, season.entry_closes_at,
    season.starts_at, season.ends_at
  into v_season_slug, v_season_entry_opens_at, v_season_entry_closes_at,
    v_season_starts_at, v_season_ends_at
  from public.league_seasons as season
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id
  for share;
  if v_season_slug is null then
    raise exception 'Season not found in this organisation.' using errcode = 'P0002';
  end if;

  v_effective_entry_opens_at := case v_entry_window_mode
    when 'custom' then p_custom_entry_opens_at else v_season_entry_opens_at end;
  v_effective_entry_closes_at := case v_entry_window_mode
    when 'custom' then p_custom_entry_closes_at else v_season_entry_closes_at end;
  v_effective_starts_at := case v_start_date_mode
    when 'custom' then p_custom_starts_at else v_season_starts_at end;

  perform private.validate_competition_configuration(
    'draft', v_entry_format, v_team_size, p_shots_per_round, p_uses_x_score,
    p_number_of_rounds, p_entry_fee, v_entry_window_mode,
    p_custom_entry_opens_at, p_custom_entry_closes_at, v_start_date_mode,
    p_custom_starts_at, v_effective_entry_opens_at,
    v_effective_entry_closes_at, v_effective_starts_at, v_season_ends_at,
    p_sets_per_round, v_components, v_ranking_method, p_best_rounds_count,
    p_local_scoring_enabled, v_deadlines, v_shoot_by_dates
  );

  v_slug := lower(regexp_replace(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'));
  if char_length(v_slug) not between 2 and 180 then
    raise exception 'The competition name cannot produce a route-safe web address.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_league_season_id::text || ':' || v_slug, 0)
  );
  if exists (
    select 1 from public.competitions as competition
    where competition.league_season_id = p_league_season_id
      and (competition.slug = v_slug or lower(competition.name) = lower(v_name))
  ) then
    raise exception 'A competition with this name already exists in this Season.' using errcode = '23505';
  end if;

  v_legacy_method := coalesce(v_components -> 0 ->> 'score_method', 'points_dropped');
  select p_sets_per_round * coalesce(sum((component.value ->> 'maximum_score')::numeric), 0)
  into v_derived_maximum
  from jsonb_array_elements(v_components) as component(value);

  insert into public.competitions (
    league_season_id, name, slug, description, status, entry_format, team_size,
    scoring_method, maximum_score_per_round, shots_per_round, uses_x_score,
    number_of_rounds, entry_fee, entry_window_mode, custom_entry_opens_at,
    custom_entry_closes_at, start_date_mode, custom_starts_at, sets_per_round,
    ranking_method, best_rounds_count, local_scoring_enabled, created_by, updated_by
  ) values (
    p_league_season_id, v_name, v_slug, v_description, 'draft', v_entry_format,
    v_team_size, v_legacy_method,
    case when v_derived_maximum between 1 and 1000000
      and v_derived_maximum = trunc(v_derived_maximum)
      then v_derived_maximum::integer else null end,
    p_shots_per_round, p_uses_x_score, p_number_of_rounds, p_entry_fee,
    v_entry_window_mode,
    case when v_entry_window_mode = 'custom' then p_custom_entry_opens_at end,
    case when v_entry_window_mode = 'custom' then p_custom_entry_closes_at end,
    v_start_date_mode,
    case when v_start_date_mode = 'custom' then p_custom_starts_at end,
    p_sets_per_round, v_ranking_method,
    case when v_ranking_method = 'best_n_average' then p_best_rounds_count end,
    p_local_scoring_enabled, v_actor_id, v_actor_id
  ) returning id into v_competition_id;

  insert into public.competition_score_components (
    competition_id, position, short_label, maximum_score, score_method
  )
  select v_competition_id, component.ordinality::integer,
    nullif(btrim(coalesce(component.value ->> 'short_label', '')), ''),
    (component.value ->> 'maximum_score')::numeric,
    component.value ->> 'score_method'
  from jsonb_array_elements(v_components) with ordinality as component(value, ordinality);

  if cardinality(v_deadlines) > 0 then
    insert into public.competition_rounds (
      competition_id, round_number, deadline, shoot_by_date
    )
    select v_competition_id, supplied.ordinality::integer, supplied.deadline,
      case when cardinality(v_shoot_by_dates) > 0
        then v_shoot_by_dates[supplied.ordinality::integer] end
    from unnest(v_deadlines) with ordinality as supplied(deadline, ordinality)
    where supplied.deadline is not null;
  end if;

  return jsonb_build_object(
    'id', v_competition_id,
    'organisation_slug', v_organisation_slug,
    'season_slug', v_season_slug,
    'competition_slug', v_slug,
    'status', 'draft'
  );
exception when unique_violation then
  raise exception 'A competition with this name already exists in this Season.' using errcode = '23505';
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_competition(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
begin
  select * into v_context
  from private.require_competition_lifecycle_owner(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  if private.competition_has_participation(p_competition_id) then
    raise exception 'This competition already has entries or competition participation data and cannot be deleted.'
      using errcode = '22023';
  end if;

  delete from public.competitions as competition
  where competition.id = p_competition_id;

  if not found then
    raise exception 'Competition not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', p_competition_id,
    'organisation_slug', v_context.organisation_slug,
    'season_slug', v_context.season_slug,
    'competition_slug', v_context.competition_slug
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_club_competition_entries(p_club_id bigint)
 RETURNS TABLE(entry_id bigint, entry_status text, submitted_at timestamp with time zone, entry_updated_at timestamp with time zone, competition_id bigint, competition_name text, competition_slug text, entry_format text, team_size integer, league_season_name text, league_season_slug text, league_season_starts_at date, league_season_ends_at date, organisation_name text, organisation_slug text, entrant_count bigint, participant_count bigint, is_user_entered boolean, can_manage boolean, entry_window_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select entry.id, entry.status, entry.submitted_at, entry.updated_at,
    competition.id, competition.name, competition.slug,
    competition.entry_format, competition.team_size,
    season.name, season.slug, effective.effective_starts_at, season.ends_at,
    organisation.name, organisation.slug,
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
        and effective.effective_entry_opens_at is not null
        and current_date < effective.effective_entry_opens_at then 'upcoming'
      when season.status = 'open'
        and effective.effective_entry_opens_at is not null
        and effective.effective_entry_closes_at is not null
        and current_date between effective.effective_entry_opens_at
          and effective.effective_entry_closes_at then 'open'
      else 'closed'
    end
  from public.club_competition_entries as entry
  join public.competitions as competition on competition.id = entry.competition_id
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where entry.club_id = p_club_id
    and organisation.status = 'active'
    and entry.status <> 'withdrawn'
    and (v_role in ('owner', 'official') or entry.status = 'submitted')
  order by effective.effective_starts_at desc nulls last, competition.name, entry.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_lifecycle_state(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
  v_has_participation boolean;
begin
  select * into v_context
  from private.require_competition_lifecycle_owner(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  v_has_participation := private.competition_has_participation(p_competition_id);

  return jsonb_build_object(
    'status', v_context.competition_status,
    'has_participation', v_has_participation,
    'can_return_to_draft',
      v_context.competition_status = 'published' and not v_has_participation,
    'can_delete', not v_has_participation
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_competition(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
  v_configuration record;
  v_components jsonb;
  v_round_deadlines date[];
  v_round_shoot_by_dates date[];
begin
  select * into v_context
  from private.require_competition_lifecycle_owner(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  if v_context.competition_status <> 'draft' then
    raise exception 'Only a draft Competition can be published.'
      using errcode = '22023';
  end if;

  select
    competition.entry_format,
    competition.team_size,
    competition.shots_per_round,
    competition.uses_x_score,
    competition.number_of_rounds,
    competition.entry_fee,
    competition.entry_window_mode,
    competition.custom_entry_opens_at,
    competition.custom_entry_closes_at,
    competition.start_date_mode,
    competition.custom_starts_at,
    competition.sets_per_round,
    competition.ranking_method,
    competition.best_rounds_count,
    competition.local_scoring_enabled,
    effective.effective_entry_opens_at,
    effective.effective_entry_closes_at,
    effective.effective_starts_at,
    effective.season_ends_at
  into v_configuration
  from public.competitions as competition
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where competition.id = p_competition_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'short_label', component.short_label,
        'maximum_score', component.maximum_score,
        'score_method', component.score_method
      ) order by component.position
    ),
    '[]'::jsonb
  )
  into v_components
  from public.competition_score_components as component
  where component.competition_id = p_competition_id;

  select
    coalesce(
      array_agg(round.deadline order by round.round_number),
      array[]::date[]
    ),
    coalesce(
      array_agg(round.shoot_by_date order by round.round_number),
      array[]::date[]
    )
  into v_round_deadlines, v_round_shoot_by_dates
  from public.competition_rounds as round
  where round.competition_id = p_competition_id;

  perform private.validate_competition_configuration(
    'published',
    v_configuration.entry_format,
    v_configuration.team_size,
    v_configuration.shots_per_round,
    v_configuration.uses_x_score,
    v_configuration.number_of_rounds,
    v_configuration.entry_fee,
    v_configuration.entry_window_mode,
    v_configuration.custom_entry_opens_at,
    v_configuration.custom_entry_closes_at,
    v_configuration.start_date_mode,
    v_configuration.custom_starts_at,
    v_configuration.effective_entry_opens_at,
    v_configuration.effective_entry_closes_at,
    v_configuration.effective_starts_at,
    v_configuration.season_ends_at,
    v_configuration.sets_per_round,
    v_components,
    v_configuration.ranking_method,
    v_configuration.best_rounds_count,
    v_configuration.local_scoring_enabled,
    v_round_deadlines,
    v_round_shoot_by_dates
  );

  update public.competitions as competition
  set status = 'published',
      updated_by = v_context.actor_id
  where competition.id = p_competition_id
    and competition.status = 'draft';

  if not found then
    raise exception 'Only a draft Competition can be published.'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', p_competition_id,
    'organisation_slug', v_context.organisation_slug,
    'season_slug', v_context.season_slug,
    'competition_slug', v_context.competition_slug,
    'status', 'published'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_competition_to_draft(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
begin
  select * into v_context
  from private.require_competition_lifecycle_owner(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  if v_context.competition_status <> 'published' then
    raise exception 'Only a published Competition can be returned to draft.'
      using errcode = '22023';
  end if;

  if private.competition_has_participation(p_competition_id) then
    raise exception 'This competition already has entries or competition participation data and cannot be returned to draft.'
      using errcode = '22023';
  end if;

  update public.competitions as competition
  set status = 'draft',
      updated_by = v_context.actor_id
  where competition.id = p_competition_id
    and competition.status = 'published';

  if not found then
    raise exception 'Only a published Competition can be returned to draft.'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', p_competition_id,
    'organisation_slug', v_context.organisation_slug,
    'season_slug', v_context.season_slug,
    'competition_slug', v_context.competition_slug,
    'status', 'draft'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_competition(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_scoring_method text, p_maximum_score_per_round integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_round_deadlines date[], p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if btrim(coalesce(p_scoring_method, '')) not in ('points_scored', 'points_dropped') then
    raise exception 'Select a valid scoring method.' using errcode = '22023';
  end if;

  return public.update_competition(
    p_organisation_id,
    p_league_season_id,
    p_competition_id,
    p_name,
    p_description,
    p_entry_format,
    p_team_size,
    p_shots_per_round,
    p_uses_x_score,
    p_number_of_rounds,
    p_entry_fee,
    'season_default',
    null,
    null,
    'season_default',
    null,
    1,
    case when p_maximum_score_per_round is null then '[]'::jsonb else
      jsonb_build_array(jsonb_build_object(
        'short_label', null,
        'maximum_score', p_maximum_score_per_round::text,
        'score_method', p_scoring_method
      )) end,
    'aggregate',
    null,
    true,
    p_round_deadlines,
    array[]::date[],
    p_status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_competition(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_name text, p_description text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[], p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_entry_format text := btrim(coalesce(p_entry_format, ''));
  v_entry_window_mode text := btrim(coalesce(p_entry_window_mode, ''));
  v_start_date_mode text := btrim(coalesce(p_start_date_mode, ''));
  v_ranking_method text := btrim(coalesce(p_ranking_method, ''));
  v_status text := btrim(coalesce(p_status, ''));
  v_team_size integer;
  v_components jsonb := coalesce(p_score_components, '[]'::jsonb);
  v_deadlines date[] := coalesce(p_round_deadlines, array[]::date[]);
  v_shoot_by_dates date[] := coalesce(p_round_shoot_by_dates, array[]::date[]);
  v_organisation_slug text;
  v_season_slug text;
  v_competition_slug text;
  v_current_status text;
  v_season_entry_opens_at date;
  v_season_entry_closes_at date;
  v_season_starts_at date;
  v_season_ends_at date;
  v_effective_entry_opens_at date;
  v_effective_entry_closes_at date;
  v_effective_starts_at date;
  v_legacy_method text;
  v_derived_maximum numeric;
  v_round_number integer;
begin
  perform private.require_competition_author(p_organisation_id);
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 160 then
    raise exception 'Competition name must contain between 2 and 160 characters.' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 2000 then
    raise exception 'Competition description must not exceed 2,000 characters.' using errcode = '22023';
  end if;

  v_team_size := case v_entry_format
    when 'individual' then 1
    when 'pairs' then 2
    else p_team_size
  end;

  select organisation.slug into v_organisation_slug
  from public.organisations as organisation
  where organisation.id = p_organisation_id and organisation.status = 'active'
  for share;
  if v_organisation_slug is null then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  perform staff.id
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and staff.user_id = v_actor_id
    and staff.role in ('owner', 'manager')
    and staff.status = 'active'
  for share;
  if not found then
    raise exception 'Only this organisation owner can edit competitions.' using errcode = '42501';
  end if;

  select season.slug, season.entry_opens_at, season.entry_closes_at,
    season.starts_at, season.ends_at
  into v_season_slug, v_season_entry_opens_at, v_season_entry_closes_at,
    v_season_starts_at, v_season_ends_at
  from public.league_seasons as season
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id
  for share;
  if v_season_slug is null then
    raise exception 'Season not found in this organisation.' using errcode = 'P0002';
  end if;

  select competition.slug, competition.status
  into v_competition_slug, v_current_status
  from public.competitions as competition
  where competition.id = p_competition_id
    and competition.league_season_id = p_league_season_id
  for update;
  if v_competition_slug is null then
    raise exception 'Competition not found in this Season.' using errcode = 'P0002';
  end if;

  if v_current_status <> 'draft' or v_status <> 'draft' then
    perform private.require_competition_author(p_organisation_id, true);
  end if;

  if v_status <> v_current_status
    and not (v_current_status = 'draft' and v_status = 'published') then
    raise exception 'A competition may only move from draft to published.' using errcode = '22023';
  end if;

  v_effective_entry_opens_at := case v_entry_window_mode
    when 'custom' then p_custom_entry_opens_at else v_season_entry_opens_at end;
  v_effective_entry_closes_at := case v_entry_window_mode
    when 'custom' then p_custom_entry_closes_at else v_season_entry_closes_at end;
  v_effective_starts_at := case v_start_date_mode
    when 'custom' then p_custom_starts_at else v_season_starts_at end;

  perform private.validate_competition_configuration(
    v_status, v_entry_format, v_team_size, p_shots_per_round, p_uses_x_score,
    p_number_of_rounds, p_entry_fee, v_entry_window_mode,
    p_custom_entry_opens_at, p_custom_entry_closes_at, v_start_date_mode,
    p_custom_starts_at, v_effective_entry_opens_at,
    v_effective_entry_closes_at, v_effective_starts_at, v_season_ends_at,
    p_sets_per_round, v_components, v_ranking_method, p_best_rounds_count,
    p_local_scoring_enabled, v_deadlines, v_shoot_by_dates
  );

  if exists (
    select 1 from public.competitions as other_competition
    where other_competition.league_season_id = p_league_season_id
      and other_competition.id <> p_competition_id
      and lower(other_competition.name) = lower(v_name)
  ) then
    raise exception 'A competition with this name already exists in this Season.' using errcode = '23505';
  end if;

  v_legacy_method := coalesce(v_components -> 0 ->> 'score_method', 'points_dropped');
  select p_sets_per_round * coalesce(sum((component.value ->> 'maximum_score')::numeric), 0)
  into v_derived_maximum
  from jsonb_array_elements(v_components) as component(value);

  update public.competitions as competition
  set name = v_name,
      description = v_description,
      entry_format = v_entry_format,
      team_size = v_team_size,
      scoring_method = v_legacy_method,
      maximum_score_per_round = case
        when v_derived_maximum between 1 and 1000000
          and v_derived_maximum = trunc(v_derived_maximum)
        then v_derived_maximum::integer else null end,
      shots_per_round = p_shots_per_round,
      uses_x_score = p_uses_x_score,
      number_of_rounds = p_number_of_rounds,
      entry_fee = p_entry_fee,
      entry_window_mode = v_entry_window_mode,
      custom_entry_opens_at = case when v_entry_window_mode = 'custom' then p_custom_entry_opens_at end,
      custom_entry_closes_at = case when v_entry_window_mode = 'custom' then p_custom_entry_closes_at end,
      start_date_mode = v_start_date_mode,
      custom_starts_at = case when v_start_date_mode = 'custom' then p_custom_starts_at end,
      sets_per_round = p_sets_per_round,
      ranking_method = v_ranking_method,
      best_rounds_count = case when v_ranking_method = 'best_n_average' then p_best_rounds_count end,
      local_scoring_enabled = p_local_scoring_enabled,
      updated_by = v_actor_id
  where competition.id = p_competition_id;

  -- Upsert by position so unchanged round and component rows retain their IDs.
  insert into public.competition_score_components (
    competition_id, position, short_label, maximum_score, score_method
  )
  select p_competition_id, component.ordinality::integer,
    nullif(btrim(coalesce(component.value ->> 'short_label', '')), ''),
    (component.value ->> 'maximum_score')::numeric,
    component.value ->> 'score_method'
  from jsonb_array_elements(v_components) with ordinality as component(value, ordinality)
  -- Filter before INSERT: BEFORE INSERT score guards also run for ON CONFLICT.
  where not exists (
    select 1 from public.competition_score_components existing
    where existing.competition_id=p_competition_id and existing.position=component.ordinality
      and (existing.short_label,existing.maximum_score,existing.score_method) is not distinct from
        (nullif(btrim(coalesce(component.value->>'short_label','')),''),
         (component.value->>'maximum_score')::numeric,component.value->>'score_method')
  )
  on conflict (competition_id, position) do update
  set short_label = excluded.short_label,
      maximum_score = excluded.maximum_score,
      score_method = excluded.score_method
  where (competition_score_components.short_label, competition_score_components.maximum_score, competition_score_components.score_method)
    is distinct from (excluded.short_label, excluded.maximum_score, excluded.score_method);

  delete from public.competition_score_components as component
  where component.competition_id = p_competition_id
    and component.position > jsonb_array_length(v_components);

  if cardinality(v_deadlines) = 0 then
    delete from public.competition_rounds as round
    where round.competition_id = p_competition_id;
  else
    for v_round_number in 1..p_number_of_rounds loop
      if v_deadlines[v_round_number] is null then
        delete from public.competition_rounds as round
        where round.competition_id = p_competition_id
          and round.round_number = v_round_number;
      else
        insert into public.competition_rounds (
          competition_id, round_number, deadline, shoot_by_date
        ) values (
          p_competition_id,
          v_round_number,
          v_deadlines[v_round_number],
          case when cardinality(v_shoot_by_dates) > 0
            then v_shoot_by_dates[v_round_number] end
        )
        on conflict (competition_id, round_number) do update
        set deadline = excluded.deadline,
            shoot_by_date = excluded.shoot_by_date;
      end if;
    end loop;

    delete from public.competition_rounds as round
    where round.competition_id = p_competition_id
      and round.round_number > p_number_of_rounds;
  end if;

  perform private.sync_provisional_competition_series(p_competition_id);

  if v_status = 'published' and v_current_status = 'draft' then
    update public.competitions as competition
    set status = 'published', updated_by = v_actor_id
    where competition.id = p_competition_id;
  end if;

  return jsonb_build_object(
    'id', p_competition_id,
    'organisation_slug', v_organisation_slug,
    'season_slug', v_season_slug,
    'competition_slug', v_competition_slug,
    'status', v_status
  );
exception when unique_violation then
  raise exception 'A competition with this name already exists in this Season.' using errcode = '23505';
end;
$function$;


commit;

