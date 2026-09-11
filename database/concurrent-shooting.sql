-- Run after database/competition-averages-stage-3.sql.
-- Adds the opt-in Concurrent Shooting management and provenance foundation.
-- Existing Competitions and score sources remain independent.

begin;

create table if not exists public.concurrent_shooting_groups (
  id bigint generated always as identity primary key,
  organisation_id bigint not null
    references public.organisations (id) on delete restrict,
  league_season_id bigint not null
    references public.league_seasons (id) on delete restrict,
  name text not null,
  status text not null default 'draft',
  compatibility_version integer,
  compatibility_signature jsonb,
  activated_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concurrent_shooting_groups_name_value check (
    char_length(name) between 2 and 160 and name = btrim(name)
  ),
  constraint concurrent_shooting_groups_status_value check (
    status in ('draft', 'active', 'archived')
  ),
  constraint concurrent_shooting_groups_lifecycle_value check (
    (status = 'draft' and compatibility_version is null
      and compatibility_signature is null and activated_at is null
      and archived_at is null)
    or (status = 'active' and compatibility_version = 1
      and compatibility_signature is not null and activated_at is not null
      and archived_at is null)
    or (status = 'archived' and compatibility_version = 1
      and compatibility_signature is not null and activated_at is not null
      and archived_at is not null)
  )
);

create unique index if not exists league_seasons_id_organisation_unique_idx
  on public.league_seasons (id, organisation_id);

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'concurrent_shooting_groups_season_organisation_fk'
      and conrelid = 'public.concurrent_shooting_groups'::regclass
  ) then
    alter table public.concurrent_shooting_groups
      add constraint concurrent_shooting_groups_season_organisation_fk
      foreign key (league_season_id, organisation_id)
      references public.league_seasons (id, organisation_id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists concurrent_shooting_groups_org_lower_name_unique_idx
  on public.concurrent_shooting_groups (organisation_id, lower(name));
create index if not exists concurrent_shooting_groups_season_status_idx
  on public.concurrent_shooting_groups (league_season_id, status, id);
create index if not exists concurrent_shooting_groups_created_by_idx
  on public.concurrent_shooting_groups (created_by) where created_by is not null;
create index if not exists concurrent_shooting_groups_updated_by_idx
  on public.concurrent_shooting_groups (updated_by) where updated_by is not null;

create table if not exists public.concurrent_shooting_group_competitions (
  concurrent_shooting_group_id bigint not null
    references public.concurrent_shooting_groups (id) on delete cascade,
  competition_id bigint not null
    references public.competitions (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint concurrent_shooting_group_competitions_pkey primary key (
    concurrent_shooting_group_id, competition_id
  ),
  constraint concurrent_shooting_group_competitions_competition_unique unique (
    competition_id
  )
);

create index if not exists concurrent_shooting_group_competitions_created_by_idx
  on public.concurrent_shooting_group_competitions (created_by)
  where created_by is not null;

create table if not exists public.concurrent_shooting_rounds (
  id bigint generated always as identity primary key,
  concurrent_shooting_group_id bigint not null
    references public.concurrent_shooting_groups (id) on delete cascade,
  position integer not null,
  label text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concurrent_shooting_rounds_position_value check (
    position between 1 and 100
  ),
  constraint concurrent_shooting_rounds_label_value check (
    label is null or (char_length(label) between 1 and 80 and label = btrim(label))
  ),
  constraint concurrent_shooting_rounds_group_position_unique unique (
    concurrent_shooting_group_id, position
  ),
  constraint concurrent_shooting_rounds_id_group_unique unique (
    id, concurrent_shooting_group_id
  )
);

create index if not exists concurrent_shooting_rounds_created_by_idx
  on public.concurrent_shooting_rounds (created_by) where created_by is not null;
create index if not exists concurrent_shooting_rounds_updated_by_idx
  on public.concurrent_shooting_rounds (updated_by) where updated_by is not null;

create unique index if not exists competition_rounds_id_competition_unique_idx
  on public.competition_rounds (id, competition_id);

create table if not exists public.concurrent_shooting_round_mappings (
  concurrent_shooting_group_id bigint not null,
  concurrent_shooting_round_id bigint not null,
  competition_id bigint not null,
  competition_round_id bigint not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint concurrent_shooting_round_mappings_pkey primary key (
    concurrent_shooting_round_id, competition_id
  ),
  constraint concurrent_shooting_round_mappings_competition_round_unique unique (
    competition_round_id
  ),
  constraint concurrent_shooting_round_mappings_group_round_fk foreign key (
    concurrent_shooting_round_id, concurrent_shooting_group_id
  ) references public.concurrent_shooting_rounds (
    id, concurrent_shooting_group_id
  ) on delete cascade,
  constraint concurrent_shooting_round_mappings_group_competition_fk foreign key (
    concurrent_shooting_group_id, competition_id
  ) references public.concurrent_shooting_group_competitions (
    concurrent_shooting_group_id, competition_id
  ) on delete cascade,
  constraint concurrent_shooting_round_mappings_competition_round_fk foreign key (
    competition_round_id, competition_id
  ) references public.competition_rounds (
    id, competition_id
  ) on delete restrict
);

create index if not exists concurrent_shooting_round_mappings_group_idx
  on public.concurrent_shooting_round_mappings (
    concurrent_shooting_group_id, concurrent_shooting_round_id
  );
create index if not exists concurrent_shooting_round_mappings_competition_idx
  on public.concurrent_shooting_round_mappings (competition_id);
create index if not exists concurrent_shooting_round_mappings_created_by_idx
  on public.concurrent_shooting_round_mappings (created_by)
  where created_by is not null;

alter table public.shooting_score_sources
  add column if not exists concurrent_shooting_round_id bigint,
  add column if not exists version bigint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'shooting_score_sources_concurrent_round_fk'
      and conrelid = 'public.shooting_score_sources'::regclass
  ) then
    alter table public.shooting_score_sources
      add constraint shooting_score_sources_concurrent_round_fk
      foreign key (concurrent_shooting_round_id)
      references public.concurrent_shooting_rounds (id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'shooting_score_sources_version_value'
      and conrelid = 'public.shooting_score_sources'::regclass
  ) then
    alter table public.shooting_score_sources
      add constraint shooting_score_sources_version_value check (version >= 1);
  end if;
end;
$$;

create unique index if not exists shooting_score_sources_concurrent_shooter_unique_idx
  on public.shooting_score_sources (
    concurrent_shooting_round_id, shooter_profile_id
  ) where concurrent_shooting_round_id is not null;
create index if not exists shooting_score_sources_concurrent_round_idx
  on public.shooting_score_sources (concurrent_shooting_round_id)
  where concurrent_shooting_round_id is not null;

create table if not exists public.shooting_score_change_events (
  id bigint generated always as identity primary key,
  shooting_score_source_id bigint not null
    references public.shooting_score_sources (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  origin_competition_id bigint
    references public.competitions (id) on delete set null,
  origin_competition_round_id bigint
    references public.competition_rounds (id) on delete set null,
  operation text not null,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now(),
  constraint shooting_score_change_events_operation_value check (
    operation in ('create', 'update', 'clear')
  ),
  constraint shooting_score_change_events_state_value check (
    before_state is not null or after_state is not null
  ),
  constraint shooting_score_change_events_before_state_value check (
    before_state is null or jsonb_typeof(before_state) = 'object'
  ),
  constraint shooting_score_change_events_after_state_value check (
    after_state is null or jsonb_typeof(after_state) = 'object'
  ),
  constraint shooting_score_change_events_reason_value check (
    reason is null or (char_length(reason) between 1 and 500 and reason = btrim(reason))
  ),
  constraint shooting_score_change_events_origin_value check (
    origin_competition_round_id is null or origin_competition_id is not null
  )
);

create index if not exists shooting_score_change_events_source_created_idx
  on public.shooting_score_change_events (shooting_score_source_id, created_at, id);
create index if not exists shooting_score_change_events_actor_idx
  on public.shooting_score_change_events (actor_id) where actor_id is not null;
create index if not exists shooting_score_change_events_origin_competition_idx
  on public.shooting_score_change_events (origin_competition_id, created_at)
  where origin_competition_id is not null;
create index if not exists shooting_score_change_events_origin_round_idx
  on public.shooting_score_change_events (origin_competition_round_id)
  where origin_competition_round_id is not null;

comment on table public.concurrent_shooting_groups is
  'Organisation- and Season-scoped symmetric groups of compatible contemporaneous Competitions.';
comment on column public.concurrent_shooting_groups.compatibility_signature is
  'Server-derived immutable V1 Course-of-Fire identity while Active or Archived.';
comment on table public.concurrent_shooting_rounds is
  'Group-local physical shooting occurrences. They have no Competition release or Results lifecycle.';
comment on table public.concurrent_shooting_round_mappings is
  'Explicit mapping from one physical occurrence to exact member Competition Rounds.';
comment on column public.shooting_score_sources.concurrent_shooting_round_id is
  'Optional physical occurrence association. Null preserves ordinary independent sources.';
comment on column public.shooting_score_sources.version is
  'Monotonic optimistic-concurrency token; Stage 2 score transactions will compare and increment it.';
comment on table public.shooting_score_change_events is
  'Append-only canonical source score history for ordinary and Concurrent score changes.';

create or replace function private.concurrent_shooting_compatibility_signature(
  p_competition_id bigint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'sets_per_round', competition.sets_per_round,
    'shots_per_round', to_jsonb(competition.shots_per_round),
    'uses_x_score', competition.uses_x_score,
    'component_count', count(component.id),
    'components', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'position', component.position,
          'label', to_jsonb(component.short_label),
          'maximum_score', component.maximum_score,
          'score_method', component.score_method
        ) order by component.position
      ) filter (where component.id is not null),
      '[]'::jsonb
    ),
    'shooter_maximum', competition.sets_per_round * coalesce(sum(component.maximum_score), 0)
  )
  from public.competitions as competition
  left join public.competition_score_components as component
    on component.competition_id = competition.id
  where competition.id = p_competition_id
  group by competition.id, competition.sets_per_round,
    competition.shots_per_round, competition.uses_x_score
$$;

create or replace function private.concurrent_shooting_compatibility_mismatches(
  p_reference jsonb,
  p_candidate jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(item.field order by item.ordinal), '[]'::jsonb)
  from (values
    (1, 'sets_per_round', p_reference -> 'sets_per_round', p_candidate -> 'sets_per_round'),
    (2, 'component_count', p_reference -> 'component_count', p_candidate -> 'component_count'),
    (3, 'components', p_reference -> 'components', p_candidate -> 'components'),
    (4, 'uses_x_score', p_reference -> 'uses_x_score', p_candidate -> 'uses_x_score'),
    (5, 'shots_per_round', p_reference -> 'shots_per_round', p_candidate -> 'shots_per_round'),
    (6, 'shooter_maximum', p_reference -> 'shooter_maximum', p_candidate -> 'shooter_maximum')
  ) as item(ordinal, field, reference_value, candidate_value)
  where item.reference_value is distinct from item.candidate_value
$$;

create or replace function private.require_concurrent_shooting_group(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_owner_only boolean default false,
  p_required_status text default null
)
returns public.concurrent_shooting_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.concurrent_shooting_groups%rowtype;
begin
  perform private.require_competition_author(p_organisation_id, p_owner_only);
  select * into v_group
  from public.concurrent_shooting_groups as group_row
  where group_row.id = p_concurrent_shooting_group_id
    and group_row.organisation_id = p_organisation_id
  for update;
  if not found then
    raise exception 'Concurrent Shooting group not found in this Organisation.'
      using errcode = 'P0002';
  end if;
  if p_required_status is not null and v_group.status <> p_required_status then
    raise exception 'Concurrent Shooting group must be %.', p_required_status
      using errcode = '22023';
  end if;
  return v_group;
end;
$$;

create or replace function private.protect_concurrent_shooting_draft_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_group_id bigint;
  v_new_group_id bigint;
begin
  v_old_group_id := case when tg_op = 'INSERT' then null else old.concurrent_shooting_group_id end;
  v_new_group_id := case when tg_op = 'DELETE' then null else new.concurrent_shooting_group_id end;
  if v_old_group_id is not null and exists (
    select 1 from public.concurrent_shooting_groups
    where id = v_old_group_id and status <> 'draft'
  ) then
    raise exception 'Active or Archived Concurrent Shooting configuration is immutable.'
      using errcode = '22023';
  end if;
  if v_new_group_id is not null and exists (
    select 1 from public.concurrent_shooting_groups
    where id = v_new_group_id and status <> 'draft'
  ) then
    raise exception 'Concurrent Shooting membership and mappings may be changed only in Draft.'
      using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.validate_concurrent_shooting_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.concurrent_shooting_groups%rowtype;
  v_competition record;
begin
  select * into v_group from public.concurrent_shooting_groups
  where id = new.concurrent_shooting_group_id;
  select season.organisation_id, competition.league_season_id
  into v_competition
  from public.competitions as competition
  join public.league_seasons as season on season.id = competition.league_season_id
  where competition.id = new.competition_id;
  if not found or v_competition.organisation_id <> v_group.organisation_id then
    raise exception 'Competition and Concurrent Shooting group must belong to the same Organisation.'
      using errcode = '22023';
  end if;
  if v_competition.league_season_id <> v_group.league_season_id then
    raise exception 'Concurrent Shooting V1 requires every Competition to use the same Season.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.protect_concurrent_shooting_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a Draft Concurrent Shooting group can be deleted.' using errcode = '22023';
    end if;
    return old;
  end if;
  if old.status = 'archived' then
    raise exception 'Archived Concurrent Shooting groups are immutable.' using errcode = '22023';
  end if;
  if old.organisation_id is distinct from new.organisation_id
    or old.league_season_id is distinct from new.league_season_id then
    raise exception 'Concurrent Shooting Organisation and Season are immutable.' using errcode = '22023';
  end if;
  if old.status = 'active' and new.status in ('active', 'archived') and (
    old.compatibility_version is distinct from new.compatibility_version
    or old.compatibility_signature is distinct from new.compatibility_signature
    or old.activated_at is distinct from new.activated_at
    or old.name is distinct from new.name
  ) then
    raise exception 'Active Concurrent Shooting configuration is immutable.' using errcode = '22023';
  end if;
  if old.status = 'active' and new.status not in ('active', 'draft', 'archived') then
    raise exception 'Invalid Concurrent Shooting lifecycle transition.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function private.protect_active_concurrent_competition_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competition_id bigint;
begin
  v_competition_id := case when tg_op = 'DELETE' then old.competition_id else new.competition_id end;
  if exists (
    select 1
    from public.concurrent_shooting_group_competitions as member
    join public.concurrent_shooting_groups as group_row
      on group_row.id = member.concurrent_shooting_group_id
    where member.competition_id = v_competition_id
      and group_row.status in ('active', 'archived')
  ) then
    if tg_table_name = 'competitions' then
      if (new.sets_per_round, new.shots_per_round, new.uses_x_score)
        is distinct from (old.sets_per_round, old.shots_per_round, old.uses_x_score) then
        raise exception 'Active or Archived Concurrent Shooting Course of Fire is immutable.'
          using errcode = '22023';
      end if;
    else
      raise exception 'Active or Archived Concurrent Shooting score components are immutable.'
        using errcode = '22023';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function private.protect_shooting_score_source_foundation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.concurrent_shooting_round_id is not null and not exists (
    select 1
    from public.concurrent_shooting_rounds as physical_round
    join public.concurrent_shooting_groups as group_row
      on group_row.id = physical_round.concurrent_shooting_group_id
    where physical_round.id = new.concurrent_shooting_round_id
      and group_row.status = 'active'
  ) then
    raise exception 'A score source may be associated only with an Active physical Concurrent Round.'
      using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.version < old.version then
    raise exception 'Shooting score source version cannot decrease.' using errcode = '22023';
  end if;
  if new.concurrent_shooting_round_id is distinct from old.concurrent_shooting_round_id
    and exists (
      select 1 from public.competition_score_usages as usage
      where usage.shooting_score_source_id = old.id
    ) then
    raise exception 'A used score source cannot be relinked to a physical Concurrent Round.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.validate_shooting_score_change_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origin_competition_round_id is not null and not exists (
    select 1 from public.competition_rounds as round_row
    where round_row.id = new.origin_competition_round_id
      and round_row.competition_id = new.origin_competition_id
  ) then
    raise exception 'Audit origin Round must belong to the origin Competition.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_shooting_score_change_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Shooting score change events are immutable.' using errcode = '22023';
end;
$$;

drop trigger if exists protect_concurrent_shooting_group
  on public.concurrent_shooting_groups;
create trigger protect_concurrent_shooting_group
  before update or delete on public.concurrent_shooting_groups
  for each row execute function private.protect_concurrent_shooting_group();

drop trigger if exists set_concurrent_shooting_rounds_updated_at
  on public.concurrent_shooting_rounds;
create trigger set_concurrent_shooting_rounds_updated_at
  before update on public.concurrent_shooting_rounds
  for each row execute function private.set_updated_at();

drop trigger if exists protect_concurrent_shooting_group_competitions
  on public.concurrent_shooting_group_competitions;
create trigger protect_concurrent_shooting_group_competitions
  before insert or update or delete on public.concurrent_shooting_group_competitions
  for each row execute function private.protect_concurrent_shooting_draft_child();
drop trigger if exists validate_concurrent_shooting_membership
  on public.concurrent_shooting_group_competitions;
create trigger validate_concurrent_shooting_membership
  before insert or update on public.concurrent_shooting_group_competitions
  for each row execute function private.validate_concurrent_shooting_membership();

drop trigger if exists protect_concurrent_shooting_rounds
  on public.concurrent_shooting_rounds;
create trigger protect_concurrent_shooting_rounds
  before insert or update or delete on public.concurrent_shooting_rounds
  for each row execute function private.protect_concurrent_shooting_draft_child();

drop trigger if exists protect_concurrent_shooting_round_mappings
  on public.concurrent_shooting_round_mappings;
create trigger protect_concurrent_shooting_round_mappings
  before insert or update or delete on public.concurrent_shooting_round_mappings
  for each row execute function private.protect_concurrent_shooting_draft_child();

drop trigger if exists protect_active_concurrent_competition_configuration
  on public.competitions;
create trigger protect_active_concurrent_competition_configuration
  before update of sets_per_round, shots_per_round, uses_x_score on public.competitions
  for each row execute function private.protect_active_concurrent_competition_configuration();
drop trigger if exists protect_active_concurrent_competition_components
  on public.competition_score_components;
create trigger protect_active_concurrent_competition_components
  before insert or update or delete on public.competition_score_components
  for each row execute function private.protect_active_concurrent_competition_configuration();

drop trigger if exists protect_shooting_score_source_foundation
  on public.shooting_score_sources;
create trigger protect_shooting_score_source_foundation
  before insert or update on public.shooting_score_sources
  for each row execute function private.protect_shooting_score_source_foundation();

drop trigger if exists validate_shooting_score_change_event
  on public.shooting_score_change_events;
create trigger validate_shooting_score_change_event
  before insert on public.shooting_score_change_events
  for each row execute function private.validate_shooting_score_change_event();
drop trigger if exists prevent_shooting_score_change_event_mutation
  on public.shooting_score_change_events;
create trigger prevent_shooting_score_change_event_mutation
  before update or delete on public.shooting_score_change_events
  for each row execute function private.prevent_shooting_score_change_event_mutation();

create or replace function public.create_concurrent_shooting_group(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_id bigint;
begin
  v_actor := private.require_competition_author(p_organisation_id);
  if char_length(v_name) not between 2 and 160 then
    raise exception 'Concurrent Shooting group name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.league_seasons
    where id = p_league_season_id and organisation_id = p_organisation_id
  ) then
    raise exception 'Season not found in this Organisation.' using errcode = 'P0002';
  end if;
  insert into public.concurrent_shooting_groups (
    organisation_id, league_season_id, name, created_by, updated_by
  ) values (p_organisation_id, p_league_season_id, v_name, v_actor, v_actor)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'draft');
end;
$$;

create or replace function public.rename_concurrent_shooting_group(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  v_actor := auth.uid();
  if char_length(v_name) not between 2 and 160 then
    raise exception 'Concurrent Shooting group name must contain between 2 and 160 characters.'
      using errcode = '22023';
  end if;
  update public.concurrent_shooting_groups
  set name = v_name, updated_by = v_actor
  where id = p_concurrent_shooting_group_id;
end;
$$;

create or replace function public.delete_draft_concurrent_shooting_group(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  delete from public.concurrent_shooting_groups
  where id = p_concurrent_shooting_group_id;
end;
$$;

create or replace function public.add_concurrent_shooting_group_competition(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_competition_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.concurrent_shooting_groups%rowtype;
  v_actor uuid;
  v_signature jsonb;
  v_reference jsonb;
  v_mismatches jsonb;
begin
  v_group := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  v_actor := auth.uid();
  if not exists (
    select 1 from public.competitions as competition
    join public.league_seasons as season on season.id = competition.league_season_id
    where competition.id = p_competition_id
      and competition.league_season_id = v_group.league_season_id
      and season.organisation_id = p_organisation_id
  ) then
    raise exception 'Competition must belong to this Organisation and Season.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.concurrent_shooting_group_competitions
    where competition_id = p_competition_id
  ) then
    raise exception 'Competition already belongs to a Concurrent Shooting group.'
      using errcode = '23505';
  end if;
  v_signature := private.concurrent_shooting_compatibility_signature(p_competition_id);
  select private.concurrent_shooting_compatibility_signature(member.competition_id)
  into v_reference
  from public.concurrent_shooting_group_competitions as member
  where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  order by member.competition_id limit 1;
  if v_reference is not null then
    v_mismatches := private.concurrent_shooting_compatibility_mismatches(v_reference, v_signature);
    if jsonb_array_length(v_mismatches) > 0 then
      raise exception 'Competition Course of Fire is incompatible. Mismatched fields: %', v_mismatches
        using errcode = '22023';
    end if;
  end if;
  insert into public.concurrent_shooting_group_competitions (
    concurrent_shooting_group_id, competition_id, created_by
  ) values (p_concurrent_shooting_group_id, p_competition_id, v_actor);
  return jsonb_build_object('competition_id', p_competition_id, 'compatibility_signature', v_signature);
end;
$$;

create or replace function public.remove_concurrent_shooting_group_competition(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_competition_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  delete from public.concurrent_shooting_group_competitions
  where concurrent_shooting_group_id = p_concurrent_shooting_group_id
    and competition_id = p_competition_id;
  if not found then
    raise exception 'Competition is not a member of this Concurrent Shooting group.'
      using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.create_concurrent_shooting_round(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_position integer,
  p_label text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_actor uuid;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  v_actor := auth.uid();
  insert into public.concurrent_shooting_rounds (
    concurrent_shooting_group_id, position, label, created_by, updated_by
  ) values (p_concurrent_shooting_group_id, p_position, v_label, v_actor, v_actor)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_concurrent_shooting_round(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_concurrent_shooting_round_id bigint,
  p_position integer,
  p_label text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  update public.concurrent_shooting_rounds
  set position = p_position,
    label = nullif(btrim(coalesce(p_label, '')), ''),
    updated_by = auth.uid()
  where id = p_concurrent_shooting_round_id
    and concurrent_shooting_group_id = p_concurrent_shooting_group_id;
  if not found then
    raise exception 'Physical Concurrent Round not found in this group.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.delete_concurrent_shooting_round(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_concurrent_shooting_round_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  delete from public.concurrent_shooting_rounds
  where id = p_concurrent_shooting_round_id
    and concurrent_shooting_group_id = p_concurrent_shooting_group_id;
  if not found then
    raise exception 'Physical Concurrent Round not found in this group.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.add_concurrent_shooting_round_mapping(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_concurrent_shooting_round_id bigint,
  p_competition_id bigint,
  p_competition_round_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  insert into public.concurrent_shooting_round_mappings (
    concurrent_shooting_group_id, concurrent_shooting_round_id,
    competition_id, competition_round_id, created_by
  ) values (
    p_concurrent_shooting_group_id, p_concurrent_shooting_round_id,
    p_competition_id, p_competition_round_id, auth.uid()
  );
end;
$$;

create or replace function public.remove_concurrent_shooting_round_mapping(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint,
  p_concurrent_shooting_round_id bigint,
  p_competition_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, false, 'draft'
  );
  delete from public.concurrent_shooting_round_mappings
  where concurrent_shooting_group_id = p_concurrent_shooting_group_id
    and concurrent_shooting_round_id = p_concurrent_shooting_round_id
    and competition_id = p_competition_id;
  if not found then
    raise exception 'Concurrent Shooting Round mapping not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.activate_concurrent_shooting_group(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.concurrent_shooting_groups%rowtype;
  v_actor uuid;
  v_reference jsonb;
  v_candidate jsonb;
  v_mismatches jsonb;
  v_reference_competition_id bigint;
  v_member record;
  v_member_count integer;
begin
  v_group := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, true, 'draft'
  );
  v_actor := auth.uid();
  select count(*)::integer, min(competition_id)
  into v_member_count, v_reference_competition_id
  from public.concurrent_shooting_group_competitions
  where concurrent_shooting_group_id = p_concurrent_shooting_group_id;
  if v_member_count < 2 then
    raise exception 'Activation requires at least two member Competitions.' using errcode = '22023';
  end if;
  v_reference := private.concurrent_shooting_compatibility_signature(v_reference_competition_id);
  if coalesce((v_reference ->> 'component_count')::integer, 0) < 1 then
    raise exception 'Member Competitions require a complete Course of Fire.' using errcode = '22023';
  end if;
  for v_member in
    select competition.id, competition.name, competition.status,
      competition.league_season_id, season.organisation_id,
      effective.effective_starts_at
    from public.concurrent_shooting_group_competitions as member
    join public.competitions as competition on competition.id = member.competition_id
    join public.league_seasons as season on season.id = competition.league_season_id
    cross join lateral private.get_competition_effective_dates(competition.id) as effective
    where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    order by competition.id
    for update of competition
  loop
    if v_member.organisation_id <> p_organisation_id
      or v_member.league_season_id <> v_group.league_season_id then
      raise exception 'Every member Competition must belong to the group Organisation and Season.'
        using errcode = '22023';
    end if;
    if v_member.status <> 'published' then
      raise exception 'Competition "%" must be published before activation.', v_member.name
        using errcode = '22023';
    end if;
    if v_member.effective_starts_at is null or v_member.effective_starts_at <= current_date then
      raise exception 'Competition "%" has reached its effective start.', v_member.name
        using errcode = '22023';
    end if;
    v_candidate := private.concurrent_shooting_compatibility_signature(v_member.id);
    v_mismatches := private.concurrent_shooting_compatibility_mismatches(v_reference, v_candidate);
    if jsonb_array_length(v_mismatches) > 0 then
      raise exception 'Competition "%" is incompatible. Mismatched fields: %',
        v_member.name, v_mismatches using errcode = '22023';
    end if;
  end loop;
  if not exists (
    select 1 from public.concurrent_shooting_rounds
    where concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) then
    raise exception 'Activation requires explicit physical Round mappings.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.concurrent_shooting_rounds as physical_round
    left join public.concurrent_shooting_round_mappings as mapping
      on mapping.concurrent_shooting_round_id = physical_round.id
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    group by physical_round.id
    having count(distinct mapping.competition_id) < 2
  ) then
    raise exception 'Every physical Concurrent Round must map at least two Competitions.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.concurrent_shooting_group_competitions as member
    where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and not exists (
        select 1 from public.concurrent_shooting_round_mappings as mapping
        where mapping.concurrent_shooting_group_id = member.concurrent_shooting_group_id
          and mapping.competition_id = member.competition_id
      )
  ) then
    raise exception 'Every member Competition must have at least one explicit Round mapping.'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.concurrent_shooting_round_mappings as mapping
    join public.competition_score_usages as usage
      on usage.competition_id = mapping.competition_id
      and usage.competition_round_id = mapping.competition_round_id
    where mapping.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) then
    raise exception 'A mapped Competition Round already has score usage.' using errcode = '22023';
  end if;
  update public.concurrent_shooting_groups
  set status = 'active', compatibility_version = 1,
    compatibility_signature = v_reference, activated_at = clock_timestamp(),
    updated_by = v_actor
  where id = p_concurrent_shooting_group_id;
  return jsonb_build_object(
    'id', p_concurrent_shooting_group_id,
    'status', 'active',
    'compatibility_version', 1,
    'compatibility_signature', v_reference
  );
end;
$$;

create or replace function public.cancel_concurrent_shooting_group_activation(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.concurrent_shooting_groups%rowtype;
begin
  v_group := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, true, 'active'
  );
  if exists (
    select 1
    from public.concurrent_shooting_group_competitions as member
    cross join lateral private.get_competition_effective_dates(member.competition_id) as effective
    where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
      and (effective.effective_starts_at is null or effective.effective_starts_at <= current_date)
  ) then
    raise exception 'Activation cannot be cancelled after a member Competition has started.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.shooting_score_sources as source
    join public.concurrent_shooting_rounds as physical_round
      on physical_round.id = source.concurrent_shooting_round_id
    where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) or exists (
    select 1 from public.concurrent_shooting_round_mappings as mapping
    join public.competition_score_usages as usage
      on usage.competition_id = mapping.competition_id
      and usage.competition_round_id = mapping.competition_round_id
    where mapping.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  ) then
    raise exception 'Activation cannot be cancelled after score provenance exists.'
      using errcode = '22023';
  end if;
  update public.concurrent_shooting_groups
  set status = 'draft', compatibility_version = null,
    compatibility_signature = null, activated_at = null,
    updated_by = auth.uid()
  where id = p_concurrent_shooting_group_id;
end;
$$;

create or replace function public.archive_concurrent_shooting_group(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id, true, 'active'
  );
  update public.concurrent_shooting_groups
  set status = 'archived', archived_at = clock_timestamp(), updated_by = auth.uid()
  where id = p_concurrent_shooting_group_id;
end;
$$;

create or replace function public.list_concurrent_shooting_groups(
  p_organisation_id bigint,
  p_league_season_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_competition_author(p_organisation_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', group_row.id,
      'league_season_id', group_row.league_season_id,
      'name', group_row.name,
      'status', group_row.status,
      'member_count', (
        select count(*) from public.concurrent_shooting_group_competitions as member
        where member.concurrent_shooting_group_id = group_row.id
      ),
      'physical_round_count', (
        select count(*) from public.concurrent_shooting_rounds as physical_round
        where physical_round.concurrent_shooting_group_id = group_row.id
      )
    ) order by group_row.updated_at desc, group_row.id desc)
    from public.concurrent_shooting_groups as group_row
    where group_row.organisation_id = p_organisation_id
      and (p_league_season_id is null or group_row.league_season_id = p_league_season_id)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_concurrent_shooting_group_management(
  p_organisation_id bigint,
  p_concurrent_shooting_group_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.concurrent_shooting_groups%rowtype;
  v_reference jsonb;
begin
  v_group := private.require_concurrent_shooting_group(
    p_organisation_id, p_concurrent_shooting_group_id
  );
  select private.concurrent_shooting_compatibility_signature(member.competition_id)
  into v_reference
  from public.concurrent_shooting_group_competitions as member
  where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
  order by member.competition_id limit 1;
  return jsonb_build_object(
    'group', to_jsonb(v_group),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'competition_id', competition.id,
        'name', competition.name,
        'entry_format', competition.entry_format,
        'status', competition.status,
        'compatibility_signature', signature.value,
        'compatibility_mismatches', case when v_reference is null then '[]'::jsonb
          else private.concurrent_shooting_compatibility_mismatches(v_reference, signature.value) end
      ) order by competition.name, competition.id)
      from public.concurrent_shooting_group_competitions as member
      join public.competitions as competition on competition.id = member.competition_id
      cross join lateral (select private.concurrent_shooting_compatibility_signature(competition.id) as value) as signature
      where member.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    ), '[]'::jsonb),
    'physical_rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', physical_round.id,
        'position', physical_round.position,
        'label', physical_round.label,
        'mappings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'competition_id', mapping.competition_id,
            'competition_round_id', mapping.competition_round_id,
            'round_number', competition_round.round_number
          ) order by mapping.competition_id)
          from public.concurrent_shooting_round_mappings as mapping
          join public.competition_rounds as competition_round
            on competition_round.id = mapping.competition_round_id
          where mapping.concurrent_shooting_round_id = physical_round.id
        ), '[]'::jsonb)
      ) order by physical_round.position)
      from public.concurrent_shooting_rounds as physical_round
      where physical_round.concurrent_shooting_group_id = p_concurrent_shooting_group_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Active or Archived membership is participation for owner-only Competition
-- return-to-draft/delete safeguards. Draft groups remain removable/editable.
create or replace function private.competition_has_participation(
  p_competition_id bigint
)
returns boolean
language sql
stable
set search_path = ''
as $$
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
$$;

alter table public.concurrent_shooting_groups enable row level security;
alter table public.concurrent_shooting_group_competitions enable row level security;
alter table public.concurrent_shooting_rounds enable row level security;
alter table public.concurrent_shooting_round_mappings enable row level security;
alter table public.shooting_score_change_events enable row level security;

revoke all privileges on table public.concurrent_shooting_groups,
  public.concurrent_shooting_group_competitions,
  public.concurrent_shooting_rounds,
  public.concurrent_shooting_round_mappings,
  public.shooting_score_change_events from public, anon, authenticated;
revoke all privileges on sequence public.concurrent_shooting_groups_id_seq,
  public.concurrent_shooting_rounds_id_seq,
  public.shooting_score_change_events_id_seq from public, anon, authenticated;

revoke execute on function private.concurrent_shooting_compatibility_signature(bigint),
  private.concurrent_shooting_compatibility_mismatches(jsonb, jsonb),
  private.require_concurrent_shooting_group(bigint, bigint, boolean, text),
  private.protect_concurrent_shooting_draft_child(),
  private.validate_concurrent_shooting_membership(),
  private.protect_concurrent_shooting_group(),
  private.protect_active_concurrent_competition_configuration(),
  private.protect_shooting_score_source_foundation(),
  private.validate_shooting_score_change_event(),
  private.prevent_shooting_score_change_event_mutation(),
  private.competition_has_participation(bigint)
  from public, anon, authenticated;

revoke execute on function public.create_concurrent_shooting_group(bigint, bigint, text),
  public.rename_concurrent_shooting_group(bigint, bigint, text),
  public.delete_draft_concurrent_shooting_group(bigint, bigint),
  public.add_concurrent_shooting_group_competition(bigint, bigint, bigint),
  public.remove_concurrent_shooting_group_competition(bigint, bigint, bigint),
  public.create_concurrent_shooting_round(bigint, bigint, integer, text),
  public.update_concurrent_shooting_round(bigint, bigint, bigint, integer, text),
  public.delete_concurrent_shooting_round(bigint, bigint, bigint),
  public.add_concurrent_shooting_round_mapping(bigint, bigint, bigint, bigint, bigint),
  public.remove_concurrent_shooting_round_mapping(bigint, bigint, bigint, bigint),
  public.activate_concurrent_shooting_group(bigint, bigint),
  public.cancel_concurrent_shooting_group_activation(bigint, bigint),
  public.archive_concurrent_shooting_group(bigint, bigint),
  public.list_concurrent_shooting_groups(bigint, bigint),
  public.get_concurrent_shooting_group_management(bigint, bigint)
  from public, anon;

grant execute on function public.create_concurrent_shooting_group(bigint, bigint, text),
  public.rename_concurrent_shooting_group(bigint, bigint, text),
  public.delete_draft_concurrent_shooting_group(bigint, bigint),
  public.add_concurrent_shooting_group_competition(bigint, bigint, bigint),
  public.remove_concurrent_shooting_group_competition(bigint, bigint, bigint),
  public.create_concurrent_shooting_round(bigint, bigint, integer, text),
  public.update_concurrent_shooting_round(bigint, bigint, bigint, integer, text),
  public.delete_concurrent_shooting_round(bigint, bigint, bigint),
  public.add_concurrent_shooting_round_mapping(bigint, bigint, bigint, bigint, bigint),
  public.remove_concurrent_shooting_round_mapping(bigint, bigint, bigint, bigint),
  public.activate_concurrent_shooting_group(bigint, bigint),
  public.cancel_concurrent_shooting_group_activation(bigint, bigint),
  public.archive_concurrent_shooting_group(bigint, bigint),
  public.list_concurrent_shooting_groups(bigint, bigint),
  public.get_concurrent_shooting_group_management(bigint, bigint)
  to authenticated;

commit;
