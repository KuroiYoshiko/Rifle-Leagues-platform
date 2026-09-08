-- Additive V1 lifecycle invariant. Run after the Competition Series Stage 1
-- management SQL and all later Competition Series contract corrections.
begin;

do $$
declare
  duplicate_summary text;
begin
  select string_agg(
    format('series %s / season %s (%s editions)', competition_series_id, league_season_id, edition_count),
    '; ' order by competition_series_id, league_season_id
  )
  into duplicate_summary
  from (
    select competition_series_id, league_season_id, count(*) as edition_count
    from public.competitions
    where competition_series_id is not null
    group by competition_series_id, league_season_id
    having count(*) > 1
  ) duplicates;

  if duplicate_summary is not null then
    raise exception 'Resolve existing duplicate Competition Series editions before applying this upgrade: %', duplicate_summary
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists competitions_series_season_unique
  on public.competitions (competition_series_id, league_season_id)
  where competition_series_id is not null;

comment on index public.competitions_series_season_unique is
  'V1 invariant: a Competition Series has at most one linked edition in each League Season; unlinked one-offs are excluded.';

-- Target-Season editions are neither recommendations nor explicit configuration
-- sources for continuing a Series into that same Season.
create or replace function public.get_competition_series_sources(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_series_id bigint,
  p_target_starts_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.get_competition_series_sources(bigint, bigint, bigint, date)
  from public, anon, authenticated;
grant execute on function public.get_competition_series_sources(bigint, bigint, bigint, date)
  to authenticated;

comment on function public.get_competition_series_sources(bigint, bigint, bigint, date) is
  'Returns authenticated configuration-source candidates outside the target Season, with an unambiguous chronological recommendation when available.';

commit;
