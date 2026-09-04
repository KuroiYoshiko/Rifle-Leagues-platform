-- Run after database/competition-configuration-owner-save-fix.sql.
--
-- Additive source-score foundation and Individual Competition score entry.
-- Existing competitions, rounds, entries, entrants, participants, divisions,
-- and their identifiers are preserved. Pair/Team entry, concurrent grouping,
-- standings, results, and ranking calculations remain intentionally deferred.

begin;

create table if not exists public.shooting_score_sources (
  id bigint generated always as identity primary key,
  shooter_profile_id uuid not null
    references public.profiles (id),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shooting_score_sources is
  'One physical shooting result for one shooter. Competition ownership is represented only by competition_score_usages.';
comment on column public.shooting_score_sources.shooter_profile_id is
  'Stable shooter identity derived from the selected entrant participant; names and club details remain relational.';

create table if not exists public.shooting_score_values (
  id bigint generated always as identity primary key,
  shooting_score_source_id bigint not null
    references public.shooting_score_sources (id) on delete cascade,
  set_number integer not null,
  component_position integer not null,
  achieved_score numeric(10, 2) not null,
  x_count integer,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shooting_score_values_set_number_value check (
    set_number between 1 and 100
  ),
  constraint shooting_score_values_component_position_value check (
    component_position between 1 and 20
  ),
  constraint shooting_score_values_achieved_score_value check (
    achieved_score between 0 and 1000000
    and achieved_score = round(achieved_score, 2)
  ),
  constraint shooting_score_values_x_count_value check (
    x_count is null or x_count between 0 and 10000
  ),
  constraint shooting_score_values_source_slot_unique unique (
    shooting_score_source_id,
    set_number,
    component_position
  )
);

comment on table public.shooting_score_values is
  'Canonical achieved gun scores for the set/component slots of a physical source result. Missing rows mean no score recorded.';
comment on column public.shooting_score_values.achieved_score is
  'Actual achieved score. Points-dropped entry is converted to maximum_score minus entered points before persistence.';
comment on column public.shooting_score_values.x_count is
  'Optional physical X count. Competition-specific save RPCs decide whether X entry is enabled and validate the round total.';

create table if not exists public.competition_score_usages (
  id bigint generated always as identity primary key,
  shooting_score_source_id bigint not null
    references public.shooting_score_sources (id),
  competition_id bigint not null
    references public.competitions (id) on delete cascade,
  competition_round_id bigint not null
    references public.competition_rounds (id),
  competition_entrant_participant_id bigint not null
    references public.competition_entrant_participants (id),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_score_usages_competition_slot_unique unique (
    competition_id,
    competition_round_id,
    competition_entrant_participant_id
  ),
  constraint competition_score_usages_source_competition_unique unique (
    shooting_score_source_id,
    competition_id
  )
);

comment on table public.competition_score_usages is
  'Applies one physical source score to one exact Competition participant/round slot. Future compatible Competitions may reference the same source.';

create index if not exists shooting_score_sources_shooter_profile_idx
  on public.shooting_score_sources (shooter_profile_id);
create index if not exists shooting_score_sources_created_by_idx
  on public.shooting_score_sources (created_by)
  where created_by is not null;
create index if not exists shooting_score_sources_updated_by_idx
  on public.shooting_score_sources (updated_by)
  where updated_by is not null;
create index if not exists shooting_score_values_created_by_idx
  on public.shooting_score_values (created_by)
  where created_by is not null;
create index if not exists shooting_score_values_updated_by_idx
  on public.shooting_score_values (updated_by)
  where updated_by is not null;
create index if not exists competition_score_usages_round_idx
  on public.competition_score_usages (competition_round_id);
create index if not exists competition_score_usages_participant_idx
  on public.competition_score_usages (competition_entrant_participant_id);
create index if not exists competition_score_usages_created_by_idx
  on public.competition_score_usages (created_by)
  where created_by is not null;
create index if not exists competition_score_usages_updated_by_idx
  on public.competition_score_usages (updated_by)
  where updated_by is not null;

drop trigger if exists set_shooting_score_sources_updated_at
  on public.shooting_score_sources;
create trigger set_shooting_score_sources_updated_at
  before update on public.shooting_score_sources
  for each row execute function private.set_updated_at();

drop trigger if exists set_shooting_score_values_updated_at
  on public.shooting_score_values;
create trigger set_shooting_score_values_updated_at
  before update on public.shooting_score_values
  for each row execute function private.set_updated_at();

drop trigger if exists set_competition_score_usages_updated_at
  on public.competition_score_usages;
create trigger set_competition_score_usages_updated_at
  before update on public.competition_score_usages
  for each row execute function private.set_updated_at();

-- A usage always joins one source shooter to the same profile represented by
-- one participant, and its round and submitted entry belong to the same exact
-- Competition. This trigger is format-agnostic so Pair/Team participant
-- usages can be added later without inventing entrant totals.
create or replace function private.validate_competition_score_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.validate_competition_score_usage()
  from public, anon, authenticated;

drop trigger if exists validate_competition_score_usage
  on public.competition_score_usages;
create trigger validate_competition_score_usage
  before insert or update of shooting_score_source_id, competition_id,
    competition_round_id, competition_entrant_participant_id
  on public.competition_score_usages
  for each row execute function private.validate_competition_score_usage();

-- Every stored value must be valid for every Competition currently consuming
-- its source. A source with several future usages therefore remains a single
-- canonical result while each linked Course of Fire is checked for
-- compatibility.
create or replace function private.validate_shooting_score_value()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.validate_shooting_score_value()
  from public, anon, authenticated;

drop trigger if exists validate_shooting_score_value
  on public.shooting_score_values;
create trigger validate_shooting_score_value
  before insert or update of shooting_score_source_id, set_number,
    component_position, achieved_score
  on public.shooting_score_values
  for each row execute function private.validate_shooting_score_value();

-- Aggregate X validation is deferred so a valid batch may rebalance values
-- without an intermediate row temporarily exceeding the shot count.
create or replace function private.validate_shooting_score_x_total()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.validate_shooting_score_x_total()
  from public, anon, authenticated;

drop trigger if exists validate_shooting_score_x_total
  on public.shooting_score_values;
create constraint trigger validate_shooting_score_x_total
  after insert or update on public.shooting_score_values
  deferrable initially deferred
  for each row execute function private.validate_shooting_score_x_total();

-- Once a source result exists, changing the slot definition would reinterpret
-- canonical values already in use. Local/central access may still be changed.
create or replace function private.protect_scored_competition_configuration()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.protect_scored_competition_configuration()
  from public, anon, authenticated;

drop trigger if exists protect_scored_competition_configuration
  on public.competitions;
create trigger protect_scored_competition_configuration
  before update of sets_per_round, uses_x_score, shots_per_round
  on public.competitions
  for each row execute function private.protect_scored_competition_configuration();

create or replace function private.protect_scored_competition_component()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.protect_scored_competition_component()
  from public, anon, authenticated;

drop trigger if exists protect_scored_competition_component
  on public.competition_score_components;
create trigger protect_scored_competition_component
  before insert or update or delete on public.competition_score_components
  for each row execute function private.protect_scored_competition_component();

-- A submitted entry with score usages cannot be returned to draft or
-- withdrawn. Participant deletion is independently blocked by the usage FK.
create or replace function private.protect_scored_competition_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
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
$$;

revoke execute on function private.protect_scored_competition_entry()
  from public, anon, authenticated;

drop trigger if exists protect_scored_competition_entry
  on public.club_competition_entries;
create trigger protect_scored_competition_entry
  before update of status on public.club_competition_entries
  for each row execute function private.protect_scored_competition_entry();

alter table public.shooting_score_sources enable row level security;
alter table public.shooting_score_values enable row level security;
alter table public.competition_score_usages enable row level security;

-- No direct Data API access is granted. Authenticated reads and writes use the
-- two narrow RPCs below, which return only score-management data authorised for
-- the caller and validate every mutation in one transaction.
revoke all privileges on table public.shooting_score_sources
  from public, anon, authenticated;
revoke all privileges on sequence public.shooting_score_sources_id_seq
  from public, anon, authenticated;
revoke all privileges on table public.shooting_score_values
  from public, anon, authenticated;
revoke all privileges on sequence public.shooting_score_values_id_seq
  from public, anon, authenticated;
revoke all privileges on table public.competition_score_usages
  from public, anon, authenticated;
revoke all privileges on sequence public.competition_score_usages_id_seq
  from public, anon, authenticated;

-- Resolves one exact score-entry scope. Passing a club ID always requests
-- local club scope, even if the caller is also organisation staff. This avoids
-- turning organisation management into unrelated club-management access.
create or replace function private.require_individual_score_entry_context(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint,
  p_club_id bigint default null
)
returns table (
  actor_id uuid,
  access_scope text,
  scoped_club_id bigint,
  competition_name text,
  uses_x_score boolean,
  sets_per_round integer,
  shots_per_round integer,
  effective_starts_at date,
  competition_started boolean,
  round_number integer,
  round_end date,
  shoot_by_date date,
  local_cutoff date,
  local_cutoff_passed boolean,
  can_edit boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_context record;
  v_access_scope text;
  v_local_authorised boolean := false;
  v_central_authorised boolean := false;
  v_started boolean;
  v_local_cutoff date;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select competition.name, competition.entry_format,
    competition.local_scoring_enabled, competition.uses_x_score,
    competition.sets_per_round, competition.shots_per_round,
    competition.status as competition_status,
    season.status as season_status,
    effective.effective_starts_at,
    round.round_number, round.deadline, round.shoot_by_date
  into v_context
  from public.organisations as organisation
  join public.league_seasons as season
    on season.organisation_id = organisation.id
  join public.competitions as competition
    on competition.league_season_id = season.id
  join public.competition_rounds as round
    on round.competition_id = competition.id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
    and season.id = p_league_season_id
    and competition.id = p_competition_id
    and round.id = p_competition_round_id;

  if not found
    or v_context.competition_status <> 'published'
    or v_context.season_status not in ('open', 'active', 'completed') then
    raise exception 'Published Competition score-entry context was not found.'
      using errcode = 'P0002';
  end if;

  if v_context.entry_format <> 'individual' then
    raise exception 'Score entry is currently available for Individual Competitions only.'
      using errcode = '22023';
  end if;

  if p_club_id is null then
    select exists (
      select 1
      from public.organisation_staff as staff
      where staff.organisation_id = p_organisation_id
        and staff.user_id = v_actor_id
        and staff.status = 'active'
        and staff.role in ('owner', 'manager')
    ) into v_central_authorised;
    v_access_scope := 'organisation';
  else
    select exists (
      select 1
      from public.club_memberships as actor_membership
      join public.clubs as club
        on club.id = actor_membership.club_id
      join public.club_competition_entries as entry
        on entry.club_id = club.id
      where actor_membership.user_id = v_actor_id
        and actor_membership.club_id = p_club_id
        and actor_membership.status = 'active'
        and actor_membership.role in ('owner', 'official')
        and club.status = 'active'
        and entry.competition_id = p_competition_id
        and entry.status = 'submitted'
    ) into v_local_authorised;
    v_access_scope := 'club';
  end if;

  if (p_club_id is null and not v_central_authorised)
    or (p_club_id is not null and not v_local_authorised) then
    raise exception 'You do not have permission to manage scores in this exact scope.'
      using errcode = '42501';
  end if;

  v_started := v_context.effective_starts_at is not null
    and current_date >= v_context.effective_starts_at;
  v_local_cutoff := coalesce(v_context.shoot_by_date, v_context.deadline);

  return query select
    v_actor_id,
    v_access_scope,
    p_club_id,
    v_context.name::text,
    v_context.uses_x_score::boolean,
    v_context.sets_per_round::integer,
    v_context.shots_per_round::integer,
    v_context.effective_starts_at::date,
    v_started,
    v_context.round_number::integer,
    v_context.deadline::date,
    v_context.shoot_by_date::date,
    v_local_cutoff,
    current_date > v_local_cutoff,
    case
      when v_access_scope = 'organisation' then v_started
      else v_started
        and v_context.local_scoring_enabled
        and current_date <= v_local_cutoff
    end;
end;
$$;

revoke execute on function private.require_individual_score_entry_context(
  bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated;

create or replace function public.get_individual_competition_score_entry(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint,
  p_club_id bigint default null
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
  from private.require_individual_score_entry_context(
    p_organisation_id,
    p_league_season_id,
    p_competition_id,
    p_competition_round_id,
    p_club_id
  );

  select jsonb_build_object(
    'access_scope', v_context.access_scope,
    'database_today', current_date,
    'can_edit', v_context.can_edit,
    'competition', jsonb_build_object(
      'id', competition.id,
      'name', competition.name,
      'entry_format', competition.entry_format,
      'uses_x_score', competition.uses_x_score,
      'sets_per_round', competition.sets_per_round,
      'shots_per_round', competition.shots_per_round,
      'local_scoring_enabled', competition.local_scoring_enabled,
      'effective_starts_at', v_context.effective_starts_at,
      'started', v_context.competition_started
    ),
    'round', jsonb_build_object(
      'id', round.id,
      'round_number', round.round_number,
      'deadline', round.deadline,
      'shoot_by_date', round.shoot_by_date,
      'local_cutoff', v_context.local_cutoff,
      'local_cutoff_passed', v_context.local_cutoff_passed
    ),
    'components', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position', component.position,
          'short_label', component.short_label,
          'maximum_score', component.maximum_score,
          'score_method', component.score_method
        ) order by component.position
      )
      from public.competition_score_components as component
      where component.competition_id = competition.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'participant_id', participant.id,
          'entrant_id', entrant.id,
          'entrant_position', entrant.position,
          'club_id', club.id,
          'club_name', club.name,
          'first_name', profile.first_name,
          'last_name', profile.last_name,
          'values', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'set_number', set_slot.set_number,
                'component_position', component.position,
                'entered_score', case
                  when value.id is null then null
                  when component.score_method = 'points_dropped'
                    then component.maximum_score - value.achieved_score
                  else value.achieved_score
                end,
                'x_count', case
                  when competition.uses_x_score then value.x_count
                  else null
                end
              ) order by set_slot.set_number, component.position
            )
            from generate_series(1, competition.sets_per_round)
              as set_slot(set_number)
            cross join public.competition_score_components as component
            left join public.shooting_score_values as value
              on value.shooting_score_source_id = usage.shooting_score_source_id
             and value.set_number = set_slot.set_number
             and value.component_position = component.position
            where component.competition_id = competition.id
          ), '[]'::jsonb)
        ) order by club.name, entry.id, entrant.position, participant.id
      )
      from public.club_competition_entries as entry
      join public.clubs as club on club.id = entry.club_id
      join public.competition_entrants as entrant
        on entrant.club_competition_entry_id = entry.id
      join public.competition_entrant_participants as participant
        on participant.competition_entrant_id = entrant.id
       and participant.club_competition_entry_id = entry.id
      join public.club_memberships as membership
        on membership.id = participant.club_membership_id
      join public.profiles as profile on profile.id = membership.user_id
      left join public.competition_score_usages as usage
        on usage.competition_id = competition.id
       and usage.competition_round_id = round.id
       and usage.competition_entrant_participant_id = participant.id
      where entry.competition_id = competition.id
        and entry.status = 'submitted'
        and (p_club_id is null or entry.club_id = p_club_id)
    ), '[]'::jsonb)
  ) into v_result
  from public.competitions as competition
  join public.competition_rounds as round
    on round.competition_id = competition.id
  where competition.id = p_competition_id
    and round.id = p_competition_round_id;

  if v_result is null then
    raise exception 'Competition score-entry context was not found.'
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

comment on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) is
  'Returns one authorised Individual Competition round editor. Canonical achieved values are converted back to configured entry representation.';

revoke execute on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) to authenticated;

create or replace function public.save_individual_competition_round_scores(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint,
  p_club_id bigint,
  p_scores jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context record;
  v_shooter record;
  v_slot record;
  v_participant_id bigint;
  v_shooter_profile_id uuid;
  v_values jsonb;
  v_component_count integer;
  v_expected_slot_count integer;
  v_source_id bigint;
  v_entered_score numeric(10, 2);
  v_achieved_score numeric(10, 2);
  v_x_count integer;
  v_recorded_participant_count integer := 0;
  v_recorded_value_count integer := 0;
begin
  select * into v_context
  from private.require_individual_score_entry_context(
    p_organisation_id,
    p_league_season_id,
    p_competition_id,
    p_competition_round_id,
    p_club_id
  );

  if not v_context.competition_started then
    raise exception 'Scores cannot be entered before the effective Competition Start.'
      using errcode = '22023';
  end if;

  if v_context.access_scope = 'club' and not v_context.can_edit then
    if not (
      select competition.local_scoring_enabled
      from public.competitions as competition
      where competition.id = p_competition_id
    ) then
      raise exception 'This Competition uses organisation score entry only.'
        using errcode = '22023';
    end if;
    raise exception 'The local score-entry cutoff for this Round has passed.'
      using errcode = '22023';
  end if;

  if p_scores is null or jsonb_typeof(p_scores) <> 'array' then
    raise exception 'Round scores must be supplied as a list.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_scores) > 20000 then
    raise exception 'A score-entry batch cannot contain more than 20,000 shooters.'
      using errcode = '22023';
  end if;

  select count(*)::integer
  into v_component_count
  from public.competition_score_components as component
  where component.competition_id = p_competition_id;

  if v_component_count = 0 then
    raise exception 'The Competition Course of Fire has no score components.'
      using errcode = '22023';
  end if;

  v_expected_slot_count := v_context.sets_per_round * v_component_count;

  if exists (
    select 1
    from jsonb_array_elements(p_scores) as item(value)
    where case
      when jsonb_typeof(item.value) <> 'object' then true
      else not (item.value ?& array['participant_id', 'values'])
        or item.value - array['participant_id', 'values'] <> '{}'::jsonb
        or jsonb_typeof(item.value -> 'participant_id') <> 'number'
        or (item.value ->> 'participant_id') !~ '^[1-9][0-9]{0,17}$'
        or jsonb_typeof(item.value -> 'values') <> 'array'
    end
  ) then
    raise exception 'Every score row must identify one participant and a score-value list.'
      using errcode = '22023';
  end if;

  if (
    select count(distinct (item.value ->> 'participant_id')::bigint)
    from jsonb_array_elements(p_scores) as item(value)
  ) <> jsonb_array_length(p_scores) then
    raise exception 'Each participant may appear only once in a score-entry batch.'
      using errcode = '23505';
  end if;

  if jsonb_array_length(p_scores) <> (
    select count(*)
    from public.club_competition_entries as entry
    join public.competition_entrants as entrant
      on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants as participant
      on participant.competition_entrant_id = entrant.id
     and participant.club_competition_entry_id = entry.id
    where entry.competition_id = p_competition_id
      and entry.status = 'submitted'
      and (p_club_id is null or entry.club_id = p_club_id)
  ) then
    raise exception 'The score-entry batch must contain every visible submitted Individual participant.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_scores) as item(value)
    where not exists (
      select 1
      from public.club_competition_entries as entry
      join public.competition_entrants as entrant
        on entrant.club_competition_entry_id = entry.id
      join public.competition_entrant_participants as participant
        on participant.competition_entrant_id = entrant.id
       and participant.club_competition_entry_id = entry.id
      where participant.id = (item.value ->> 'participant_id')::bigint
        and entry.competition_id = p_competition_id
        and entry.status = 'submitted'
        and (p_club_id is null or entry.club_id = p_club_id)
    )
  ) then
    raise exception 'A score row contains a participant outside this exact Competition scope.'
      using errcode = '22023';
  end if;

  -- Local and central saves for the same physical Competition Round serialize
  -- on one narrow transaction lock, preventing duplicate source creation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'competition-score:' || p_competition_id::text || ':' || p_competition_round_id::text,
      0
    )
  );

  for v_shooter in
    select item.value
    from jsonb_array_elements(p_scores) as item(value)
  loop
    v_participant_id := (v_shooter.value ->> 'participant_id')::bigint;
    v_values := v_shooter.value -> 'values';

    if jsonb_array_length(v_values) <> v_expected_slot_count then
      raise exception 'Every participant must contain every configured Set and score component.'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_values) as slot(value)
      where case
        when jsonb_typeof(slot.value) <> 'object' then true
        else not (slot.value ?& array[
            'set_number', 'component_position', 'entered_score', 'x_count'
          ])
          or slot.value - array[
            'set_number', 'component_position', 'entered_score', 'x_count'
          ] <> '{}'::jsonb
          or jsonb_typeof(slot.value -> 'set_number') <> 'number'
          or (slot.value ->> 'set_number') !~ '^(?:[1-9]|[1-9][0-9]|100)$'
          or jsonb_typeof(slot.value -> 'component_position') <> 'number'
          or (slot.value ->> 'component_position') !~ '^(?:[1-9]|1[0-9]|20)$'
          or (
            jsonb_typeof(slot.value -> 'entered_score') <> 'null'
            and (
              jsonb_typeof(slot.value -> 'entered_score') <> 'string'
              or (slot.value ->> 'entered_score')
                !~ '^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$'
            )
          )
          or (
            jsonb_typeof(slot.value -> 'x_count') <> 'null'
            and (
              jsonb_typeof(slot.value -> 'x_count') <> 'number'
              or (slot.value ->> 'x_count') !~ '^(?:0|[1-9][0-9]{0,3}|10000)$'
            )
          )
          or (
            jsonb_typeof(slot.value -> 'entered_score') = 'null'
            and jsonb_typeof(slot.value -> 'x_count') <> 'null'
          )
      end
    ) then
      raise exception 'A score value has an invalid Set, component, score, or X representation.'
        using errcode = '22023';
    end if;

    if (
      select count(distinct (
        (slot.value ->> 'set_number')::integer,
        (slot.value ->> 'component_position')::integer
      ))
      from jsonb_array_elements(v_values) as slot(value)
    ) <> v_expected_slot_count then
      raise exception 'Every Set/component slot must appear exactly once per participant.'
        using errcode = '23505';
    end if;

    if exists (
      select 1
      from generate_series(1, v_context.sets_per_round) as set_slot(set_number)
      cross join public.competition_score_components as component
      where component.competition_id = p_competition_id
        and not exists (
          select 1
          from jsonb_array_elements(v_values) as slot(value)
          where (slot.value ->> 'set_number')::integer = set_slot.set_number
            and (slot.value ->> 'component_position')::integer = component.position
        )
    ) then
      raise exception 'The score-entry batch contains a Set or component outside the Course of Fire.'
        using errcode = '22023';
    end if;

    if not v_context.uses_x_score and exists (
      select 1
      from jsonb_array_elements(v_values) as slot(value)
      where jsonb_typeof(slot.value -> 'x_count') <> 'null'
    ) then
      raise exception 'X values are not enabled for this Competition.'
        using errcode = '22023';
    end if;

    if v_context.shots_per_round is not null and (
      select coalesce(sum((slot.value ->> 'x_count')::integer), 0)
      from jsonb_array_elements(v_values) as slot(value)
      where jsonb_typeof(slot.value -> 'x_count') <> 'null'
    ) > v_context.shots_per_round then
      raise exception 'A shooter''s total X count cannot exceed the configured shots per Round.'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_values) as slot(value)
      join public.competition_score_components as component
        on component.competition_id = p_competition_id
       and component.position = (slot.value ->> 'component_position')::integer
      where jsonb_typeof(slot.value -> 'entered_score') <> 'null'
        and (slot.value ->> 'entered_score')::numeric > component.maximum_score
    ) then
      raise exception 'An entered score cannot exceed its Course of Fire component maximum.'
        using errcode = '22023';
    end if;

    select membership.user_id
    into v_shooter_profile_id
    from public.competition_entrant_participants as participant
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
    where participant.id = v_participant_id;

    select usage.shooting_score_source_id
    into v_source_id
    from public.competition_score_usages as usage
    where usage.competition_id = p_competition_id
      and usage.competition_round_id = p_competition_round_id
      and usage.competition_entrant_participant_id = v_participant_id
    for update of usage;

    if not exists (
      select 1
      from jsonb_array_elements(v_values) as slot(value)
      where jsonb_typeof(slot.value -> 'entered_score') <> 'null'
    ) then
      if v_source_id is not null then
        delete from public.competition_score_usages
        where competition_id = p_competition_id
          and competition_round_id = p_competition_round_id
          and competition_entrant_participant_id = v_participant_id;

        delete from public.shooting_score_sources as source
        where source.id = v_source_id
          and not exists (
            select 1
            from public.competition_score_usages as remaining_usage
            where remaining_usage.shooting_score_source_id = source.id
          );
      end if;
      v_source_id := null;
      continue;
    end if;

    if v_source_id is null then
      insert into public.shooting_score_sources (
        shooter_profile_id,
        created_by,
        updated_by
      ) values (
        v_shooter_profile_id,
        v_context.actor_id,
        v_context.actor_id
      ) returning id into v_source_id;

      insert into public.competition_score_usages (
        shooting_score_source_id,
        competition_id,
        competition_round_id,
        competition_entrant_participant_id,
        created_by,
        updated_by
      ) values (
        v_source_id,
        p_competition_id,
        p_competition_round_id,
        v_participant_id,
        v_context.actor_id,
        v_context.actor_id
      );
    else
      update public.shooting_score_sources
      set updated_by = v_context.actor_id
      where id = v_source_id;

      update public.competition_score_usages
      set updated_by = v_context.actor_id
      where competition_id = p_competition_id
        and competition_round_id = p_competition_round_id
        and competition_entrant_participant_id = v_participant_id;
    end if;

    v_recorded_participant_count := v_recorded_participant_count + 1;

    for v_slot in
      select slot.value, component.maximum_score, component.score_method
      from jsonb_array_elements(v_values) as slot(value)
      join public.competition_score_components as component
        on component.competition_id = p_competition_id
       and component.position = (slot.value ->> 'component_position')::integer
    loop
      if jsonb_typeof(v_slot.value -> 'entered_score') = 'null' then
        delete from public.shooting_score_values
        where shooting_score_source_id = v_source_id
          and set_number = (v_slot.value ->> 'set_number')::integer
          and component_position = (v_slot.value ->> 'component_position')::integer;
        continue;
      end if;

      v_entered_score := (v_slot.value ->> 'entered_score')::numeric(10, 2);
      v_achieved_score := case v_slot.score_method
        when 'points_dropped' then v_slot.maximum_score - v_entered_score
        else v_entered_score
      end;
      v_x_count := case
        when jsonb_typeof(v_slot.value -> 'x_count') = 'null' then null
        else (v_slot.value ->> 'x_count')::integer
      end;

      insert into public.shooting_score_values (
        shooting_score_source_id,
        set_number,
        component_position,
        achieved_score,
        x_count,
        created_by,
        updated_by
      ) values (
        v_source_id,
        (v_slot.value ->> 'set_number')::integer,
        (v_slot.value ->> 'component_position')::integer,
        v_achieved_score,
        v_x_count,
        v_context.actor_id,
        v_context.actor_id
      )
      on conflict (
        shooting_score_source_id,
        set_number,
        component_position
      ) do update
      set achieved_score = excluded.achieved_score,
          x_count = excluded.x_count,
          updated_by = excluded.updated_by;

      v_recorded_value_count := v_recorded_value_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'competition_id', p_competition_id,
    'competition_round_id', p_competition_round_id,
    'recorded_participant_count', v_recorded_participant_count,
    'recorded_value_count', v_recorded_value_count
  );
end;
$$;

comment on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) is
  'Atomically validates and saves every visible Individual participant for one Competition Round. Null input removes that source slot; no zero or NSR is manufactured.';

revoke execute on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) to authenticated;

commit;
