-- Run after database/competition-scores.sql.
--
-- Extends the existing participant-owned source-score workflow from
-- Individual Competitions to Individual, Pairs, and Team Competitions.
-- No source, usage, entry, entrant, participant, division, or score rows are
-- rewritten. The existing public read/save RPC signatures remain unchanged.

begin;

-- Keep the established function signature because the public read and atomic
-- batch-save RPCs already depend on it. The legacy "individual" name is now an
-- implementation detail; access and Course-of-Fire rules apply to all three
-- participant formats.
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

  select competition.name, competition.entry_format, competition.team_size,
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

  if v_context.entry_format not in ('individual', 'pairs', 'team') then
    raise exception 'This Competition participant format does not support score entry.'
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

  -- Submitted entry composition is normally guaranteed by the entry RPC.
  -- Recheck it here so malformed legacy/service-role data cannot be treated as
  -- a complete Individual, Pair, or Team by either the read or save endpoint.
  if exists (
    select 1
    from public.club_competition_entries as entry
    where entry.competition_id = p_competition_id
      and entry.status = 'submitted'
      and (p_club_id is null or entry.club_id = p_club_id)
      and (
        not exists (
          select 1
          from public.competition_entrants as entrant
          where entrant.club_competition_entry_id = entry.id
        )
        or exists (
          select 1
          from public.competition_entrants as entrant
          where entrant.club_competition_entry_id = entry.id
            and (
              select count(*)
              from public.competition_entrant_participants as participant
              where participant.club_competition_entry_id = entry.id
                and participant.competition_entrant_id = entrant.id
            ) <> v_context.team_size
        )
      )
  ) then
    raise exception 'A submitted Competition entrant has an incomplete participant composition.'
      using errcode = '22023';
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

comment on function public.get_individual_competition_score_entry(
  bigint, bigint, bigint, bigint, bigint
) is
  'Returns one authorised participant source-score editor for an Individual, Pairs, or Team Competition Round. Canonical achieved values are converted back to configured entry representation.';

comment on function public.save_individual_competition_round_scores(
  bigint, bigint, bigint, bigint, bigint, jsonb
) is
  'Atomically validates and saves every visible participant source score for one Individual, Pairs, or Team Competition Round. Null input removes that source slot; no aggregate, zero, or NSR is manufactured.';

commit;
