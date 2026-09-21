-- Incremental upgrade from the complete pre-fix/prelaunch-ux-polish schema.
-- The numbered database/*.sql files are canonical fresh-install inputs and must
-- not be replayed against an existing database.
--
-- This upgrade is transactional and safe to re-run: existing functions use
-- CREATE OR REPLACE, new function signatures are replaced in place, and
-- privileges/comments are restated idempotently.

begin;
set local check_function_bodies = false;

CREATE OR REPLACE FUNCTION private.validate_competition_entrant_club_team()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_entry_status text;
  v_entry_format text;
  v_competition_size integer;
  v_entry_club_id bigint;
  v_team_club_id bigint;
  v_team_name text;
  v_team_archived_at timestamptz;
  v_unit_type text;
  v_fixed_size integer;
  v_active_roster_count integer;
begin
  if new.club_team_id is null then
    new.club_team_name_snapshot := null;
    return new;
  end if;

  select entry.status, competition.entry_format, competition.team_size,
    entry.club_id
  into v_entry_status, v_entry_format, v_competition_size, v_entry_club_id
  from public.club_competition_entries as entry
  join public.competitions as competition on competition.id = entry.competition_id
  where entry.id = new.club_competition_entry_id;

  if v_entry_status is null then
    raise exception 'Club competition entry not found.' using errcode = 'P0002';
  end if;

  if v_entry_format not in ('pairs', 'team') then
    raise exception 'Club Pairs or Club Teams can only be linked to matching Pair or Team Competition entrants.'
      using errcode = '23514';
  end if;

  select team.club_id, team.name, team.archived_at, team.unit_type,
    team.fixed_size
  into v_team_club_id, v_team_name, v_team_archived_at, v_unit_type,
    v_fixed_size
  from public.club_teams as team
  where team.id = new.club_team_id
  for share;

  if v_team_club_id is null then
    raise exception 'The selected Club Team does not exist.' using errcode = '22023';
  end if;

  if v_team_club_id <> v_entry_club_id then
    raise exception 'The selected Club Pair or Team belongs to a different club.' using errcode = '23514';
  end if;

  if v_unit_type is null or v_fixed_size is null then
    raise exception 'Complete this Club Pair or Team setup before using it in a Competition entry.'
      using errcode = '22023';
  end if;

  if (v_entry_format = 'pairs' and v_unit_type <> 'pair')
    or (v_entry_format = 'team' and v_unit_type <> 'team')
    or v_fixed_size <> v_competition_size then
    raise exception 'The selected Club Pair or Team type and size are not compatible with this Competition.'
      using errcode = '23514';
  end if;

  select count(*)::integer into v_active_roster_count
  from public.club_team_roster_members as roster
  join public.club_memberships as membership
    on membership.id = roster.club_membership_id
  where roster.club_team_id = new.club_team_id
    and membership.club_id = v_entry_club_id
    and membership.status = 'active';

  if v_active_roster_count <> v_fixed_size then
    raise exception 'Update this Club Pair or Team so its complete current roster contains active Club members.'
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and v_entry_status <> 'draft' and (
    new.club_team_id is distinct from old.club_team_id
    or new.club_competition_entry_id is distinct from old.club_competition_entry_id
    or new.club_team_name_snapshot is distinct from old.club_team_name_snapshot
  ) then
    raise exception 'A submitted entrant''s persistent Pair/Team link and name snapshot are historical and cannot be changed.'
      using errcode = '23514';
  end if;

  if v_team_archived_at is not null and (
    tg_op = 'INSERT'
    or new.club_team_id is distinct from old.club_team_id
    or v_entry_status = 'draft'
  ) then
    raise exception 'The selected Club Pair or Team is archived. Unarchive it or choose another unit.'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' or v_entry_status = 'draft' then
    new.club_team_name_snapshot := v_team_name;
  else
    new.club_team_name_snapshot := old.club_team_name_snapshot;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_league_season(p_organisation_id bigint, p_league_season_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_organisation_slug text;
  v_season_slug text;
  v_season_status text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select organisation.slug
  into v_organisation_slug
  from public.organisations as organisation
  where organisation.id = p_organisation_id
    and organisation.status = 'active'
  for share;

  if v_organisation_slug is null then
    raise exception 'Active organisation not found.' using errcode = 'P0002';
  end if;

  perform staff.id
  from public.organisation_staff as staff
  where staff.organisation_id = p_organisation_id
    and staff.user_id = v_actor_id
    and staff.role = 'owner'
    and staff.status = 'active'
  for share;

  if not found then
    raise exception 'Only this organisation owner can delete the league season.'
      using errcode = '42501';
  end if;

  select season.slug, season.status
  into v_season_slug, v_season_status
  from public.league_seasons as season
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id
  for update;

  if v_season_slug is null then
    raise exception 'League season not found in this organisation.'
      using errcode = 'P0002';
  end if;

  if v_season_status <> 'draft' then
    raise exception 'Only a draft league season can be deleted.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.competitions as competition
    where competition.league_season_id = p_league_season_id
  ) then
    raise exception 'A league season containing Competitions cannot be deleted.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.concurrent_shooting_groups as group_row
    where group_row.league_season_id = p_league_season_id
  ) then
    raise exception 'A league season containing Concurrent Shooting setup cannot be deleted.'
      using errcode = '22023';
  end if;

  delete from public.league_seasons as season
  where season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;

  return jsonb_build_object(
    'id', p_league_season_id,
    'organisation_slug', v_organisation_slug,
    'season_slug', v_season_slug,
    'status', v_season_status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.competition_publication_readiness_errors(p_effective_entry_opens_at date, p_effective_entry_closes_at date, p_effective_starts_at date, p_ranking_method text, p_score_components jsonb, p_best_rounds_count integer, p_number_of_rounds integer, p_round_deadlines date[])
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_errors text[] := array[]::text[];
  v_round_deadlines date[] := coalesce(p_round_deadlines, array[]::date[]);
begin
  if p_effective_entry_opens_at is null or p_effective_entry_closes_at is null then
    v_errors := array_append(v_errors, 'Set a complete effective Competition entry window before publishing.');
  end if;
  if p_effective_starts_at is null then
    v_errors := array_append(v_errors, 'Set an effective Competition Start before publishing.');
  end if;
  if p_ranking_method = 'round_robin'
    and p_effective_entry_closes_at is not null
    and p_effective_starts_at is not null
    and p_effective_entry_closes_at >= p_effective_starts_at then
    v_errors := array_append(v_errors, 'Round Robin requires time to finalise divisions after entries close. Competition Start must be after the Entry Close date.');
  end if;
  if p_score_components is null
    or jsonb_typeof(p_score_components) <> 'array'
    or jsonb_array_length(p_score_components) = 0 then
    v_errors := array_append(v_errors, 'Add at least one Course of Fire score component before publishing.');
  end if;
  if p_ranking_method = 'best_n_average' and p_best_rounds_count is null then
    v_errors := array_append(v_errors, 'Set how many rounds count for Best N rounds average.');
  end if;
  if cardinality(v_round_deadlines) <> p_number_of_rounds
    or exists (select 1 from unnest(v_round_deadlines) as supplied(value) where supplied.value is null) then
    v_errors := array_append(v_errors, 'Set a Round End for every configured round before publishing.');
  end if;
  return v_errors;
end;
$function$;

CREATE OR REPLACE FUNCTION private.validate_competition_configuration(p_status text, p_entry_format text, p_team_size integer, p_shots_per_round integer, p_uses_x_score boolean, p_number_of_rounds integer, p_entry_fee numeric, p_entry_window_mode text, p_custom_entry_opens_at date, p_custom_entry_closes_at date, p_start_date_mode text, p_custom_starts_at date, p_effective_entry_opens_at date, p_effective_entry_closes_at date, p_effective_starts_at date, p_season_ends_at date, p_sets_per_round integer, p_score_components jsonb, p_ranking_method text, p_best_rounds_count integer, p_local_scoring_enabled boolean, p_round_deadlines date[], p_round_shoot_by_dates date[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_component record;
  v_label text;
  v_maximum_text text;
  v_maximum numeric;
  v_method text;
  v_round_deadlines date[] := coalesce(p_round_deadlines, array[]::date[]);
  v_round_shoot_by_dates date[] := coalesce(p_round_shoot_by_dates, array[]::date[]);
  v_round_number integer;
  v_previous_deadline date;
  v_publication_error text;
begin
  if p_status not in ('draft', 'published') then
    raise exception 'Select a valid competition status.' using errcode = '22023';
  end if;

  if p_entry_format not in ('individual', 'pairs', 'team') then
    raise exception 'Select a valid entry format.' using errcode = '22023';
  end if;

  if not (
    (p_entry_format = 'individual' and p_team_size = 1)
    or (p_entry_format = 'pairs' and p_team_size = 2)
    or (p_entry_format = 'team' and p_team_size between 3 and 20)
  ) then
    raise exception 'Team entries must contain between 3 and 20 shooters.'
      using errcode = '22023';
  end if;

  if p_shots_per_round is not null
    and p_shots_per_round not between 1 and 10000 then
    raise exception 'Shots per round must be between 1 and 10,000.'
      using errcode = '22023';
  end if;

  if p_uses_x_score is null then
    raise exception 'Choose whether X scores are recorded.' using errcode = '22023';
  end if;

  if p_number_of_rounds is null or p_number_of_rounds not between 1 and 100 then
    raise exception 'Number of rounds must be between 1 and 100.'
      using errcode = '22023';
  end if;

  if p_entry_fee is not null and (
    p_entry_fee < 0
    or p_entry_fee > 10000
    or p_entry_fee <> round(p_entry_fee, 2)
  ) then
    raise exception 'Entry fee must be between £0 and £10,000 with no more than two decimal places.'
      using errcode = '22023';
  end if;

  if p_entry_window_mode not in ('season_default', 'custom') then
    raise exception 'Select how this competition gets its entry window.'
      using errcode = '22023';
  end if;

  if p_entry_window_mode = 'season_default'
    and (p_custom_entry_opens_at is not null or p_custom_entry_closes_at is not null) then
    raise exception 'Custom entry dates must be empty when using the Season default.'
      using errcode = '22023';
  end if;

  if p_custom_entry_opens_at is not null
    and p_custom_entry_opens_at not between date '1900-01-01' and date '2200-12-31' then
    raise exception 'Entries open must use a supported date.' using errcode = '22023';
  end if;

  if p_custom_entry_closes_at is not null
    and p_custom_entry_closes_at not between date '1900-01-01' and date '2200-12-31' then
    raise exception 'Entries close must use a supported date.' using errcode = '22023';
  end if;

  if p_effective_entry_opens_at is not null
    and p_effective_entry_closes_at is not null
    and p_effective_entry_closes_at < p_effective_entry_opens_at then
    raise exception 'Entries close must be on or after Entries open.'
      using errcode = '22023';
  end if;

  if p_start_date_mode not in ('season_default', 'custom') then
    raise exception 'Select how this competition gets its start date.'
      using errcode = '22023';
  end if;

  if p_start_date_mode = 'season_default' and p_custom_starts_at is not null then
    raise exception 'Custom Competition Start must be empty when using the Season start.'
      using errcode = '22023';
  end if;

  if p_custom_starts_at is not null
    and p_custom_starts_at not between date '1900-01-01' and date '2200-12-31' then
    raise exception 'Competition Start must use a supported date.' using errcode = '22023';
  end if;

  if p_sets_per_round is null or p_sets_per_round not between 1 and 100 then
    raise exception 'Sets per round must be between 1 and 100.'
      using errcode = '22023';
  end if;

  if p_score_components is null or jsonb_typeof(p_score_components) <> 'array' then
    raise exception 'Course of Fire score components must be supplied as a list.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_score_components) > 20 then
    raise exception 'A Course of Fire cannot contain more than 20 score components per set.'
      using errcode = '22023';
  end if;

  for v_component in
    select value, ordinality::integer as position
    from jsonb_array_elements(p_score_components) with ordinality
  loop
    if jsonb_typeof(v_component.value) <> 'object' then
      raise exception 'Course of Fire component % is invalid.', v_component.position
        using errcode = '22023';
    end if;

    v_label := nullif(btrim(coalesce(v_component.value ->> 'short_label', '')), '');
    v_maximum_text := btrim(coalesce(v_component.value ->> 'maximum_score', ''));
    v_method := btrim(coalesce(v_component.value ->> 'score_method', ''));

    if v_label is not null and char_length(v_label) > 30 then
      raise exception 'Course of Fire component % label must be 30 characters or fewer.', v_component.position
        using errcode = '22023';
    end if;

    if v_maximum_text !~ '^[0-9]{1,7}([.][0-9]{1,2})?$' then
      raise exception 'Course of Fire component % needs a valid maximum with up to two decimal places.', v_component.position
        using errcode = '22023';
    end if;
    v_maximum := v_maximum_text::numeric;
    if v_maximum not between 0.01 and 1000000 then
      raise exception 'Course of Fire component % maximum must be between 0.01 and 1,000,000.', v_component.position
        using errcode = '22023';
    end if;

    if v_method not in ('points_scored', 'points_dropped') then
      raise exception 'Course of Fire component % needs a valid scoring method.', v_component.position
        using errcode = '22023';
    end if;
  end loop;

  if p_ranking_method not in ('aggregate', 'best_n_average', 'round_robin', 'gun_score') then
    raise exception 'Select a valid ranking method.' using errcode = '22023';
  end if;

  if p_ranking_method = 'best_n_average' then
    if p_best_rounds_count is null
      or p_best_rounds_count not between 1 and p_number_of_rounds then
      raise exception 'Best rounds count must be between 1 and the number of rounds.'
        using errcode = '22023';
    end if;
    if p_uses_x_score then
      raise exception 'X-based ranking is not currently defined for Best N Average competitions.'
        using errcode = '22023';
    end if;
  elsif p_best_rounds_count is not null then
    raise exception 'Best rounds count must be empty for this ranking method.'
      using errcode = '22023';
  end if;

  if p_local_scoring_enabled is null then
    raise exception 'Select who can enter scores.' using errcode = '22023';
  end if;

  if cardinality(v_round_deadlines) not in (0, p_number_of_rounds)
    or (cardinality(v_round_deadlines) > 0 and array_lower(v_round_deadlines, 1) <> 1) then
    raise exception 'Round End dates must contain either zero items or exactly one position per configured round.'
      using errcode = '22023';
  end if;

  if cardinality(v_round_shoot_by_dates) not in (0, p_number_of_rounds)
    or (cardinality(v_round_shoot_by_dates) > 0 and array_lower(v_round_shoot_by_dates, 1) <> 1) then
    raise exception 'Shoot-by dates must contain either zero items or exactly one position per configured round.'
      using errcode = '22023';
  end if;

  if cardinality(v_round_shoot_by_dates) > 0
    and cardinality(v_round_deadlines) = 0
    and exists (select 1 from unnest(v_round_shoot_by_dates) as supplied(value) where supplied.value is not null) then
    raise exception 'Set a Round End before adding its Shoot-by date.' using errcode = '22023';
  end if;

  if cardinality(v_round_deadlines) > 0 then
    for v_round_number in 1..p_number_of_rounds loop
      if v_round_deadlines[v_round_number] is null then
        if cardinality(v_round_shoot_by_dates) > 0
          and v_round_shoot_by_dates[v_round_number] is not null then
          raise exception 'Round % needs a Round End before its Shoot-by date.', v_round_number
            using errcode = '22023';
        end if;
        continue;
      end if;

      if v_round_deadlines[v_round_number] not between date '1900-01-01' and date '2200-12-31' then
        raise exception 'Round % has an unsupported Round End.', v_round_number
          using errcode = '22023';
      end if;

      if p_effective_starts_at is not null
        and (
          (v_round_number = 1 and v_round_deadlines[v_round_number] <= p_effective_starts_at)
          or (v_round_number > 1 and v_round_deadlines[v_round_number] < p_effective_starts_at)
        ) then
        if v_round_number = 1 then
          raise exception 'Round 1 End must be after the effective Competition Start.'
            using errcode = '22023';
        end if;
        raise exception 'Round % must end on or after the effective Competition Start.', v_round_number
          using errcode = '22023';
      end if;

      if p_season_ends_at is not null
        and v_round_deadlines[v_round_number] > p_season_ends_at then
        raise exception 'Round % must end on or before the Season end.', v_round_number
          using errcode = '22023';
      end if;

      if v_previous_deadline is not null
        and v_round_deadlines[v_round_number] < v_previous_deadline then
        raise exception 'Round End dates cannot move backwards.' using errcode = '22023';
      end if;

      if cardinality(v_round_shoot_by_dates) > 0
        and v_round_shoot_by_dates[v_round_number] is not null then
        if v_round_shoot_by_dates[v_round_number] not between date '1900-01-01' and date '2200-12-31' then
          raise exception 'Round % has an unsupported Shoot-by date.', v_round_number
            using errcode = '22023';
        end if;
        if v_round_shoot_by_dates[v_round_number] > v_round_deadlines[v_round_number] then
          raise exception 'Round % Shoot-by date must be on or before Round End.', v_round_number
            using errcode = '22023';
        end if;
      end if;

      v_previous_deadline := v_round_deadlines[v_round_number];
    end loop;
  end if;

  if p_status = 'published' then
    foreach v_publication_error in array private.competition_publication_readiness_errors(
      p_effective_entry_opens_at,
      p_effective_entry_closes_at,
      p_effective_starts_at,
      p_ranking_method,
      p_score_components,
      p_best_rounds_count,
      p_number_of_rounds,
      v_round_deadlines
    ) loop
      raise exception '%', v_publication_error using errcode = '22023';
    end loop;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_club_entry_context(p_competition_id bigint)
 RETURNS TABLE(club_id bigint, club_name text, club_slug text, club_role text, entry_id bigint, entry_status text, entrant_count bigint, participant_count bigint, is_user_entered boolean, can_manage boolean, entry_window_state text, database_today date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  return query
  select club.id, club.name, club.slug, membership.role, entry.id, entry.status,
    coalesce((select count(*) from public.competition_entrants as entrant
      where entrant.club_competition_entry_id = entry.id), 0),
    coalesce((select count(*) from public.competition_entrant_participants as participant
      where participant.club_competition_entry_id = entry.id), 0),
    coalesce(exists (
      select 1
      from public.competition_entrant_participants as participant
      join public.club_memberships as selected_membership
        on selected_membership.id = participant.club_membership_id
      where participant.club_competition_entry_id = entry.id
        and selected_membership.user_id = v_actor_id
    ), false),
    membership.role in ('owner', 'official'),
    case
      when season.status = 'open'
        and effective.effective_entry_opens_at is not null
        and current_date < effective.effective_entry_opens_at then 'upcoming'
      when season.status = 'open'
        and effective.effective_entry_opens_at is not null
        and effective.effective_entry_closes_at is not null
        and current_date between effective.effective_entry_opens_at
          and effective.effective_entry_closes_at then 'open'
      else 'closed'
    end,
    current_date
  from public.competitions as competition
  join public.league_seasons as season on season.id = competition.league_season_id
  join public.organisations as organisation on organisation.id = season.organisation_id
  cross join lateral private.get_competition_effective_dates(competition.id) as effective
  join public.club_memberships as membership
    on membership.user_id = v_actor_id and membership.status = 'active'
  join public.clubs as club on club.id = membership.club_id and club.status = 'active'
  left join public.club_competition_entries as entry
    on entry.competition_id = competition.id
    and entry.club_id = club.id
    and (membership.role in ('owner', 'official') or entry.status = 'submitted')
  where competition.id = p_competition_id
    and competition.status = 'published'
    and season.status in ('open', 'active', 'completed')
    and organisation.status = 'active'
  order by club.name, club.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_club_competition_entry(p_club_competition_entry_id bigint, p_entrants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context record;
  v_unit record;
  v_slot record;
  v_entrant_id bigint;
  v_selected_count integer;
  v_selected_team_count integer;
  v_participants jsonb;
  v_team_value jsonb;
  v_team_id bigint;
  v_normalised jsonb := '[]'::jsonb;
  v_constraint_name text;
begin
  select * into v_context
  from private.get_club_competition_entry_mutation_context(
    p_club_competition_entry_id,
    true
  );

  if v_context.entry_status = 'withdrawn' then
    raise exception 'Restart this withdrawn entry before editing it.'
      using errcode = '22023';
  end if;

  if p_entrants is null or jsonb_typeof(p_entrants) <> 'array' then
    raise exception 'Competition entrants must be supplied as a list.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_entrants) > 1000 then
    raise exception 'A club entry cannot contain more than 1,000 entrant units.'
      using errcode = '22023';
  end if;

  for v_unit in
    select value, ordinality::integer as position
    from jsonb_array_elements(p_entrants) with ordinality
  loop
    v_team_id := null;
    v_team_value := null;
    if jsonb_typeof(v_unit.value) = 'array' then
      v_participants := v_unit.value;
    elsif jsonb_typeof(v_unit.value) = 'object'
      and v_context.entry_format in ('pairs', 'team') then
      v_team_value := v_unit.value -> 'club_team_id';
      if v_team_value is not null and jsonb_typeof(v_team_value) <> 'null' then
        if jsonb_typeof(v_team_value) <> 'number'
          or v_team_value::text !~ '^[1-9][0-9]*$' then
          raise exception 'Select a valid Club Pair or Club Team.'
            using errcode = '22023';
        end if;
        v_team_id := v_team_value::text::bigint;
      end if;
      if v_team_id is null then
        v_participants := v_unit.value -> 'participants';
      else
        perform team.id
        from public.club_teams as team
        where team.id = v_team_id
        for share;
        if not found then
          raise exception 'A selected Club Pair or Team no longer exists.'
            using errcode = '22023';
        end if;
        if exists (
          select 1 from public.club_teams as team
          where team.id = v_team_id and team.club_id <> v_context.club_id
        ) then
          raise exception 'A selected Club Pair or Team belongs to a different club.'
            using errcode = '23514';
        end if;
        if exists (
          select 1 from public.club_teams as team
          where team.id = v_team_id and team.archived_at is not null
        ) then
          raise exception 'A selected Club Pair or Team is archived. Unarchive it or choose another unit.'
            using errcode = '22023';
        end if;
        if not exists (
          select 1
          from public.club_teams as team
          where team.id = v_team_id
            and team.fixed_size = v_context.team_size
            and (
              (v_context.entry_format = 'pairs' and team.unit_type = 'pair')
              or (v_context.entry_format = 'team' and team.unit_type = 'team')
            )
        ) then
          raise exception 'The selected Club Pair or Team type and size are not compatible with this Competition.'
            using errcode = '23514';
        end if;

        select coalesce(jsonb_agg(
          to_jsonb(roster.club_membership_id) order by roster.position
        ), '[]'::jsonb)
        into v_participants
        from public.club_team_roster_members as roster
        join public.club_memberships as membership
          on membership.id = roster.club_membership_id
        where roster.club_team_id = v_team_id
          and membership.club_id = v_context.club_id
          and membership.status = 'active';
      end if;
    else
      raise exception 'Individual entrants use participant lists; Pair and Team entrants select a Club Pair or Club Team.'
        using errcode = '22023';
    end if;

    if v_participants is null
      or jsonb_typeof(v_participants) <> 'array'
      or jsonb_array_length(v_participants) <> v_context.team_size then
      raise exception 'Every entrant must contain exactly % shooter slots.',
        v_context.team_size using errcode = '22023';
    end if;

    for v_slot in
      select value from jsonb_array_elements(v_participants)
    loop
      if jsonb_typeof(v_slot.value) not in ('number', 'null')
        or (
          jsonb_typeof(v_slot.value) = 'number'
          and v_slot.value::text !~ '^[1-9][0-9]*$'
        ) then
        raise exception 'Shooter selections must use valid club membership IDs.'
          using errcode = '22023';
      end if;
    end loop;

    v_normalised := v_normalised || jsonb_build_array(jsonb_build_object(
      'club_team_id', v_team_id,
      'participants', v_participants
    ));
  end loop;

  select count(*)::integer into v_selected_team_count
  from jsonb_array_elements(v_normalised) as unit(value)
  where jsonb_typeof(unit.value -> 'club_team_id') = 'number';

  if (
    select count(distinct (unit.value ->> 'club_team_id'))::integer
    from jsonb_array_elements(v_normalised) as unit(value)
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
  ) <> v_selected_team_count then
    raise exception 'A Club Pair or Club Team can only be used once in this Club entry.'
      using errcode = '23505',
        constraint = 'competition_entrants_entry_club_team_unique';
  end if;

  select count(*)::integer into v_selected_count
  from jsonb_array_elements(v_normalised) as unit(value)
  cross join lateral jsonb_array_elements(unit.value -> 'participants') as slot(value)
  where jsonb_typeof(slot.value) = 'number';

  perform membership.id
  from public.club_memberships as membership
  where membership.club_id = v_context.club_id
    and membership.id in (
      select slot.value::text::bigint
      from jsonb_array_elements(v_normalised) as unit(value)
      cross join lateral jsonb_array_elements(unit.value -> 'participants') as slot(value)
      where jsonb_typeof(slot.value) = 'number'
    )
  order by membership.id
  for share;

  if (
    select count(distinct slot.value::text)::integer
    from jsonb_array_elements(v_normalised) as unit(value)
    cross join lateral jsonb_array_elements(unit.value -> 'participants') as slot(value)
    where jsonb_typeof(slot.value) = 'number'
  ) <> v_selected_count then
    raise exception 'A shooter can only be selected once in this club entry.'
      using errcode = '23505';
  end if;

  if (
    select count(*)::integer
    from public.club_memberships as membership
    where membership.club_id = v_context.club_id
      and membership.status = 'active'
      and membership.id in (
        select slot.value::text::bigint
        from jsonb_array_elements(v_normalised) as unit(value)
        cross join lateral jsonb_array_elements(unit.value -> 'participants') as slot(value)
        where jsonb_typeof(slot.value) = 'number'
      )
  ) <> v_selected_count then
    raise exception 'Every selected shooter must be an active member of this club.'
      using errcode = '22023';
  end if;

  perform team.id
  from public.club_teams as team
  where team.id in (
    select (unit.value ->> 'club_team_id')::bigint
    from jsonb_array_elements(v_normalised) as unit(value)
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
  )
  order by team.id
  for share;

  if exists (
    select 1
    from jsonb_array_elements(v_normalised) as unit(value)
    left join public.club_teams as team
      on team.id = (unit.value ->> 'club_team_id')::bigint
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
      and team.id is null
  ) then
    raise exception 'A selected Club Pair or Team no longer exists.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_normalised) as unit(value)
    join public.club_teams as team
      on team.id = (unit.value ->> 'club_team_id')::bigint
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
      and team.club_id <> v_context.club_id
  ) then
    raise exception 'A selected Club Pair or Team belongs to a different club.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_normalised) as unit(value)
    join public.club_teams as team
      on team.id = (unit.value ->> 'club_team_id')::bigint
    where jsonb_typeof(unit.value -> 'club_team_id') = 'number'
      and team.archived_at is not null
  ) then
    raise exception 'A selected Club Pair or Team is archived. Unarchive it or choose another unit.'
      using errcode = '22023';
  end if;

  delete from public.competition_entrants
  where club_competition_entry_id = p_club_competition_entry_id;

  for v_unit in
    select value, ordinality::integer as position
    from jsonb_array_elements(v_normalised) with ordinality
  loop
    insert into public.competition_entrants(
      club_competition_entry_id,
      position,
      club_team_id,
      club_team_name_snapshot
    ) values (
      p_club_competition_entry_id,
      v_unit.position,
      (v_unit.value ->> 'club_team_id')::bigint,
      null
    ) returning id into v_entrant_id;

    for v_slot in
      select value, ordinality::integer as slot_number
      from jsonb_array_elements(v_unit.value -> 'participants') with ordinality
    loop
      if jsonb_typeof(v_slot.value) = 'number' then
        insert into public.competition_entrant_participants(
          club_competition_entry_id,
          competition_entrant_id,
          club_membership_id,
          slot_number
        ) values (
          p_club_competition_entry_id,
          v_entrant_id,
          v_slot.value::text::bigint,
          v_slot.slot_number
        );
      end if;
    end loop;
  end loop;

  update public.club_competition_entries
  set status = 'draft', submitted_at = null, updated_by = v_context.actor_id
  where id = p_club_competition_entry_id;

  return jsonb_build_object(
    'id', p_club_competition_entry_id,
    'status', 'draft',
    'entrant_count', jsonb_array_length(v_normalised),
    'participant_count', v_selected_count
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'competition_entrants_entry_club_team_unique' then
      raise exception 'A Club Pair or Club Team can only be used once in this Club entry.'
        using errcode = '23505';
    end if;
    raise exception 'A shooter can only be selected once in this club entry.'
      using errcode = '23505';
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_competition_publish_readiness(p_organisation_id bigint, p_league_season_id bigint, p_competition_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  competition_record record;
  components jsonb;
  round_deadlines date[];
  requirements text[];
begin
  perform private.require_competition_author(p_organisation_id, false);

  select competition.*,
    effective.effective_entry_opens_at,
    effective.effective_entry_closes_at,
    effective.effective_starts_at
  into competition_record
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  cross join lateral private.get_competition_effective_dates(competition.id) effective
  where competition.id = p_competition_id
    and competition.league_season_id = p_league_season_id
    and season.organisation_id = p_organisation_id;

  if not found then
    raise exception 'Competition not found in this Organisation and Season.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'short_label', component.short_label,
    'maximum_score', component.maximum_score,
    'score_method', component.score_method
  ) order by component.position), '[]'::jsonb)
  into components
  from public.competition_score_components component
  where component.competition_id = p_competition_id;

  select coalesce(array_agg(round.deadline order by round.round_number), array[]::date[])
  into round_deadlines
  from public.competition_rounds round
  where round.competition_id = p_competition_id;

  requirements := private.competition_publication_readiness_errors(
    competition_record.effective_entry_opens_at,
    competition_record.effective_entry_closes_at,
    competition_record.effective_starts_at,
    competition_record.ranking_method,
    components,
    competition_record.best_rounds_count,
    competition_record.number_of_rounds,
    round_deadlines
  );

  if competition_record.shooting_details_version is not null
    and not private.competition_has_complete_shooting_details(p_competition_id) then
    requirements := array_prepend(
      'Choose equipment and complete position/style, distance, and Shots for every Course of Fire component.',
      requirements
    );
  end if;

  return jsonb_build_object(
    'status', competition_record.status,
    'requirements', to_jsonb(requirements),
    'ready', cardinality(requirements) = 0
  );
end;
$function$;

revoke all privileges on function private.competition_publication_readiness_errors(date, date, date, text, jsonb, integer, integer, date[]) from public, anon, authenticated, service_role;

revoke all privileges on function public.delete_league_season(bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function public.delete_league_season(bigint, bigint) to authenticated;

revoke all privileges on function public.get_competition_publish_readiness(bigint, bigint, bigint) from public, anon, authenticated, service_role;
grant execute on function public.get_competition_publish_readiness(bigint, bigint, bigint) to authenticated;

comment on function public.delete_league_season(bigint, bigint) is
  'Deletes only an empty draft Season after exact active Organisation Owner authorisation; Competitions and Concurrent Shooting dependencies block deletion.';

comment on function public.get_competition_publish_readiness(bigint, bigint, bigint) is
  'Returns publication requirements to authorised Organisation management from the same validators used by publication.';

commit;

