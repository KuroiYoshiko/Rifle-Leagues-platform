-- Run after database/season-description.sql, database/competition-rounds.sql,
-- database/competition-entries.sql, and database/competition-divisions.sql.
--
-- Focused, additive upgrade for populated RifleLeagues installations. This
-- script does not recreate competitions, rounds, entries, entrants, divisions,
-- or assignments, and is safe to rerun.

begin;

alter table public.competitions
  add column if not exists entry_window_mode text not null default 'season_default',
  add column if not exists custom_entry_opens_at date,
  add column if not exists custom_entry_closes_at date,
  add column if not exists start_date_mode text not null default 'season_default',
  add column if not exists custom_starts_at date,
  add column if not exists sets_per_round integer not null default 1,
  add column if not exists ranking_method text not null default 'aggregate',
  add column if not exists best_rounds_count integer,
  add column if not exists local_scoring_enabled boolean not null default true;

alter table public.competition_rounds
  add column if not exists shoot_by_date date;

-- A previous run may already have the deferred configuration trigger. It is
-- recreated later in this same transaction; dropping it here prevents the two
-- narrow ranking backfills from unnecessarily revalidating legacy schedules.
drop trigger if exists validate_final_competition_configuration_schedule
  on public.competitions;

-- X ranking semantics are intentionally undefined for Best N Average. Existing
-- configuration rows are normalised without changing Competition identity or
-- any entry, entrant, round, or division relationship.
update public.competitions
set uses_x_score = false
where ranking_method = 'best_n_average'
  and uses_x_score = true;

-- Older drafts could select Best N before supplying the count. Preserve those
-- drafts with the least surprising valid meaning: all configured rounds count.
update public.competitions
set best_rounds_count = number_of_rounds
where ranking_method = 'best_n_average'
  and best_rounds_count is null;

alter table public.competitions
  drop constraint if exists competitions_best_rounds_count_value;

-- Existing databases used a 52-round bound. The new bound is deliberately
-- still defensive while allowing longer postal programmes.
alter table public.competitions
  drop constraint if exists competitions_number_of_rounds_value;
alter table public.competitions
  add constraint competitions_number_of_rounds_value
  check (number_of_rounds between 1 and 100) not valid;
alter table public.competitions
  validate constraint competitions_number_of_rounds_value;

alter table public.competition_rounds
  drop constraint if exists competition_rounds_round_number_value;
alter table public.competition_rounds
  add constraint competition_rounds_round_number_value
  check (round_number between 1 and 100) not valid;
alter table public.competition_rounds
  validate constraint competition_rounds_round_number_value;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_entry_window_mode_value'
  ) then
    alter table public.competitions
      add constraint competitions_entry_window_mode_value check (
        entry_window_mode in ('season_default', 'custom')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_best_n_x_value'
  ) then
    alter table public.competitions
      add constraint competitions_best_n_x_value check (
        ranking_method <> 'best_n_average' or uses_x_score = false
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_custom_entry_window_value'
  ) then
    alter table public.competitions
      add constraint competitions_custom_entry_window_value check (
        (
          entry_window_mode = 'season_default'
          and custom_entry_opens_at is null
          and custom_entry_closes_at is null
        )
        or (
          entry_window_mode = 'custom'
          and (
            custom_entry_opens_at is null
            or custom_entry_closes_at is null
            or custom_entry_closes_at >= custom_entry_opens_at
          )
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_start_date_mode_value'
  ) then
    alter table public.competitions
      add constraint competitions_start_date_mode_value check (
        start_date_mode in ('season_default', 'custom')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_custom_start_value'
  ) then
    alter table public.competitions
      add constraint competitions_custom_start_value check (
        (start_date_mode = 'season_default' and custom_starts_at is null)
        or start_date_mode = 'custom'
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_custom_dates_supported_value'
  ) then
    alter table public.competitions
      add constraint competitions_custom_dates_supported_value check (
        (custom_entry_opens_at is null or custom_entry_opens_at between date '1900-01-01' and date '2200-12-31')
        and (custom_entry_closes_at is null or custom_entry_closes_at between date '1900-01-01' and date '2200-12-31')
        and (custom_starts_at is null or custom_starts_at between date '1900-01-01' and date '2200-12-31')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_sets_per_round_value'
  ) then
    alter table public.competitions
      add constraint competitions_sets_per_round_value
      check (sets_per_round between 1 and 100) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_ranking_method_value'
  ) then
    alter table public.competitions
      add constraint competitions_ranking_method_value check (
        ranking_method in ('aggregate', 'best_n_average', 'round_robin', 'gun_score')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_best_rounds_count_value'
  ) then
    alter table public.competitions
      add constraint competitions_best_rounds_count_value check (
        (
          ranking_method = 'best_n_average'
          and best_rounds_count between 1 and number_of_rounds
        )
        or (
          ranking_method <> 'best_n_average'
          and best_rounds_count is null
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competition_rounds'::regclass
      and conname = 'competition_rounds_shoot_by_value'
  ) then
    alter table public.competition_rounds
      add constraint competition_rounds_shoot_by_value check (
        shoot_by_date is null
        or (
          shoot_by_date between date '1900-01-01' and date '2200-12-31'
          and shoot_by_date <= deadline
        )
      ) not valid;
  end if;
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
    and staff.role = 'owner'
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
  on conflict (competition_id, position) do update
  set short_label = excluded.short_label,
      maximum_score = excluded.maximum_score,
      score_method = excluded.score_method;

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

-- Entry mutations and read models now resolve their dates through the same
-- authoritative Competition helper.
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
$$;

revoke execute on function private.get_club_competition_entry_mutation_context(bigint, boolean)
  from public, anon, authenticated;

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
$$;

alter table public.competitions
  validate constraint competitions_entry_window_mode_value;
alter table public.competitions
  validate constraint competitions_custom_entry_window_value;
alter table public.competitions
  validate constraint competitions_start_date_mode_value;
alter table public.competitions
  validate constraint competitions_custom_start_value;
alter table public.competitions
  validate constraint competitions_custom_dates_supported_value;
alter table public.competitions
  validate constraint competitions_sets_per_round_value;
alter table public.competitions
  validate constraint competitions_ranking_method_value;
alter table public.competitions
  validate constraint competitions_best_rounds_count_value;
alter table public.competitions
  validate constraint competitions_best_n_x_value;
alter table public.competition_rounds
  validate constraint competition_rounds_shoot_by_value;

comment on column public.competitions.entry_window_mode is
  'Whether the competition inherits the season default entry window or uses custom dates.';
comment on column public.competitions.custom_entry_opens_at is
  'Competition entry-open date when entry_window_mode is custom; nullable for an incomplete draft.';
comment on column public.competitions.custom_entry_closes_at is
  'Competition entry-close date when entry_window_mode is custom; nullable for an incomplete draft.';
comment on column public.competitions.start_date_mode is
  'Whether the competition inherits the season start or uses custom_starts_at.';
comment on column public.competitions.custom_starts_at is
  'Competition start date when start_date_mode is custom; nullable for an incomplete draft.';
comment on column public.competitions.sets_per_round is
  'Number of repetitions of the ordered score-component definition per shooter and round.';
comment on column public.competitions.ranking_method is
  'Base ranking method. X recording is configured independently through uses_x_score.';
comment on column public.competitions.local_scoring_enabled is
  'When true, club and organisation scoring is configured; when false, organisation-only scoring is configured.';
comment on column public.competition_rounds.deadline is
  'Legacy deadline column retained as the authoritative Round End date.';
comment on column public.competition_rounds.shoot_by_date is
  'Optional local/club scoring cutoff. When null, the Round End date is the future local cutoff.';

create table if not exists public.competition_score_components (
  id bigint generated always as identity primary key,
  competition_id bigint not null
    references public.competitions (id) on delete cascade,
  position integer not null,
  short_label text,
  maximum_score numeric(10, 2) not null,
  score_method text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_score_components_position_value check (
    position between 1 and 20
  ),
  constraint competition_score_components_label_value check (
    short_label is null
    or (
      char_length(short_label) between 1 and 30
      and short_label = btrim(short_label)
    )
  ),
  constraint competition_score_components_maximum_value check (
    maximum_score between 0.01 and 1000000
    and maximum_score = round(maximum_score, 2)
  ),
  constraint competition_score_components_method_value check (
    score_method in ('points_scored', 'points_dropped')
  ),
  constraint competition_score_components_competition_position_unique unique (
    competition_id,
    position
  )
);

comment on table public.competition_score_components is
  'Ordered relational Course of Fire score components for one set. sets_per_round determines repetition.';

drop trigger if exists set_competition_score_components_updated_at
  on public.competition_score_components;
create trigger set_competition_score_components_updated_at
  before update on public.competition_score_components
  for each row execute function private.set_updated_at();

-- Backfill only Competition rows whose legacy configuration actually defines
-- one score. Incomplete drafts remain incomplete and can be finished in UI.
insert into public.competition_score_components (
  competition_id,
  position,
  short_label,
  maximum_score,
  score_method
)
select
  competition.id,
  1,
  null,
  competition.maximum_score_per_round::numeric(10, 2),
  competition.scoring_method
from public.competitions as competition
where competition.maximum_score_per_round is not null
  and not exists (
    select 1
    from public.competition_score_components as component
    where component.competition_id = competition.id
  )
on conflict (competition_id, position) do nothing;

create or replace function private.get_competition_effective_dates(
  p_competition_id bigint
)
returns table (
  effective_entry_opens_at date,
  effective_entry_closes_at date,
  effective_starts_at date,
  season_ends_at date
)
language sql
stable
set search_path = ''
as $$
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
$$;

revoke execute on function private.get_competition_effective_dates(bigint)
  from public, anon, authenticated;

create or replace function private.validate_competition_round()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.validate_competition_round()
  from public, anon, authenticated;

drop trigger if exists validate_competition_round
  on public.competition_rounds;
create trigger validate_competition_round
  before insert or update of competition_id, round_number, deadline, shoot_by_date
  on public.competition_rounds
  for each row execute function private.validate_competition_round();

create or replace function private.validate_final_competition_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_competition_id bigint;
  v_number_of_rounds integer;
  v_effective_starts_at date;
begin
  v_competition_id := case
    when tg_table_name = 'competitions' then coalesce(new.id, old.id)
    else coalesce(new.competition_id, old.competition_id)
  end;

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
$$;

revoke execute on function private.validate_final_competition_schedule()
  from public, anon, authenticated;

drop trigger if exists validate_final_competition_round_schedule
  on public.competition_rounds;
create constraint trigger validate_final_competition_round_schedule
  after insert or update or delete on public.competition_rounds
  deferrable initially deferred
  for each row execute function private.validate_final_competition_schedule();

drop trigger if exists validate_final_competition_configuration_schedule
  on public.competitions;
create constraint trigger validate_final_competition_configuration_schedule
  after update on public.competitions
  deferrable initially deferred
  for each row execute function private.validate_final_competition_schedule();

alter table public.competition_score_components enable row level security;
revoke all privileges on table public.competition_score_components
  from anon, authenticated;
revoke all privileges on sequence public.competition_score_components_id_seq
  from anon, authenticated;
grant select (
  id,
  competition_id,
  position,
  short_label,
  maximum_score,
  score_method,
  created_at,
  updated_at
) on table public.competition_score_components to authenticated;

drop policy if exists "Authenticated users can read visible competition score components"
  on public.competition_score_components;
create policy "Authenticated users can read visible competition score components"
on public.competition_score_components
for select
to authenticated
using (
  exists (
    select 1
    from public.competitions as competition
    where competition.id = competition_score_components.competition_id
  )
);

-- Refresh column-level grants so the application can read the new config.
revoke select on table public.competitions from authenticated;
grant select (
  id,
  league_season_id,
  name,
  slug,
  description,
  status,
  entry_format,
  team_size,
  scoring_method,
  maximum_score_per_round,
  shots_per_round,
  uses_x_score,
  number_of_rounds,
  entry_fee,
  entry_window_mode,
  custom_entry_opens_at,
  custom_entry_closes_at,
  start_date_mode,
  custom_starts_at,
  sets_per_round,
  ranking_method,
  best_rounds_count,
  local_scoring_enabled,
  created_at,
  updated_at
) on table public.competitions to authenticated;

revoke select on table public.competition_rounds from authenticated;
grant select (
  id,
  competition_id,
  round_number,
  deadline,
  shoot_by_date,
  created_at,
  updated_at
) on table public.competition_rounds to authenticated;

create or replace function private.validate_competition_configuration(
  p_status text,
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
  p_effective_entry_opens_at date,
  p_effective_entry_closes_at date,
  p_effective_starts_at date,
  p_season_ends_at date,
  p_sets_per_round integer,
  p_score_components jsonb,
  p_ranking_method text,
  p_best_rounds_count integer,
  p_local_scoring_enabled boolean,
  p_round_deadlines date[],
  p_round_shoot_by_dates date[]
)
returns void
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.validate_competition_configuration(
  text, text, integer, integer, boolean, integer, numeric, text, date, date,
  text, date, date, date, date, date, integer, jsonb, text, integer, boolean,
  date[], date[]
) from public, anon, authenticated;

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
    and staff.role = 'owner'
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

comment on function public.create_competition(
  bigint, bigint, text, text, text, integer, integer, boolean, integer, numeric,
  text, date, date, text, date, integer, jsonb, text, integer, boolean,
  date[], date[]
) is
  'Creates a private draft using inherited/custom dates and relational Course of Fire configuration.';

comment on function public.update_competition(
  bigint, bigint, bigint, text, text, text, integer, integer, boolean, integer,
  numeric, text, date, date, text, date, integer, jsonb, text, integer, boolean,
  date[], date[], text
) is
  'Updates Competition configuration in place, preserving stable Competition and unchanged Round IDs.';

revoke execute on function public.create_competition(
  bigint, bigint, text, text, text, integer, integer, boolean, integer, numeric,
  text, date, date, text, date, integer, jsonb, text, integer, boolean,
  date[], date[]
) from public, anon, authenticated;
grant execute on function public.create_competition(
  bigint, bigint, text, text, text, integer, integer, boolean, integer, numeric,
  text, date, date, text, date, integer, jsonb, text, integer, boolean,
  date[], date[]
) to authenticated;

revoke execute on function public.update_competition(
  bigint, bigint, bigint, text, text, text, integer, integer, boolean, integer,
  numeric, text, date, date, text, date, integer, jsonb, text, integer, boolean,
  date[], date[], text
) from public, anon, authenticated;
grant execute on function public.update_competition(
  bigint, bigint, bigint, text, text, text, integer, integer, boolean, integer,
  numeric, text, date, date, text, date, integer, jsonb, text, integer, boolean,
  date[], date[], text
) to authenticated;

-- Preserve the original RPC signatures for deployed clients. Their legacy
-- one-score inputs are translated into the relational Course of Fire model.
create or replace function public.create_competition(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_name text,
  p_description text,
  p_entry_format text,
  p_team_size integer,
  p_scoring_method text,
  p_maximum_score_per_round integer,
  p_shots_per_round integer,
  p_uses_x_score boolean,
  p_number_of_rounds integer,
  p_entry_fee numeric,
  p_round_deadlines date[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.update_competition(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_name text,
  p_description text,
  p_entry_format text,
  p_team_size integer,
  p_scoring_method text,
  p_maximum_score_per_round integer,
  p_shots_per_round integer,
  p_uses_x_score boolean,
  p_number_of_rounds integer,
  p_entry_fee numeric,
  p_round_deadlines date[],
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Keep the existing table-shaped result contract, but calculate the entry
-- state from each Competition's effective window.
create or replace function public.get_club_competition_entries(
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
$$;

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
  select v_actor_id, organisation.slug, season.slug, competition.slug,
    effective.effective_entry_closes_at
  from public.organisation_staff as staff
  join public.organisations as organisation on organisation.id = staff.organisation_id
  join public.league_seasons as season on season.organisation_id = organisation.id
  join public.competitions as competition on competition.league_season_id = season.id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
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
    'entry_closes_at', v_context.entry_closes_at,
    'effective_entry_closes_at', v_context.entry_closes_at,
    'entry_window_closed', (
      v_context.entry_closes_at is not null
      and current_date > v_context.entry_closes_at
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
            select jsonb_agg(
              assignment.competition_entrant_id
              order by assignment.competition_entrant_id
            )
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
  join public.league_seasons as season on season.id = competition.league_season_id
  where competition.id = p_competition_id
    and season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;

  return v_result;
end;
$$;

-- Keep inherited published Competitions valid when their Season defaults are
-- edited later, and preserve the pre-existing Season-end protection.
create or replace function private.protect_competition_season_bounds()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.protect_competition_season_bounds()
  from public, anon, authenticated;

drop trigger if exists protect_competition_season_bounds
  on public.league_seasons;
create trigger protect_competition_season_bounds
  before update of entry_opens_at, entry_closes_at, starts_at, ends_at
  on public.league_seasons
  for each row execute function private.protect_competition_season_bounds();

commit;
