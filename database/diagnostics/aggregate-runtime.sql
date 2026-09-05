-- READ-ONLY diagnosis, not a migration. Do not rerun ranking SQL first.
-- Run section 1 by itself to inventory every installed overload and body.
-- Run section 2 separately after replacing YOUR_SIGNED_IN_USER_UUID with your
-- own existing application's Auth user UUID (Supabase Authentication > Users).
-- The temporary claim lets the same authenticated RPC run from SQL Editor;
-- ROLLBACK discards it. No user, score, or configuration row is modified.

-- SECTION 1: exact installed functions, including unexpected overloads/schemas.
select namespace.nspname as schema_name,
  procedure.proname as function_name,
  procedure.oid::regprocedure::text as signature,
  procedure.proargnames as parameter_names,
  pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
  procedure.prosecdef as security_definer,
  procedure.provolatile as volatility,
  md5(pg_get_functiondef(procedure.oid)) as definition_hash,
  pg_get_functiondef(procedure.oid) as installed_definition
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where procedure.proname in (
  'get_competition_aggregate_results',
  'derive_competition_round_results',
  'get_competition_round_results'
)
order by namespace.nspname, procedure.proname, identity_arguments;

-- SECTION 2: actual API payload and upstream canonical totals for the named
-- competition. Returns each matching exact organisation/season/competition
-- context, so duplicate competition names cannot silently select the wrong one.
begin;
set transaction read only;
select set_config('request.jwt.claim.sub', 'YOUR_SIGNED_IN_USER_UUID', true);

with contexts as (
  select season.organisation_id, competition.league_season_id,
    competition.id as competition_id, competition.name, competition.slug,
    competition.entry_format, competition.team_size, competition.sets_per_round,
    to_jsonb(competition) ->> 'scoring_method' as legacy_scoring_method,
    competition.ranking_method,
    (select jsonb_agg(jsonb_build_object(
      'position', component.position, 'maximum_score', component.maximum_score,
      'score_method', component.score_method
    ) order by component.position)
      from public.competition_score_components as component
      where component.competition_id = competition.id) as course_of_fire
  from public.competitions as competition
  join public.league_seasons as season on season.id = competition.league_season_id
  where lower(competition.name) = lower('Summer Pairs 200')
), payloads as (
  select context.*,
    public.get_competition_aggregate_results(
      context.organisation_id::bigint, context.league_season_id::bigint,
      context.competition_id::bigint
    ) as rpc_payload,
    private.derive_competition_round_results(
      context.organisation_id::bigint, context.league_season_id::bigint,
      context.competition_id::bigint, null::bigint, true
    ) as derived_payload
  from contexts as context
)
select organisation_id, league_season_id, competition_id, name, slug,
  entry_format, team_size, sets_per_round, legacy_scoring_method,
  ranking_method, course_of_fire,
  derived_payload #>> '{competition,display_scoring_mode}' as derived_scoring_mode,
  rpc_payload,
  (select jsonb_agg(jsonb_build_object(
    'round_id', round.value -> 'id',
    'round_number', round.value -> 'round_number',
    'deadline', round.value -> 'deadline',
    'entrant_id', entrant.value -> 'entrant_id',
    'entrant_label', entrant.value -> 'entrant_label',
    'completeness', entrant.value -> 'completeness',
    'achieved_score', entrant.value -> 'achieved_score',
    'maximum_possible_score', entrant.value -> 'maximum_possible_score',
    'display_score', entrant.value -> 'display_score',
    'display_scoring_mode', entrant.value -> 'display_scoring_mode'
  ) order by (round.value ->> 'round_number')::integer,
    (entrant.value ->> 'entrant_id')::bigint)
  from jsonb_array_elements(derived_payload -> 'rounds') as round(value)
  cross join lateral jsonb_array_elements(round.value -> 'entrants') as entrant(value)
  ) as derived_round_totals,
  -- Independently show the canonical stored values behind released results.
  -- Names, profile IDs, contact details, and unreleased scores are excluded.
  (select jsonb_agg(to_jsonb(source) order by source.round_number, source.entrant_id)
    from (
      select round.round_number, entrant.id as entrant_id,
        entrant.position as entrant_position,
        count(value.id) as recorded_slots,
        payloads.team_size * payloads.sets_per_round * (
          select count(*) from public.competition_score_components as config
          where config.competition_id = payloads.competition_id
        ) as expected_slots,
        sum(value.achieved_score) as stored_achieved_sum,
        sum(component.maximum_score - value.achieved_score) as recorded_dropped_sum
      from public.club_competition_entries as entry
      join public.competition_entrants as entrant on entrant.club_competition_entry_id = entry.id
      join public.competition_entrant_participants as participant on participant.competition_entrant_id = entrant.id
      join public.competition_rounds as round on round.competition_id = entry.competition_id
      left join public.competition_score_usages as usage
        on usage.competition_id = entry.competition_id
       and usage.competition_round_id = round.id
       and usage.competition_entrant_participant_id = participant.id
      left join public.shooting_score_values as value on value.shooting_score_source_id = usage.shooting_score_source_id
      left join public.competition_score_components as component
        on component.competition_id = entry.competition_id and component.position = value.component_position
      where entry.competition_id = payloads.competition_id and entry.status = 'submitted'
        and (statement_timestamp() at time zone 'UTC')::date > round.deadline
      group by round.round_number, entrant.id, entrant.position
    ) as source
  ) as canonical_released_totals
from payloads;

rollback;
