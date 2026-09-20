-- Canonical fresh-install schema: series.
-- Contains final current definitions only; historical upgrades live under database/upgrades/.

begin;
set local check_function_bodies = false;

create table "public"."competition_series" (
  "id" bigint generated always as identity not null,
  "organisation_id" bigint not null,
  "name" text not null,
  "slug" text not null,
  "archived_at" timestamp with time zone,
  "entry_format" text not null,
  "team_size" integer not null,
  "discipline_code" text,
  "discipline_detail" text,
  "sets_per_round" integer not null,
  "shots_per_round" integer,
  "identity_locked_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid,
  "updated_by" uuid,
  "shooting_details_version" smallint,
  "equipment_type_code" text,
  "organisation_equipment_type_id" bigint
);

create table "public"."competition_series_score_components" (
  "competition_series_id" bigint not null,
  "position" integer not null,
  "short_label" text,
  "maximum_score" numeric(10,2) not null,
  "score_method" text not null,
  "shooting_position_mode" text,
  "shooting_position_code" text,
  "organisation_shooting_position_id" bigint,
  "distance_mode" text,
  "distance_value" numeric(12,3),
  "distance_unit" text,
  "shots" integer
);

CREATE OR REPLACE FUNCTION private.check_competition_configuration_keys(p_values jsonb, p_identity boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_values) key
    where key <> all(array[
      'name','description','entry_fee','entry_window_mode','custom_entry_opens_at','custom_entry_closes_at',
      'start_date_mode','custom_starts_at','ranking_method','best_rounds_count','uses_x_score',
      'local_scoring_enabled','number_of_rounds','round_deadlines','round_shoot_by_dates'] ||
      case when p_identity then array[
        'entry_format','team_size','sets_per_round','shots_per_round','score_components',
        'discipline_code','discipline_detail','shooting_details_version',
        'equipment_type_code','organisation_equipment_type_id','custom_equipment_type_name'
      ] else array[]::text[] end)
  ) then
    raise exception 'Unsupported Competition configuration fields.' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_series_final_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sid bigint; cid bigint;
begin
  if tg_table_name='competition_series' then sid:=case when tg_op='DELETE' then old.id else new.id end;
  elsif tg_table_name='competition_score_components' then
    if tg_op='UPDATE' and new.competition_id is distinct from old.competition_id then
      select competition_series_id into sid from public.competitions where id=old.competition_id;
      if sid is not null then perform private.validate_competition_series(sid); end if;
    end if;
    cid:=case when tg_op='DELETE' then old.competition_id else new.competition_id end;
    select competition_series_id into sid from public.competitions where id=cid;
  else sid:=case when tg_op='DELETE' then old.competition_series_id else new.competition_series_id end;
  end if;
  if sid is not null then
    perform private.validate_competition_series(sid,
      exists(select 1 from public.competitions where competition_series_id=sid and status='published')
      or (select count(*) from public.competitions where competition_series_id=sid)>1);
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION private.competition_configuration_version(p_competition_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select md5(jsonb_build_object(
    'competition', to_jsonb(c) - 'discipline_code' - 'discipline_detail',
    'components', private.competition_components(c.id),
    'rounds', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.round_number), '[]'::jsonb)
      from public.competition_rounds r
      where r.competition_id = c.id
    ),
    'season_dates', jsonb_build_array(s.entry_opens_at, s.entry_closes_at, s.starts_at, s.ends_at)
  )::text)
  from public.competitions c
  join public.league_seasons s on s.id = c.league_season_id
  where c.id = p_competition_id
$function$;

CREATE OR REPLACE FUNCTION private.protect_series_contract()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  series_id bigint;
  locked_at timestamptz;
begin
  if tg_table_name = 'competition_series' then
    if tg_op = 'DELETE' then return old; end if;
    if new.organisation_id is distinct from old.organisation_id
      or new.slug is distinct from old.slug then
      raise exception 'Series Organisation and slug are immutable.' using errcode = '22023';
    end if;
    if old.identity_locked_at is not null and (
      new.identity_locked_at is distinct from old.identity_locked_at
      or (new.entry_format, new.team_size, new.sets_per_round, new.shots_per_round,
          new.shooting_details_version, new.equipment_type_code,
          new.organisation_equipment_type_id)
        is distinct from
         (old.entry_format, old.team_size, old.sets_per_round, old.shots_per_round,
          old.shooting_details_version, old.equipment_type_code,
          old.organisation_equipment_type_id)
    ) then
      raise exception 'Finalised Series identity is immutable. Create a new Series instead.' using errcode = '22023';
    end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;
  series_id := case when tg_op = 'DELETE' then old.competition_series_id else new.competition_series_id end;
  if tg_op = 'UPDATE' and new.competition_series_id <> old.competition_series_id then
    raise exception 'Series components cannot be moved.' using errcode = '22023';
  end if;
  select identity_locked_at into locked_at from public.competition_series
  where id = series_id for update;
  if locked_at is not null then
    raise exception 'Finalised Series components are immutable.' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.protect_series_edition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.competition_series_id is not null and new.competition_series_id is distinct from old.competition_series_id then
    raise exception 'Series editions cannot be detached or reassigned.' using errcode='22023';
  end if;
  if old.configuration_source_competition_id is not null and
    (new.configuration_source_competition_id is not null and
     new.configuration_source_competition_id is distinct from old.configuration_source_competition_id
     or new.configuration_source_version is distinct from old.configuration_source_version) then
    raise exception 'Configuration provenance is immutable.' using errcode='22023';
  end if;
  if new.status='published' and old.status='draft' and new.competition_series_id is not null then
    perform private.validate_competition_series(new.competition_series_id,true);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.protect_series_season_organisation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.organisation_id is distinct from old.organisation_id and exists (
    select 1 from public.competitions where league_season_id=old.id and competition_series_id is not null) then
    raise exception 'A Season containing Series editions cannot change Organisation.' using errcode='22023';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.save_series_competition(p_organisation_id bigint, p_season_id bigint, p_values jsonb, p_competition_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  clean_values jsonb;
  configuration jsonb;
  deadlines date[];
  shoot_by date[];
  result jsonb;
  structured boolean;
  derived_shots bigint;
begin
  perform private.check_competition_configuration_keys(p_values, true);
  clean_values := p_values - 'discipline_code' - 'discipline_detail';
  configuration := jsonb_build_object(
    'entry_format', 'individual', 'team_size', 1, 'sets_per_round', 1,
    'score_components', '[]'::jsonb, 'uses_x_score', false, 'number_of_rounds', 10,
    'entry_window_mode', 'season_default', 'start_date_mode', 'season_default',
    'ranking_method', 'aggregate', 'local_scoring_enabled', true
  ) || clean_values;
  structured := configuration ->> 'shooting_details_version' = '1';

  select coalesce(array_agg(value::date order by ordinality), array[]::date[])
  into deadlines
  from jsonb_array_elements_text(coalesce(configuration -> 'round_deadlines', '[]'::jsonb)) with ordinality;
  select coalesce(array_agg(value::date order by ordinality), array[]::date[])
  into shoot_by
  from jsonb_array_elements_text(coalesce(configuration -> 'round_shoot_by_dates', '[]'::jsonb)) with ordinality;

  if structured then
    if jsonb_typeof(configuration -> 'score_components') <> 'array' then
      raise exception 'Course of Fire score components must be supplied as a list.' using errcode = '22023';
    end if;
    if jsonb_array_length(configuration -> 'score_components') = 0 or exists (
      select 1
      from jsonb_array_elements(configuration -> 'score_components') component
      where nullif(btrim(component ->> 'shots'), '') is null
    ) then
      derived_shots := null;
    else
      select (configuration ->> 'sets_per_round')::integer
        * sum((component ->> 'shots')::bigint)
      into derived_shots
      from jsonb_array_elements(configuration -> 'score_components') component;
      if derived_shots > 10000 then
        raise exception 'Derived shots per Round must not exceed 10,000.' using errcode = '22023';
      end if;
    end if;
  else
    derived_shots := (configuration ->> 'shots_per_round')::integer;
  end if;

  if p_competition_id is null then
    result := public.create_competition(
      p_organisation_id, p_season_id, configuration ->> 'name', configuration ->> 'description',
      configuration ->> 'entry_format', (configuration ->> 'team_size')::integer,
      derived_shots::integer, (configuration ->> 'uses_x_score')::boolean,
      (configuration ->> 'number_of_rounds')::integer, (configuration ->> 'entry_fee')::numeric,
      configuration ->> 'entry_window_mode', (configuration ->> 'custom_entry_opens_at')::date,
      (configuration ->> 'custom_entry_closes_at')::date, configuration ->> 'start_date_mode',
      (configuration ->> 'custom_starts_at')::date, (configuration ->> 'sets_per_round')::integer,
      configuration -> 'score_components', configuration ->> 'ranking_method',
      (configuration ->> 'best_rounds_count')::integer,
      (configuration ->> 'local_scoring_enabled')::boolean, deadlines, shoot_by
    );
  else
    result := public.update_competition(
      p_organisation_id, p_season_id, p_competition_id,
      configuration ->> 'name', configuration ->> 'description', configuration ->> 'entry_format',
      (configuration ->> 'team_size')::integer, derived_shots::integer,
      (configuration ->> 'uses_x_score')::boolean, (configuration ->> 'number_of_rounds')::integer,
      (configuration ->> 'entry_fee')::numeric, configuration ->> 'entry_window_mode',
      (configuration ->> 'custom_entry_opens_at')::date,
      (configuration ->> 'custom_entry_closes_at')::date, configuration ->> 'start_date_mode',
      (configuration ->> 'custom_starts_at')::date, (configuration ->> 'sets_per_round')::integer,
      configuration -> 'score_components', configuration ->> 'ranking_method',
      (configuration ->> 'best_rounds_count')::integer,
      (configuration ->> 'local_scoring_enabled')::boolean, deadlines, shoot_by, 'draft'
    );
  end if;

  if structured then
    perform private.apply_competition_shooting_details(
      p_organisation_id, (result ->> 'id')::bigint, configuration
    );
  end if;
  perform private.sync_provisional_competition_series((result ->> 'id')::bigint);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_provisional_competition_series(p_competition_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  competition_record public.competitions%rowtype;
  series_record public.competition_series%rowtype;
begin
  select * into competition_record from public.competitions where id = p_competition_id;
  if competition_record.competition_series_id is null then return; end if;
  select * into series_record from public.competition_series
  where id = competition_record.competition_series_id for update;
  if series_record.identity_locked_at is not null then
    perform private.validate_competition_series(series_record.id);
    return;
  end if;
  if competition_record.status <> 'draft' or (
    select count(*) from public.competitions where competition_series_id = series_record.id
  ) <> 1 then
    raise exception 'Only the first unpublished draft can correct provisional Series identity.'
      using errcode = '22023';
  end if;
  update public.competition_series
  set entry_format = competition_record.entry_format,
      team_size = competition_record.team_size,
      sets_per_round = competition_record.sets_per_round,
      shots_per_round = competition_record.shots_per_round,
      shooting_details_version = competition_record.shooting_details_version,
      equipment_type_code = competition_record.equipment_type_code,
      organisation_equipment_type_id = competition_record.organisation_equipment_type_id,
      updated_by = (select auth.uid())
  where id = series_record.id;
  delete from public.competition_series_score_components
  where competition_series_id = series_record.id;
  insert into public.competition_series_score_components(
    competition_series_id, position, short_label, maximum_score, score_method,
    shooting_position_mode, shooting_position_code,
    organisation_shooting_position_id, distance_mode, distance_value,
    distance_unit, shots
  )
  select series_record.id, position, short_label, maximum_score, score_method,
    shooting_position_mode, shooting_position_code,
    organisation_shooting_position_id, distance_mode, distance_value,
    distance_unit, shots
  from public.competition_score_components
  where competition_id = competition_record.id;
  perform private.validate_competition_series(series_record.id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_series(p_series_id bigint, p_finalise boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  series_record public.competition_series%rowtype;
  edition record;
  components jsonb;
begin
  select * into series_record from public.competition_series where id = p_series_id for update;
  if not found then return; end if;
  components := private.competition_series_components(series_record.id);
  if exists (
    select 1 from (
      select position, row_number() over (order by position) expected_position
      from public.competition_series_score_components
      where competition_series_id = series_record.id
    ) positions where position <> expected_position
  ) then
    raise exception 'Series component positions must be contiguous.' using errcode = '22023';
  end if;
  if series_record.organisation_equipment_type_id is not null and not exists (
    select 1 from public.organisation_equipment_types custom_equipment
    where custom_equipment.id = series_record.organisation_equipment_type_id
      and custom_equipment.organisation_id = series_record.organisation_id
  ) then
    raise exception 'Custom equipment type must belong to the Series Organisation.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.competition_series_score_components component
    join public.organisation_shooting_positions custom_position
      on custom_position.id = component.organisation_shooting_position_id
    where component.competition_series_id = series_record.id
      and custom_position.organisation_id <> series_record.organisation_id
  ) then
    raise exception 'Custom shooting positions must belong to the Series Organisation.' using errcode = '22023';
  end if;
  if (p_finalise or series_record.identity_locked_at is not null)
    and jsonb_array_length(components) = 0 then
    raise exception 'Complete Course of Fire before finalising Series identity.' using errcode = '22023';
  end if;
  if (p_finalise or series_record.identity_locked_at is not null)
    and series_record.shooting_details_version = 1
    and (
      ((series_record.equipment_type_code is not null)::integer
        + (series_record.organisation_equipment_type_id is not null)::integer) <> 1
      or exists (
        select 1 from public.competition_series_score_components component
        where component.competition_series_id = series_record.id
          and (component.shooting_position_mode is null
            or component.distance_mode is null or component.shots is null)
      )
    ) then
    raise exception 'Complete Series equipment, position/style, distance, and component Shots before finalising Series identity.'
      using errcode = '22023';
  end if;

  for edition in
    select competition.*, season.organisation_id
    from public.competitions competition
    join public.league_seasons season on season.id = competition.league_season_id
    where competition.competition_series_id = series_record.id
  loop
    if edition.organisation_id <> series_record.organisation_id then
      raise exception 'Series and Season must belong to the same Organisation.' using errcode = '22023';
    end if;
    if (edition.entry_format, edition.team_size, edition.sets_per_round,
        edition.shots_per_round, edition.shooting_details_version,
        edition.equipment_type_code, edition.organisation_equipment_type_id)
      is distinct from
       (series_record.entry_format, series_record.team_size, series_record.sets_per_round,
        series_record.shots_per_round, series_record.shooting_details_version,
        series_record.equipment_type_code, series_record.organisation_equipment_type_id)
      or private.competition_components(edition.id) is distinct from components
      or exists (
        select 1 from (
          select position, row_number() over (order by position) expected_position
          from public.competition_score_components
          where competition_id = edition.id
        ) positions where position <> expected_position
      ) then
      raise exception 'Competition identity must match its Series. Create a new Series to change the shooting format.'
        using errcode = '22023';
    end if;
    if edition.configuration_source_competition_id is not null and not exists (
      select 1 from public.competitions source
      where source.id = edition.configuration_source_competition_id
        and source.competition_series_id = series_record.id and source.id <> edition.id
    ) then
      raise exception 'Configuration source must be another edition of this Series.' using errcode = '22023';
    end if;
  end loop;
  if p_finalise and series_record.identity_locked_at is null then
    update public.competition_series
    set identity_locked_at = clock_timestamp(), updated_by = (select auth.uid())
    where id = series_record.id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.continue_competition_series(p_organisation_id bigint, p_league_season_id bigint, p_competition_series_id bigint, p_configuration_source_competition_id bigint, p_expected_source_version text, p_edition_values jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid;
  series_record public.competition_series%rowtype;
  source public.competitions%rowtype;
  values_to_save jsonb;
  result jsonb;
  version text;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform private.check_competition_configuration_keys(p_edition_values, false);
  perform season.id from public.league_seasons season
  where season.id = p_league_season_id or season.id = (
    select league_season_id from public.competitions
    where id = p_configuration_source_competition_id
  ) order by season.id for share;
  if not exists (
    select 1 from public.league_seasons
    where id = p_league_season_id and organisation_id = p_organisation_id
  ) then
    raise exception 'Target Season does not belong to this Organisation.' using errcode = '22023';
  end if;
  select * into series_record from public.competition_series
  where id = p_competition_series_id and organisation_id = p_organisation_id for update;
  if not found then raise exception 'Series not found in this Organisation.' using errcode = '22023'; end if;
  if series_record.archived_at is not null then
    raise exception 'Archived Series cannot be continued.' using errcode = '22023';
  end if;
  select * into source from public.competitions
  where id = p_configuration_source_competition_id
    and competition_series_id = series_record.id for update;
  if not found then
    raise exception 'Configuration source must belong to this Series.' using errcode = '22023';
  end if;
  version := private.competition_configuration_version(source.id);
  if p_expected_source_version is null or version is distinct from p_expected_source_version then
    raise exception 'Source configuration changed. Refresh and review the source edition.' using errcode = '40001';
  end if;
  perform private.validate_competition_series(series_record.id, true);
  values_to_save := jsonb_build_object(
    'name', source.name, 'description', source.description, 'entry_fee', source.entry_fee,
    'entry_window_mode', source.entry_window_mode, 'start_date_mode', source.start_date_mode,
    'ranking_method', source.ranking_method, 'best_rounds_count', source.best_rounds_count,
    'uses_x_score', source.uses_x_score, 'local_scoring_enabled', source.local_scoring_enabled,
    'number_of_rounds', source.number_of_rounds
  ) || p_edition_values || jsonb_build_object(
    'entry_format', series_record.entry_format, 'team_size', series_record.team_size,
    'sets_per_round', series_record.sets_per_round, 'shots_per_round', series_record.shots_per_round,
    'shooting_details_version', series_record.shooting_details_version,
    'equipment_type_code', series_record.equipment_type_code,
    'organisation_equipment_type_id', series_record.organisation_equipment_type_id,
    'score_components', private.competition_series_components(series_record.id)
  );
  if values_to_save ->> 'ranking_method' <> 'best_n_average' then
    values_to_save := values_to_save || jsonb_build_object('best_rounds_count', null);
  end if;
  result := private.save_series_competition(
    p_organisation_id, p_league_season_id, values_to_save
  );
  update public.competitions
  set competition_series_id = series_record.id,
      configuration_source_competition_id = source.id,
      configuration_source_version = version,
      updated_by = actor
  where id = (result ->> 'id')::bigint;
  perform private.validate_competition_series(series_record.id);
  return result || jsonb_build_object(
    'competition_series_id', series_record.id,
    'configuration_source_competition_id', source.id,
    'configuration_source_version', version,
    'configuration_version', private.competition_configuration_version((result ->> 'id')::bigint)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_competition_series(p_organisation_id bigint, p_league_season_id bigint, p_series_name text, p_configuration jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid;
  result jsonb;
  competition_record public.competitions%rowtype;
  series_id bigint;
  series_slug text;
begin
  actor := private.require_competition_author(p_organisation_id);
  result := private.save_series_competition(
    p_organisation_id, p_league_season_id, p_configuration
  );
  select * into competition_record from public.competitions
  where id = (result ->> 'id')::bigint;
  series_slug := lower(regexp_replace(regexp_replace(
    btrim(p_series_name), '[^a-zA-Z0-9]+', '-', 'g'
  ), '(^-+|-+$)', '', 'g'));
  insert into public.competition_series(
    organisation_id, name, slug, entry_format, team_size,
    sets_per_round, shots_per_round, shooting_details_version,
    equipment_type_code, organisation_equipment_type_id, created_by, updated_by
  ) values (
    p_organisation_id, btrim(p_series_name), series_slug,
    competition_record.entry_format, competition_record.team_size,
    competition_record.sets_per_round, competition_record.shots_per_round,
    competition_record.shooting_details_version, competition_record.equipment_type_code,
    competition_record.organisation_equipment_type_id, actor, actor
  ) returning id into series_id;
  insert into public.competition_series_score_components(
    competition_series_id, position, short_label, maximum_score, score_method,
    shooting_position_mode, shooting_position_code,
    organisation_shooting_position_id, distance_mode, distance_value,
    distance_unit, shots
  )
  select series_id, position, short_label, maximum_score, score_method,
    shooting_position_mode, shooting_position_code,
    organisation_shooting_position_id, distance_mode, distance_value,
    distance_unit, shots
  from public.competition_score_components
  where competition_id = competition_record.id;
  update public.competitions set competition_series_id = series_id
  where id = competition_record.id;
  perform private.validate_competition_series(series_id);
  return result || jsonb_build_object(
    'competition_series_id', series_id,
    'configuration_version', private.competition_configuration_version(competition_record.id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_empty_competition_series(p_organisation_id bigint, p_competition_series_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_competition_author(p_organisation_id,true);
  perform id from public.competition_series where id=p_competition_series_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Series not found in this Organisation.' using errcode='22023'; end if;
  if exists(select 1 from public.competitions where competition_series_id=p_competition_series_id) then
    raise exception 'Series with editions cannot be deleted. Archive it instead.' using errcode='22023';
  end if;
  delete from public.competition_series where id=p_competition_series_id;
  return jsonb_build_object('id',p_competition_series_id);
end $function$;

CREATE OR REPLACE FUNCTION public.get_competition_series_sources(p_organisation_id bigint, p_league_season_id bigint, p_competition_series_id bigint, p_target_starts_at date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.competition_series%rowtype;
  cutoff date;
  provisional boolean;
  candidates jsonb;
  best_date date;
  recommended bigint;
  ties integer;
begin
  perform private.require_competition_author(p_organisation_id);

  select coalesce(p_target_starts_at, starts_at, (statement_timestamp() at time zone 'UTC')::date),
    p_target_starts_at is null and starts_at is null
  into cutoff, provisional
  from public.league_seasons
  where id = p_league_season_id
    and organisation_id = p_organisation_id;
  if not found then
    raise exception 'Target Season does not belong to this Organisation.' using errcode = '22023';
  end if;

  select * into s
  from public.competition_series
  where id = p_competition_series_id
    and organisation_id = p_organisation_id;
  if not found then
    raise exception 'Series not found in this Organisation.' using errcode = '22023';
  end if;
  if s.archived_at is not null then
    raise exception 'Archived Series cannot be continued.' using errcode = '22023';
  end if;

  select max(dates.effective_starts_at)
  into best_date
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  cross join lateral private.get_competition_effective_dates(competition.id) dates
  where competition.competition_series_id = s.id
    and competition.league_season_id <> p_league_season_id
    and season.organisation_id = p_organisation_id
    and competition.status = 'published'
    and season.status in ('open', 'active', 'completed')
    and dates.effective_starts_at < cutoff
    and dates.effective_starts_at <= (statement_timestamp() at time zone 'UTC')::date;

  select count(*), min(competition.id)
  into ties, recommended
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  cross join lateral private.get_competition_effective_dates(competition.id) dates
  where competition.competition_series_id = s.id
    and competition.league_season_id <> p_league_season_id
    and season.organisation_id = p_organisation_id
    and competition.status = 'published'
    and season.status in ('open', 'active', 'completed')
    and dates.effective_starts_at = best_date;
  if ties <> 1 then recommended := null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', competition.id,
    'name', competition.name,
    'slug', competition.slug,
    'status', competition.status,
    'season_id', season.id,
    'season_name', season.name,
    'season_status', season.status,
    'effective_starts_at', dates.effective_starts_at,
    'ranking_method', competition.ranking_method,
    'number_of_rounds', competition.number_of_rounds,
    'configuration_version', private.competition_configuration_version(competition.id)
  ) order by dates.effective_starts_at desc nulls last, competition.name, competition.id), '[]'::jsonb)
  into candidates
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  cross join lateral private.get_competition_effective_dates(competition.id) dates
  where competition.competition_series_id = s.id
    and competition.league_season_id <> p_league_season_id
    and season.organisation_id = p_organisation_id;

  return jsonb_build_object(
    'series', jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'slug', s.slug,
      'identity_locked_at', s.identity_locked_at
    ),
    'cutoff', cutoff,
    'provisional_cutoff', provisional,
    'recommended_source_id', recommended,
    'selection_required', recommended is null,
    'ambiguous_latest_date', ties > 1,
    'sources', candidates
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rename_competition_series(p_organisation_id bigint, p_competition_series_id bigint, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_result jsonb;
begin
  v_actor_id := private.require_competition_author(p_organisation_id, true);

  if char_length(v_name) not between 2 and 160 then
    raise exception 'Series name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  update public.competition_series
  set name = v_name,
      updated_by = v_actor_id
  where id = p_competition_series_id
    and organisation_id = p_organisation_id
  returning jsonb_build_object('id', id, 'name', name) into v_result;

  if v_result is null then
    raise exception 'Series not found in this Organisation.' using errcode = '22023';
  end if;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_competition_series_archived(p_organisation_id bigint, p_competition_series_id bigint, p_archived boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; result jsonb;
begin
  actor:=private.require_competition_author(p_organisation_id,true);
  if p_archived is null then raise exception 'Choose archive or restore.' using errcode='22023'; end if;
  update public.competition_series set archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) end,
    updated_by=actor where id=p_competition_series_id and organisation_id=p_organisation_id
    returning jsonb_build_object('id',id,'archived_at',archived_at) into result;
  if result is null then raise exception 'Series not found in this Organisation.' using errcode='22023'; end if;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.update_competition_series_draft(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint, p_configuration jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  perform private.require_competition_author(p_organisation_id);
  perform c.id from public.competitions c join public.league_seasons s on s.id=c.league_season_id
    where c.id=p_competition_id and s.id=p_league_season_id and s.organisation_id=p_organisation_id
      and c.status='draft' for update of c;
  if not found then raise exception 'Draft Competition not found in this Organisation and Season.' using errcode='22023'; end if;
  result:=private.save_series_competition(p_organisation_id,p_league_season_id,p_configuration,p_competition_id);
  return result||jsonb_build_object('configuration_version',private.competition_configuration_version(p_competition_id));
end $function$;


commit;

