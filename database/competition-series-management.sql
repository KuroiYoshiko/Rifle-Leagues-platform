-- Run AFTER competition-series.sql; rerun this upgrade last after earlier configuration SQL.
-- Existing signatures and validators remain compatible. No application data is rewritten.
begin;

create or replace function public.create_competition(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_name text,
  p_description text,
  p_entry_format text,
  p_team_size integer,
  p_shots_per_round integer,
  p_uses_x_score boolean,
  p_number_of_rounds integer,
  p_entry_fee numeric,
  p_entry_window_mode text,
  p_custom_entry_opens_at date,
  p_custom_entry_closes_at date,
  p_start_date_mode text,
  p_custom_starts_at date,
  p_sets_per_round integer,
  p_score_components jsonb,
  p_ranking_method text,
  p_best_rounds_count integer,
  p_local_scoring_enabled boolean,
  p_round_deadlines date[],
  p_round_shoot_by_dates date[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.update_competition(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_name text,
  p_description text,
  p_entry_format text,
  p_team_size integer,
  p_shots_per_round integer,
  p_uses_x_score boolean,
  p_number_of_rounds integer,
  p_entry_fee numeric,
  p_entry_window_mode text,
  p_custom_entry_opens_at date,
  p_custom_entry_closes_at date,
  p_start_date_mode text,
  p_custom_starts_at date,
  p_sets_per_round integer,
  p_score_components jsonb,
  p_ranking_method text,
  p_best_rounds_count integer,
  p_local_scoring_enabled boolean,
  p_round_deadlines date[],
  p_round_shoot_by_dates date[],
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.require_competition_lifecycle_owner(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns table (
  actor_id uuid,
  organisation_slug text,
  season_slug text,
  competition_slug text,
  competition_status text
)
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.sync_provisional_competition_series(p_competition_id bigint)
returns void language plpgsql security definer set search_path='' as $$
declare c public.competitions%rowtype; s public.competition_series%rowtype;
begin
  select * into c from public.competitions where id=p_competition_id;
  if c.competition_series_id is null then return; end if;
  select * into s from public.competition_series where id=c.competition_series_id for update;
  if s.identity_locked_at is not null then
    perform private.validate_competition_series(s.id); return;
  end if;
  if c.status<>'draft' or (select count(*) from public.competitions where competition_series_id=s.id)<>1 then
    raise exception 'Only the first unpublished draft can correct provisional Series identity.' using errcode='22023';
  end if;
  update public.competition_series set entry_format=c.entry_format,team_size=c.team_size,
    discipline_code=c.discipline_code,discipline_detail=c.discipline_detail,
    sets_per_round=c.sets_per_round,shots_per_round=c.shots_per_round,updated_by=(select auth.uid()) where id=s.id;
  delete from public.competition_series_score_components where competition_series_id=s.id;
  insert into public.competition_series_score_components(competition_series_id,position,short_label,maximum_score,score_method)
    select s.id,position,short_label,maximum_score,score_method from public.competition_score_components where competition_id=c.id;
  perform private.validate_competition_series(s.id);
end $$;

create or replace function private.competition_configuration_version(p_competition_id bigint)
returns text language sql stable set search_path='' as $$
  select md5(jsonb_build_object('competition',to_jsonb(c),'components',private.competition_components(c.id),
    'rounds',(select coalesce(jsonb_agg(to_jsonb(r) order by r.round_number),'[]'::jsonb)
      from public.competition_rounds r where r.competition_id=c.id),
    'season_dates',jsonb_build_array(s.entry_opens_at,s.entry_closes_at,s.starts_at,s.ends_at))::text)
  from public.competitions c join public.league_seasons s on s.id=c.league_season_id where c.id=p_competition_id
$$;

create or replace function private.check_competition_configuration_keys(p_values jsonb,p_identity boolean)
returns void language plpgsql set search_path='' as $$
begin
  if p_values is null or jsonb_typeof(p_values)<>'object' or exists (
    select 1 from jsonb_object_keys(p_values) k where k<>all(array[
      'name','description','entry_fee','entry_window_mode','custom_entry_opens_at','custom_entry_closes_at',
      'start_date_mode','custom_starts_at','ranking_method','best_rounds_count','uses_x_score',
      'local_scoring_enabled','number_of_rounds','round_deadlines','round_shoot_by_dates'] ||
      case when p_identity then array['entry_format','team_size','sets_per_round','shots_per_round',
        'score_components','discipline_code','discipline_detail'] else array[]::text[] end)) then
    raise exception 'Unsupported Competition configuration fields.' using errcode='22023';
  end if;
end $$;

-- Converts the bounded configuration payload to the existing typed RPC. All
-- sporting/date/fee/component validation remains in validate_competition_configuration.
create or replace function private.save_series_competition(
  p_organisation_id bigint,p_season_id bigint,p_values jsonb,p_competition_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb:=jsonb_build_object('entry_format','individual','team_size',1,'sets_per_round',1,
  'score_components','[]'::jsonb,'uses_x_score',false,'number_of_rounds',10,
  'entry_window_mode','season_default','start_date_mode','season_default','ranking_method','aggregate',
  'local_scoring_enabled',true)||p_values;
  deadlines date[]; shoot_by date[]; result jsonb;
begin
  perform private.check_competition_configuration_keys(p_values,true);
  select coalesce(array_agg(value::date order by ordinality),array[]::date[]) into deadlines
    from jsonb_array_elements_text(coalesce(v->'round_deadlines','[]'::jsonb)) with ordinality;
  select coalesce(array_agg(value::date order by ordinality),array[]::date[]) into shoot_by
    from jsonb_array_elements_text(coalesce(v->'round_shoot_by_dates','[]'::jsonb)) with ordinality;
  if p_competition_id is null then
    result:=public.create_competition(p_organisation_id,p_season_id,v->>'name',v->>'description',
      v->>'entry_format',(v->>'team_size')::integer,(v->>'shots_per_round')::integer,
      (v->>'uses_x_score')::boolean,(v->>'number_of_rounds')::integer,(v->>'entry_fee')::numeric,
      v->>'entry_window_mode',(v->>'custom_entry_opens_at')::date,(v->>'custom_entry_closes_at')::date,
      v->>'start_date_mode',(v->>'custom_starts_at')::date,(v->>'sets_per_round')::integer,
      v->'score_components',v->>'ranking_method',(v->>'best_rounds_count')::integer,
      (v->>'local_scoring_enabled')::boolean,deadlines,shoot_by);
  else
    result:=public.update_competition(p_organisation_id,p_season_id,p_competition_id,v->>'name',v->>'description',
      v->>'entry_format',(v->>'team_size')::integer,(v->>'shots_per_round')::integer,
      (v->>'uses_x_score')::boolean,(v->>'number_of_rounds')::integer,(v->>'entry_fee')::numeric,
      v->>'entry_window_mode',(v->>'custom_entry_opens_at')::date,(v->>'custom_entry_closes_at')::date,
      v->>'start_date_mode',(v->>'custom_starts_at')::date,(v->>'sets_per_round')::integer,
      v->'score_components',v->>'ranking_method',(v->>'best_rounds_count')::integer,
      (v->>'local_scoring_enabled')::boolean,deadlines,shoot_by,'draft');
  end if;
  update public.competitions set discipline_code=nullif(btrim(v->>'discipline_code'),''),
    discipline_detail=nullif(btrim(v->>'discipline_detail'),''),updated_by=(select auth.uid()) where id=(result->>'id')::bigint;
  perform private.sync_provisional_competition_series((result->>'id')::bigint);
  return result;
end $$;

create or replace function public.create_competition_series(
  p_organisation_id bigint,p_league_season_id bigint,p_series_name text,p_configuration jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb; c public.competitions%rowtype; sid bigint; series_slug text;
begin
  actor:=private.require_competition_author(p_organisation_id);
  result:=private.save_series_competition(p_organisation_id,p_league_season_id,p_configuration);
  select * into c from public.competitions where id=(result->>'id')::bigint;
  series_slug:=lower(regexp_replace(regexp_replace(btrim(p_series_name),'[^a-zA-Z0-9]+','-','g'),'(^-+|-+$)','','g'));
  insert into public.competition_series(organisation_id,name,slug,entry_format,team_size,discipline_code,
    discipline_detail,sets_per_round,shots_per_round,created_by,updated_by)
  values(p_organisation_id,btrim(p_series_name),series_slug,c.entry_format,c.team_size,c.discipline_code,
    c.discipline_detail,c.sets_per_round,c.shots_per_round,actor,actor) returning id into sid;
  insert into public.competition_series_score_components(competition_series_id,position,short_label,maximum_score,score_method)
    select sid,position,short_label,maximum_score,score_method from public.competition_score_components where competition_id=c.id;
  update public.competitions set competition_series_id=sid where id=c.id;
  perform private.validate_competition_series(sid);
  return result||jsonb_build_object('competition_series_id',sid,'configuration_version',private.competition_configuration_version(c.id));
end $$;

-- Full draft payload, with discipline snapshots. Existing update_competition
-- remains supported and also synchronises a sole provisional draft's contract.
create or replace function public.update_competition_series_draft(
  p_organisation_id bigint,p_league_season_id bigint,p_competition_id bigint,p_configuration jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_competition_author(p_organisation_id);
  perform c.id from public.competitions c join public.league_seasons s on s.id=c.league_season_id
    where c.id=p_competition_id and s.id=p_league_season_id and s.organisation_id=p_organisation_id
      and c.status='draft' for update of c;
  if not found then raise exception 'Draft Competition not found in this Organisation and Season.' using errcode='22023'; end if;
  result:=private.save_series_competition(p_organisation_id,p_league_season_id,p_configuration,p_competition_id);
  return result||jsonb_build_object('configuration_version',private.competition_configuration_version(p_competition_id));
end $$;

create or replace function public.continue_competition_series(
  p_organisation_id bigint,p_league_season_id bigint,p_competition_series_id bigint,
  p_configuration_source_competition_id bigint,p_expected_source_version text,p_edition_values jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; s public.competition_series%rowtype; source public.competitions%rowtype;
  values_to_save jsonb; result jsonb; version text;
begin
  actor:=private.require_competition_author(p_organisation_id);
  perform private.check_competition_configuration_keys(p_edition_values,false);
  -- Lock source and destination Season dates before taking the configuration snapshot.
  perform season.id from public.league_seasons season where season.id=p_league_season_id
    or season.id=(select league_season_id from public.competitions where id=p_configuration_source_competition_id)
    order by season.id for share;
  if not exists(select 1 from public.league_seasons where id=p_league_season_id and organisation_id=p_organisation_id) then
    raise exception 'Target Season does not belong to this Organisation.' using errcode='22023';
  end if;
  select * into s from public.competition_series where id=p_competition_series_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Series not found in this Organisation.' using errcode='22023'; end if;
  if s.archived_at is not null then raise exception 'Archived Series cannot be continued.' using errcode='22023'; end if;
  select * into source from public.competitions where id=p_configuration_source_competition_id
    and competition_series_id=s.id for update;
  if not found then raise exception 'Configuration source must belong to this Series.' using errcode='22023'; end if;
  version:=private.competition_configuration_version(source.id);
  if p_expected_source_version is null or version is distinct from p_expected_source_version then
    raise exception 'Source configuration changed. Refresh and review the source edition.' using errcode='40001';
  end if;
  perform private.validate_competition_series(s.id,true);
  -- Explicit allowlist: no dates, source usages, participation or fixture data.
  values_to_save:=jsonb_build_object('name',source.name,'description',source.description,
    'entry_fee',source.entry_fee,'entry_window_mode',source.entry_window_mode,'start_date_mode',source.start_date_mode,
    'ranking_method',source.ranking_method,'best_rounds_count',source.best_rounds_count,'uses_x_score',source.uses_x_score,
    'local_scoring_enabled',source.local_scoring_enabled,'number_of_rounds',source.number_of_rounds)
    ||p_edition_values||jsonb_build_object('entry_format',s.entry_format,'team_size',s.team_size,
    'sets_per_round',s.sets_per_round,'shots_per_round',s.shots_per_round,'discipline_code',s.discipline_code,
    'discipline_detail',s.discipline_detail,'score_components',private.competition_series_components(s.id));
  if values_to_save->>'ranking_method'<>'best_n_average' then
    values_to_save:=values_to_save||jsonb_build_object('best_rounds_count',null);
  end if;
  result:=private.save_series_competition(p_organisation_id,p_league_season_id,values_to_save);
  update public.competitions set competition_series_id=s.id,configuration_source_competition_id=source.id,
    configuration_source_version=version,updated_by=actor where id=(result->>'id')::bigint;
  perform private.validate_competition_series(s.id);
  return result||jsonb_build_object('competition_series_id',s.id,'configuration_source_competition_id',source.id,
    'configuration_source_version',version,'configuration_version',private.competition_configuration_version((result->>'id')::bigint));
end $$;

create or replace function public.set_competition_series_archived(
  p_organisation_id bigint,p_competition_series_id bigint,p_archived boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb;
begin
  actor:=private.require_competition_author(p_organisation_id,true);
  if p_archived is null then raise exception 'Choose archive or restore.' using errcode='22023'; end if;
  update public.competition_series set archived_at=case when p_archived then coalesce(archived_at,clock_timestamp()) end,
    updated_by=actor where id=p_competition_series_id and organisation_id=p_organisation_id
    returning jsonb_build_object('id',id,'archived_at',archived_at) into result;
  if result is null then raise exception 'Series not found in this Organisation.' using errcode='22023'; end if;
  return result;
end $$;

create or replace function public.delete_empty_competition_series(p_organisation_id bigint,p_competition_series_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_competition_author(p_organisation_id,true);
  perform id from public.competition_series where id=p_competition_series_id and organisation_id=p_organisation_id for update;
  if not found then raise exception 'Series not found in this Organisation.' using errcode='22023'; end if;
  if exists(select 1 from public.competitions where competition_series_id=p_competition_series_id) then
    raise exception 'Series with editions cannot be deleted. Archive it instead.' using errcode='22023';
  end if;
  delete from public.competition_series where id=p_competition_series_id;
  return jsonb_build_object('id',p_competition_series_id);
end $$;

-- Read support is management-only and returns an explicit projection, not row JSON.
-- A draft/undated/future edition remains an explicit override, never a silent default.
create or replace function public.get_competition_series_sources(
  p_organisation_id bigint,p_league_season_id bigint,p_competition_series_id bigint,
  p_target_starts_at date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.competition_series%rowtype; cutoff date; provisional boolean; candidates jsonb;
  best_date date; recommended bigint; ties integer;
begin
  perform private.require_competition_author(p_organisation_id);
  select coalesce(p_target_starts_at,starts_at,(statement_timestamp() at time zone 'UTC')::date),
    p_target_starts_at is null and starts_at is null into cutoff,provisional
    from public.league_seasons where id=p_league_season_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Target Season does not belong to this Organisation.' using errcode='22023'; end if;
  select * into s from public.competition_series where id=p_competition_series_id and organisation_id=p_organisation_id;
  if not found then raise exception 'Series not found in this Organisation.' using errcode='22023'; end if;
  if s.archived_at is not null then raise exception 'Archived Series cannot be continued.' using errcode='22023'; end if;
  select max(d.effective_starts_at) into best_date from public.competitions c
    join public.league_seasons season on season.id=c.league_season_id
    cross join lateral private.get_competition_effective_dates(c.id) d
    where c.competition_series_id=s.id and season.organisation_id=p_organisation_id
      and c.status='published' and season.status in ('open','active','completed') and d.effective_starts_at<cutoff
      and d.effective_starts_at<=(statement_timestamp() at time zone 'UTC')::date;
  select count(*),min(c.id) into ties,recommended from public.competitions c
    join public.league_seasons season on season.id=c.league_season_id
    cross join lateral private.get_competition_effective_dates(c.id) d
    where c.competition_series_id=s.id and c.status='published' and season.status in ('open','active','completed')
      and d.effective_starts_at=best_date;
  if ties<>1 then recommended:=null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'status',c.status,
    'season_id',season.id,'season_name',season.name,'season_status',season.status,
    'effective_starts_at',d.effective_starts_at,'ranking_method',c.ranking_method,
    'number_of_rounds',c.number_of_rounds,'configuration_version',private.competition_configuration_version(c.id))
    order by d.effective_starts_at desc nulls last,c.name,c.id),'[]'::jsonb) into candidates
    from public.competitions c join public.league_seasons season on season.id=c.league_season_id
    cross join lateral private.get_competition_effective_dates(c.id) d
    where c.competition_series_id=s.id and season.organisation_id=p_organisation_id;
  return jsonb_build_object('series',jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,
    'identity_locked_at',s.identity_locked_at,'discipline_code',s.discipline_code,'discipline_detail',s.discipline_detail),
    'cutoff',cutoff,'provisional_cutoff',provisional,'recommended_source_id',recommended,
    'selection_required',recommended is null,'ambiguous_latest_date',ties>1,'sources',candidates);
end $$;

revoke all on function private.sync_provisional_competition_series(bigint),
  private.competition_configuration_version(bigint),private.check_competition_configuration_keys(jsonb,boolean),
  private.save_series_competition(bigint,bigint,jsonb,bigint),private.require_competition_lifecycle_owner(bigint,bigint,bigint)
  from public,anon,authenticated;
revoke all on function public.create_competition_series(bigint,bigint,text,jsonb),
  public.update_competition_series_draft(bigint,bigint,bigint,jsonb),
  public.continue_competition_series(bigint,bigint,bigint,bigint,text,jsonb),
  public.set_competition_series_archived(bigint,bigint,boolean),public.delete_empty_competition_series(bigint,bigint),
  public.get_competition_series_sources(bigint,bigint,bigint,date) from public,anon,authenticated;
grant execute on function public.create_competition_series(bigint,bigint,text,jsonb),
  public.update_competition_series_draft(bigint,bigint,bigint,jsonb),
  public.continue_competition_series(bigint,bigint,bigint,bigint,text,jsonb),
  public.set_competition_series_archived(bigint,bigint,boolean),public.delete_empty_competition_series(bigint,bigint),
  public.get_competition_series_sources(bigint,bigint,bigint,date) to authenticated;
revoke all on function public.create_competition(
  bigint,bigint,text,text,text,integer,integer,boolean,integer,numeric,text,date,date,text,date,integer,jsonb,text,integer,boolean,date[],date[]),
  public.update_competition(
  bigint,bigint,bigint,text,text,text,integer,integer,boolean,integer,numeric,text,date,date,text,date,integer,jsonb,text,integer,boolean,date[],date[],text)
  from public,anon,authenticated;
grant execute on function public.create_competition(
  bigint,bigint,text,text,text,integer,integer,boolean,integer,numeric,text,date,date,text,date,integer,jsonb,text,integer,boolean,date[],date[]),
  public.update_competition(
  bigint,bigint,bigint,text,text,text,integer,integer,boolean,integer,numeric,text,date,date,text,date,integer,jsonb,text,integer,boolean,date[],date[],text)
  to authenticated;
commit;
