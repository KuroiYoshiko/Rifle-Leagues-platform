-- DEVELOPMENT ONLY. Small, rerunnable Competition Series UI fixture.
-- Run after development-demo-seed.sql and all Competition Series SQL files.
-- It adds two isolated Series and two isolated Competition editions. It does not
-- modify existing competitions, entries, divisions, scores, or fixture records.
begin;

do $$
declare
  v_organisation_id bigint;
  v_owner_id uuid;
  v_previous_season_id bigint;
  v_previous_starts_at date;
  v_current_season_id bigint;
  v_current_starts_at date;
  v_series_id bigint;
  v_competition_id bigint;
begin
  select organisation.id, staff.user_id
  into v_organisation_id, v_owner_id
  from public.organisations organisation
  join public.organisation_staff staff on staff.organisation_id = organisation.id
  where organisation.slug = 'eastern-region-shooting-association'
    and staff.role = 'owner'
    and staff.status = 'active'
  order by staff.id
  limit 1;

  select id, starts_at into v_previous_season_id, v_previous_starts_at
  from public.league_seasons
  where organisation_id = v_organisation_id
    and slug = 'eastern-winter-postal-league';

  select id, starts_at into v_current_season_id, v_current_starts_at
  from public.league_seasons
  where organisation_id = v_organisation_id
    and slug = 'eastern-summer-league';

  if v_organisation_id is null or v_owner_id is null
    or v_previous_season_id is null or v_current_season_id is null then
    raise exception 'Run development-demo-seed.sql before the Competition Series development fixture.';
  end if;

  if not exists (
    select 1 from public.competition_series
    where organisation_id = v_organisation_id
      and slug = 'dev-short-range-prone-league'
  ) then
    insert into public.competition_series (
      organisation_id, name, slug, entry_format, team_size, discipline_code,
      sets_per_round, shots_per_round, created_by, updated_by
    ) values (
      v_organisation_id, 'Short Range Prone League', 'dev-short-range-prone-league',
      'individual', 1, 'rifle_prone', 1, 10, v_owner_id, v_owner_id
    ) returning id into v_series_id;

    insert into public.competition_series_score_components (
      competition_series_id, position, short_label, maximum_score, score_method
    ) values (v_series_id, 1, 'Prone', 100, 'points_dropped');

    insert into public.competitions (
      league_season_id, competition_series_id, name, slug, description, status,
      entry_format, team_size, scoring_method, maximum_score_per_round,
      shots_per_round, uses_x_score, number_of_rounds, entry_fee,
      entry_window_mode, start_date_mode, sets_per_round, ranking_method,
      best_rounds_count, local_scoring_enabled, discipline_code,
      created_by, updated_by
    ) values (
      v_previous_season_id, v_series_id, 'Short Range Prone 2025',
      'dev-short-range-prone-2025', 'Development-only recommended Series source.',
      'draft', 'individual', 1, 'points_dropped', 100, 10, false, 4, 7.50,
      'season_default', 'season_default', 1, 'aggregate', null, true,
      'rifle_prone', v_owner_id, v_owner_id
    ) returning id into v_competition_id;

    insert into public.competition_score_components (
      competition_id, position, short_label, maximum_score, score_method
    ) values (v_competition_id, 1, 'Prone', 100, 'points_dropped');
    insert into public.competition_rounds (competition_id, round_number, deadline)
    select v_competition_id, round_number,
      v_previous_starts_at + (round_number * 14)
    from generate_series(1, 4) round_number;
    update public.competitions
    set status = 'published'
    where id = v_competition_id;

    insert into public.competitions (
      league_season_id, competition_series_id, name, slug, description, status,
      entry_format, team_size, scoring_method, maximum_score_per_round,
      shots_per_round, uses_x_score, number_of_rounds, entry_fee,
      entry_window_mode, start_date_mode, sets_per_round, ranking_method,
      best_rounds_count, local_scoring_enabled, discipline_code,
      created_by, updated_by
    ) values (
      v_current_season_id, v_series_id, 'Short Range Prone Trial',
      'dev-short-range-prone-trial', 'Development-only explicit source override.',
      'draft', 'individual', 1, 'points_dropped', 100, 10, true, 4, 8.00,
      'season_default', 'season_default', 1, 'gun_score', null, false,
      'rifle_prone', v_owner_id, v_owner_id
    ) returning id into v_competition_id;

    insert into public.competition_score_components (
      competition_id, position, short_label, maximum_score, score_method
    ) values (v_competition_id, 1, 'Prone', 100, 'points_dropped');
    insert into public.competition_rounds (competition_id, round_number, deadline)
    select v_competition_id, round_number,
      v_current_starts_at + (round_number * 14)
    from generate_series(1, 4) round_number;
  end if;

  if not exists (
    select 1 from public.competition_series
    where organisation_id = v_organisation_id
      and slug = 'dev-archived-empty-series'
  ) then
    insert into public.competition_series (
      organisation_id, name, slug, archived_at, entry_format, team_size,
      discipline_code, sets_per_round, shots_per_round, created_by, updated_by
    ) values (
      v_organisation_id, 'Archived Empty Series', 'dev-archived-empty-series',
      now(), 'individual', 1, 'rifle_benchrest', 1, 10, v_owner_id, v_owner_id
    );
  end if;
end;
$$;

commit;

-- Manual paths after running the fixture:
-- Owner: basildon.demo01@example.com
-- Manager: basildon.demo02@example.com
-- Add/Continue in target Season:
-- /organisations/eastern-region-shooting-association/leagues/eastern-autumn-development-league/competitions/new
-- Owner Series management:
-- /organisations/eastern-region-shooting-association/management
