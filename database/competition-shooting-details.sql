-- Structured physical shooting details. Run after the complete Competition
-- Series and Competition Averages migration chain, and before
-- concurrent-shooting-physical-compatibility.sql.
--
-- Existing rows are deliberately left with shooting_details_version IS NULL.
-- No equipment, position, distance, or shot value is inferred from legacy text.
-- The updated application writes version 1 for every newly configured draft.

begin;

create or replace function private.clean_shooting_term(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.btrim(p_value), '[[:space:]]+', ' ', 'g')
$$;

create or replace function private.normalise_shooting_term(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.lower(private.clean_shooting_term(p_value))
$$;

create table if not exists public.shooting_equipment_types (
  code text primary key,
  display_name text not null,
  sort_order smallint not null,
  constraint shooting_equipment_types_code_value check (
    code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
  ),
  constraint shooting_equipment_types_display_name_value check (
    display_name = private.clean_shooting_term(display_name)
    and char_length(display_name) between 2 and 80
  ),
  constraint shooting_equipment_types_sort_order_value check (sort_order > 0),
  constraint shooting_equipment_types_sort_order_unique unique (sort_order)
);

insert into public.shooting_equipment_types (code, display_name, sort_order)
values
  ('smallbore_rifle', 'Smallbore Rifle', 10),
  ('fullbore_rifle', 'Fullbore Rifle', 20),
  ('lightweight_sporting_rifle', 'Lightweight Sporting Rifle', 30),
  ('gallery_rifle', 'Gallery Rifle', 40),
  ('air_rifle', 'Air Rifle', 50),
  ('pistol', 'Pistol', 60),
  ('air_pistol', 'Air Pistol', 70),
  ('shotgun', 'Shotgun', 80)
on conflict (code) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order;

create table if not exists public.shooting_positions (
  code text primary key,
  display_name text not null,
  sort_order smallint not null,
  constraint shooting_positions_code_value check (
    code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
  ),
  constraint shooting_positions_display_name_value check (
    display_name = private.clean_shooting_term(display_name)
    and char_length(display_name) between 2 and 80
  ),
  constraint shooting_positions_sort_order_value check (sort_order > 0),
  constraint shooting_positions_sort_order_unique unique (sort_order)
);

insert into public.shooting_positions (code, display_name, sort_order)
values
  ('prone', 'Prone', 10),
  ('standing', 'Standing', 20),
  ('kneeling', 'Kneeling', 30),
  ('benchrest', 'Benchrest', 40)
on conflict (code) do update
set display_name = excluded.display_name,
    sort_order = excluded.sort_order;

create table if not exists public.organisation_equipment_types (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint organisation_equipment_types_display_name_value check (
    display_name = private.clean_shooting_term(display_name)
    and char_length(display_name) between 2 and 80
  ),
  constraint organisation_equipment_types_normalized_name_value check (
    normalized_name = private.normalise_shooting_term(display_name)
  ),
  constraint organisation_equipment_types_org_name_unique unique (
    organisation_id, normalized_name
  )
);

create table if not exists public.organisation_shooting_positions (
  id bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint organisation_shooting_positions_display_name_value check (
    display_name = private.clean_shooting_term(display_name)
    and char_length(display_name) between 2 and 80
  ),
  constraint organisation_shooting_positions_normalized_name_value check (
    normalized_name = private.normalise_shooting_term(display_name)
  ),
  constraint organisation_shooting_positions_org_name_unique unique (
    organisation_id, normalized_name
  )
);

drop trigger if exists set_organisation_equipment_types_updated_at
  on public.organisation_equipment_types;
create trigger set_organisation_equipment_types_updated_at
  before update on public.organisation_equipment_types
  for each row execute function private.set_updated_at();

drop trigger if exists set_organisation_shooting_positions_updated_at
  on public.organisation_shooting_positions;
create trigger set_organisation_shooting_positions_updated_at
  before update on public.organisation_shooting_positions
  for each row execute function private.set_updated_at();

alter table public.competitions
  add column if not exists shooting_details_version smallint,
  add column if not exists equipment_type_code text,
  add column if not exists organisation_equipment_type_id bigint;

alter table public.competition_score_components
  add column if not exists shooting_position_mode text,
  add column if not exists shooting_position_code text,
  add column if not exists organisation_shooting_position_id bigint,
  add column if not exists distance_mode text,
  add column if not exists distance_value numeric(12, 3),
  add column if not exists distance_unit text,
  add column if not exists shots integer;

alter table public.competition_series
  add column if not exists shooting_details_version smallint,
  add column if not exists equipment_type_code text,
  add column if not exists organisation_equipment_type_id bigint;

alter table public.competition_series_score_components
  add column if not exists shooting_position_mode text,
  add column if not exists shooting_position_code text,
  add column if not exists organisation_shooting_position_id bigint,
  add column if not exists distance_mode text,
  add column if not exists distance_value numeric(12, 3),
  add column if not exists distance_unit text,
  add column if not exists shots integer;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_equipment_type_code_fkey'
  ) then
    alter table public.competitions
      add constraint competitions_equipment_type_code_fkey
      foreign key (equipment_type_code)
      references public.shooting_equipment_types(code);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competitions'::regclass
      and conname = 'competitions_organisation_equipment_type_id_fkey'
  ) then
    alter table public.competitions
      add constraint competitions_organisation_equipment_type_id_fkey
      foreign key (organisation_equipment_type_id)
      references public.organisation_equipment_types(id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competition_score_components'::regclass
      and conname = 'competition_score_components_shooting_position_code_fkey'
  ) then
    alter table public.competition_score_components
      add constraint competition_score_components_shooting_position_code_fkey
      foreign key (shooting_position_code)
      references public.shooting_positions(code);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competition_score_components'::regclass
      and conname = 'competition_score_components_organisation_position_id_fkey'
  ) then
    alter table public.competition_score_components
      add constraint competition_score_components_organisation_position_id_fkey
      foreign key (organisation_shooting_position_id)
      references public.organisation_shooting_positions(id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competition_series'::regclass
      and conname = 'competition_series_equipment_type_code_fkey'
  ) then
    alter table public.competition_series
      add constraint competition_series_equipment_type_code_fkey
      foreign key (equipment_type_code)
      references public.shooting_equipment_types(code);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competition_series'::regclass
      and conname = 'competition_series_organisation_equipment_type_id_fkey'
  ) then
    alter table public.competition_series
      add constraint competition_series_organisation_equipment_type_id_fkey
      foreign key (organisation_equipment_type_id)
      references public.organisation_equipment_types(id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competition_series_score_components'::regclass
      and conname = 'competition_series_components_position_code_fkey'
  ) then
    alter table public.competition_series_score_components
      add constraint competition_series_components_position_code_fkey
      foreign key (shooting_position_code)
      references public.shooting_positions(code);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competition_series_score_components'::regclass
      and conname = 'competition_series_components_org_position_id_fkey'
  ) then
    alter table public.competition_series_score_components
      add constraint competition_series_components_org_position_id_fkey
      foreign key (organisation_shooting_position_id)
      references public.organisation_shooting_positions(id);
  end if;
end;
$$;

do $$
declare
  target regclass;
  prefix text;
begin
  foreach target in array array[
    'public.competitions'::regclass,
    'public.competition_series'::regclass
  ] loop
    prefix := case target
      when 'public.competitions'::regclass then 'competitions'
      else 'competition_series'
    end;
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = target and conname = prefix || '_shooting_details_version_value'
    ) then
      execute format(
        'alter table %s add constraint %I check (shooting_details_version is null or shooting_details_version = 1)',
        target, prefix || '_shooting_details_version_value'
      );
    end if;
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = target and conname = prefix || '_equipment_choice_value'
    ) then
      execute format(
        'alter table %s add constraint %I check ((equipment_type_code is null or organisation_equipment_type_id is null) and (shooting_details_version is not null or (equipment_type_code is null and organisation_equipment_type_id is null)))',
        target, prefix || '_equipment_choice_value'
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  target regclass;
  prefix text;
begin
  foreach target in array array[
    'public.competition_score_components'::regclass,
    'public.competition_series_score_components'::regclass
  ] loop
    prefix := case target
      when 'public.competition_score_components'::regclass then 'competition_score_components'
      else 'competition_series_components'
    end;
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = target and conname = prefix || '_position_choice_value'
    ) then
      execute format(
        'alter table %s add constraint %I check ((shooting_position_mode is null and shooting_position_code is null and organisation_shooting_position_id is null) or (shooting_position_mode = ''fixed'' and ((shooting_position_code is not null)::integer + (organisation_shooting_position_id is not null)::integer) = 1) or (shooting_position_mode in (''variable'', ''not_applicable'') and shooting_position_code is null and organisation_shooting_position_id is null))',
        target, prefix || '_position_choice_value'
      );
    end if;
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = target and conname = prefix || '_distance_value'
    ) then
      execute format(
        'alter table %s add constraint %I check ((distance_mode is null and distance_value is null and distance_unit is null) or (distance_mode = ''fixed'' and distance_value > 0 and distance_value <= 100000 and distance_unit in (''metres'', ''yards'', ''feet'')) or (distance_mode in (''variable'', ''not_applicable'') and distance_value is null and distance_unit is null))',
        target, prefix || '_distance_value'
      );
    end if;
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = target and conname = prefix || '_shots_value'
    ) then
      execute format(
        'alter table %s add constraint %I check (shots is null or shots between 1 and 10000)',
        target, prefix || '_shots_value'
      );
    end if;
  end loop;
end;
$$;

create index if not exists organisation_equipment_types_created_by_idx
  on public.organisation_equipment_types(created_by) where created_by is not null;
create index if not exists organisation_shooting_positions_created_by_idx
  on public.organisation_shooting_positions(created_by) where created_by is not null;
create index if not exists competitions_organisation_equipment_type_idx
  on public.competitions(organisation_equipment_type_id)
  where organisation_equipment_type_id is not null;
create index if not exists competition_components_organisation_position_idx
  on public.competition_score_components(organisation_shooting_position_id)
  where organisation_shooting_position_id is not null;
create index if not exists competition_series_organisation_equipment_type_idx
  on public.competition_series(organisation_equipment_type_id)
  where organisation_equipment_type_id is not null;
create index if not exists competition_series_components_org_position_idx
  on public.competition_series_score_components(organisation_shooting_position_id)
  where organisation_shooting_position_id is not null;

comment on table public.shooting_equipment_types is
  'Stable global equipment categories. Physical position and event style do not belong here.';
comment on table public.shooting_positions is
  'Stable global physical shooting positions/styles used by score components.';
comment on table public.organisation_equipment_types is
  'Reusable Organisation-scoped custom equipment categories with normalized identity.';
comment on table public.organisation_shooting_positions is
  'Reusable Organisation-scoped custom shooting positions/styles with normalized identity.';
comment on column public.competitions.shooting_details_version is
  'NULL marks untouched legacy configuration. Version 1 requires explicit structured physical details before publication and Concurrent eligibility.';
comment on column public.competitions.shots_per_round is
  'Backward-compatible total. For structured version 1 it is derived server-side as sets_per_round multiplied by the sum of component shots.';
comment on column public.competition_score_components.shots is
  'Physical shots represented by this component within one set.';
comment on column public.competition_score_components.distance_value is
  'Organiser-facing fixed distance value; compared with distance_unit exactly for Concurrent Shooting V1.';

alter table public.shooting_equipment_types enable row level security;
alter table public.shooting_positions enable row level security;
alter table public.organisation_equipment_types enable row level security;
alter table public.organisation_shooting_positions enable row level security;

revoke all on table public.shooting_equipment_types,
  public.shooting_positions,
  public.organisation_equipment_types,
  public.organisation_shooting_positions
  from public, anon, authenticated;
revoke all on sequence public.organisation_equipment_types_id_seq,
  public.organisation_shooting_positions_id_seq
  from public, anon, authenticated;
grant select on table public.shooting_equipment_types,
  public.shooting_positions,
  public.organisation_equipment_types,
  public.organisation_shooting_positions
  to authenticated;

drop policy if exists "Authenticated read built-in equipment" on public.shooting_equipment_types;
create policy "Authenticated read built-in equipment"
  on public.shooting_equipment_types for select to authenticated using (true);
drop policy if exists "Authenticated read built-in positions" on public.shooting_positions;
create policy "Authenticated read built-in positions"
  on public.shooting_positions for select to authenticated using (true);
drop policy if exists "Contextual staff read custom equipment" on public.organisation_equipment_types;
create policy "Contextual staff read custom equipment"
  on public.organisation_equipment_types for select to authenticated using (
    exists (
      select 1
      from public.organisation_staff staff
      join public.organisations organisation on organisation.id = staff.organisation_id
      where staff.organisation_id = organisation_equipment_types.organisation_id
        and staff.user_id = (select auth.uid())
        and staff.status = 'active'
        and staff.role in ('owner', 'manager')
        and organisation.status = 'active'
    )
  );
drop policy if exists "Contextual staff read custom positions" on public.organisation_shooting_positions;
create policy "Contextual staff read custom positions"
  on public.organisation_shooting_positions for select to authenticated using (
    exists (
      select 1
      from public.organisation_staff staff
      join public.organisations organisation on organisation.id = staff.organisation_id
      where staff.organisation_id = organisation_shooting_positions.organisation_id
        and staff.user_id = (select auth.uid())
        and staff.status = 'active'
        and staff.role in ('owner', 'manager')
        and organisation.status = 'active'
    )
  );

-- Refresh the existing column-level projections. Direct writes remain revoked.
revoke select on table public.competitions from authenticated;
grant select (
  id, league_season_id, competition_series_id, name, slug, description, status,
  entry_format, team_size, scoring_method, maximum_score_per_round,
  shots_per_round, uses_x_score, number_of_rounds, entry_fee,
  entry_window_mode, custom_entry_opens_at, custom_entry_closes_at,
  start_date_mode, custom_starts_at, sets_per_round, ranking_method,
  best_rounds_count, local_scoring_enabled, shooting_details_version,
  equipment_type_code, organisation_equipment_type_id, created_at, updated_at
) on table public.competitions to authenticated;

revoke select on table public.competition_score_components from authenticated;
grant select (
  id, competition_id, position, short_label, maximum_score, score_method,
  shooting_position_mode, shooting_position_code,
  organisation_shooting_position_id, distance_mode, distance_value,
  distance_unit, shots, created_at, updated_at
) on table public.competition_score_components to authenticated;

create or replace function private.resolve_organisation_equipment_type(
  p_organisation_id bigint,
  p_existing_id bigint,
  p_new_name text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.resolve_organisation_shooting_position(
  p_organisation_id bigint,
  p_existing_id bigint,
  p_new_name text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.competition_components(p_competition_id bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
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
$$;

create or replace function private.competition_series_components(p_series_id bigint)
returns jsonb
language sql
stable
set search_path = ''
as $$
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
$$;

create or replace function private.competition_has_complete_shooting_details(
  p_competition_id bigint
)
returns boolean
language sql
stable
set search_path = ''
as $$
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
$$;

create or replace function private.validate_competition_shooting_details(
  p_competition_id bigint,
  p_require_complete boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.validate_final_competition_shooting_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

drop trigger if exists validate_final_competition_shooting_details
  on public.competitions;
create constraint trigger validate_final_competition_shooting_details
  after insert or update on public.competitions
  deferrable initially deferred
  for each row execute function private.validate_final_competition_shooting_details();

drop trigger if exists validate_final_component_shooting_details
  on public.competition_score_components;
create constraint trigger validate_final_component_shooting_details
  after insert or update or delete on public.competition_score_components
  deferrable initially deferred
  for each row execute function private.validate_final_competition_shooting_details();

create or replace function private.apply_competition_shooting_details(
  p_organisation_id bigint,
  p_competition_id bigint,
  p_configuration jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.check_competition_configuration_keys(
  p_values jsonb,
  p_identity boolean
)
returns void
language plpgsql
set search_path = ''
as $$
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
$$;

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
$$;

create or replace function public.create_competition_with_shooting_details(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_configuration jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_configuration ->> 'shooting_details_version' <> '1' then
    raise exception 'Structured shooting details version 1 is required.' using errcode = '22023';
  end if;
  return private.save_series_competition(
    p_organisation_id, p_league_season_id, p_configuration
  );
end;
$$;

create or replace function public.update_competition_shooting_details_draft(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_configuration jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.sync_provisional_competition_series(p_competition_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

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
$$;

create or replace function private.protect_series_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.create_competition_series(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_series_name text,
  p_configuration jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.continue_competition_series(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_series_id bigint,
  p_configuration_source_competition_id bigint,
  p_expected_source_version text,
  p_edition_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.protect_published_competition_configuration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

drop trigger if exists protect_published_competition_configuration on public.competitions;
create trigger protect_published_competition_configuration
  before update of entry_format, team_size, sets_per_round, shots_per_round,
    scoring_method, maximum_score_per_round, ranking_method, best_rounds_count,
    uses_x_score, number_of_rounds, shooting_details_version,
    equipment_type_code, organisation_equipment_type_id
  on public.competitions
  for each row execute function private.protect_published_competition_configuration();

create or replace function private.protect_published_competition_component()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function private.clean_shooting_term(text),
  private.normalise_shooting_term(text),
  private.resolve_organisation_equipment_type(bigint, bigint, text),
  private.resolve_organisation_shooting_position(bigint, bigint, text),
  private.competition_has_complete_shooting_details(bigint),
  private.validate_competition_shooting_details(bigint, boolean),
  private.validate_final_competition_shooting_details(),
  private.apply_competition_shooting_details(bigint, bigint, jsonb),
  private.competition_components(bigint),
  private.competition_series_components(bigint),
  private.check_competition_configuration_keys(jsonb, boolean),
  private.save_series_competition(bigint, bigint, jsonb, bigint),
  private.sync_provisional_competition_series(bigint),
  private.validate_competition_series(bigint, boolean),
  private.protect_series_contract(),
  private.protect_published_competition_configuration(),
  private.protect_published_competition_component()
  from public, anon, authenticated;

revoke execute on function public.create_competition_with_shooting_details(
  bigint, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.create_competition_with_shooting_details(
  bigint, bigint, jsonb
) to authenticated;
revoke execute on function public.update_competition_shooting_details_draft(
  bigint, bigint, bigint, jsonb
) from public, anon, authenticated;
grant execute on function public.update_competition_shooting_details_draft(
  bigint, bigint, bigint, jsonb
) to authenticated;

comment on function public.create_competition_with_shooting_details(bigint, bigint, jsonb) is
  'Creates a private draft with versioned physical shooting details and server-derived shots per Round.';
comment on function public.update_competition_shooting_details_draft(bigint, bigint, bigint, jsonb) is
  'Updates a draft through the versioned physical configuration path; published configuration remains locked.';

commit;
