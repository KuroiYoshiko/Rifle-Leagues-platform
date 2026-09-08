-- Additive V1 contract correction. Run after all Competition Series Stage 1 SQL.
-- Existing nullable discipline metadata is retained but ignored by current product
-- writes, Series identity/finalisation, continuation versions and published locks.
begin;

create or replace function private.validate_competition_series(
  p_series_id bigint,
  p_finalise boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.competition_series%rowtype;
  c record;
  components jsonb;
begin
  select * into s from public.competition_series where id = p_series_id for update;
  if not found then return; end if;

  components := private.competition_series_components(s.id);
  if exists (
    select 1
    from (
      select position, row_number() over (order by position) as expected_position
      from public.competition_series_score_components
      where competition_series_id = s.id
    ) positions
    where position <> expected_position
  ) then
    raise exception 'Series component positions must be contiguous.' using errcode = '22023';
  end if;

  if (p_finalise or s.identity_locked_at is not null)
    and jsonb_array_length(components) = 0 then
    raise exception 'Complete Course of Fire before finalising Series identity.' using errcode = '22023';
  end if;

  for c in
    select edition.*, season.organisation_id
    from public.competitions edition
    join public.league_seasons season on season.id = edition.league_season_id
    where edition.competition_series_id = s.id
  loop
    if c.organisation_id <> s.organisation_id then
      raise exception 'Series and Season must belong to the same Organisation.' using errcode = '22023';
    end if;
    if (c.entry_format, c.team_size, c.sets_per_round, c.shots_per_round)
      is distinct from (s.entry_format, s.team_size, s.sets_per_round, s.shots_per_round)
      or private.competition_components(c.id) is distinct from components
      or exists (
        select 1
        from (
          select position, row_number() over (order by position) as expected_position
          from public.competition_score_components
          where competition_id = c.id
        ) positions
        where position <> expected_position
      ) then
      raise exception 'Competition identity must match its Series. Create a new Series to change the shooting format.' using errcode = '22023';
    end if;
    if c.configuration_source_competition_id is not null and not exists (
      select 1
      from public.competitions source
      where source.id = c.configuration_source_competition_id
        and source.competition_series_id = s.id
        and source.id <> c.id
    ) then
      raise exception 'Configuration source must be another edition of this Series.' using errcode = '22023';
    end if;
  end loop;

  if p_finalise and s.identity_locked_at is null then
    update public.competition_series
    set identity_locked_at = clock_timestamp(), updated_by = (select auth.uid())
    where id = s.id;
  end if;
end;
$$;

create or replace function private.protect_series_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid bigint;
  locked timestamptz;
begin
  if tg_table_name = 'competition_series' then
    if tg_op = 'DELETE' then return old; end if;
    if new.organisation_id is distinct from old.organisation_id
      or new.slug is distinct from old.slug then
      raise exception 'Series Organisation and slug are immutable.' using errcode = '22023';
    end if;
    if old.identity_locked_at is not null and (
      new.identity_locked_at is distinct from old.identity_locked_at
      or (new.entry_format, new.team_size, new.sets_per_round, new.shots_per_round)
        is distinct from (old.entry_format, old.team_size, old.sets_per_round, old.shots_per_round)
    ) then
      raise exception 'Finalised Series identity is immutable. Create a new Series instead.' using errcode = '22023';
    end if;
    new.updated_at := clock_timestamp();
    return new;
  end if;

  sid := case when tg_op = 'DELETE' then old.competition_series_id else new.competition_series_id end;
  if tg_op = 'UPDATE' and new.competition_series_id <> old.competition_series_id then
    raise exception 'Series components cannot be moved.' using errcode = '22023';
  end if;
  select identity_locked_at into locked
  from public.competition_series
  where id = sid
  for update;
  if locked is not null then
    raise exception 'Finalised Series components are immutable.' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.sync_provisional_competition_series(p_competition_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.competitions%rowtype;
  s public.competition_series%rowtype;
begin
  select * into c from public.competitions where id = p_competition_id;
  if c.competition_series_id is null then return; end if;
  select * into s from public.competition_series where id = c.competition_series_id for update;
  if s.identity_locked_at is not null then
    perform private.validate_competition_series(s.id);
    return;
  end if;
  if c.status <> 'draft'
    or (select count(*) from public.competitions where competition_series_id = s.id) <> 1 then
    raise exception 'Only the first unpublished draft can correct provisional Series identity.' using errcode = '22023';
  end if;

  update public.competition_series
  set entry_format = c.entry_format,
      team_size = c.team_size,
      sets_per_round = c.sets_per_round,
      shots_per_round = c.shots_per_round,
      updated_by = (select auth.uid())
  where id = s.id;
  delete from public.competition_series_score_components where competition_series_id = s.id;
  insert into public.competition_series_score_components(
    competition_series_id, position, short_label, maximum_score, score_method
  )
  select s.id, position, short_label, maximum_score, score_method
  from public.competition_score_components
  where competition_id = c.id;
  perform private.validate_competition_series(s.id);
end;
$$;

create or replace function private.competition_configuration_version(p_competition_id bigint)
returns text
language sql
stable
set search_path = ''
as $$
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
$$;

-- Legacy clients may still send the two removed keys during a rolling deployment.
-- Keep accepting them, but strip them before the canonical Competition write.
create or replace function private.save_series_competition(
  p_organisation_id bigint,
  p_season_id bigint,
  p_values jsonb,
  p_competition_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_values jsonb;
  v jsonb;
  deadlines date[];
  shoot_by date[];
  result jsonb;
begin
  perform private.check_competition_configuration_keys(p_values, true);
  clean_values := p_values - 'discipline_code' - 'discipline_detail';
  v := jsonb_build_object(
    'entry_format', 'individual', 'team_size', 1, 'sets_per_round', 1,
    'score_components', '[]'::jsonb, 'uses_x_score', false, 'number_of_rounds', 10,
    'entry_window_mode', 'season_default', 'start_date_mode', 'season_default',
    'ranking_method', 'aggregate', 'local_scoring_enabled', true
  ) || clean_values;

  select coalesce(array_agg(value::date order by ordinality), array[]::date[])
  into deadlines
  from jsonb_array_elements_text(coalesce(v->'round_deadlines', '[]'::jsonb)) with ordinality;
  select coalesce(array_agg(value::date order by ordinality), array[]::date[])
  into shoot_by
  from jsonb_array_elements_text(coalesce(v->'round_shoot_by_dates', '[]'::jsonb)) with ordinality;

  if p_competition_id is null then
    result := public.create_competition(
      p_organisation_id, p_season_id, v->>'name', v->>'description',
      v->>'entry_format', (v->>'team_size')::integer, (v->>'shots_per_round')::integer,
      (v->>'uses_x_score')::boolean, (v->>'number_of_rounds')::integer, (v->>'entry_fee')::numeric,
      v->>'entry_window_mode', (v->>'custom_entry_opens_at')::date, (v->>'custom_entry_closes_at')::date,
      v->>'start_date_mode', (v->>'custom_starts_at')::date, (v->>'sets_per_round')::integer,
      v->'score_components', v->>'ranking_method', (v->>'best_rounds_count')::integer,
      (v->>'local_scoring_enabled')::boolean, deadlines, shoot_by
    );
  else
    result := public.update_competition(
      p_organisation_id, p_season_id, p_competition_id, v->>'name', v->>'description',
      v->>'entry_format', (v->>'team_size')::integer, (v->>'shots_per_round')::integer,
      (v->>'uses_x_score')::boolean, (v->>'number_of_rounds')::integer, (v->>'entry_fee')::numeric,
      v->>'entry_window_mode', (v->>'custom_entry_opens_at')::date, (v->>'custom_entry_closes_at')::date,
      v->>'start_date_mode', (v->>'custom_starts_at')::date, (v->>'sets_per_round')::integer,
      v->'score_components', v->>'ranking_method', (v->>'best_rounds_count')::integer,
      (v->>'local_scoring_enabled')::boolean, deadlines, shoot_by, 'draft'
    );
  end if;

  perform private.sync_provisional_competition_series((result->>'id')::bigint);
  return result;
end;
$$;

create or replace function private.protect_published_competition_configuration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'published'
    and (
      new.entry_format,
      new.team_size,
      new.sets_per_round,
      new.shots_per_round,
      new.scoring_method,
      new.maximum_score_per_round,
      new.ranking_method,
      new.best_rounds_count,
      new.uses_x_score,
      new.number_of_rounds
    ) is distinct from (
      old.entry_format,
      old.team_size,
      old.sets_per_round,
      old.shots_per_round,
      old.scoring_method,
      old.maximum_score_per_round,
      old.ranking_method,
      old.best_rounds_count,
      old.uses_x_score,
      old.number_of_rounds
    ) then
    raise exception 'Published Competition sporting configuration is locked. Return the Competition to draft before changing it.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function private.validate_competition_series(bigint, boolean),
  private.protect_series_contract(),
  private.sync_provisional_competition_series(bigint),
  private.competition_configuration_version(bigint),
  private.save_series_competition(bigint, bigint, jsonb, bigint),
  private.protect_published_competition_configuration()
  from public, anon, authenticated;

drop trigger if exists protect_published_competition_configuration on public.competitions;
create trigger protect_published_competition_configuration
  before update of
    entry_format,
    team_size,
    sets_per_round,
    shots_per_round,
    scoring_method,
    maximum_score_per_round,
    ranking_method,
    best_rounds_count,
    uses_x_score,
    number_of_rounds
  on public.competitions
  for each row execute function private.protect_published_competition_configuration();

comment on column public.competition_series.discipline_code is
  'Deprecated nullable metadata. Not used by the V1 product, Series identity, continuation, averages, or compatibility.';
comment on column public.competition_series.discipline_detail is
  'Deprecated nullable metadata. Not used by the V1 product, Series identity, continuation, averages, or compatibility.';
comment on column public.competitions.discipline_code is
  'Deprecated nullable metadata. Not used by the V1 product, Series identity, continuation, averages, or compatibility.';
comment on column public.competitions.discipline_detail is
  'Deprecated nullable metadata. Not used by the V1 product, Series identity, continuation, averages, or compatibility.';

commit;
