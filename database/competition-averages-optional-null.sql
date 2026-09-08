-- Competition Averages follow-up: an explicit, finalisable no-history state.
-- Run after competition-averages-stage-2b.sql. Additive and safe to rerun.
begin;

alter table public.competition_participant_starting_averages
  alter column starting_average drop not null;

alter table public.competition_participant_starting_averages
  drop constraint if exists competition_participant_starting_averages_origin_check,
  drop constraint if exists competition_participant_starting_averages_check1,
  drop constraint if exists competition_starting_averages_origin_value,
  drop constraint if exists competition_starting_averages_origin_consistency;

alter table public.competition_participant_starting_averages
  add constraint competition_starting_averages_origin_value
    check (origin in ('calculated','manual','no_history')) not valid,
  add constraint competition_starting_averages_origin_consistency check (
    (origin = 'calculated' and starting_average is not null
      and source_competition_id is not null and qualifying_score_count > 0
      and manual_reason is null)
    or (origin = 'manual' and starting_average is not null
      and source_competition_id is null and qualifying_score_count = 0)
    or (origin = 'no_history' and starting_average is null
      and source_competition_id is null and qualifying_score_count = 0
      and manual_reason is null)
  ) not valid;

alter table public.competition_participant_starting_averages
  validate constraint competition_starting_averages_origin_value;
alter table public.competition_participant_starting_averages
  validate constraint competition_starting_averages_origin_consistency;

comment on column public.competition_participant_starting_averages.starting_average is
  'Participant S/Av, or NULL only for an explicit no_history snapshot. No snapshot means calculation has not resolved the participant.';
comment on column public.competition_participant_starting_averages.origin is
  'calculated, manual, or no_history. no_history is a valid reviewed null and is never converted to zero.';

create or replace function public.calculate_competition_starting_averages(
  p_organisation_id bigint,p_league_season_id bigint,p_competition_id bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  setting public.competition_average_settings%rowtype;
  participant_row record;
  decision record;
  snapshot public.competition_participant_starting_averages%rowtype;
  snapshot_id bigint;
  items jsonb := '[]'::jsonb;
  snapshot_found boolean;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and competition.status = 'published'
    and season.id = p_league_season_id and season.organisation_id = p_organisation_id
  for update of competition;
  if not found then
    raise exception 'Published Competition not found in this Organisation and Season.' using errcode = '22023';
  end if;
  select * into setting from public.competition_average_settings average_setting
  where average_setting.competition_id = p_competition_id for share;
  if not found then
    raise exception 'Competition does not have authoritative Average settings.' using errcode = '22023';
  end if;

  for participant_row in
    select entrant_participant.id as participant_id,
      entrant_participant.competition_entrant_id as entrant_id,entrant_participant.slot_number,
      membership.user_id as shooter_profile_id,profile.first_name,profile.last_name
    from public.club_competition_entries entry
    join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
    join public.competition_entrant_participants entrant_participant
      on entrant_participant.club_competition_entry_id = entry.id
     and entrant_participant.competition_entrant_id = entrant.id
    join public.club_memberships membership on membership.id = entrant_participant.club_membership_id
    join public.profiles profile on profile.id = membership.user_id
    where entry.competition_id = p_competition_id and entry.status = 'submitted'
    order by entrant.position,entrant_participant.slot_number,entrant_participant.id
  loop
    select * into decision from private.resolve_competition_starting_average(
      p_competition_id,participant_row.shooter_profile_id
    );
    select * into snapshot from public.competition_participant_starting_averages existing
    where existing.competition_entrant_participant_id = participant_row.participant_id for update;
    snapshot_found := found;

    if snapshot_found and snapshot.status = 'frozen' then
      null;
    elsif decision.policy_branch in ('current','preceding') then
      insert into public.competition_participant_starting_averages(
        competition_id,competition_entrant_participant_id,shooter_profile_id,
        starting_average,average_context_id,average_policy_version_id,
        origin,status,calculated_at,frozen_at,source_competition_id,
        qualifying_score_count,manual_reason,created_by,updated_by
      ) values (
        p_competition_id,participant_row.participant_id,participant_row.shooter_profile_id,
        decision.starting_average,setting.average_context_id,setting.average_policy_version_id,
        'calculated','provisional',clock_timestamp(),null,decision.source_competition_id,
        decision.qualifying_score_count,null,actor,actor
      )
      on conflict (competition_entrant_participant_id) do update
      set shooter_profile_id = excluded.shooter_profile_id,
          starting_average = excluded.starting_average,
          average_context_id = excluded.average_context_id,
          average_policy_version_id = excluded.average_policy_version_id,
          origin = excluded.origin,status = 'provisional',calculated_at = excluded.calculated_at,
          frozen_at = null,source_competition_id = excluded.source_competition_id,
          qualifying_score_count = excluded.qualifying_score_count,manual_reason = null,
          updated_by = actor
      returning * into snapshot;
      snapshot_id := snapshot.id;
      delete from public.starting_average_score_sources provenance
      where provenance.starting_average_id = snapshot_id;
      insert into public.starting_average_score_sources(
        starting_average_id,shooting_score_source_id,competition_id,round_id,
        achieved_score_at_calculation,maximum_at_calculation
      )
      select snapshot_id,candidate.shooting_score_source_id,candidate.competition_id,
        candidate.round_id,candidate.achieved_score,candidate.maximum_score
      from private.shooter_historical_average_candidates(
        setting.average_context_id,participant_row.shooter_profile_id,p_competition_id
      ) candidate
      where candidate.competition_id = decision.source_competition_id;
    elsif not (snapshot_found and snapshot.origin = 'manual') then
      insert into public.competition_participant_starting_averages(
        competition_id,competition_entrant_participant_id,shooter_profile_id,
        starting_average,average_context_id,average_policy_version_id,
        origin,status,calculated_at,frozen_at,source_competition_id,
        qualifying_score_count,manual_reason,created_by,updated_by
      ) values (
        p_competition_id,participant_row.participant_id,participant_row.shooter_profile_id,
        null,setting.average_context_id,setting.average_policy_version_id,
        'no_history','provisional',clock_timestamp(),null,null,0,null,actor,actor
      )
      on conflict (competition_entrant_participant_id) do update
      set shooter_profile_id = excluded.shooter_profile_id,
          starting_average = null,
          average_context_id = excluded.average_context_id,
          average_policy_version_id = excluded.average_policy_version_id,
          origin = 'no_history',status = 'provisional',calculated_at = excluded.calculated_at,
          frozen_at = null,source_competition_id = null,qualifying_score_count = 0,
          manual_reason = null,updated_by = actor
      returning * into snapshot;
      delete from public.starting_average_score_sources provenance
      where provenance.starting_average_id = snapshot.id;
    end if;

    items := items || jsonb_build_array(jsonb_build_object(
      'competition_entrant_participant_id',participant_row.participant_id,
      'competition_entrant_id',participant_row.entrant_id,
      'slot_number',participant_row.slot_number,
      'shooter_profile_id',participant_row.shooter_profile_id,
      'first_name',participant_row.first_name,'last_name',participant_row.last_name,
      'starting_average',snapshot.starting_average,
      'manual_required',false,
      'origin',snapshot.origin,
      'status',snapshot.status,
      'policy_branch',case when snapshot.status = 'frozen' and snapshot.origin = 'manual'
        then 'manual' else decision.policy_branch end,
      'qualifying_score_count',snapshot.qualifying_score_count,
      'source_competition_id',snapshot.source_competition_id
    ));
  end loop;
  return items;
end;
$$;

create or replace function public.set_manual_competition_starting_average(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_competition_id bigint,
  p_competition_entrant_participant_id bigint,
  p_starting_average numeric,
  p_manual_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  setting public.competition_average_settings%rowtype;
  shooter_id uuid;
  basis_maximum numeric;
  decision record;
  snapshot public.competition_participant_starting_averages%rowtype;
  snapshot_origin text;
begin
  actor := private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id and competition.status = 'published'
    and season.id = p_league_season_id and season.organisation_id = p_organisation_id
  for update of competition;
  if not found then
    raise exception 'Published Competition not found in this Organisation and Season.' using errcode = '22023';
  end if;
  select * into setting from public.competition_average_settings average_setting
  where average_setting.competition_id = p_competition_id for share;
  if not found then
    raise exception 'Competition does not have authoritative Average settings.' using errcode = '22023';
  end if;
  select context.basis_maximum into basis_maximum
  from public.average_contexts context where context.id = setting.average_context_id;
  select membership.user_id into shooter_id
  from public.competition_entrant_participants participant
  join public.club_competition_entries entry on entry.id = participant.club_competition_entry_id
  join public.club_memberships membership on membership.id = participant.club_membership_id
  where participant.id = p_competition_entrant_participant_id
    and entry.competition_id = p_competition_id and entry.status = 'submitted';
  if shooter_id is null then
    raise exception 'Submitted Competition participant was not found.' using errcode = '22023';
  end if;
  if p_starting_average is not null and (p_starting_average < 0
    or p_starting_average > basis_maximum or p_starting_average <> round(p_starting_average,6)) then
    raise exception 'Manual Starting Average must be blank or a number from zero through the Context basis maximum, with at most six decimal places.'
      using errcode = '22023';
  end if;
  select * into decision from private.resolve_competition_starting_average(p_competition_id,shooter_id);
  if decision.policy_branch <> 'manual' then
    raise exception 'The active Average Policy can calculate this participant; manual input is not currently allowed.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.competition_participant_starting_averages existing
    where existing.competition_entrant_participant_id = p_competition_entrant_participant_id
      and existing.status = 'frozen'
  ) then
    raise exception 'Frozen Starting Averages cannot be changed through the provisional lifecycle.' using errcode = '22023';
  end if;
  snapshot_origin := case when p_starting_average is null then 'no_history' else 'manual' end;
  insert into public.competition_participant_starting_averages(
    competition_id,competition_entrant_participant_id,shooter_profile_id,
    starting_average,average_context_id,average_policy_version_id,
    origin,status,calculated_at,frozen_at,source_competition_id,
    qualifying_score_count,manual_reason,created_by,updated_by
  ) values (
    p_competition_id,p_competition_entrant_participant_id,shooter_id,
    p_starting_average,setting.average_context_id,setting.average_policy_version_id,
    snapshot_origin,'provisional',clock_timestamp(),null,null,0,
    case when p_starting_average is null then null else nullif(btrim(p_manual_reason),'') end,
    actor,actor
  )
  on conflict (competition_entrant_participant_id) do update
  set shooter_profile_id = excluded.shooter_profile_id,
      starting_average = excluded.starting_average,
      average_context_id = excluded.average_context_id,
      average_policy_version_id = excluded.average_policy_version_id,
      origin = excluded.origin,status = 'provisional',calculated_at = excluded.calculated_at,
      frozen_at = null,source_competition_id = null,qualifying_score_count = 0,
      manual_reason = excluded.manual_reason,updated_by = actor
  returning * into snapshot;
  delete from public.starting_average_score_sources provenance
  where provenance.starting_average_id = snapshot.id;
  return jsonb_build_object('id',snapshot.id,'competition_id',snapshot.competition_id,
    'competition_entrant_participant_id',snapshot.competition_entrant_participant_id,
    'shooter_profile_id',snapshot.shooter_profile_id,'starting_average',snapshot.starting_average,
    'origin',snapshot.origin,'status',snapshot.status,'manual_reason',snapshot.manual_reason);
end;
$$;

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
      and stats.value_count = stats.participant_count
      then stats.starting_average else null end,
    'state', case
      when stats.participant_count > 0 and stats.snapshot_count = stats.participant_count
        and stats.frozen_count = stats.participant_count then 'frozen'
      when stats.participant_count > 0 and stats.snapshot_count = stats.participant_count
        and stats.value_count < stats.participant_count then 'no_average'
      when stats.participant_count > 0 and stats.snapshot_count = stats.participant_count then 'ready'
      else 'recalculation_required'
    end,
    'participants', stats.participants
  ) order by entrant.id), '[]'::jsonb) into v_entrants
  from public.club_competition_entries entry
  join public.competition_entrants entrant on entrant.club_competition_entry_id = entry.id
  cross join lateral (
    select count(participant.id)::integer as participant_count,
      count(snapshot.id)::integer as snapshot_count,
      count(snapshot.starting_average)::integer as value_count,
      count(*) filter (where snapshot.status = 'frozen')::integer as frozen_count,
      avg(snapshot.starting_average) as starting_average,
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
          when snapshot.origin = 'no_history' then 'no_average'
          when snapshot.id is not null then 'ready'
          else 'recalculation_required'
        end
      ) order by participant.slot_number, participant.id), '[]'::jsonb) as participants
    from public.competition_entrant_participants participant
    join public.club_memberships membership on membership.id = participant.club_membership_id
    join public.profiles profile on profile.id = membership.user_id
    left join public.competition_participant_starting_averages snapshot
      on snapshot.competition_entrant_participant_id = participant.id
     and snapshot.competition_id = p_competition_id
    where participant.competition_entrant_id = entrant.id
      and participant.club_competition_entry_id = entry.id
  ) stats
  where entry.competition_id = p_competition_id and entry.status = 'submitted';

  return jsonb_build_object(
    'configured', v_state.configured,
    'basis_maximum', v_basis_maximum,
    'current_fingerprint', v_state.fingerprint,
    'review_status', case
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

revoke all on function public.calculate_competition_starting_averages(bigint,bigint,bigint),
  public.set_manual_competition_starting_average(bigint,bigint,bigint,bigint,numeric,text),
  public.get_competition_division_average_projection(bigint,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.calculate_competition_starting_averages(bigint,bigint,bigint),
  public.set_manual_competition_starting_average(bigint,bigint,bigint,bigint,numeric,text),
  public.get_competition_division_average_projection(bigint,bigint,bigint)
  to authenticated;

comment on function public.calculate_competition_starting_averages(bigint,bigint,bigint) is
  'Creates calculated S/Av snapshots or explicit valid no_history snapshots; existing provisional manual overrides remain optional.';
comment on function public.set_manual_competition_starting_average(bigint,bigint,bigint,bigint,numeric,text) is
  'Sets an optional manual S/Av. NULL preserves the explicit no-history state and never becomes zero.';
comment on function public.get_competition_division_average_projection(bigint,bigint,bigint) is
  'Returns staff-only participant S/Av values and ephemeral entrant means; resolved nulls are valid and never averaged as zero.';

commit;
