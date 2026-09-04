-- Run after database/competition-configuration-refactor.sql and
-- database/competition-divisions.sql.
-- Adds owner-only Competition publish, return-to-draft, and safe-delete RPCs.
-- Existing Competitions and all participation data are preserved.

begin;

create or replace function private.require_competition_lifecycle_owner(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns table (
  actor_id uuid,
  organisation_slug text,
  season_slug text,
  competition_slug text,
  competition_status text
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
  select
    v_actor_id,
    organisation.slug,
    season.slug,
    competition.slug,
    competition.status
  from public.organisation_staff as staff
  join public.organisations as organisation
    on organisation.id = staff.organisation_id
  join public.league_seasons as season
    on season.organisation_id = organisation.id
  join public.competitions as competition
    on competition.league_season_id = season.id
  where staff.user_id = v_actor_id
    and staff.organisation_id = p_organisation_id
    and staff.role = 'owner'
    and staff.status = 'active'
    and organisation.id = p_organisation_id
    and organisation.status = 'active'
    and season.id = p_league_season_id
    and competition.id = p_competition_id
  for update of staff, organisation, season, competition;

  if not found then
    raise exception 'Only this organisation owner can manage this Competition lifecycle.'
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.require_competition_lifecycle_owner(
  bigint, bigint, bigint
) from public, anon, authenticated;

create or replace function private.competition_has_participation(
  p_competition_id bigint
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.club_competition_entries as entry
      where entry.competition_id = p_competition_id
    )
    or exists (
      select 1
      from public.competition_entrants as entrant
      join public.club_competition_entries as entry
        on entry.id = entrant.club_competition_entry_id
      where entry.competition_id = p_competition_id
    )
    or exists (
      select 1
      from public.competition_entrant_participants as participant
      join public.club_competition_entries as entry
        on entry.id = participant.club_competition_entry_id
      where entry.competition_id = p_competition_id
    )
    or exists (
      select 1
      from public.competition_division_configs as config
      where config.competition_id = p_competition_id
    )
    or exists (
      select 1
      from public.competition_divisions as division
      where division.competition_id = p_competition_id
    )
    or exists (
      select 1
      from public.competition_division_assignments as assignment
      where assignment.competition_id = p_competition_id
    )
$$;

revoke execute on function private.competition_has_participation(bigint)
  from public, anon, authenticated;

create or replace function public.get_competition_lifecycle_state(
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
  v_has_participation boolean;
begin
  select * into v_context
  from private.require_competition_lifecycle_owner(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  v_has_participation := private.competition_has_participation(p_competition_id);

  return jsonb_build_object(
    'status', v_context.competition_status,
    'has_participation', v_has_participation,
    'can_return_to_draft',
      v_context.competition_status = 'published' and not v_has_participation,
    'can_delete', not v_has_participation
  );
end;
$$;

create or replace function public.publish_competition(
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
  v_configuration record;
  v_components jsonb;
  v_round_deadlines date[];
  v_round_shoot_by_dates date[];
begin
  select * into v_context
  from private.require_competition_lifecycle_owner(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  if v_context.competition_status <> 'draft' then
    raise exception 'Only a draft Competition can be published.'
      using errcode = '22023';
  end if;

  select
    competition.entry_format,
    competition.team_size,
    competition.shots_per_round,
    competition.uses_x_score,
    competition.number_of_rounds,
    competition.entry_fee,
    competition.entry_window_mode,
    competition.custom_entry_opens_at,
    competition.custom_entry_closes_at,
    competition.start_date_mode,
    competition.custom_starts_at,
    competition.sets_per_round,
    competition.ranking_method,
    competition.best_rounds_count,
    competition.local_scoring_enabled,
    effective.effective_entry_opens_at,
    effective.effective_entry_closes_at,
    effective.effective_starts_at,
    effective.season_ends_at
  into v_configuration
  from public.competitions as competition
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  where competition.id = p_competition_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'short_label', component.short_label,
        'maximum_score', component.maximum_score,
        'score_method', component.score_method
      ) order by component.position
    ),
    '[]'::jsonb
  )
  into v_components
  from public.competition_score_components as component
  where component.competition_id = p_competition_id;

  select
    coalesce(
      array_agg(round.deadline order by round.round_number),
      array[]::date[]
    ),
    coalesce(
      array_agg(round.shoot_by_date order by round.round_number),
      array[]::date[]
    )
  into v_round_deadlines, v_round_shoot_by_dates
  from public.competition_rounds as round
  where round.competition_id = p_competition_id;

  perform private.validate_competition_configuration(
    'published',
    v_configuration.entry_format,
    v_configuration.team_size,
    v_configuration.shots_per_round,
    v_configuration.uses_x_score,
    v_configuration.number_of_rounds,
    v_configuration.entry_fee,
    v_configuration.entry_window_mode,
    v_configuration.custom_entry_opens_at,
    v_configuration.custom_entry_closes_at,
    v_configuration.start_date_mode,
    v_configuration.custom_starts_at,
    v_configuration.effective_entry_opens_at,
    v_configuration.effective_entry_closes_at,
    v_configuration.effective_starts_at,
    v_configuration.season_ends_at,
    v_configuration.sets_per_round,
    v_components,
    v_configuration.ranking_method,
    v_configuration.best_rounds_count,
    v_configuration.local_scoring_enabled,
    v_round_deadlines,
    v_round_shoot_by_dates
  );

  update public.competitions as competition
  set status = 'published',
      updated_by = v_context.actor_id
  where competition.id = p_competition_id
    and competition.status = 'draft';

  if not found then
    raise exception 'Only a draft Competition can be published.'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', p_competition_id,
    'organisation_slug', v_context.organisation_slug,
    'season_slug', v_context.season_slug,
    'competition_slug', v_context.competition_slug,
    'status', 'published'
  );
end;
$$;

create or replace function public.return_competition_to_draft(
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
begin
  select * into v_context
  from private.require_competition_lifecycle_owner(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  if v_context.competition_status <> 'published' then
    raise exception 'Only a published Competition can be returned to draft.'
      using errcode = '22023';
  end if;

  if private.competition_has_participation(p_competition_id) then
    raise exception 'This competition already has entries or competition participation data and cannot be returned to draft.'
      using errcode = '22023';
  end if;

  update public.competitions as competition
  set status = 'draft',
      updated_by = v_context.actor_id
  where competition.id = p_competition_id
    and competition.status = 'published';

  if not found then
    raise exception 'Only a published Competition can be returned to draft.'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'id', p_competition_id,
    'organisation_slug', v_context.organisation_slug,
    'season_slug', v_context.season_slug,
    'competition_slug', v_context.competition_slug,
    'status', 'draft'
  );
end;
$$;

create or replace function public.delete_competition(
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
begin
  select * into v_context
  from private.require_competition_lifecycle_owner(
    p_organisation_id,
    p_league_season_id,
    p_competition_id
  );

  if private.competition_has_participation(p_competition_id) then
    raise exception 'This competition already has entries or competition participation data and cannot be deleted.'
      using errcode = '22023';
  end if;

  delete from public.competitions as competition
  where competition.id = p_competition_id;

  if not found then
    raise exception 'Competition not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', p_competition_id,
    'organisation_slug', v_context.organisation_slug,
    'season_slug', v_context.season_slug,
    'competition_slug', v_context.competition_slug
  );
end;
$$;

comment on function public.get_competition_lifecycle_state(bigint, bigint, bigint) is
  'Returns owner-only lifecycle availability after checking the exact Organisation, Season, and Competition relationship.';
comment on function public.publish_competition(bigint, bigint, bigint) is
  'Publishes a stored draft through the same authoritative Competition configuration validator used by update_competition.';
comment on function public.return_competition_to_draft(bigint, bigint, bigint) is
  'Returns a published Competition to private draft only when no entry, entrant, participant, or division data exists.';
comment on function public.delete_competition(bigint, bigint, bigint) is
  'Deletes only a participation-free Competition; configuration-only children follow existing cascades.';

revoke execute on function public.get_competition_lifecycle_state(
  bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.get_competition_lifecycle_state(
  bigint, bigint, bigint
) to authenticated;

revoke execute on function public.publish_competition(
  bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.publish_competition(
  bigint, bigint, bigint
) to authenticated;

revoke execute on function public.return_competition_to_draft(
  bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.return_competition_to_draft(
  bigint, bigint, bigint
) to authenticated;

revoke execute on function public.delete_competition(
  bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.delete_competition(
  bigint, bigint, bigint
) to authenticated;

commit;
