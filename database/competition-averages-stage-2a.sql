-- Competition Averages Stage 2A: atomic one-off Competition creation with an
-- optional authoritative Average binding. Run after the two Stage 1 Average
-- files. Additive and safe to rerun.
begin;

create or replace function public.create_competition_with_average_settings(
  p_organisation_id bigint,
  p_league_season_id bigint,
  p_configuration jsonb,
  p_average_context_id bigint,
  p_average_policy_version_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_average_context_id is null or p_average_policy_version_id is null then
    raise exception 'Average Context and Average Policy version are required.'
      using errcode = '22023';
  end if;

  result := private.save_series_competition(
    p_organisation_id,
    p_league_season_id,
    p_configuration
  );

  perform public.set_competition_average_settings(
    p_organisation_id,
    p_league_season_id,
    (result->>'id')::bigint,
    p_average_context_id,
    p_average_policy_version_id,
    true
  );

  return result || jsonb_build_object(
    'average_context_id', p_average_context_id,
    'average_policy_version_id', p_average_policy_version_id,
    'contributes_to_history', true
  );
end;
$$;

revoke all on function public.create_competition_with_average_settings(
  bigint,bigint,jsonb,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.create_competition_with_average_settings(
  bigint,bigint,jsonb,bigint,bigint
) to authenticated;

comment on function public.create_competition_with_average_settings(
  bigint,bigint,jsonb,bigint,bigint
) is
  'Creates a one-off Competition and its authoritative Average binding atomically using the existing Competition and Stage 1 Average validators.';

create or replace function public.get_competition_starting_average_management(
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
  participants jsonb;
begin
  perform private.require_competition_author(p_organisation_id);
  perform competition.id
  from public.competitions competition
  join public.league_seasons season on season.id = competition.league_season_id
  where competition.id = p_competition_id
    and season.id = p_league_season_id
    and season.organisation_id = p_organisation_id;
  if not found then
    raise exception 'Competition not found in this Organisation and Season.'
      using errcode = '22023';
  end if;

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
  join public.competition_entrants entrant
    on entrant.club_competition_entry_id = entry.id
  join public.competition_entrant_participants participant
    on participant.club_competition_entry_id = entry.id
   and participant.competition_entrant_id = entrant.id
  join public.club_memberships membership on membership.id = participant.club_membership_id
  join public.profiles profile on profile.id = membership.user_id
  left join public.competition_participant_starting_averages snapshot
    on snapshot.competition_entrant_participant_id = participant.id
  left join public.competitions source_competition
    on source_competition.id = snapshot.source_competition_id
  where entry.competition_id = p_competition_id
    and entry.status = 'submitted';

  return jsonb_build_object('participants', participants);
end;
$$;

revoke all on function public.get_competition_starting_average_management(
  bigint,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.get_competition_starting_average_management(
  bigint,bigint,bigint
) to authenticated;

comment on function public.get_competition_starting_average_management(
  bigint,bigint,bigint
) is
  'Returns the minimum staff-only participant and provisional Starting Average projection required by Stage 2A management UI.';

commit;
