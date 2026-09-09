-- Competition Averages Stage 1: organisation-owned Contexts, immutable Policy
-- versions, authoritative Competition bindings, canonical historical candidates,
-- and participant-owned provisional Starting Average snapshots.
-- Run after all existing Competition Series SQL. Additive and safe to rerun.
begin;

create table if not exists public.average_contexts (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id),
  name text not null check (name = btrim(name) and char_length(name) between 2 and 160),
  basis_maximum numeric(10,2) not null check (
    basis_maximum between 0.01 and 1000000 and basis_maximum = round(basis_maximum, 2)
  ),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists average_contexts_organisation_lower_name_unique
  on public.average_contexts (organisation_id, lower(name));
create index if not exists average_contexts_created_by_idx
  on public.average_contexts(created_by) where created_by is not null;
create index if not exists average_contexts_updated_by_idx
  on public.average_contexts(updated_by) where updated_by is not null;

create table if not exists public.average_policies (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id),
  name text not null check (name = btrim(name) and char_length(name) between 2 and 160),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists average_policies_organisation_lower_name_unique
  on public.average_policies (organisation_id, lower(name));
create index if not exists average_policies_created_by_idx
  on public.average_policies(created_by) where created_by is not null;
create index if not exists average_policies_updated_by_idx
  on public.average_policies(updated_by) where updated_by is not null;

create table if not exists public.average_policy_versions (
  id bigint generated always as identity primary key,
  average_policy_id bigint not null references public.average_policies(id),
  version_number integer not null check (version_number between 1 and 1000000),
  strategy text not null check (strategy in ('manual','current_then_preceding')),
  configuration jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (average_policy_id, version_number)
);

create index if not exists average_policy_versions_created_by_idx
  on public.average_policy_versions(created_by) where created_by is not null;

create table if not exists public.competition_average_settings (
  competition_id bigint primary key references public.competitions(id) on delete cascade,
  average_context_id bigint not null references public.average_contexts(id),
  average_policy_version_id bigint not null references public.average_policy_versions(id),
  contributes_to_history boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);

create index if not exists competition_average_settings_context_history_idx
  on public.competition_average_settings(average_context_id, competition_id)
  where contributes_to_history;
create index if not exists competition_average_settings_policy_version_idx
  on public.competition_average_settings(average_policy_version_id);
create index if not exists competition_average_settings_created_by_idx
  on public.competition_average_settings(created_by) where created_by is not null;
create index if not exists competition_average_settings_updated_by_idx
  on public.competition_average_settings(updated_by) where updated_by is not null;

create table if not exists public.competition_participant_starting_averages (
  id bigint generated always as identity primary key,
  competition_id bigint not null references public.competitions(id) on delete cascade,
  competition_entrant_participant_id bigint not null
    references public.competition_entrant_participants(id) on delete cascade,
  shooter_profile_id uuid not null references public.profiles(id),
  starting_average numeric(14,6) not null check (
    starting_average between 0 and 1000000 and starting_average = round(starting_average, 6)
  ),
  average_context_id bigint not null references public.average_contexts(id),
  average_policy_version_id bigint not null references public.average_policy_versions(id),
  origin text not null check (origin in ('calculated','manual')),
  status text not null default 'provisional' check (status in ('provisional','frozen')),
  calculated_at timestamptz not null default now(),
  frozen_at timestamptz,
  source_competition_id bigint references public.competitions(id) on delete set null,
  qualifying_score_count integer not null default 0 check (qualifying_score_count between 0 and 1000000),
  manual_reason text check (
    manual_reason is null
    or (manual_reason = btrim(manual_reason) and char_length(manual_reason) between 1 and 500)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  unique (competition_entrant_participant_id),
  check ((status = 'provisional' and frozen_at is null) or (status = 'frozen' and frozen_at is not null)),
  check (
    (origin = 'calculated' and source_competition_id is not null
      and qualifying_score_count > 0 and manual_reason is null)
    or (origin = 'manual' and source_competition_id is null and qualifying_score_count = 0)
  )
);

create index if not exists starting_averages_competition_idx
  on public.competition_participant_starting_averages(competition_id, competition_entrant_participant_id);
create index if not exists starting_averages_shooter_idx
  on public.competition_participant_starting_averages(shooter_profile_id, competition_id);
create index if not exists starting_averages_context_idx
  on public.competition_participant_starting_averages(average_context_id);
create index if not exists starting_averages_policy_version_idx
  on public.competition_participant_starting_averages(average_policy_version_id);
create index if not exists starting_averages_source_competition_idx
  on public.competition_participant_starting_averages(source_competition_id)
  where source_competition_id is not null;
create index if not exists starting_averages_created_by_idx
  on public.competition_participant_starting_averages(created_by) where created_by is not null;
create index if not exists starting_averages_updated_by_idx
  on public.competition_participant_starting_averages(updated_by) where updated_by is not null;

create table if not exists public.starting_average_score_sources (
  id bigint generated always as identity primary key,
  starting_average_id bigint not null
    references public.competition_participant_starting_averages(id) on delete cascade,
  shooting_score_source_id bigint references public.shooting_score_sources(id) on delete set null,
  competition_id bigint references public.competitions(id) on delete set null,
  round_id bigint references public.competition_rounds(id) on delete set null,
  achieved_score_at_calculation numeric(14,2) not null check (
    achieved_score_at_calculation between 0 and 1000000
  ),
  maximum_at_calculation numeric(10,2) not null check (
    maximum_at_calculation between 0.01 and 1000000
  ),
  created_at timestamptz not null default now()
);

create unique index if not exists starting_average_score_sources_physical_unique
  on public.starting_average_score_sources(starting_average_id, shooting_score_source_id)
  where shooting_score_source_id is not null;
create index if not exists starting_average_score_sources_source_idx
  on public.starting_average_score_sources(shooting_score_source_id)
  where shooting_score_source_id is not null;
create index if not exists starting_average_score_sources_competition_idx
  on public.starting_average_score_sources(competition_id) where competition_id is not null;
create index if not exists starting_average_score_sources_round_idx
  on public.starting_average_score_sources(round_id) where round_id is not null;

comment on table public.average_contexts is
  'Explicit organisation-owned shooter-average compatibility pool. V1 compatibility is exact basis maximum only and is never inferred from Series or names.';
comment on table public.average_policies is
  'Organisation-owned named Starting Average policy identity. Calculation definitions live in immutable versions.';
comment on table public.average_policy_versions is
  'Immutable versioned Starting Average calculation definition. V1 supports manual and current_then_preceding.';
comment on table public.competition_average_settings is
  'Authoritative per-edition Average Context, immutable Policy version, and history-contribution decision. Series membership is not compatibility.';
comment on table public.competition_participant_starting_averages is
  'Starting Average snapshot owned by one submitted Competition entrant participant, never a global shooter value.';
comment on table public.starting_average_score_sources is
  'Minimal calculated Starting Average provenance: the exact canonical physical source scores and values used.';

create or replace function private.competition_average_shooter_maximum(p_competition_id bigint)
returns numeric language sql stable set search_path = '' as $$
  select competition.sets_per_round * sum(component.maximum_score)
  from public.competitions competition
  join public.competition_score_components component on component.competition_id = competition.id
  where competition.id = p_competition_id
  group by competition.id, competition.sets_per_round
$$;

create or replace function private.validate_average_policy_version_definition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(new.configuration) <> 'object' then
    raise exception 'Average Policy configuration must be a JSON object.' using errcode = '22023';
  end if;
  if new.strategy = 'manual' then
    if new.configuration <> '{}'::jsonb then
      raise exception 'Manual Average Policy configuration must be empty.' using errcode = '22023';
    end if;
    return new;
  end if;
  if (select count(*) from jsonb_object_keys(new.configuration)) <> 3
    or not new.configuration ?& array['minimum_current_scores','minimum_preceding_scores','fallback']
    or jsonb_typeof(new.configuration->'minimum_current_scores') <> 'number'
    or jsonb_typeof(new.configuration->'minimum_preceding_scores') <> 'number'
    or (new.configuration->>'minimum_current_scores') !~ '^[1-9][0-9]{0,2}$'
    or (new.configuration->>'minimum_preceding_scores') !~ '^[1-9][0-9]{0,2}$'
    or (new.configuration->>'minimum_current_scores')::integer > 999
    or (new.configuration->>'minimum_preceding_scores')::integer > 999
    or new.configuration->>'fallback' <> 'manual'
  then
    raise exception 'current_then_preceding requires exactly positive integer minimum_current_scores, minimum_preceding_scores, and fallback=manual.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_average_policy_version_definition on public.average_policy_versions;
create trigger validate_average_policy_version_definition before insert on public.average_policy_versions
  for each row execute function private.validate_average_policy_version_definition();

create or replace function private.protect_average_policy_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Average Policy versions are immutable. Create a new version instead.' using errcode = '22023';
end;
$$;
drop trigger if exists protect_average_policy_version on public.average_policy_versions;
create trigger protect_average_policy_version before update or delete on public.average_policy_versions
  for each row execute function private.protect_average_policy_version();

create or replace function private.protect_average_context_basis()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organisation_id is distinct from old.organisation_id
    or new.basis_maximum is distinct from old.basis_maximum then
    raise exception 'Average Context Organisation and basis maximum are immutable.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists protect_average_context_basis on public.average_contexts;
create trigger protect_average_context_basis before update on public.average_contexts
  for each row execute function private.protect_average_context_basis();

drop trigger if exists set_average_policies_updated_at on public.average_policies;
create trigger set_average_policies_updated_at before update on public.average_policies
  for each row execute function private.set_updated_at();

create or replace function private.validate_competition_average_setting()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  competition_organisation_id bigint;
  context_organisation_id bigint;
  policy_organisation_id bigint;
  competition_maximum numeric;
  context_maximum numeric;
  context_archived_at timestamptz;
  policy_archived_at timestamptz;
begin
  select season.organisation_id, private.competition_average_shooter_maximum(competition.id)
  into competition_organisation_id, competition_maximum
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = new.competition_id;
  select context.organisation_id, context.basis_maximum, context.archived_at
  into context_organisation_id, context_maximum, context_archived_at
  from public.average_contexts context where context.id = new.average_context_id;
  select policy.organisation_id, policy.archived_at
  into policy_organisation_id, policy_archived_at
  from public.average_policy_versions version
  join public.average_policies policy on policy.id = version.average_policy_id
  where version.id = new.average_policy_version_id;
  if competition_organisation_id is null or context_organisation_id is null
    or policy_organisation_id is null then
    raise exception 'Competition, Average Context, or Average Policy version was not found.' using errcode = '23503';
  end if;
  if competition_organisation_id <> context_organisation_id
    or competition_organisation_id <> policy_organisation_id then
    raise exception 'Competition, Average Context, and Average Policy must belong to the same Organisation.' using errcode = '22023';
  end if;
  if context_archived_at is not null or policy_archived_at is not null then
    raise exception 'Archived Average Contexts or Policies cannot be selected for a Competition.' using errcode = '22023';
  end if;
  if competition_maximum is null or competition_maximum is distinct from context_maximum then
    raise exception 'Competition shooter maximum % must exactly equal Average Context basis maximum %. V1 does not normalise scores.',
      competition_maximum, context_maximum using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_competition_average_setting on public.competition_average_settings;
create trigger validate_competition_average_setting before insert or update on public.competition_average_settings
  for each row execute function private.validate_competition_average_setting();

create or replace function private.protect_competition_average_setting()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  changed boolean := tg_op = 'DELETE';
  target_competition_id bigint := old.competition_id;
begin
  if tg_op = 'UPDATE' then
    if new.competition_id is distinct from old.competition_id then
      raise exception 'Competition Average settings cannot be moved between Competitions.' using errcode = '22023';
    end if;
    changed := (new.average_context_id,new.average_policy_version_id,new.contributes_to_history)
      is distinct from (old.average_context_id,old.average_policy_version_id,old.contributes_to_history);
  end if;
  if changed and exists (
    select 1 from public.competition_participant_starting_averages snapshot
    where snapshot.competition_id = target_competition_id and snapshot.status = 'frozen'
  ) then
    raise exception 'Competition Average settings cannot change after a Starting Average is frozen.' using errcode = '22023';
  end if;
  if changed then
    delete from public.competition_participant_starting_averages snapshot
    where snapshot.competition_id = target_competition_id and snapshot.status = 'provisional';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := clock_timestamp(); return new; end if;
  return old;
end;
$$;
drop trigger if exists protect_competition_average_setting on public.competition_average_settings;
create trigger protect_competition_average_setting before update or delete on public.competition_average_settings
  for each row execute function private.protect_competition_average_setting();

create or replace function private.check_bound_competition_average_maximum()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  competition_id_to_check bigint;
  context_maximum numeric;
  actual_maximum numeric;
begin
  if tg_table_name = 'competition_score_components' then
    competition_id_to_check := case when tg_op = 'DELETE' then old.competition_id else new.competition_id end;
  else
    competition_id_to_check := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  select context.basis_maximum into context_maximum
  from public.competition_average_settings average_setting
  join public.average_contexts context on context.id = average_setting.average_context_id
  where average_setting.competition_id = competition_id_to_check;
  if not found then return null; end if;
  actual_maximum := private.competition_average_shooter_maximum(competition_id_to_check);
  if actual_maximum is null or actual_maximum is distinct from context_maximum then
    raise exception 'Bound Competition shooter maximum must continue to exactly equal its Average Context basis maximum.'
      using errcode = '22023';
  end if;
  return null;
end;
$$;
drop trigger if exists check_bound_competition_average_maximum on public.competitions;
create constraint trigger check_bound_competition_average_maximum
  after insert or update or delete on public.competitions deferrable initially deferred
  for each row execute function private.check_bound_competition_average_maximum();
drop trigger if exists check_bound_competition_average_maximum on public.competition_score_components;
create constraint trigger check_bound_competition_average_maximum
  after insert or update or delete on public.competition_score_components deferrable initially deferred
  for each row execute function private.check_bound_competition_average_maximum();

create or replace function private.validate_starting_average_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  participant_competition_id bigint;
  participant_shooter_id uuid;
  setting_context_id bigint;
  setting_policy_version_id bigint;
  context_maximum numeric;
begin
  select entry.competition_id, membership.user_id
  into participant_competition_id, participant_shooter_id
  from public.competition_entrant_participants participant
  join public.club_competition_entries entry on entry.id = participant.club_competition_entry_id
  join public.club_memberships membership on membership.id = participant.club_membership_id
  where participant.id = new.competition_entrant_participant_id;
  select setting.average_context_id, setting.average_policy_version_id, context.basis_maximum
  into setting_context_id, setting_policy_version_id, context_maximum
  from public.competition_average_settings setting
  join public.average_contexts context on context.id = setting.average_context_id
  where setting.competition_id = new.competition_id;
  if participant_competition_id is null or setting_context_id is null then
    raise exception 'Starting Average requires a participant and authoritative Competition Average settings.' using errcode = '22023';
  end if;
  if participant_competition_id <> new.competition_id
    or participant_shooter_id is distinct from new.shooter_profile_id then
    raise exception 'Starting Average participant, Competition, and shooter identity do not match.' using errcode = '22023';
  end if;
  if (new.average_context_id,new.average_policy_version_id)
    is distinct from (setting_context_id,setting_policy_version_id) then
    raise exception 'Starting Average must snapshot the Competition authoritative Context and Policy version.' using errcode = '22023';
  end if;
  if new.starting_average > context_maximum then
    raise exception 'Starting Average must be between zero and the Average Context basis maximum.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_starting_average_snapshot on public.competition_participant_starting_averages;
create trigger validate_starting_average_snapshot
  before insert or update on public.competition_participant_starting_averages
  for each row execute function private.validate_starting_average_snapshot();

create or replace function private.protect_frozen_starting_average()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'frozen' then
    raise exception 'Frozen Starting Averages cannot be changed through the provisional lifecycle.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists protect_frozen_starting_average on public.competition_participant_starting_averages;
create trigger protect_frozen_starting_average
  before update on public.competition_participant_starting_averages
  for each row execute function private.protect_frozen_starting_average();

-- A physical source reused by future compatible Competition usages is credited
-- once, to its latest eligible usage in this Context. Release and completeness
-- deliberately match the ordinary Results semantics.
create or replace function private.shooter_historical_average_candidates(
  p_average_context_id bigint,
  p_shooter_profile_id uuid,
  p_before_competition_id bigint
)
returns table (
  shooting_score_source_id bigint,
  competition_id bigint,
  round_id bigint,
  achieved_score numeric,
  maximum_score numeric,
  effective_starts_at date,
  round_number integer
)
language sql stable security invoker set search_path = '' as $$
  with target as (
    select dates.effective_starts_at
    from public.competitions competition
    cross join lateral private.get_competition_effective_dates(competition.id) dates
    where competition.id = p_before_competition_id
  ), raw_candidates as (
    select source.id as shooting_score_source_id,
      competition.id as competition_id,
      competition_round.id as round_id,
      values.recorded_achieved_score as achieved_score,
      config.shooter_maximum as maximum_score,
      dates.effective_starts_at,
      competition_round.round_number,
      row_number() over (
        partition by source.id
        order by dates.effective_starts_at desc, competition.id desc,
          competition_round.deadline desc, competition_round.round_number desc, usage.id desc
      ) as source_usage_order
    from public.competition_average_settings average_setting
    join public.average_contexts context on context.id = average_setting.average_context_id
    join public.competitions competition on competition.id = average_setting.competition_id
    cross join lateral private.get_competition_effective_dates(competition.id) dates
    join public.competition_score_usages usage on usage.competition_id = competition.id
    join public.competition_rounds competition_round
      on competition_round.id = usage.competition_round_id
     and competition_round.competition_id = competition.id
    join public.competition_entrant_participants participant
      on participant.id = usage.competition_entrant_participant_id
    join public.club_competition_entries entry
      on entry.id = participant.club_competition_entry_id
     and entry.competition_id = competition.id and entry.status = 'submitted'
    join public.club_memberships membership on membership.id = participant.club_membership_id
    join public.shooting_score_sources source
      on source.id = usage.shooting_score_source_id
     and source.shooter_profile_id = membership.user_id
    cross join target
    cross join lateral (
      select count(component.id)::integer as component_count,
        (competition.sets_per_round * count(component.id))::integer as expected_slot_count,
        competition.sets_per_round * sum(component.maximum_score) as shooter_maximum
      from public.competition_score_components component
      where component.competition_id = competition.id
    ) config
    cross join lateral (
      select count(score_value.id)::integer as recorded_slot_count,
        sum(score_value.achieved_score) as recorded_achieved_score
      from public.shooting_score_values score_value
      where score_value.shooting_score_source_id = source.id
    ) values
    where average_setting.average_context_id = p_average_context_id
      and average_setting.contributes_to_history
      and competition.status = 'published'
      and competition.id <> p_before_competition_id
      and dates.effective_starts_at is not null
      and target.effective_starts_at is not null
      and dates.effective_starts_at < target.effective_starts_at
      and (statement_timestamp() at time zone 'UTC')::date > competition_round.deadline
      and source.shooter_profile_id = p_shooter_profile_id
      and config.component_count > 0
      and values.recorded_slot_count = config.expected_slot_count
      and config.shooter_maximum = context.basis_maximum
  )
  select raw.shooting_score_source_id, raw.competition_id, raw.round_id,
    raw.achieved_score, raw.maximum_score, raw.effective_starts_at, raw.round_number
  from raw_candidates raw where raw.source_usage_order = 1
$$;

create or replace function private.average_context_competition_history(
  p_average_context_id bigint,
  p_before_competition_id bigint
)
returns table (competition_id bigint, effective_starts_at date, history_position integer)
language sql stable security invoker set search_path = '' as $$
  with target as (
    select dates.effective_starts_at
    from public.competitions competition
    cross join lateral private.get_competition_effective_dates(competition.id) dates
    where competition.id = p_before_competition_id
  )
  select competition.id, dates.effective_starts_at,
    row_number() over (order by dates.effective_starts_at desc, competition.id desc)::integer
  from public.competition_average_settings average_setting
  join public.average_contexts context on context.id = average_setting.average_context_id
  join public.competitions competition on competition.id = average_setting.competition_id
  cross join lateral private.get_competition_effective_dates(competition.id) dates
  cross join target
  where average_setting.average_context_id = p_average_context_id
    and average_setting.contributes_to_history
    and competition.status = 'published'
    and competition.id <> p_before_competition_id
    and dates.effective_starts_at is not null
    and target.effective_starts_at is not null
    and dates.effective_starts_at < target.effective_starts_at
    and private.competition_average_shooter_maximum(competition.id) = context.basis_maximum
  order by dates.effective_starts_at desc, competition.id desc
$$;

create or replace function private.resolve_competition_starting_average(
  p_target_competition_id bigint,
  p_shooter_profile_id uuid
)
returns table (
  starting_average numeric,
  policy_branch text,
  qualifying_score_count integer,
  source_competition_id bigint
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  context_id bigint;
  strategy_name text;
  policy_configuration jsonb;
  current_competition_id bigint;
  preceding_competition_id bigint;
  score_count integer;
  score_average numeric;
begin
  select setting.average_context_id, version.strategy, version.configuration
  into context_id, strategy_name, policy_configuration
  from public.competition_average_settings setting
  join public.average_policy_versions version on version.id = setting.average_policy_version_id
  where setting.competition_id = p_target_competition_id;
  if not found then
    raise exception 'Competition does not have authoritative Average settings.' using errcode = '22023';
  end if;
  if strategy_name = 'manual' then
    return query select null::numeric, 'manual'::text, 0, null::bigint;
    return;
  end if;

  select history.competition_id into current_competition_id
  from private.average_context_competition_history(context_id,p_target_competition_id) history
  where history.history_position = 1;
  select history.competition_id into preceding_competition_id
  from private.average_context_competition_history(context_id,p_target_competition_id) history
  where history.history_position = 2;

  select count(*)::integer, round(avg(candidate.achieved_score),6)
  into score_count,score_average
  from private.shooter_historical_average_candidates(context_id,p_shooter_profile_id,p_target_competition_id) candidate
  where candidate.competition_id = current_competition_id;
  if score_count >= (policy_configuration->>'minimum_current_scores')::integer then
    return query select score_average,'current'::text,score_count,current_competition_id;
    return;
  end if;

  select count(*)::integer, round(avg(candidate.achieved_score),6)
  into score_count,score_average
  from private.shooter_historical_average_candidates(context_id,p_shooter_profile_id,p_target_competition_id) candidate
  where candidate.competition_id = preceding_competition_id;
  if score_count >= (policy_configuration->>'minimum_preceding_scores')::integer then
    return query select score_average,'preceding'::text,score_count,preceding_competition_id;
    return;
  end if;
  return query select null::numeric,'manual'::text,0,null::bigint;
end;
$$;

create or replace function public.create_average_context(
  p_organisation_id bigint,p_name text,p_basis_maximum numeric
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; context_id bigint;
begin
  actor := private.require_competition_author(p_organisation_id);
  insert into public.average_contexts(organisation_id,name,basis_maximum,created_by,updated_by)
  values (p_organisation_id,btrim(p_name),p_basis_maximum,actor,actor)
  returning id into context_id;
  return jsonb_build_object('id',context_id,'organisation_id',p_organisation_id,
    'name',btrim(p_name),'basis_maximum',p_basis_maximum);
end;
$$;

create or replace function public.set_average_context_archived(
  p_organisation_id bigint,p_average_context_id bigint,p_archived boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; result jsonb;
begin
  actor := private.require_competition_author(p_organisation_id);
  if p_archived is null then raise exception 'Choose archive or restore.' using errcode = '22023'; end if;
  update public.average_contexts context
  set archived_at = case when p_archived then coalesce(context.archived_at,clock_timestamp()) else null end,
      updated_by = actor
  where context.id = p_average_context_id and context.organisation_id = p_organisation_id
  returning jsonb_build_object('id',context.id,'archived_at',context.archived_at) into result;
  if result is null then raise exception 'Average Context not found in this Organisation.' using errcode = '22023'; end if;
  return result;
end;
$$;

create or replace function public.create_average_policy(
  p_organisation_id bigint,p_name text,p_strategy text,p_configuration jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; policy_id bigint; version_id bigint;
begin
  actor := private.require_competition_author(p_organisation_id);
  insert into public.average_policies(organisation_id,name,created_by,updated_by)
  values (p_organisation_id,btrim(p_name),actor,actor) returning id into policy_id;
  insert into public.average_policy_versions(
    average_policy_id,version_number,strategy,configuration,created_by
  ) values (policy_id,1,p_strategy,p_configuration,actor) returning id into version_id;
  return jsonb_build_object('id',policy_id,'name',btrim(p_name),'version_id',version_id,
    'version_number',1,'strategy',p_strategy,'configuration',p_configuration);
end;
$$;

create or replace function public.create_average_policy_version(
  p_organisation_id bigint,p_average_policy_id bigint,p_strategy text,p_configuration jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; next_version integer; version_id bigint;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform policy.id from public.average_policies policy
  where policy.id = p_average_policy_id and policy.organisation_id = p_organisation_id
    and policy.archived_at is null for update;
  if not found then raise exception 'Active Average Policy not found in this Organisation.' using errcode = '22023'; end if;
  select coalesce(max(version.version_number),0)+1 into next_version
  from public.average_policy_versions version where version.average_policy_id = p_average_policy_id;
  insert into public.average_policy_versions(
    average_policy_id,version_number,strategy,configuration,created_by
  ) values (p_average_policy_id,next_version,p_strategy,p_configuration,actor)
  returning id into version_id;
  return jsonb_build_object('id',version_id,'average_policy_id',p_average_policy_id,
    'version_number',next_version,'strategy',p_strategy,'configuration',p_configuration);
end;
$$;

create or replace function public.set_average_policy_archived(
  p_organisation_id bigint,p_average_policy_id bigint,p_archived boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; result jsonb;
begin
  actor := private.require_competition_author(p_organisation_id);
  if p_archived is null then raise exception 'Choose archive or restore.' using errcode = '22023'; end if;
  update public.average_policies policy
  set archived_at = case when p_archived then coalesce(policy.archived_at,clock_timestamp()) else null end,
      updated_by = actor
  where policy.id = p_average_policy_id and policy.organisation_id = p_organisation_id
  returning jsonb_build_object('id',policy.id,'archived_at',policy.archived_at) into result;
  if result is null then raise exception 'Average Policy not found in this Organisation.' using errcode = '22023'; end if;
  return result;
end;
$$;

create or replace function public.set_competition_average_settings(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_average_context_id bigint,
  p_average_policy_version_id bigint,
  p_contributes_to_history boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and season.id = p_league_season_id
    and season.organisation_id = p_organisation_id for update of competition;
  if not found then raise exception 'Competition not found in this Organisation and Season.' using errcode = '22023'; end if;
  if p_contributes_to_history is null then
    raise exception 'Choose whether this Competition contributes to Average history.' using errcode = '22023';
  end if;
  insert into public.competition_average_settings(
    competition_id,average_context_id,average_policy_version_id,
    contributes_to_history,created_by,updated_by
  ) values (
    p_competition_id,p_average_context_id,p_average_policy_version_id,
    p_contributes_to_history,actor,actor
  )
  on conflict (competition_id) do update
  set average_context_id = excluded.average_context_id,
      average_policy_version_id = excluded.average_policy_version_id,
      contributes_to_history = excluded.contributes_to_history,
      updated_by = actor;
  return jsonb_build_object('competition_id',p_competition_id,
    'average_context_id',p_average_context_id,
    'average_policy_version_id',p_average_policy_version_id,
    'contributes_to_history',p_contributes_to_history);
end;
$$;

create or replace function public.calculate_competition_starting_averages(
  p_organisation_id bigint,p_league_season_id bigint,p_competition_id bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  setting public.competition_average_settings%rowtype;
  participant_row record;
  decision record;
  snapshot public.competition_participant_starting_averages%rowtype;
  snapshot_id bigint;
  items jsonb := '[]'::jsonb;
  manual_required boolean;
  snapshot_found boolean;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and competition.status = 'published'
    and season.id = p_league_season_id and season.organisation_id = p_organisation_id
  for update of competition;
  if not found then
    raise exception 'Published Competition not found in this Organisation and Season.' using errcode = '22023';
  end if;
  select * into setting from public.competition_average_settings average_setting
  where average_setting.competition_id = p_competition_id for share;
  if not found then
    raise exception 'Competition does not have authoritative Average settings.' using errcode = '22023';
  end if;

  for participant_row in
    select entrant_participant.id as participant_id,
      entrant_participant.competition_entrant_id as entrant_id,entrant_participant.slot_number,
      membership.user_id as shooter_profile_id,profile.first_name,profile.last_name
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants entrant_participant
      on entrant_participant.club_competition_entry_id = entry.id
     and entrant_participant.competition_entrant_id = entrant.id
    join public.club_memberships membership on membership.id = entrant_participant.club_membership_id
    join public.profiles profile on profile.id = membership.user_id
    where entry.competition_id = p_competition_id and entry.status = 'submitted'
    order by entrant.position,entrant_participant.slot_number,entrant_participant.id
  loop
    select * into decision from private.resolve_competition_starting_average(
      p_competition_id,participant_row.shooter_profile_id
    );
    select * into snapshot from public.competition_participant_starting_averages existing
    where existing.competition_entrant_participant_id = participant_row.participant_id for update;
    snapshot_found := found;

    if snapshot_found and snapshot.status = 'frozen' then
      manual_required := false;
    elsif decision.policy_branch in ('current','preceding') then
      insert into public.competition_participant_starting_averages(
        competition_id,competition_entrant_participant_id,shooter_profile_id,
        starting_average,average_context_id,average_policy_version_id,
        origin,status,calculated_at,frozen_at,source_competition_id,
        qualifying_score_count,manual_reason,created_by,updated_by
      ) values (
        p_competition_id,participant_row.participant_id,participant_row.shooter_profile_id,
        decision.starting_average,setting.average_context_id,setting.average_policy_version_id,
        'calculated','provisional',clock_timestamp(),null,decision.source_competition_id,
        decision.qualifying_score_count,null,actor,actor
      )
      on conflict (competition_entrant_participant_id) do update
      set shooter_profile_id = excluded.shooter_profile_id,
          starting_average = excluded.starting_average,
          average_context_id = excluded.average_context_id,
          average_policy_version_id = excluded.average_policy_version_id,
          origin = excluded.origin,status = 'provisional',calculated_at = excluded.calculated_at,
          frozen_at = null,source_competition_id = excluded.source_competition_id,
          qualifying_score_count = excluded.qualifying_score_count,manual_reason = null,
          updated_by = actor
      returning * into snapshot;
      snapshot_id := snapshot.id;
      delete from public.starting_average_score_sources provenance
      where provenance.starting_average_id = snapshot_id;
      insert into public.starting_average_score_sources(
        starting_average_id,shooting_score_source_id,competition_id,round_id,
        achieved_score_at_calculation,maximum_at_calculation
      )
      select snapshot_id,candidate.shooting_score_source_id,candidate.competition_id,
        candidate.round_id,candidate.achieved_score,candidate.maximum_score
      from private.shooter_historical_average_candidates(
        setting.average_context_id,participant_row.shooter_profile_id,p_competition_id
      ) candidate
      where candidate.competition_id = decision.source_competition_id;
      snapshot_found := true;
      manual_required := false;
    else
      if snapshot_found and snapshot.origin = 'calculated' then
        delete from public.competition_participant_starting_averages existing
        where existing.id = snapshot.id;
      end if;
      select * into snapshot from public.competition_participant_starting_averages existing
      where existing.competition_entrant_participant_id = participant_row.participant_id;
      snapshot_found := found;
      manual_required := not snapshot_found;
    end if;

    items := items || jsonb_build_array(jsonb_build_object(
      'competition_entrant_participant_id',participant_row.participant_id,
      'competition_entrant_id',participant_row.entrant_id,
      'slot_number',participant_row.slot_number,
      'shooter_profile_id',participant_row.shooter_profile_id,
      'first_name',participant_row.first_name,'last_name',participant_row.last_name,
      'starting_average',case when manual_required then null else snapshot.starting_average end,
      'manual_required',manual_required,
      'origin',case when manual_required then 'manual' else snapshot.origin end,
      'status',case when manual_required then null else snapshot.status end,
      'policy_branch',case when snapshot_found and snapshot.status = 'frozen'
        and snapshot.origin = 'manual' then 'manual' else decision.policy_branch end,
      'qualifying_score_count',case when manual_required then 0 else snapshot.qualifying_score_count end,
      'source_competition_id',case when manual_required then null else snapshot.source_competition_id end
    ));
  end loop;
  return items;
end;
$$;

create or replace function public.set_manual_competition_starting_average(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_entrant_participant_id bigint,
  p_starting_average numeric,
  p_manual_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  setting public.competition_average_settings%rowtype;
  shooter_id uuid;
  basis_maximum numeric;
  decision record;
  snapshot public.competition_participant_starting_averages%rowtype;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and competition.status = 'published'
    and season.id = p_league_season_id and season.organisation_id = p_organisation_id
  for update of competition;
  if not found then
    raise exception 'Published Competition not found in this Organisation and Season.' using errcode = '22023';
  end if;
  select * into setting
  from public.competition_average_settings average_setting
  where average_setting.competition_id = p_competition_id for share;
  if not found then
    raise exception 'Competition does not have authoritative Average settings.' using errcode = '22023';
  end if;
  select context.basis_maximum into basis_maximum
  from public.average_contexts context where context.id = setting.average_context_id;
  select membership.user_id into shooter_id
  from public.competition_entrant_participants participant
  join public.club_competition_entries entry on entry.id = participant.club_competition_entry_id
  join public.club_memberships membership on membership.id = participant.club_membership_id
  where participant.id = p_competition_entrant_participant_id
    and entry.competition_id = p_competition_id and entry.status = 'submitted';
  if shooter_id is null then
    raise exception 'Submitted Competition participant was not found.' using errcode = '22023';
  end if;
  if p_starting_average is null or p_starting_average < 0
    or p_starting_average > basis_maximum or p_starting_average <> round(p_starting_average,6) then
    raise exception 'Manual Starting Average must be a number from zero through the Context basis maximum, with at most six decimal places.'
      using errcode = '22023';
  end if;
  select * into decision from private.resolve_competition_starting_average(p_competition_id,shooter_id);
  if decision.policy_branch <> 'manual' then
    raise exception 'The active Average Policy can calculate this participant; manual input is not currently allowed.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.competition_participant_starting_averages existing
    where existing.competition_entrant_participant_id = p_competition_entrant_participant_id
      and existing.status = 'frozen'
  ) then
    raise exception 'Frozen Starting Averages cannot be changed through the provisional lifecycle.' using errcode = '22023';
  end if;
  insert into public.competition_participant_starting_averages(
    competition_id,competition_entrant_participant_id,shooter_profile_id,
    starting_average,average_context_id,average_policy_version_id,
    origin,status,calculated_at,frozen_at,source_competition_id,
    qualifying_score_count,manual_reason,created_by,updated_by
  ) values (
    p_competition_id,p_competition_entrant_participant_id,shooter_id,
    p_starting_average,setting.average_context_id,setting.average_policy_version_id,
    'manual','provisional',clock_timestamp(),null,null,0,
    nullif(btrim(p_manual_reason),''),actor,actor
  )
  on conflict (competition_entrant_participant_id) do update
  set shooter_profile_id = excluded.shooter_profile_id,
      starting_average = excluded.starting_average,
      average_context_id = excluded.average_context_id,
      average_policy_version_id = excluded.average_policy_version_id,
      origin = 'manual',status = 'provisional',calculated_at = excluded.calculated_at,
      frozen_at = null,source_competition_id = null,qualifying_score_count = 0,
      manual_reason = excluded.manual_reason,updated_by = actor
  returning * into snapshot;
  delete from public.starting_average_score_sources provenance
  where provenance.starting_average_id = snapshot.id;
  return jsonb_build_object('id',snapshot.id,'competition_id',snapshot.competition_id,
    'competition_entrant_participant_id',snapshot.competition_entrant_participant_id,
    'shooter_profile_id',snapshot.shooter_profile_id,'starting_average',snapshot.starting_average,
    'origin',snapshot.origin,'status',snapshot.status,'manual_reason',snapshot.manual_reason);
end;
$$;

alter table public.average_contexts enable row level security;
alter table public.average_policies enable row level security;
alter table public.average_policy_versions enable row level security;
alter table public.competition_average_settings enable row level security;
alter table public.competition_participant_starting_averages enable row level security;
alter table public.starting_average_score_sources enable row level security;

revoke all on table public.average_contexts,public.average_policies,
  public.average_policy_versions,public.competition_average_settings,
  public.competition_participant_starting_averages,
  public.starting_average_score_sources from public,anon,authenticated;
revoke all on sequence public.average_contexts_id_seq,public.average_policies_id_seq,
  public.average_policy_versions_id_seq,
  public.competition_participant_starting_averages_id_seq,
  public.starting_average_score_sources_id_seq from public,anon,authenticated;
grant select on table public.average_contexts,public.average_policies,
  public.average_policy_versions,public.competition_average_settings,
  public.competition_participant_starting_averages,
  public.starting_average_score_sources to authenticated;

drop policy if exists "Staff read Average Contexts" on public.average_contexts;
create policy "Staff read Average Contexts" on public.average_contexts
  for select to authenticated using (exists (
    select 1 from public.organisation_staff staff
    join public.organisations organisation on organisation.id = staff.organisation_id
    where staff.organisation_id = average_contexts.organisation_id
      and staff.user_id = (select auth.uid()) and staff.status = 'active'
      and staff.role in ('owner','manager') and organisation.status = 'active'
  ));
drop policy if exists "Staff read Average Policies" on public.average_policies;
create policy "Staff read Average Policies" on public.average_policies
  for select to authenticated using (exists (
    select 1 from public.organisation_staff staff
    join public.organisations organisation on organisation.id = staff.organisation_id
    where staff.organisation_id = average_policies.organisation_id
      and staff.user_id = (select auth.uid()) and staff.status = 'active'
      and staff.role in ('owner','manager') and organisation.status = 'active'
  ));
drop policy if exists "Staff read Average Policy versions" on public.average_policy_versions;
create policy "Staff read Average Policy versions" on public.average_policy_versions
  for select to authenticated using (exists (
    select 1 from public.average_policies policy
    where policy.id = average_policy_versions.average_policy_id
  ));
drop policy if exists "Staff read Competition Average settings" on public.competition_average_settings;
create policy "Staff read Competition Average settings" on public.competition_average_settings
  for select to authenticated using (exists (
    select 1 from public.competitions competition
    join public.league_seasons season on season.id = competition.league_season_id
    join public.organisation_staff staff on staff.organisation_id = season.organisation_id
    join public.organisations organisation on organisation.id = season.organisation_id
    where competition.id = competition_average_settings.competition_id
      and staff.user_id = (select auth.uid()) and staff.status = 'active'
      and staff.role in ('owner','manager') and organisation.status = 'active'
  ));
drop policy if exists "Staff read Starting Averages" on public.competition_participant_starting_averages;
create policy "Staff read Starting Averages" on public.competition_participant_starting_averages
  for select to authenticated using (exists (
    select 1 from public.competitions competition
    join public.league_seasons season on season.id = competition.league_season_id
    join public.organisation_staff staff on staff.organisation_id = season.organisation_id
    join public.organisations organisation on organisation.id = season.organisation_id
    where competition.id = competition_participant_starting_averages.competition_id
      and staff.user_id = (select auth.uid()) and staff.status = 'active'
      and staff.role in ('owner','manager') and organisation.status = 'active'
  ));
drop policy if exists "Staff read Starting Average provenance" on public.starting_average_score_sources;
create policy "Staff read Starting Average provenance" on public.starting_average_score_sources
  for select to authenticated using (exists (
    select 1 from public.competition_participant_starting_averages snapshot
    where snapshot.id = starting_average_score_sources.starting_average_id
  ));

revoke all on function private.competition_average_shooter_maximum(bigint),
  private.validate_average_policy_version_definition(),private.protect_average_policy_version(),
  private.protect_average_context_basis(),private.validate_competition_average_setting(),
  private.protect_competition_average_setting(),private.check_bound_competition_average_maximum(),
  private.validate_starting_average_snapshot(),private.protect_frozen_starting_average(),
  private.shooter_historical_average_candidates(bigint,uuid,bigint),
  private.average_context_competition_history(bigint,bigint),
  private.resolve_competition_starting_average(bigint,uuid)
  from public,anon,authenticated;
revoke all on function public.create_average_context(bigint,text,numeric),
  public.set_average_context_archived(bigint,bigint,boolean),
  public.create_average_policy(bigint,text,text,jsonb),
  public.create_average_policy_version(bigint,bigint,text,jsonb),
  public.set_average_policy_archived(bigint,bigint,boolean),
  public.set_competition_average_settings(bigint,bigint,bigint,bigint,bigint,boolean),
  public.calculate_competition_starting_averages(bigint,bigint,bigint),
  public.set_manual_competition_starting_average(bigint,bigint,bigint,bigint,numeric,text)
  from public,anon,authenticated;
grant execute on function public.create_average_context(bigint,text,numeric),
  public.set_average_context_archived(bigint,bigint,boolean),
  public.create_average_policy(bigint,text,text,jsonb),
  public.create_average_policy_version(bigint,bigint,text,jsonb),
  public.set_average_policy_archived(bigint,bigint,boolean),
  public.set_competition_average_settings(bigint,bigint,bigint,bigint,bigint,boolean),
  public.calculate_competition_starting_averages(bigint,bigint,bigint),
  public.set_manual_competition_starting_average(bigint,bigint,bigint,bigint,numeric,text)
  to authenticated;

comment on function private.shooter_historical_average_candidates(bigint,uuid,bigint) is
  'Private canonical achieved-score candidate primitive: published, released, complete, strict-maximum, submitted, contributing, and deduplicated by physical source.';
comment on function public.calculate_competition_starting_averages(bigint,bigint,bigint) is
  'Owner/manager calculation RPC. Creates or refreshes calculated provisional participant snapshots and returns manual-required rows without touching divisions.';
comment on function public.set_manual_competition_starting_average(bigint,bigint,bigint,bigint,numeric,text) is
  'Owner/manager provisional manual Starting Average mutation, allowed only when the immutable active Policy resolves to manual.';

commit;
