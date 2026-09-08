-- Competition Averages Stage 1: optional Series defaults and copy-on-create.
-- Run after competition-averages.sql. Defaults never rewrite existing editions.
begin;

create table if not exists public.competition_series_average_defaults (
  competition_series_id bigint primary key
    references public.competition_series(id) on delete cascade,
  average_context_id bigint not null references public.average_contexts(id),
  average_policy_version_id bigint not null references public.average_policy_versions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);

create index if not exists competition_series_average_defaults_context_idx
  on public.competition_series_average_defaults(average_context_id);
create index if not exists competition_series_average_defaults_policy_version_idx
  on public.competition_series_average_defaults(average_policy_version_id);
create index if not exists competition_series_average_defaults_created_by_idx
  on public.competition_series_average_defaults(created_by) where created_by is not null;
create index if not exists competition_series_average_defaults_updated_by_idx
  on public.competition_series_average_defaults(updated_by) where updated_by is not null;

comment on table public.competition_series_average_defaults is
  'Optional copy-on-create defaults only. They do not make Series editions average-compatible and never rewrite an existing Competition binding.';

create or replace function private.competition_series_average_shooter_maximum(
  p_competition_series_id bigint
)
returns numeric language sql stable set search_path = '' as $$
  select series.sets_per_round * sum(component.maximum_score)
  from public.competition_series series
  join public.competition_series_score_components component
    on component.competition_series_id = series.id
  where series.id = p_competition_series_id
  group by series.id,series.sets_per_round
$$;

create or replace function private.validate_competition_series_average_default()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  series_organisation_id bigint;
  context_organisation_id bigint;
  policy_organisation_id bigint;
  series_maximum numeric;
  context_maximum numeric;
  context_archived_at timestamptz;
  policy_archived_at timestamptz;
begin
  select series.organisation_id,private.competition_series_average_shooter_maximum(series.id)
  into series_organisation_id,series_maximum
  from public.competition_series series where series.id = new.competition_series_id;
  select context.organisation_id,context.basis_maximum,context.archived_at
  into context_organisation_id,context_maximum,context_archived_at
  from public.average_contexts context where context.id = new.average_context_id;
  select policy.organisation_id,policy.archived_at
  into policy_organisation_id,policy_archived_at
  from public.average_policy_versions version
  join public.average_policies policy on policy.id = version.average_policy_id
  where version.id = new.average_policy_version_id;
  if series_organisation_id is null or context_organisation_id is null
    or policy_organisation_id is null then
    raise exception 'Series, Average Context, or Average Policy version was not found.' using errcode = '23503';
  end if;
  if series_organisation_id <> context_organisation_id
    or series_organisation_id <> policy_organisation_id then
    raise exception 'Series, Average Context, and Average Policy must belong to the same Organisation.' using errcode = '22023';
  end if;
  if context_archived_at is not null or policy_archived_at is not null then
    raise exception 'Archived Average Contexts or Policies cannot be selected as Series defaults.' using errcode = '22023';
  end if;
  if series_maximum is null or series_maximum is distinct from context_maximum then
    raise exception 'Series shooter maximum % must exactly equal Average Context basis maximum %. V1 does not normalise scores.',
      series_maximum,context_maximum using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_competition_series_average_default
  on public.competition_series_average_defaults;
create trigger validate_competition_series_average_default
  before insert or update on public.competition_series_average_defaults
  for each row execute function private.validate_competition_series_average_default();

drop trigger if exists set_competition_series_average_defaults_updated_at
  on public.competition_series_average_defaults;
create trigger set_competition_series_average_defaults_updated_at
  before update on public.competition_series_average_defaults
  for each row execute function private.set_updated_at();

create or replace function private.check_series_average_default_maximum()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  series_id_to_check bigint;
  context_maximum numeric;
begin
  if tg_table_name = 'competition_series_score_components' then
    series_id_to_check := case when tg_op = 'DELETE' then old.competition_series_id else new.competition_series_id end;
  else
    series_id_to_check := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  select context.basis_maximum into context_maximum
  from public.competition_series_average_defaults defaults
  join public.average_contexts context on context.id = defaults.average_context_id
  where defaults.competition_series_id = series_id_to_check;
  if not found then return null; end if;
  if private.competition_series_average_shooter_maximum(series_id_to_check)
    is distinct from context_maximum then
    raise exception 'Series with Average defaults must continue to exactly match its Context basis maximum.'
      using errcode = '22023';
  end if;
  return null;
end;
$$;
drop trigger if exists check_series_average_default_maximum on public.competition_series;
create constraint trigger check_series_average_default_maximum
  after insert or update or delete on public.competition_series deferrable initially deferred
  for each row execute function private.check_series_average_default_maximum();
drop trigger if exists check_series_average_default_maximum on public.competition_series_score_components;
create constraint trigger check_series_average_default_maximum
  after insert or update or delete on public.competition_series_score_components deferrable initially deferred
  for each row execute function private.check_series_average_default_maximum();

-- Existing continuation attaches the Series only after creating the new draft.
-- This trigger copies current defaults exactly once at that attachment point.
create or replace function private.copy_competition_series_average_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.competition_series_id is not null
    and new.competition_series_id is distinct from old.competition_series_id then
    insert into public.competition_average_settings(
      competition_id,average_context_id,average_policy_version_id,
      contributes_to_history,created_by,updated_by
    )
    select new.id,defaults.average_context_id,defaults.average_policy_version_id,
      true,coalesce((select auth.uid()),new.updated_by),coalesce((select auth.uid()),new.updated_by)
    from public.competition_series_average_defaults defaults
    where defaults.competition_series_id = new.competition_series_id
    on conflict (competition_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists copy_competition_series_average_defaults on public.competitions;
create trigger copy_competition_series_average_defaults
  after update of competition_series_id on public.competitions
  for each row execute function private.copy_competition_series_average_defaults();

create or replace function public.set_competition_series_average_defaults(
  p_organisation_id bigint,
  p_competition_series_id bigint,
  p_average_context_id bigint,
  p_average_policy_version_id bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform series.id from public.competition_series series
  where series.id = p_competition_series_id and series.organisation_id = p_organisation_id
  for update;
  if not found then raise exception 'Series not found in this Organisation.' using errcode = '22023'; end if;
  if (p_average_context_id is null) <> (p_average_policy_version_id is null) then
    raise exception 'Average Context and Average Policy version defaults must be set or cleared together.' using errcode = '22023';
  end if;
  if p_average_context_id is null then
    delete from public.competition_series_average_defaults defaults
    where defaults.competition_series_id = p_competition_series_id;
    return jsonb_build_object('competition_series_id',p_competition_series_id,
      'average_context_id',null,'average_policy_version_id',null);
  end if;
  insert into public.competition_series_average_defaults(
    competition_series_id,average_context_id,average_policy_version_id,created_by,updated_by
  ) values (
    p_competition_series_id,p_average_context_id,p_average_policy_version_id,actor,actor
  )
  on conflict (competition_series_id) do update
  set average_context_id = excluded.average_context_id,
      average_policy_version_id = excluded.average_policy_version_id,
      updated_by = actor;
  return jsonb_build_object('competition_series_id',p_competition_series_id,
    'average_context_id',p_average_context_id,
    'average_policy_version_id',p_average_policy_version_id);
end;
$$;

-- New backend callers that want defaults on the first edition use this wrapper.
-- The existing create_competition_series signature remains unchanged.
create or replace function public.create_competition_series_with_average_defaults(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_series_name text,
  p_configuration jsonb,
  p_average_context_id bigint,
  p_average_policy_version_id bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_average_context_id is null or p_average_policy_version_id is null then
    raise exception 'Average Context and Average Policy version defaults are required.' using errcode = '22023';
  end if;
  result := public.create_competition_series(
    p_organisation_id,p_league_season_id,p_series_name,p_configuration
  );
  perform public.set_competition_series_average_defaults(
    p_organisation_id,(result->>'competition_series_id')::bigint,
    p_average_context_id,p_average_policy_version_id
  );
  perform public.set_competition_average_settings(
    p_organisation_id,p_league_season_id,(result->>'id')::bigint,
    p_average_context_id,p_average_policy_version_id,true
  );
  return result || jsonb_build_object('average_context_id',p_average_context_id,
    'average_policy_version_id',p_average_policy_version_id,'contributes_to_history',true);
end;
$$;

alter table public.competition_series_average_defaults enable row level security;
revoke all on table public.competition_series_average_defaults from public,anon,authenticated;
grant select on table public.competition_series_average_defaults to authenticated;
drop policy if exists "Staff read Series Average defaults" on public.competition_series_average_defaults;
create policy "Staff read Series Average defaults" on public.competition_series_average_defaults
  for select to authenticated using (exists (
    select 1 from public.competition_series series
    where series.id = competition_series_average_defaults.competition_series_id
  ));

revoke all on function private.competition_series_average_shooter_maximum(bigint),
  private.validate_competition_series_average_default(),
  private.check_series_average_default_maximum(),
  private.copy_competition_series_average_defaults()
  from public,anon,authenticated;
revoke all on function public.set_competition_series_average_defaults(bigint,bigint,bigint,bigint),
  public.create_competition_series_with_average_defaults(bigint,bigint,text,jsonb,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.set_competition_series_average_defaults(bigint,bigint,bigint,bigint),
  public.create_competition_series_with_average_defaults(bigint,bigint,text,jsonb,bigint,bigint)
  to authenticated;

commit;
