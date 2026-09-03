-- Run after database/league-seasons.sql on an existing populated database.
-- This migration is additive, idempotent, and does not rewrite existing rows.

begin;

alter table public.league_seasons
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'league_seasons_description_length'
      and conrelid = 'public.league_seasons'::regclass
  ) then
    alter table public.league_seasons
      add constraint league_seasons_description_length
      check (
        description is null
        or (
          char_length(description) <= 2000
          and description = btrim(description)
        )
      ) not valid;
  end if;
end;
$$;

alter table public.league_seasons
  validate constraint league_seasons_description_length;

comment on column public.league_seasons.description is
  'Optional plain-text season description, limited to 2,000 characters.';

grant select (description)
  on table public.league_seasons
  to authenticated;

-- The existing six-argument RPC remains available for older create clients.
create or replace function public.create_league_season(
  p_organisation_id bigint,
  p_name text,
  p_entry_opens_at date,
  p_entry_closes_at date,
  p_starts_at date,
  p_ends_at date,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_result jsonb;
begin
  if char_length(v_description) > 2000 then
    raise exception 'Season description must contain 2,000 characters or fewer.'
      using errcode = '22023';
  end if;

  v_result := public.create_league_season(
    p_organisation_id,
    p_name,
    p_entry_opens_at,
    p_entry_closes_at,
    p_starts_at,
    p_ends_at
  );

  update public.league_seasons as season
  set description = v_description
  where season.id = (v_result ->> 'id')::bigint
    and season.organisation_id = p_organisation_id;

  return v_result;
end;
$$;

comment on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) is
  'Creates one draft season with an optional plain-text description; preserves the original RPC signature as a compatibility overload.';

revoke execute on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) from public, anon, authenticated;
grant execute on function public.create_league_season(
  bigint,
  text,
  date,
  date,
  date,
  date,
  text
) to authenticated;

-- The existing eight-argument RPC remains available for older update clients
-- and does not clear a description that it does not know about.
create or replace function public.update_league_season(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_name text,
  p_entry_opens_at date,
  p_entry_closes_at date,
  p_starts_at date,
  p_ends_at date,
  p_status text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_result jsonb;
begin
  if char_length(v_description) > 2000 then
    raise exception 'Season description must contain 2,000 characters or fewer.'
      using errcode = '22023';
  end if;

  v_result := public.update_league_season(
    p_organisation_id,
    p_league_season_id,
    p_name,
    p_entry_opens_at,
    p_entry_closes_at,
    p_starts_at,
    p_ends_at,
    p_status
  );

  update public.league_seasons as season
  set description = v_description
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;

  return v_result;
end;
$$;

comment on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text,
  text
) is
  'Updates mutable season fields including an optional plain-text description; preserves the original RPC signature as a compatibility overload.';

revoke execute on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.update_league_season(
  bigint,
  bigint,
  text,
  date,
  date,
  date,
  date,
  text,
  text
) to authenticated;

commit;
