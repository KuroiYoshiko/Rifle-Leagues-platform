-- Run AFTER database/club-foundation.sql, database/competition-entries.sql,
-- and database/competition-aggregate-results.sql.
-- Safe to rerun on populated databases. This creates narrow public catalogue
-- projections; source tables, RLS policies, and management RPC grants are not
-- changed.
begin;

create or replace function public.get_public_results_catalog(
  p_organisation_slug text default null,
  p_season_slug text default null,
  p_competition_slug text default null,
  p_query text default null,
  p_offset integer default 0,
  p_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organisation public.organisations%rowtype;
  v_season public.league_seasons%rowtype;
  v_competition public.competitions%rowtype;
  v_query text := nullif(pg_catalog.btrim(p_query), '');
  v_result jsonb;
begin
  if p_offset is null or p_offset < 0
    or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Invalid public catalog pagination.' using errcode = '22023';
  end if;

  if v_query is not null and char_length(v_query) > 100 then
    raise exception 'Public organisation search is too long.' using errcode = '22023';
  end if;

  if p_organisation_slug is null then
    if p_season_slug is not null or p_competition_slug is not null then
      raise exception 'Organisation context is required.' using errcode = '22023';
    end if;

    select jsonb_build_object(
      'total_count', (
        select count(*)
        from public.organisations as organisation
        where organisation.status = 'active'
          and (
            v_query is null
            or organisation.search_document @@ pg_catalog.websearch_to_tsquery('simple', v_query)
          )
      ),
      'organisations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', page.id,
          'name', page.name,
          'slug', page.slug,
          'short_name', page.short_name,
          'description', page.description,
          'about_content', page.about_content,
          'status', page.status
        ) order by page.name, page.id)
        from (
          select organisation.id, organisation.name, organisation.slug,
            organisation.short_name, organisation.description,
            organisation.about_content, organisation.status
          from public.organisations as organisation
          where organisation.status = 'active'
            and (
              v_query is null
              or organisation.search_document @@ pg_catalog.websearch_to_tsquery('simple', v_query)
            )
          order by organisation.name, organisation.id
          offset p_offset limit p_limit
        ) as page
      ), '[]'::jsonb)
    ) into v_result;

    return v_result;
  end if;

  if char_length(p_organisation_slug) > 180
    or p_organisation_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or (p_season_slug is not null and (
      char_length(p_season_slug) > 180
      or p_season_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    ))
    or (p_competition_slug is not null and (
      char_length(p_competition_slug) > 180
      or p_competition_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    )) then
    return null;
  end if;

  if p_competition_slug is not null and p_season_slug is null then
    raise exception 'Season context is required.' using errcode = '22023';
  end if;

  select organisation.* into v_organisation
  from public.organisations as organisation
  where organisation.slug = p_organisation_slug
    and organisation.status = 'active';

  if not found then return null; end if;

  v_result := jsonb_build_object(
    'organisation', jsonb_build_object(
      'id', v_organisation.id,
      'name', v_organisation.name,
      'slug', v_organisation.slug,
      'short_name', v_organisation.short_name,
      'description', v_organisation.description,
      'about_content', v_organisation.about_content,
      'status', v_organisation.status
    ),
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', season.id,
        'organisation_id', season.organisation_id,
        'name', season.name,
        'description', season.description,
        'slug', season.slug,
        'status', season.status,
        'entry_opens_at', season.entry_opens_at,
        'entry_closes_at', season.entry_closes_at,
        'starts_at', season.starts_at,
        'ends_at', season.ends_at,
        'created_at', season.created_at,
        'updated_at', season.updated_at
      ) order by season.starts_at asc nulls last, season.created_at desc)
      from public.league_seasons as season
      where season.organisation_id = v_organisation.id
        and season.status in ('open', 'active', 'completed')
    ), '[]'::jsonb)
  );

  if p_season_slug is null then return v_result; end if;

  select season.* into v_season
  from public.league_seasons as season
  where season.organisation_id = v_organisation.id
    and season.slug = p_season_slug
    and season.status in ('open', 'active', 'completed');

  if not found then return null; end if;

  v_result := v_result || jsonb_build_object(
    'season', jsonb_build_object(
      'id', v_season.id,
      'organisation_id', v_season.organisation_id,
      'name', v_season.name,
      'description', v_season.description,
      'slug', v_season.slug,
      'status', v_season.status,
      'entry_opens_at', v_season.entry_opens_at,
      'entry_closes_at', v_season.entry_closes_at,
      'starts_at', v_season.starts_at,
      'ends_at', v_season.ends_at,
      'created_at', v_season.created_at,
      'updated_at', v_season.updated_at
    ),
    'competitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', competition.id,
        'league_season_id', competition.league_season_id,
        'name', competition.name,
        'slug', competition.slug,
        'description', competition.description,
        'status', competition.status,
        'entry_format', competition.entry_format,
        'team_size', competition.team_size,
        'scoring_method', competition.scoring_method,
        'maximum_score_per_round', competition.maximum_score_per_round,
        'shots_per_round', competition.shots_per_round,
        'uses_x_score', competition.uses_x_score,
        'number_of_rounds', competition.number_of_rounds,
        'entry_fee', competition.entry_fee,
        'entry_window_mode', competition.entry_window_mode,
        'custom_entry_opens_at', competition.custom_entry_opens_at,
        'custom_entry_closes_at', competition.custom_entry_closes_at,
        'start_date_mode', competition.start_date_mode,
        'custom_starts_at', competition.custom_starts_at,
        'sets_per_round', competition.sets_per_round,
        'ranking_method', competition.ranking_method,
        'best_rounds_count', competition.best_rounds_count,
        'created_at', competition.created_at,
        'updated_at', competition.updated_at
      ) order by competition.name, competition.id)
      from public.competitions as competition
      where competition.league_season_id = v_season.id
        and competition.status = 'published'
    ), '[]'::jsonb)
  );

  if p_competition_slug is null then return v_result; end if;

  select competition.* into v_competition
  from public.competitions as competition
  where competition.league_season_id = v_season.id
    and competition.slug = p_competition_slug
    and competition.status = 'published';

  if not found then return null; end if;

  v_result := v_result || jsonb_build_object(
    'competition', jsonb_build_object(
      'id', v_competition.id,
      'league_season_id', v_competition.league_season_id,
      'name', v_competition.name,
      'slug', v_competition.slug,
      'description', v_competition.description,
      'status', v_competition.status,
      'entry_format', v_competition.entry_format,
      'team_size', v_competition.team_size,
      'scoring_method', v_competition.scoring_method,
      'maximum_score_per_round', v_competition.maximum_score_per_round,
      'shots_per_round', v_competition.shots_per_round,
      'uses_x_score', v_competition.uses_x_score,
      'number_of_rounds', v_competition.number_of_rounds,
      'entry_fee', v_competition.entry_fee,
      'entry_window_mode', v_competition.entry_window_mode,
      'custom_entry_opens_at', v_competition.custom_entry_opens_at,
      'custom_entry_closes_at', v_competition.custom_entry_closes_at,
      'start_date_mode', v_competition.start_date_mode,
      'custom_starts_at', v_competition.custom_starts_at,
      'sets_per_round', v_competition.sets_per_round,
      'ranking_method', v_competition.ranking_method,
      'best_rounds_count', v_competition.best_rounds_count,
      'created_at', v_competition.created_at,
      'updated_at', v_competition.updated_at
    ),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', round.id,
        'competition_id', round.competition_id,
        'round_number', round.round_number,
        'deadline', round.deadline,
        'shoot_by_date', round.shoot_by_date,
        'created_at', round.created_at,
        'updated_at', round.updated_at
      ) order by round.round_number)
      from public.competition_rounds as round
      where round.competition_id = v_competition.id
    ), '[]'::jsonb),
    'score_components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', component.id,
        'competition_id', component.competition_id,
        'position', component.position,
        'short_label', component.short_label,
        'maximum_score', component.maximum_score,
        'score_method', component.score_method,
        'created_at', component.created_at,
        'updated_at', component.updated_at
      ) order by component.position)
      from public.competition_score_components as component
      where component.competition_id = v_competition.id
    ), '[]'::jsonb),
    'published_divisions', (
      select jsonb_build_object(
        'status', 'published',
        'divisions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', division.id,
            'name', division.name,
            'position', division.position,
            'entrants', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', entrant.id,
                'club_name', club.name,
                'participants', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'first_name', profile.first_name,
                    'last_name', profile.last_name,
                    'slot_number', participant.slot_number
                  ) order by participant.slot_number)
                  from public.competition_entrant_participants as participant
                  join public.club_memberships as membership
                    on membership.id = participant.club_membership_id
                  join public.profiles as profile on profile.id = membership.user_id
                  where participant.competition_entrant_id = entrant.id
                ), '[]'::jsonb)
              ) order by club.name, entrant.position, entrant.id)
              from public.competition_division_assignments as assignment
              join public.competition_entrants as entrant
                on entrant.id = assignment.competition_entrant_id
              join public.club_competition_entries as entry
                on entry.id = entrant.club_competition_entry_id
               and entry.status = 'submitted'
              join public.clubs as club on club.id = entry.club_id
              where assignment.competition_id = v_competition.id
                and assignment.competition_division_id = division.id
            ), '[]'::jsonb)
          ) order by division.position, division.id)
          from public.competition_divisions as division
          where division.competition_id = v_competition.id
        ), '[]'::jsonb)
      )
      from public.competition_division_configs as config
      where config.competition_id = v_competition.id
        and config.status = 'published'
    )
  );

  return v_result;
end;
$$;

create or replace function public.get_public_club_results_catalog(
  p_club_slug text default null,
  p_query text default null,
  p_offset integer default 0,
  p_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club public.clubs%rowtype;
  v_query text := nullif(pg_catalog.btrim(p_query), '');
  v_result jsonb;
begin
  if p_offset is null or p_offset < 0
    or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Invalid public club catalog pagination.' using errcode = '22023';
  end if;

  if v_query is not null and char_length(v_query) > 100 then
    raise exception 'Public club search is too long.' using errcode = '22023';
  end if;

  if p_club_slug is null then
    select jsonb_build_object(
      'total_count', (
        select count(*)
        from public.clubs as club
        where club.status = 'active'
          and (
            v_query is null
            or club.search_document @@ pg_catalog.websearch_to_tsquery('simple', v_query)
          )
      ),
      'clubs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', page.id,
          'name', page.name,
          'slug', page.slug,
          'town', page.town,
          'county', page.county,
          'postcode', page.postcode,
          'website', page.website,
          'about_content', page.about_content
        ) order by page.name, page.id)
        from (
          select club.id, club.name, club.slug, club.town, club.county,
            club.postcode, club.website, club.about_content
          from public.clubs as club
          where club.status = 'active'
            and (
              v_query is null
              or club.search_document @@ pg_catalog.websearch_to_tsquery('simple', v_query)
            )
          order by club.name, club.id
          offset p_offset limit p_limit
        ) as page
      ), '[]'::jsonb)
    ) into v_result;

    return v_result;
  end if;

  if v_query is not null then
    raise exception 'Search is not accepted with exact club context.' using errcode = '22023';
  end if;

  if char_length(p_club_slug) > 180
    or p_club_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    return null;
  end if;

  select club.* into v_club
  from public.clubs as club
  where club.slug = p_club_slug
    and club.status = 'active';

  if not found then return null; end if;

  select jsonb_build_object(
    'club', jsonb_build_object(
      'id', v_club.id,
      'name', v_club.name,
      'slug', v_club.slug,
      'town', v_club.town,
      'county', v_club.county,
      'postcode', v_club.postcode,
      'website', v_club.website,
      'about_content', v_club.about_content
    ),
    'information_cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', card.id,
        'title', card.title,
        'content', card.content,
        'position', card.position,
        'updated_at', card.updated_at
      ) order by card.position, card.id)
      from public.club_information_cards as card
      where card.club_id = v_club.id
    ), '[]'::jsonb),
    'competitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'competition_id', competition.id,
        'competition_name', competition.name,
        'competition_slug', competition.slug,
        'entry_format', competition.entry_format,
        'team_size', competition.team_size,
        'ranking_method', competition.ranking_method,
        'effective_starts_at', case
          when competition.start_date_mode = 'custom' then competition.custom_starts_at
          else season.starts_at
        end,
        'season_name', season.name,
        'season_slug', season.slug,
        'season_status', season.status,
        'season_starts_at', season.starts_at,
        'season_ends_at', season.ends_at,
        'organisation_name', organisation.name,
        'organisation_slug', organisation.slug,
        'has_released_results', exists (
          select 1
          from public.competition_rounds as competition_round
          where competition_round.competition_id = competition.id
            and (statement_timestamp() at time zone 'UTC')::date
              > competition_round.deadline
        )
      ) order by season.starts_at desc nulls last,
          organisation.name, competition.name, competition.id)
      from public.club_competition_entries as entry
      join public.competitions as competition
        on competition.id = entry.competition_id
       and competition.status = 'published'
      join public.league_seasons as season
        on season.id = competition.league_season_id
       and season.status in ('open', 'active', 'completed')
      join public.organisations as organisation
        on organisation.id = season.organisation_id
       and organisation.status = 'active'
      where entry.club_id = v_club.id
        and entry.status = 'submitted'
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_public_results_catalog(
  text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_public_results_catalog(
  text, text, text, text, integer, integer
) to anon, authenticated;

revoke execute on function public.get_public_club_results_catalog(
  text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_public_club_results_catalog(
  text, text, integer, integer
) to anon, authenticated;

comment on function public.get_public_results_catalog(
  text, text, text, text, integer, integer
) is
  'Public discovery projection for active organisations, public seasons, published competitions, public competition configuration, and published division allocations. Omits contact, staff, membership, profile identifiers, entry-management state, draft data, and every score source field.';

comment on function public.get_public_club_results_catalog(
  text, text, integer, integer
) is
  'Public active-club discovery and exact club projection. Competition participation is derived only from submitted entries in published competitions under public seasons and active organisations. Omits membership, profile, contact, entry-management, draft, withdrawn, score-source, and unreleased score fields.';

commit;
