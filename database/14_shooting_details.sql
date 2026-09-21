-- Canonical fresh-install schema: shooting details.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."organisation_equipment_types" (
  "id" bigint generated always as identity not null,
  "organisation_id" bigint not null,
  "display_name" text not null,
  "normalized_name" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid
);

create table "public"."organisation_shooting_positions" (
  "id" bigint generated always as identity not null,
  "organisation_id" bigint not null,
  "display_name" text not null,
  "normalized_name" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid
);

create table "public"."shooting_equipment_types" (
  "code" text not null,
  "display_name" text not null,
  "sort_order" smallint not null
);

create table "public"."shooting_positions" (
  "code" text not null,
  "display_name" text not null,
  "sort_order" smallint not null
);

CREATE OR REPLACE FUNCTION private.apply_competition_shooting_details(p_organisation_id bigint, p_competition_id bigint, p_configuration jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  equipment_code text := nullif(btrim(p_configuration ->> 'equipment_type_code'), '');
  custom_equipment_id bigint;
  custom_equipment_text text := nullif(btrim(p_configuration ->> 'organisation_equipment_type_id'), '');
  custom_equipment_name text := nullif(
    private.clean_shooting_term(coalesce(p_configuration ->> 'custom_equipment_type_name', '')), ''
  );
  components jsonb := coalesce(p_configuration -> 'score_components', '[]'::jsonb);
  component record;
  v_position_mode text;
  v_position_code text;
  v_custom_position_id bigint;
  v_custom_position_text text;
  v_custom_position_name text;
  v_distance_mode text;
  v_distance_text text;
  v_distance_value numeric(12, 3);
  v_distance_unit text;
  v_shots_text text;
  v_component_shots integer;
  derived_shots bigint;
begin
  perform private.require_competition_author(p_organisation_id);
  if p_configuration is null or jsonb_typeof(p_configuration) <> 'object'
    or p_configuration ->> 'shooting_details_version' <> '1' then
    raise exception 'Structured shooting details version 1 is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.competitions competition
    join public.league_seasons season on season.id = competition.league_season_id
    where competition.id = p_competition_id and season.organisation_id = p_organisation_id
  ) then
    raise exception 'Competition not found in this Organisation.' using errcode = 'P0002';
  end if;
  if equipment_code is not null and (custom_equipment_text is not null or custom_equipment_name is not null) then
    raise exception 'Choose one equipment type.' using errcode = '22023';
  end if;
  if custom_equipment_text is not null then
    if custom_equipment_text !~ '^[1-9][0-9]*$' then
      raise exception 'Choose a valid custom equipment type.' using errcode = '22023';
    end if;
    custom_equipment_id := custom_equipment_text::bigint;
  end if;
  if equipment_code is not null and not exists (
    select 1 from public.shooting_equipment_types where code = equipment_code
  ) then
    raise exception 'Choose a valid equipment type.' using errcode = '22023';
  end if;
  if equipment_code is null then
    custom_equipment_id := private.resolve_organisation_equipment_type(
      p_organisation_id, custom_equipment_id, custom_equipment_name
    );
  end if;

  update public.competitions
  set shooting_details_version = 1,
      equipment_type_code = equipment_code,
      organisation_equipment_type_id = custom_equipment_id,
      updated_by = (select auth.uid())
  where id = p_competition_id;

  if jsonb_typeof(components) <> 'array' then
    raise exception 'Course of Fire score components must be supplied as a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(components) <> (
    select count(*) from public.competition_score_components where competition_id = p_competition_id
  ) then
    raise exception 'Physical shooting details must match every Course of Fire component.' using errcode = '22023';
  end if;

  for component in
    select value, ordinality::integer as position
    from jsonb_array_elements(components) with ordinality
  loop
    v_position_mode := nullif(btrim(component.value ->> 'shooting_position_mode'), '');
    v_position_code := nullif(btrim(component.value ->> 'shooting_position_code'), '');
    v_custom_position_text := nullif(btrim(component.value ->> 'organisation_shooting_position_id'), '');
    v_custom_position_name := nullif(
      private.clean_shooting_term(coalesce(component.value ->> 'custom_shooting_position_name', '')), ''
    );
    v_custom_position_id := null;
    if v_custom_position_text is not null then
      if v_custom_position_text !~ '^[1-9][0-9]*$' then
        raise exception 'Score % needs a valid custom position.', component.position using errcode = '22023';
      end if;
      v_custom_position_id := v_custom_position_text::bigint;
    end if;
    if v_position_mode is null then
      if v_position_code is not null or v_custom_position_id is not null or v_custom_position_name is not null then
        raise exception 'Score % position/style state is incomplete.', component.position using errcode = '22023';
      end if;
    elsif v_position_mode = 'fixed' then
      if v_position_code is not null and (v_custom_position_id is not null or v_custom_position_name is not null) then
        raise exception 'Score % must use one position/style.', component.position using errcode = '22023';
      end if;
      if v_position_code is not null then
        if not exists (select 1 from public.shooting_positions where code = v_position_code) then
          raise exception 'Score % needs a valid position/style.', component.position using errcode = '22023';
        end if;
      else
        v_custom_position_id := private.resolve_organisation_shooting_position(
          p_organisation_id, v_custom_position_id, v_custom_position_name
        );
        if v_custom_position_id is null then
          raise exception 'Score % needs a position/style.', component.position using errcode = '22023';
        end if;
      end if;
    elsif v_position_mode in ('variable', 'not_applicable') then
      if v_position_code is not null or v_custom_position_id is not null or v_custom_position_name is not null then
        raise exception 'Score % cannot combine this position/style state with a named position.', component.position using errcode = '22023';
      end if;
    else
      raise exception 'Score % needs a valid position/style state.', component.position using errcode = '22023';
    end if;

    v_distance_mode := nullif(btrim(component.value ->> 'distance_mode'), '');
    v_distance_text := nullif(btrim(component.value ->> 'distance_value'), '');
    v_distance_unit := nullif(btrim(component.value ->> 'distance_unit'), '');
    v_distance_value := null;
    if v_distance_mode is null then
      if v_distance_text is not null or v_distance_unit is not null then
        raise exception 'Score % distance state is incomplete.', component.position using errcode = '22023';
      end if;
    elsif v_distance_mode = 'fixed' then
      if v_distance_text is null or v_distance_text !~ '^[0-9]+([.][0-9]{1,3})?$' then
        raise exception 'Score % needs a positive fixed distance with up to three decimal places.', component.position using errcode = '22023';
      end if;
      v_distance_value := v_distance_text::numeric;
      if v_distance_value <= 0 or v_distance_value > 100000 then
        raise exception 'Score % fixed distance must be greater than zero and no more than 100,000.', component.position using errcode = '22023';
      end if;
      if v_distance_unit not in ('metres', 'yards', 'feet') then
        raise exception 'Score % needs a valid distance unit.', component.position using errcode = '22023';
      end if;
    elsif v_distance_mode in ('variable', 'not_applicable') then
      if v_distance_text is not null or v_distance_unit is not null then
        raise exception 'Score % cannot combine this distance state with a fixed value or unit.', component.position using errcode = '22023';
      end if;
    else
      raise exception 'Score % needs a valid distance state.', component.position using errcode = '22023';
    end if;

    v_shots_text := nullif(btrim(component.value ->> 'shots'), '');
    v_component_shots := null;
    if v_shots_text is not null then
      if v_shots_text !~ '^[1-9][0-9]*$' or v_shots_text::numeric > 10000 then
        raise exception 'Score % Shots must be a whole number between 1 and 10,000.', component.position using errcode = '22023';
      end if;
      v_component_shots := v_shots_text::integer;
    end if;

    update public.competition_score_components
    set shooting_position_mode = v_position_mode,
        shooting_position_code = v_position_code,
        organisation_shooting_position_id = v_custom_position_id,
        distance_mode = v_distance_mode,
        distance_value = v_distance_value,
        distance_unit = v_distance_unit,
        shots = v_component_shots
    where competition_id = p_competition_id and position = component.position;
  end loop;

  if jsonb_array_length(components) = 0 or exists (
    select 1 from public.competition_score_components
    where competition_id = p_competition_id and shots is null
  ) then
    derived_shots := null;
  else
    select competition.sets_per_round * sum(stored_component.shots)::bigint
    into derived_shots
    from public.competitions competition
    join public.competition_score_components stored_component
      on stored_component.competition_id = competition.id
    where competition.id = p_competition_id
    group by competition.sets_per_round;
    if derived_shots > 10000 then
      raise exception 'Derived shots per Round must not exceed 10,000.' using errcode = '22023';
    end if;
  end if;
  update public.competitions
  set shots_per_round = derived_shots::integer, updated_by = (select auth.uid())
  where id = p_competition_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.clean_shooting_term(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select pg_catalog.regexp_replace(pg_catalog.btrim(p_value), '[[:space:]]+', ' ', 'g')
$function$;

CREATE OR REPLACE FUNCTION private.competition_components(p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'short_label', component.short_label,
    'maximum_score', component.maximum_score,
    'score_method', component.score_method,
    'shooting_position_mode', component.shooting_position_mode,
    'shooting_position_code', component.shooting_position_code,
    'organisation_shooting_position_id', component.organisation_shooting_position_id,
    'distance_mode', component.distance_mode,
    'distance_value', component.distance_value,
    'distance_unit', component.distance_unit,
    'shots', component.shots
  ) order by component.position), '[]'::jsonb)
  from public.competition_score_components component
  where component.competition_id = p_competition_id
$function$;

CREATE OR REPLACE FUNCTION private.competition_has_complete_shooting_details(p_competition_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select competition.shooting_details_version = 1
    and ((competition.equipment_type_code is not null)::integer
      + (competition.organisation_equipment_type_id is not null)::integer) = 1
    and exists (
      select 1 from public.competition_score_components component
      where component.competition_id = competition.id
    )
    and not exists (
      select 1
      from public.competition_score_components component
      where component.competition_id = competition.id
        and (component.shooting_position_mode is null
          or component.distance_mode is null
          or component.shots is null)
    )
  from public.competitions competition
  where competition.id = p_competition_id
$function$;

CREATE OR REPLACE FUNCTION private.competition_series_components(p_series_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'short_label', component.short_label,
    'maximum_score', component.maximum_score,
    'score_method', component.score_method,
    'shooting_position_mode', component.shooting_position_mode,
    'shooting_position_code', component.shooting_position_code,
    'organisation_shooting_position_id', component.organisation_shooting_position_id,
    'distance_mode', component.distance_mode,
    'distance_value', component.distance_value,
    'distance_unit', component.distance_unit,
    'shots', component.shots
  ) order by component.position), '[]'::jsonb)
  from public.competition_series_score_components component
  where component.competition_series_id = p_series_id
$function$;

CREATE OR REPLACE FUNCTION private.normalise_shooting_term(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select pg_catalog.lower(private.clean_shooting_term(p_value))
$function$;

CREATE OR REPLACE FUNCTION private.resolve_organisation_equipment_type(p_organisation_id bigint, p_existing_id bigint, p_new_name text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cleaned text := nullif(private.clean_shooting_term(coalesce(p_new_name, '')), '');
  normalized text;
  result bigint;
begin
  if p_existing_id is not null and cleaned is not null then
    raise exception 'Choose an existing custom equipment type or create a new one, not both.'
      using errcode = '22023';
  end if;
  if p_existing_id is not null then
    select id into result
    from public.organisation_equipment_types
    where id = p_existing_id and organisation_id = p_organisation_id;
    if result is null then
      raise exception 'Custom equipment type was not found in this Organisation.'
        using errcode = '22023';
    end if;
    return result;
  end if;
  if cleaned is null then return null; end if;
  if char_length(cleaned) not between 2 and 80 then
    raise exception 'Custom equipment type must contain between 2 and 80 characters.'
      using errcode = '22023';
  end if;
  normalized := private.normalise_shooting_term(cleaned);
  insert into public.organisation_equipment_types(
    organisation_id, display_name, normalized_name, created_by
  ) values (
    p_organisation_id, cleaned, normalized, (select auth.uid())
  ) on conflict (organisation_id, normalized_name) do nothing
  returning id into result;
  if result is null then
    select id into result
    from public.organisation_equipment_types
    where organisation_id = p_organisation_id and normalized_name = normalized;
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.resolve_organisation_shooting_position(p_organisation_id bigint, p_existing_id bigint, p_new_name text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cleaned text := nullif(private.clean_shooting_term(coalesce(p_new_name, '')), '');
  normalized text;
  result bigint;
begin
  if p_existing_id is not null and cleaned is not null then
    raise exception 'Choose an existing custom position or create a new one, not both.'
      using errcode = '22023';
  end if;
  if p_existing_id is not null then
    select id into result
    from public.organisation_shooting_positions
    where id = p_existing_id and organisation_id = p_organisation_id;
    if result is null then
      raise exception 'Custom shooting position was not found in this Organisation.'
        using errcode = '22023';
    end if;
    return result;
  end if;
  if cleaned is null then return null; end if;
  if char_length(cleaned) not between 2 and 80 then
    raise exception 'Custom position/style must contain between 2 and 80 characters.'
      using errcode = '22023';
  end if;
  normalized := private.normalise_shooting_term(cleaned);
  insert into public.organisation_shooting_positions(
    organisation_id, display_name, normalized_name, created_by
  ) values (
    p_organisation_id, cleaned, normalized, (select auth.uid())
  ) on conflict (organisation_id, normalized_name) do nothing
  returning id into result;
  if result is null then
    select id into result
    from public.organisation_shooting_positions
    where organisation_id = p_organisation_id and normalized_name = normalized;
  end if;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_shooting_details(p_competition_id bigint, p_require_complete boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  competition_record record;
  derived_shots bigint;
begin
  select competition.*, season.organisation_id
  into competition_record
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id;
  if not found then return; end if;

  if competition_record.shooting_details_version is null then
    return;
  end if;
  if competition_record.shooting_details_version <> 1 then
    raise exception 'Unsupported structured shooting details version.' using errcode = '22023';
  end if;
  if competition_record.organisation_equipment_type_id is not null and not exists (
    select 1 from public.organisation_equipment_types custom_equipment
    where custom_equipment.id = competition_record.organisation_equipment_type_id
      and custom_equipment.organisation_id = competition_record.organisation_id
  ) then
    raise exception 'Custom equipment type must belong to the Competition Organisation.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.competition_score_components component
    join public.organisation_shooting_positions custom_position
      on custom_position.id = component.organisation_shooting_position_id
    where component.competition_id = p_competition_id
      and custom_position.organisation_id <> competition_record.organisation_id
  ) then
    raise exception 'Custom shooting positions must belong to the Competition Organisation.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.competition_score_components component
    where component.competition_id = p_competition_id and component.shots is null
  ) or not exists (
    select 1 from public.competition_score_components component
    where component.competition_id = p_competition_id
  ) then
    derived_shots := null;
  else
    select competition_record.sets_per_round * sum(component.shots)::bigint
    into derived_shots
    from public.competition_score_components component
    where component.competition_id = p_competition_id;
    if derived_shots > 10000 then
      raise exception 'Derived shots per Round must not exceed 10,000.' using errcode = '22023';
    end if;
  end if;
  if competition_record.shots_per_round is distinct from derived_shots::integer then
    raise exception 'Shots per Round must be derived from sets and component shots.'
      using errcode = '22023';
  end if;

  if p_require_complete then
    if not private.competition_has_complete_shooting_details(p_competition_id) then
      raise exception 'Physical shooting details required: choose equipment and complete position/style, distance, and Shots for every score component.'
        using errcode = '22023';
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_final_competition_shooting_details()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_competition_id bigint;
  competition_status text;
begin
  if tg_table_name = 'competitions' then
    target_competition_id := coalesce(new.id, old.id);
  else
    target_competition_id := case when tg_op = 'DELETE'
      then old.competition_id else new.competition_id end;
    if tg_op = 'UPDATE' and new.competition_id is distinct from old.competition_id then
      perform private.validate_competition_shooting_details(
        old.competition_id,
        (select status = 'published' from public.competitions where id = old.competition_id)
      );
    end if;
  end if;
  select status into competition_status
  from public.competitions where id = target_competition_id;
  if competition_status is not null then
    perform private.validate_competition_shooting_details(
      target_competition_id, competition_status = 'published'
    );
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_competition_with_shooting_details(p_organisation_id bigint, p_league_season_id bigint, p_configuration jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_configuration ->> 'shooting_details_version' <> '1' then
    raise exception 'Structured shooting details version 1 is required.' using errcode = '22023';
  end if;
  return private.save_series_competition(
    p_organisation_id, p_league_season_id, p_configuration
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_shooting_display(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  competition_record public.competitions%rowtype;
  result jsonb;
begin
  select competition.* into competition_record
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  join public.organisations organisation on organisation.id = season.organisation_id
  where competition.id = p_competition_id
    and competition.league_season_id = p_league_season_id
    and season.organisation_id = p_organisation_id
    and (
      (organisation.status = 'active'
        and season.status in ('open', 'active', 'completed')
        and competition.status = 'published')
      or exists (
        select 1 from public.organisation_staff staff
        where staff.organisation_id = organisation.id
          and staff.user_id = (select auth.uid())
          and staff.role in ('owner', 'manager')
          and staff.status = 'active'
      )
    );
  if not found then
    raise exception 'Competition shooting details are not available.' using errcode = '42501';
  end if;

  if competition_record.shooting_details_version is distinct from 1 then
    return jsonb_build_object(
      'configured', false, 'equipment_name', null, 'components', '[]'::jsonb
    );
  end if;

  select jsonb_build_object(
    'configured', true,
    'equipment_name', coalesce(built_in_equipment.display_name, custom_equipment.display_name),
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'component_id', component.id,
        'position_mode', component.shooting_position_mode,
        'position_name', case component.shooting_position_mode
          when 'fixed' then coalesce(built_in_position.display_name, custom_position.display_name)
          when 'variable' then 'Variable'
          when 'not_applicable' then 'Not applicable'
          else null
        end,
        'distance_mode', component.distance_mode,
        'distance_value', component.distance_value,
        'distance_unit', component.distance_unit,
        'shots', component.shots
      ) order by component.position)
      from public.competition_score_components component
      left join public.shooting_positions built_in_position
        on built_in_position.code = component.shooting_position_code
      left join public.organisation_shooting_positions custom_position
        on custom_position.id = component.organisation_shooting_position_id
      where component.competition_id = competition_record.id
    ), '[]'::jsonb)
  ) into result
  from (select competition_record.equipment_type_code code) selected_equipment
  left join public.shooting_equipment_types built_in_equipment
    on built_in_equipment.code = selected_equipment.code
  left join public.organisation_equipment_types custom_equipment
    on custom_equipment.id = competition_record.organisation_equipment_type_id;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_publish_readiness(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  competition_record record;
  components jsonb;
  round_deadlines date[];
  requirements text[];
begin
  perform private.require_competition_author(p_organisation_id, false);

  select competition.*,
    effective.effective_entry_opens_at,
    effective.effective_entry_closes_at,
    effective.effective_starts_at
  into competition_record
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  cross join lateral private.get_competition_effective_dates(competition.id) effective
  where competition.id = p_competition_id
    and competition.league_season_id = p_league_season_id
    and season.organisation_id = p_organisation_id;

  if not found then
    raise exception 'Competition not found in this Organisation and Season.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'short_label', component.short_label,
    'maximum_score', component.maximum_score,
    'score_method', component.score_method
  ) order by component.position), '[]'::jsonb)
  into components
  from public.competition_score_components component
  where component.competition_id = p_competition_id;

  select coalesce(array_agg(round.deadline order by round.round_number), array[]::date[])
  into round_deadlines
  from public.competition_rounds round
  where round.competition_id = p_competition_id;

  requirements := private.competition_publication_readiness_errors(
    competition_record.effective_entry_opens_at,
    competition_record.effective_entry_closes_at,
    competition_record.effective_starts_at,
    competition_record.ranking_method,
    components,
    competition_record.best_rounds_count,
    competition_record.number_of_rounds,
    round_deadlines
  );

  if competition_record.shooting_details_version is not null
    and not private.competition_has_complete_shooting_details(p_competition_id) then
    requirements := array_prepend(
      'Choose equipment and complete position/style, distance, and Shots for every Course of Fire component.',
      requirements
    );
  end if;

  return jsonb_build_object(
    'status', competition_record.status,
    'requirements', to_jsonb(requirements),
    'ready', cardinality(requirements) = 0
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_competition_shooting_details_draft(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_configuration jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_configuration ->> 'shooting_details_version' <> '1' then
    raise exception 'Structured shooting details version 1 is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.competitions competition
    join public.league_seasons season on season.id = competition.league_season_id
    where competition.id = p_competition_id
      and season.id = p_league_season_id
      and season.organisation_id = p_organisation_id
      and competition.status = 'draft'
  ) then
    raise exception 'Only a draft Competition can update physical shooting details.'
      using errcode = '22023';
  end if;
  return private.save_series_competition(
    p_organisation_id, p_league_season_id, p_configuration, p_competition_id
  );
end;
$function$;


commit;

