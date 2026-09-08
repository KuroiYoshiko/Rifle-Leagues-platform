-- Competition Averages Stage 2B: division projection, reviewed-state
-- fingerprints, and atomic Starting Average finalisation. Run after
-- competition-averages-stage-2a.sql. Additive and safe to rerun.
begin;

alter table public.competition_division_configs
  add column if not exists reviewed_starting_average_fingerprint text,
  add column if not exists reviewed_starting_averages_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.competition_division_configs'::regclass
      and conname = 'competition_division_configs_average_review_value'
  ) then
    alter table public.competition_division_configs
      add constraint competition_division_configs_average_review_value check (
        (reviewed_starting_average_fingerprint is null and reviewed_starting_averages_at is null)
        or (reviewed_starting_average_fingerprint ~ '^[0-9a-f]{32}$'
          and reviewed_starting_averages_at is not null)
      ) not valid;
  end if;
end;
$$;
alter table public.competition_division_configs
  validate constraint competition_division_configs_average_review_value;

create table if not exists public.competition_starting_average_finalisations (
  competition_id bigint primary key
    references public.competition_average_settings(competition_id) on delete cascade,
  starting_average_fingerprint text not null check (
    starting_average_fingerprint ~ '^[0-9a-f]{32}$'
  ),
  participant_count integer not null check (participant_count between 1 and 20000),
  finalised_at timestamptz not null default now(),
  finalised_by uuid references public.profiles(id) on delete set null
);

comment on table public.competition_starting_average_finalisations is
  'One immutable Competition-level marker proving that the complete submitted participant S/Av set was atomically frozen.';
comment on column public.competition_division_configs.reviewed_starting_average_fingerprint is
  'Opaque fingerprint of the participant-owned S/Av state last reviewed with this draft; never a Pair/Team historical average.';

create index if not exists competition_starting_average_finalisations_finalised_by_idx
  on public.competition_starting_average_finalisations(finalised_by)
  where finalised_by is not null;

alter table public.competition_starting_average_finalisations enable row level security;
revoke all on table public.competition_starting_average_finalisations
  from public, anon, authenticated;

create or replace function private.protect_starting_average_finalisation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Starting Average finalisation is immutable.' using errcode = '22023';
end;
$$;
revoke execute on function private.protect_starting_average_finalisation()
  from public, anon, authenticated;
drop trigger if exists protect_starting_average_finalisation
  on public.competition_starting_average_finalisations;
create trigger protect_starting_average_finalisation
  before update on public.competition_starting_average_finalisations
  for each row execute function private.protect_starting_average_finalisation();

create or replace function private.block_starting_average_after_finalisation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.competition_starting_average_finalisations finalisation
    where finalisation.competition_id = new.competition_id
  ) then
    raise exception 'Starting Averages were finalised for this Competition.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function private.block_starting_average_after_finalisation()
  from public, anon, authenticated;
drop trigger if exists block_starting_average_after_finalisation
  on public.competition_participant_starting_averages;
create trigger block_starting_average_after_finalisation
  before insert or update on public.competition_participant_starting_averages
  for each row execute function private.block_starting_average_after_finalisation();

-- Status, frozen_at and updated_at are excluded so freezing preserves the
-- reviewed identity. Recalculation, manual edits, roster changes, and binding
-- changes all produce a new fingerprint.
create or replace function private.competition_starting_average_state(
  p_competition_id bigint
)
returns table (
  configured boolean,
  participant_count integer,
  snapshot_count integer,
  frozen_count integer,
  complete boolean,
  fingerprint text
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_setting public.competition_average_settings%rowtype;
begin
  select * into v_setting from public.competition_average_settings setting
  where setting.competition_id = p_competition_id;

  if not found then
    return query
    select false, count(participant.id)::integer, 0, 0, false, null::text
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants participant
      on participant.club_competition_entry_id = entry.id
     and participant.competition_entrant_id = entrant.id
    where entry.competition_id = p_competition_id and entry.status = 'submitted';
    return;
  end if;

  return query
  with roster as (
    select participant.id as participant_id,
      membership.user_id as shooter_profile_id,
      snapshot.id as snapshot_id,
      snapshot.starting_average,
      snapshot.origin,
      snapshot.status,
      snapshot.calculated_at,
      snapshot.source_competition_id,
      snapshot.qualifying_score_count,
      snapshot.average_context_id,
      snapshot.average_policy_version_id
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants participant
      on participant.club_competition_entry_id = entry.id
     and participant.competition_entrant_id = entrant.id
    join public.club_memberships membership on membership.id = participant.club_membership_id
    left join public.competition_participant_starting_averages snapshot
      on snapshot.competition_entrant_participant_id = participant.id
     and snapshot.competition_id = p_competition_id
    where entry.competition_id = p_competition_id and entry.status = 'submitted'
  )
  select true, count(*)::integer, count(roster.snapshot_id)::integer,
    count(*) filter (where roster.status = 'frozen')::integer,
    count(*) > 0 and count(roster.snapshot_id) = count(*),
    pg_catalog.md5(
      v_setting.average_context_id::text || '|' ||
      v_setting.average_policy_version_id::text || '|' ||
      v_setting.contributes_to_history::text || '|' ||
      coalesce(string_agg(
        roster.participant_id::text || ':' || roster.shooter_profile_id::text || ':' ||
        coalesce(roster.snapshot_id::text, '-') || ':' ||
        coalesce(roster.starting_average::text, '-') || ':' ||
        coalesce(roster.origin, '-') || ':' ||
        coalesce(extract(epoch from roster.calculated_at)::text, '-') || ':' ||
        coalesce(roster.source_competition_id::text, '-') || ':' ||
        coalesce(roster.qualifying_score_count::text, '-') || ':' ||
        coalesce(roster.average_context_id::text, '-') || ':' ||
        coalesce(roster.average_policy_version_id::text, '-'),
        ',' order by roster.participant_id
      ), '')
    )
  from roster;
end;
$$;
revoke execute on function private.competition_starting_average_state(bigint)
  from public, anon, authenticated;

create or replace function private.record_competition_starting_average_review(
  p_competition_id bigint,
  p_fingerprint text,
  p_actor_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_state record;
begin
  select * into v_state from private.competition_starting_average_state(p_competition_id);
  if not v_state.configured then
    update public.competition_division_configs
    set reviewed_starting_average_fingerprint = null,
        reviewed_starting_averages_at = null,
        updated_by = p_actor_id
    where competition_id = p_competition_id;
    return;
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{32}$'
    or p_fingerprint is distinct from v_state.fingerprint then
    raise exception 'Starting Averages changed since this division layout was reviewed. Refresh, review, and save the draft again.'
      using errcode = '40001';
  end if;
  update public.competition_division_configs
  set reviewed_starting_average_fingerprint = v_state.fingerprint,
      reviewed_starting_averages_at = clock_timestamp(),
      updated_by = p_actor_id
  where competition_id = p_competition_id;
end;
$$;
revoke execute on function private.record_competition_starting_average_review(bigint,text,uuid)
  from public, anon, authenticated;

create or replace function private.freeze_competition_starting_averages(
  p_competition_id bigint,
  p_actor_id uuid,
  p_require_division_review boolean
)
returns table (participant_count integer, finalised_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_state record;
  v_finalisation public.competition_starting_average_finalisations%rowtype;
  v_reviewed_fingerprint text;
  v_now timestamptz := clock_timestamp();
begin
  perform setting.competition_id
  from public.competition_average_settings setting
  where setting.competition_id = p_competition_id for share;
  if not found then
    return query select 0, null::timestamptz;
    return;
  end if;

  perform entry.id from public.club_competition_entries entry
  where entry.competition_id = p_competition_id order by entry.id for update;
  perform participant.id
  from public.competition_entrant_participants participant
  join public.club_competition_entries entry
    on entry.id = participant.club_competition_entry_id
  where entry.competition_id = p_competition_id and entry.status = 'submitted'
  order by participant.id for update of participant;
  perform snapshot.id from public.competition_participant_starting_averages snapshot
  where snapshot.competition_id = p_competition_id order by snapshot.id for update;

  select * into v_state from private.competition_starting_average_state(p_competition_id);
  select * into v_finalisation
  from public.competition_starting_average_finalisations finalisation
  where finalisation.competition_id = p_competition_id;
  if found then
    if v_state.fingerprint is distinct from v_finalisation.starting_average_fingerprint
      or not v_state.complete or v_state.frozen_count <> v_state.participant_count then
      raise exception 'Finalised Starting Average state is inconsistent and requires administrator review.'
        using errcode = '22023';
    end if;
    return query select v_finalisation.participant_count, v_finalisation.finalised_at;
    return;
  end if;

  if not v_state.complete then
    raise exception 'Every submitted participant needs a Starting Average before finalisation.'
      using errcode = '22023';
  end if;

  if p_require_division_review then
    select config.reviewed_starting_average_fingerprint into v_reviewed_fingerprint
    from public.competition_division_configs config
    where config.competition_id = p_competition_id for update;
    if v_reviewed_fingerprint is null
      or v_reviewed_fingerprint is distinct from v_state.fingerprint then
      raise exception 'Starting Averages changed since this division layout was reviewed. Refresh, review, and save the draft again.'
        using errcode = '40001';
    end if;
  end if;

  update public.competition_participant_starting_averages snapshot
  set status = 'frozen', frozen_at = v_now, updated_by = p_actor_id
  where snapshot.competition_id = p_competition_id and snapshot.status = 'provisional';

  insert into public.competition_starting_average_finalisations(
    competition_id, starting_average_fingerprint, participant_count,
    finalised_at, finalised_by
  ) values (
    p_competition_id, v_state.fingerprint, v_state.participant_count,
    v_now, p_actor_id
  )
  returning competition_starting_average_finalisations.participant_count,
    competition_starting_average_finalisations.finalised_at
  into participant_count, finalised_at;
  return next;
end;
$$;
revoke execute on function private.freeze_competition_starting_averages(bigint,uuid,boolean)
  from public, anon, authenticated;

create or replace function public.get_competition_division_average_projection(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context record;
  v_state record;
  v_config public.competition_division_configs%rowtype;
  v_finalisation public.competition_starting_average_finalisations%rowtype;
  v_basis_maximum numeric;
  v_entrants jsonb;
begin
  select * into v_context from private.require_competition_division_manager(
    p_organisation_id, p_league_season_id, p_competition_id
  );
  select * into v_state from private.competition_starting_average_state(p_competition_id);
  select * into v_config from public.competition_division_configs config
  where config.competition_id = p_competition_id;
  select * into v_finalisation
  from public.competition_starting_average_finalisations finalisation
  where finalisation.competition_id = p_competition_id;
  select context.basis_maximum into v_basis_maximum
  from public.competition_average_settings setting
  join public.average_contexts context on context.id = setting.average_context_id
  where setting.competition_id = p_competition_id;

  if not v_state.configured then
    select coalesce(jsonb_agg(jsonb_build_object(
      'competition_entrant_id', entrant.id,
      'starting_average', null,
      'state', 'not_configured',
      'participants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'competition_entrant_participant_id', participant.id,
          'slot_number', participant.slot_number,
          'first_name', profile.first_name,
          'last_name', profile.last_name,
          'starting_average', null,
          'origin', null,
          'status', null,
          'state', 'not_configured'
        ) order by participant.slot_number, participant.id)
        from public.competition_entrant_participants participant
        join public.club_memberships membership on membership.id = participant.club_membership_id
        join public.profiles profile on profile.id = membership.user_id
        where participant.competition_entrant_id = entrant.id
          and participant.club_competition_entry_id = entry.id
      ), '[]'::jsonb)
    ) order by entrant.id), '[]'::jsonb) into v_entrants
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    where entry.competition_id = p_competition_id and entry.status = 'submitted';

    return jsonb_build_object(
      'configured', false,
      'basis_maximum', null,
      'current_fingerprint', null,
      'review_status', 'not_configured',
      'finalised_at', null,
      'entrants', v_entrants
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'competition_entrant_id', entrant.id,
    'starting_average', case when stats.participant_count > 0
      and stats.snapshot_count = stats.participant_count
      then stats.starting_average else null end,
    'state', case
      when not v_state.configured then 'not_configured'
      when stats.participant_count > 0 and stats.snapshot_count = stats.participant_count
        and stats.frozen_count = stats.participant_count then 'frozen'
      when stats.participant_count > 0 and stats.snapshot_count = stats.participant_count then 'ready'
      when stats.recalculation_required then 'recalculation_required'
      else 'manual_required'
    end,
    'participants', stats.participants
  ) order by entrant.id), '[]'::jsonb) into v_entrants
  from public.club_competition_entries entry
  join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
  cross join lateral (
    select count(participant.id)::integer as participant_count,
      count(snapshot.id)::integer as snapshot_count,
      count(*) filter (where snapshot.status = 'frozen')::integer as frozen_count,
      avg(snapshot.starting_average) as starting_average,
      coalesce(bool_or(snapshot.id is null
        and decision.policy_branch in ('current','preceding')), false) as recalculation_required,
      coalesce(jsonb_agg(jsonb_build_object(
        'competition_entrant_participant_id', participant.id,
        'slot_number', participant.slot_number,
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'starting_average', snapshot.starting_average,
        'origin', snapshot.origin,
        'status', snapshot.status,
        'state', case
          when snapshot.status = 'frozen' then 'frozen'
          when snapshot.id is not null then 'ready'
          when not v_state.configured then 'not_configured'
          when decision.policy_branch in ('current','preceding') then 'recalculation_required'
          else 'manual_required'
        end
      ) order by participant.slot_number, participant.id), '[]'::jsonb) as participants
    from public.competition_entrant_participants participant
    join public.club_memberships membership on membership.id = participant.club_membership_id
    join public.profiles profile on profile.id = membership.user_id
    left join public.competition_participant_starting_averages snapshot
      on snapshot.competition_entrant_participant_id = participant.id
     and snapshot.competition_id = p_competition_id
    left join lateral private.resolve_competition_starting_average(
      p_competition_id, membership.user_id
    ) decision on v_state.configured and snapshot.id is null
    where participant.competition_entrant_id = entrant.id
      and participant.club_competition_entry_id = entry.id
  ) stats
  where entry.competition_id = p_competition_id and entry.status = 'submitted';

  return jsonb_build_object(
    'configured', v_state.configured,
    'basis_maximum', v_basis_maximum,
    'current_fingerprint', v_state.fingerprint,
    'review_status', case
      when not v_state.configured then 'not_configured'
      when v_finalisation.competition_id is not null then 'finalised'
      when v_config.reviewed_starting_average_fingerprint is null then 'unreviewed'
      when v_config.reviewed_starting_average_fingerprint = v_state.fingerprint then 'current'
      else 'stale'
    end,
    'finalised_at', v_finalisation.finalised_at,
    'entrants', v_entrants
  );
end;
$$;
revoke all on function public.get_competition_division_average_projection(bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.get_competition_division_average_projection(bigint,bigint,bigint)
  to authenticated;

create or replace function public.save_competition_division_draft_with_average_review(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_target_size integer,
  p_divisions jsonb,
  p_starting_average_fingerprint text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context record;
  v_result jsonb;
begin
  select * into v_context from private.require_competition_division_manager(
    p_organisation_id, p_league_season_id, p_competition_id
  );
  v_result := public.save_competition_division_draft(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_target_size, p_divisions
  );
  perform private.record_competition_starting_average_review(
    p_competition_id, p_starting_average_fingerprint, v_context.actor_id
  );
  return v_result;
end;
$$;
revoke all on function public.save_competition_division_draft_with_average_review(bigint,bigint,bigint,integer,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.save_competition_division_draft_with_average_review(bigint,bigint,bigint,integer,jsonb,text)
  to authenticated;

-- Replace the deployed publication body without changing its public signature.
-- Existing clients and Competitions without Average setup stay compatible.
create or replace function public.publish_competition_divisions(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context record;
  v_entrant_count integer;
  v_division_count integer;
  v_assignment_count integer;
begin
  select * into v_context from private.require_competition_division_manager(
    p_organisation_id, p_league_season_id, p_competition_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('competition-divisions:' || p_competition_id::text, 0)
  );
  perform config.competition_id from public.competition_division_configs config
  where config.competition_id = p_competition_id for update;
  if not found then
    raise exception 'Save a division draft before publishing.' using errcode = '22023';
  end if;
  if v_context.entry_closes_at is null or current_date <= v_context.entry_closes_at then
    raise exception 'Divisions cannot be published until the competition entry window has closed.'
      using errcode = '22023';
  end if;

  perform entry.id from public.club_competition_entries entry
  where entry.competition_id = p_competition_id order by entry.id for update;
  select count(*)::integer into v_entrant_count
  from public.competition_entrants entrant
  join public.club_competition_entries entry on entry.id = entrant.club_competition_entry_id
  where entry.competition_id = p_competition_id and entry.status = 'submitted';
  if v_entrant_count = 0 then
    raise exception 'At least one submitted entrant unit is required before publishing.'
      using errcode = '22023';
  end if;
  select count(*)::integer into v_division_count from public.competition_divisions
  where competition_id = p_competition_id;
  if v_division_count = 0 then
    raise exception 'Create at least one division before publishing.' using errcode = '22023';
  end if;

  select count(*)::integer into v_assignment_count
  from public.competition_division_assignments assignment
  join public.competition_divisions division
    on division.id = assignment.competition_division_id
   and division.competition_id = assignment.competition_id
  join public.competition_entrants entrant on entrant.id = assignment.competition_entrant_id
  join public.club_competition_entries entry on entry.id = entrant.club_competition_entry_id
  where assignment.competition_id = p_competition_id
    and division.competition_id = p_competition_id
    and entry.competition_id = p_competition_id and entry.status = 'submitted';
  if v_assignment_count <> v_entrant_count
    or exists (
      select 1 from public.competition_entrants entrant
      join public.club_competition_entries entry on entry.id = entrant.club_competition_entry_id
      left join public.competition_division_assignments assignment
        on assignment.competition_entrant_id = entrant.id
       and assignment.competition_id = p_competition_id
      where entry.competition_id = p_competition_id and entry.status = 'submitted'
        and assignment.competition_entrant_id is null
    )
    or exists (
      select 1 from public.competition_division_assignments assignment
      left join public.competition_entrants entrant on entrant.id = assignment.competition_entrant_id
      left join public.club_competition_entries entry on entry.id = entrant.club_competition_entry_id
      where assignment.competition_id = p_competition_id
        and (entrant.id is null or entry.competition_id <> p_competition_id
          or entry.status <> 'submitted')
    ) then
    raise exception 'Every currently submitted entrant unit must be assigned to exactly one division before publishing.'
      using errcode = '22023';
  end if;

  perform * from private.freeze_competition_starting_averages(
    p_competition_id, v_context.actor_id, true
  );
  update public.competition_division_configs
  set status = 'published', published_at = now(), updated_by = v_context.actor_id
  where competition_id = p_competition_id;
  return jsonb_build_object('status','published','entrant_count',v_entrant_count,
    'division_count',v_division_count,'published_at',now());
end;
$$;

create or replace function public.save_and_publish_competition_divisions_with_average_review(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_target_size integer,
  p_divisions jsonb,
  p_starting_average_fingerprint text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.save_competition_division_draft_with_average_review(
    p_organisation_id, p_league_season_id, p_competition_id,
    p_target_size, p_divisions, p_starting_average_fingerprint
  );
  return public.publish_competition_divisions(
    p_organisation_id, p_league_season_id, p_competition_id
  );
end;
$$;
revoke all on function public.save_and_publish_competition_divisions_with_average_review(bigint,bigint,bigint,integer,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.save_and_publish_competition_divisions_with_average_review(bigint,bigint,bigint,integer,jsonb,text)
  to authenticated;

create or replace function public.finalise_competition_starting_averages(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context record;
  v_result record;
begin
  select * into v_context from private.require_competition_division_manager(
    p_organisation_id, p_league_season_id, p_competition_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('competition-divisions:' || p_competition_id::text, 0)
  );
  if exists (select 1 from public.competition_division_configs config
    where config.competition_id = p_competition_id) then
    raise exception 'This Competition uses the division workflow. Publish divisions to finalise Starting Averages.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.competition_average_settings setting
    where setting.competition_id = p_competition_id) then
    raise exception 'This Competition does not have Starting Average setup.' using errcode = '22023';
  end if;
  select * into v_result from private.freeze_competition_starting_averages(
    p_competition_id, v_context.actor_id, false
  );
  return jsonb_build_object('status','frozen',
    'participant_count',v_result.participant_count,'finalised_at',v_result.finalised_at);
end;
$$;
revoke all on function public.finalise_competition_starting_averages(bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.finalise_competition_starting_averages(bigint,bigint,bigint)
  to authenticated;

-- Extend the Stage 2A staff projection with finalisation and division state.
create or replace function public.get_competition_starting_average_management(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  participants jsonb;
  v_finalised_at timestamptz;
  v_division_status text;
begin
  perform private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;
  if not found then
    raise exception 'Competition not found in this Organisation and Season.'
      using errcode = '22023';
  end if;
  select finalisation.finalised_at into v_finalised_at
  from public.competition_starting_average_finalisations finalisation
  where finalisation.competition_id = p_competition_id;
  select config.status into v_division_status
  from public.competition_division_configs config
  where config.competition_id = p_competition_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'competition_entrant_participant_id', participant.id,
    'competition_entrant_id', participant.competition_entrant_id,
    'slot_number', participant.slot_number,
    'shooter_profile_id', membership.user_id,
    'first_name', profile.first_name,
    'last_name', profile.last_name,
    'starting_average', snapshot.starting_average,
    'origin', snapshot.origin,
    'status', snapshot.status,
    'qualifying_score_count', coalesce(snapshot.qualifying_score_count, 0),
    'source_competition_id', snapshot.source_competition_id,
    'source_competition_name', source_competition.name,
    'manual_reason', snapshot.manual_reason
  ) order by entrant.position, participant.slot_number, participant.id), '[]'::jsonb)
  into participants
  from public.club_competition_entries entry
  join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
  join public.competition_entrant_participants participant
    on participant.club_competition_entry_id = entry.id
   and participant.competition_entrant_id = entrant.id
  join public.club_memberships membership on membership.id = participant.club_membership_id
  join public.profiles profile on profile.id = membership.user_id
  left join public.competition_participant_starting_averages snapshot
    on snapshot.competition_entrant_participant_id = participant.id
  left join public.competitions source_competition
    on source_competition.id = snapshot.source_competition_id
  where entry.competition_id = p_competition_id and entry.status = 'submitted';

  return jsonb_build_object('participants',participants,
    'finalised_at',v_finalised_at,'division_status',v_division_status);
end;
$$;

comment on function public.get_competition_division_average_projection(bigint,bigint,bigint) is
  'Returns staff-only participant S/Av values and ephemeral Individual/Pair/Team entrant means for division management.';
comment on function public.save_competition_division_draft_with_average_review(bigint,bigint,bigint,integer,jsonb,text) is
  'Saves a division draft and records the exact currently reviewed participant S/Av fingerprint atomically.';
comment on function public.publish_competition_divisions(bigint,bigint,bigint) is
  'Publishes a complete division allocation and, when configured, atomically validates and freezes its reviewed participant Starting Averages.';
comment on function public.save_and_publish_competition_divisions_with_average_review(bigint,bigint,bigint,integer,jsonb,text) is
  'Atomically saves a reviewed division layout, freezes configured Starting Averages, and publishes; all validation failures roll back.';
comment on function public.finalise_competition_starting_averages(bigint,bigint,bigint) is
  'Explicitly freezes a complete configured participant S/Av set only when no division workflow exists.';

revoke all on function public.publish_competition_divisions(bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.publish_competition_divisions(bigint,bigint,bigint)
  to authenticated;
revoke all on function public.get_competition_starting_average_management(bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.get_competition_starting_average_management(bigint,bigint,bigint)
  to authenticated;

commit;
