-- DEVELOPMENT ONLY: minimal manual-testing data for Gun Score Results.
--
-- This fixture deliberately reuses the Eastern Summer League, Basildon Rifle
-- and Pistol Club, and six existing development memberships. It creates no
-- auth users and never modifies Aggregate competitions. Rerunning it rebuilds
-- only the two competitions identified by the marker below.
--
-- Prerequisite: run database/competition-results.sql, then
-- database/competition-gun-score-results.sql.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.shooting_score_sources') is null
    or to_regclass('public.competition_division_configs') is null
    or to_regprocedure(
      'public.get_competition_gun_score_results(bigint,bigint,bigint)'
    ) is null
  then
    raise exception
      'Gun Score Results schema is missing. Run competition-results.sql and competition-gun-score-results.sql first.';
  end if;
end;
$$;

create temporary table gun_fixture_context on commit drop as
select
  organisation.id as organisation_id,
  season.id as league_season_id,
  club.id as club_id,
  owner_membership.user_id as actor_id
from public.organisations as organisation
join public.league_seasons as season
  on season.organisation_id = organisation.id
cross join public.clubs as club
join public.club_memberships as owner_membership
  on owner_membership.club_id = club.id
 and owner_membership.user_id =
   '10000000-0000-4000-8000-000000000001'::uuid
 and owner_membership.status = 'active'
 and owner_membership.role = 'owner'
where organisation.slug = 'eastern-region-shooting-association'
  and organisation.status = 'active'
  and season.slug = 'eastern-summer-league'
  and season.status in ('open', 'active')
  and club.slug = 'basildon-rifle-and-pistol-club'
  and club.status = 'active'
  and (season.starts_at is null or current_date - 4 > season.starts_at)
  and (season.ends_at is null or current_date + 14 <= season.ends_at);

do $$
begin
  if (select count(*) from gun_fixture_context) <> 1 then
    raise exception using message =
      'Expected the active Eastern Summer League, Basildon club, and Eleanor Hughes owner membership. The season must contain dates from four days ago through fourteen days from now.';
  end if;
end;
$$;

create temporary table gun_fixture_users (
  user_number integer primary key,
  user_id uuid not null,
  first_name text not null,
  last_name text not null,
  club_membership_id bigint
) on commit drop;

insert into gun_fixture_users (
  user_number,
  user_id,
  first_name,
  last_name
)
values
  (1, '10000000-0000-4000-8000-000000000004', 'George', 'Foster'),
  (2, '10000000-0000-4000-8000-000000000005', 'Sophie', 'Turner'),
  (3, '10000000-0000-4000-8000-000000000006', 'Harry', 'Collins'),
  (4, '10000000-0000-4000-8000-000000000007', 'Isla', 'Morgan'),
  (5, '10000000-0000-4000-8000-000000000008', 'Jack', 'Ward'),
  (6, '10000000-0000-4000-8000-000000000009', 'Emily', 'Price');

update gun_fixture_users as fixture_user
set club_membership_id = membership.id
from gun_fixture_context as context
join public.club_memberships as membership
  on membership.club_id = context.club_id
 and membership.status = 'active'
join public.profiles as profile
  on profile.id = membership.user_id
where membership.user_id = fixture_user.user_id
  and profile.first_name = fixture_user.first_name
  and profile.last_name = fixture_user.last_name;

do $$
begin
  if exists (
    select 1
    from gun_fixture_users
    where club_membership_id is null
  ) then
    raise exception
      'One or more expected Basildon development profiles/memberships are missing. This fixture does not create auth users.';
  end if;
end;
$$;

create temporary table gun_fixture_competition_specs (
  slug text primary key,
  name text not null,
  entry_format text not null,
  team_size integer not null,
  scoring_method text not null,
  maximum_score_per_round integer not null,
  shots_per_round integer not null,
  uses_x_score boolean not null,
  entrant_count integer not null
) on commit drop;

insert into gun_fixture_competition_specs values
  (
    'dev-gun-score-individual',
    'DEV Gun Score Individual',
    'individual',
    1,
    'points_scored',
    100,
    10,
    true,
    4
  ),
  (
    'dev-gun-score-pairs-dropped',
    'DEV Gun Score Pairs Dropped',
    'pairs',
    2,
    'points_dropped',
    100,
    10,
    false,
    3
  );

-- Refuse to claim a coincidentally matching slug unless it was made by this
-- fixture. This keeps the cleanup below tightly scoped.
do $$
begin
  if exists (
    select 1
    from gun_fixture_context as context
    join gun_fixture_competition_specs as specification on true
    join public.competitions as competition
      on competition.league_season_id = context.league_season_id
     and competition.slug = specification.slug
    where coalesce(competition.description, '') not like
      '%DEVELOPMENT ONLY: gun-score-manual-fixture-v1%'
  ) then
    raise exception
      'A non-fixture Competition already uses a reserved Gun Score fixture slug.';
  end if;
end;
$$;

-- This destructive, marker-scoped development reset deliberately stages its
-- existing fixtures as drafts before replacing sporting configuration.
update public.competitions as competition
set status = 'draft'
from gun_fixture_context as context,
  gun_fixture_competition_specs as specification
where competition.league_season_id = context.league_season_id
  and competition.slug = specification.slug;

insert into public.competitions (
  league_season_id,
  name,
  slug,
  description,
  status,
  entry_format,
  team_size,
  scoring_method,
  maximum_score_per_round,
  shots_per_round,
  uses_x_score,
  number_of_rounds,
  entry_fee,
  created_by,
  updated_by,
  entry_window_mode,
  custom_entry_opens_at,
  custom_entry_closes_at,
  start_date_mode,
  custom_starts_at,
  sets_per_round,
  ranking_method,
  best_rounds_count,
  local_scoring_enabled
)
select
  context.league_season_id,
  specification.name,
  specification.slug,
  'DEVELOPMENT ONLY: gun-score-manual-fixture-v1. Minimal manual Results fixture.',
  'draft',
  specification.entry_format,
  specification.team_size,
  specification.scoring_method,
  specification.maximum_score_per_round,
  specification.shots_per_round,
  specification.uses_x_score,
  3,
  0,
  context.actor_id,
  context.actor_id,
  'custom',
  current_date - 20,
  current_date - 10,
  'season_default',
  null,
  1,
  'gun_score',
  null,
  true
from gun_fixture_context as context
cross join gun_fixture_competition_specs as specification
on conflict (league_season_id, slug) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  entry_format = excluded.entry_format,
  team_size = excluded.team_size,
  scoring_method = excluded.scoring_method,
  maximum_score_per_round = excluded.maximum_score_per_round,
  shots_per_round = excluded.shots_per_round,
  uses_x_score = excluded.uses_x_score,
  number_of_rounds = excluded.number_of_rounds,
  entry_fee = excluded.entry_fee,
  updated_by = excluded.updated_by,
  entry_window_mode = excluded.entry_window_mode,
  custom_entry_opens_at = excluded.custom_entry_opens_at,
  custom_entry_closes_at = excluded.custom_entry_closes_at,
  start_date_mode = excluded.start_date_mode,
  custom_starts_at = excluded.custom_starts_at,
  sets_per_round = excluded.sets_per_round,
  ranking_method = excluded.ranking_method,
  best_rounds_count = excluded.best_rounds_count,
  local_scoring_enabled = excluded.local_scoring_enabled;

create temporary table gun_fixture_competitions on commit drop as
select competition.id, competition.slug
from gun_fixture_context as context
join public.competitions as competition
  on competition.league_season_id = context.league_season_id
join gun_fixture_competition_specs as specification
  on specification.slug = competition.slug;

-- Preserve a source if another Competition also uses it. Otherwise remove the
-- old fixture source after detaching its fixture usage; score values cascade.
create temporary table gun_fixture_old_sources on commit drop as
select distinct usage.shooting_score_source_id as id
from public.competition_score_usages as usage
join gun_fixture_competitions as competition
  on competition.id = usage.competition_id;

delete from public.competition_score_usages as usage
using gun_fixture_competitions as competition
where usage.competition_id = competition.id;

delete from public.shooting_score_sources as source
using gun_fixture_old_sources as old_source
where source.id = old_source.id
  and not exists (
    select 1
    from public.competition_score_usages as usage
    where usage.shooting_score_source_id = source.id
  );

delete from public.competition_division_configs as config
using gun_fixture_competitions as competition
where config.competition_id = competition.id;

delete from public.club_competition_entries as entry
using gun_fixture_competitions as competition
where entry.competition_id = competition.id;

delete from public.competition_rounds as round
using gun_fixture_competitions as competition
where round.competition_id = competition.id;

delete from public.competition_score_components as component
using gun_fixture_competitions as competition
where component.competition_id = competition.id;

insert into public.competition_score_components (
  competition_id,
  position,
  short_label,
  maximum_score,
  score_method
)
select
  competition.id,
  1,
  'Score',
  100,
  specification.scoring_method
from gun_fixture_competitions as competition
join gun_fixture_competition_specs as specification using (slug);

insert into public.competition_rounds (
  competition_id,
  round_number,
  deadline,
  shoot_by_date
)
select
  competition.id,
  schedule.round_number,
  current_date + schedule.day_offset,
  current_date + schedule.shoot_by_offset
from gun_fixture_competitions as competition
cross join (
  values
    (1, -4, -5),
    (2, -2, -3),
    (3, 14, 10)
) as schedule(round_number, day_offset, shoot_by_offset);

update public.competitions as competition
set status = 'published'
from gun_fixture_competitions as fixture
where competition.id = fixture.id;

insert into public.club_competition_entries (
  competition_id,
  club_id,
  status,
  submitted_at,
  created_by,
  updated_by
)
select
  competition.id,
  context.club_id,
  'submitted',
  now(),
  context.actor_id,
  context.actor_id
from gun_fixture_competitions as competition
cross join gun_fixture_context as context;

create temporary table gun_fixture_entries on commit drop as
select entry.id, competition.slug
from public.club_competition_entries as entry
join gun_fixture_competitions as competition
  on competition.id = entry.competition_id;

insert into public.competition_entrants (
  club_competition_entry_id,
  position
)
select entry.id, entrant.position
from gun_fixture_entries as entry
join gun_fixture_competition_specs as specification using (slug)
cross join lateral generate_series(1, specification.entrant_count)
  as entrant(position)
order by entry.slug, entrant.position;

create temporary table gun_fixture_participant_specs (
  slug text not null,
  entrant_position integer not null,
  slot_number integer not null,
  user_number integer not null,
  primary key (slug, entrant_position, slot_number)
) on commit drop;

insert into gun_fixture_participant_specs values
  ('dev-gun-score-individual', 1, 1, 1),
  ('dev-gun-score-individual', 2, 1, 2),
  ('dev-gun-score-individual', 3, 1, 3),
  ('dev-gun-score-individual', 4, 1, 4),
  ('dev-gun-score-pairs-dropped', 1, 1, 1),
  ('dev-gun-score-pairs-dropped', 1, 2, 2),
  ('dev-gun-score-pairs-dropped', 2, 1, 3),
  ('dev-gun-score-pairs-dropped', 2, 2, 4),
  ('dev-gun-score-pairs-dropped', 3, 1, 5),
  ('dev-gun-score-pairs-dropped', 3, 2, 6);

insert into public.competition_entrant_participants (
  club_competition_entry_id,
  competition_entrant_id,
  club_membership_id,
  slot_number
)
select
  entry.id,
  entrant.id,
  fixture_user.club_membership_id,
  specification.slot_number
from gun_fixture_participant_specs as specification
join gun_fixture_entries as entry using (slug)
join public.competition_entrants as entrant
  on entrant.club_competition_entry_id = entry.id
 and entrant.position = specification.entrant_position
join gun_fixture_users as fixture_user
  on fixture_user.user_number = specification.user_number;

insert into public.competition_division_configs (
  competition_id,
  target_size,
  status,
  published_at,
  created_by,
  updated_by
)
select
  competition.id,
  specification.entrant_count,
  'published',
  now(),
  context.actor_id,
  context.actor_id
from gun_fixture_competitions as competition
join gun_fixture_competition_specs as specification using (slug)
cross join gun_fixture_context as context;

insert into public.competition_divisions (
  competition_id,
  name,
  position
)
select id, 'Manual Test Division', 1
from gun_fixture_competitions;

insert into public.competition_division_assignments (
  competition_entrant_id,
  competition_id,
  competition_division_id
)
select entrant.id, competition.id, division.id
from gun_fixture_competitions as competition
join gun_fixture_entries as entry using (slug)
join public.competition_entrants as entrant
  on entrant.club_competition_entry_id = entry.id
join public.competition_divisions as division
  on division.competition_id = competition.id;

-- Every number below is canonical achieved score. For the points-dropped
-- Competition, Results derive dropped points as 100 - achieved per shooter.
-- A NULL achieved score creates a real source/usage with no value row: NSR,
-- never a fabricated zero.
create temporary table gun_fixture_score_specs (
  slug text not null,
  round_number integer not null,
  entrant_position integer not null,
  slot_number integer not null,
  achieved_score numeric(10, 2),
  x_count integer,
  primary key (slug, round_number, entrant_position, slot_number)
) on commit drop;

insert into gun_fixture_score_specs values
  -- Individual released totals: George 197/10X, Sophie 196/12X,
  -- Harry 196/9X, Isla 195/6X. Round 3 is entered early but unreleased.
  ('dev-gun-score-individual', 1, 1, 1, 99, 5),
  ('dev-gun-score-individual', 2, 1, 1, 98, 5),
  ('dev-gun-score-individual', 3, 1, 1, 100, 9),
  ('dev-gun-score-individual', 1, 2, 1, 98, 6),
  ('dev-gun-score-individual', 2, 2, 1, 98, 6),
  ('dev-gun-score-individual', 3, 2, 1, 99, 8),
  ('dev-gun-score-individual', 1, 3, 1, 98, 4),
  ('dev-gun-score-individual', 2, 3, 1, 98, 5),
  ('dev-gun-score-individual', 3, 3, 1, 98, 7),
  ('dev-gun-score-individual', 1, 4, 1, 98, 3),
  ('dev-gun-score-individual', 2, 4, 1, 97, 3),
  ('dev-gun-score-individual', 3, 4, 1, 97, 6),

  -- Pair 1: 3 + 4 = 7 dropped. Pair 2: 3 + 5 = 8 dropped.
  -- Pair 3 has 20 dropped from Round 1; Emily has an incomplete Round 2.
  ('dev-gun-score-pairs-dropped', 1, 1, 1, 99, null),
  ('dev-gun-score-pairs-dropped', 1, 1, 2, 98, null),
  ('dev-gun-score-pairs-dropped', 2, 1, 1, 98, null),
  ('dev-gun-score-pairs-dropped', 2, 1, 2, 98, null),
  ('dev-gun-score-pairs-dropped', 3, 1, 1, 95, null),
  ('dev-gun-score-pairs-dropped', 3, 1, 2, 95, null),
  ('dev-gun-score-pairs-dropped', 1, 2, 1, 99, null),
  ('dev-gun-score-pairs-dropped', 1, 2, 2, 98, null),
  ('dev-gun-score-pairs-dropped', 2, 2, 1, 97, null),
  ('dev-gun-score-pairs-dropped', 2, 2, 2, 98, null),
  ('dev-gun-score-pairs-dropped', 3, 2, 1, 94, null),
  ('dev-gun-score-pairs-dropped', 3, 2, 2, 94, null),
  ('dev-gun-score-pairs-dropped', 1, 3, 1, 90, null),
  ('dev-gun-score-pairs-dropped', 1, 3, 2, 90, null),
  ('dev-gun-score-pairs-dropped', 2, 3, 1, 90, null),
  ('dev-gun-score-pairs-dropped', 2, 3, 2, null, null),
  ('dev-gun-score-pairs-dropped', 3, 3, 1, 93, null),
  ('dev-gun-score-pairs-dropped', 3, 3, 2, 93, null);

do $$
declare
  score_specification record;
  source_id bigint;
  actor_id uuid := (select context.actor_id from gun_fixture_context as context);
begin
  for score_specification in
    select
      specification.*,
      competition.id as competition_id,
      round.id as competition_round_id,
      participant.id as participant_id,
      membership.user_id as shooter_profile_id
    from gun_fixture_score_specs as specification
    join gun_fixture_competitions as competition using (slug)
    join gun_fixture_entries as entry using (slug)
    join public.competition_entrants as entrant
      on entrant.club_competition_entry_id = entry.id
     and entrant.position = specification.entrant_position
    join public.competition_entrant_participants as participant
      on participant.competition_entrant_id = entrant.id
     and participant.slot_number = specification.slot_number
    join public.club_memberships as membership
      on membership.id = participant.club_membership_id
    join public.competition_rounds as round
      on round.competition_id = competition.id
     and round.round_number = specification.round_number
    order by specification.slug,
      specification.round_number,
      specification.entrant_position,
      specification.slot_number
  loop
    insert into public.shooting_score_sources (
      shooter_profile_id,
      created_by,
      updated_by
    )
    values (
      score_specification.shooter_profile_id,
      actor_id,
      actor_id
    )
    returning id into source_id;

    insert into public.competition_score_usages (
      shooting_score_source_id,
      competition_id,
      competition_round_id,
      competition_entrant_participant_id,
      created_by,
      updated_by
    )
    values (
      source_id,
      score_specification.competition_id,
      score_specification.competition_round_id,
      score_specification.participant_id,
      actor_id,
      actor_id
    );

    if score_specification.achieved_score is not null then
      insert into public.shooting_score_values (
        shooting_score_source_id,
        set_number,
        component_position,
        achieved_score,
        x_count,
        created_by,
        updated_by
      )
      values (
        source_id,
        1,
        1,
        score_specification.achieved_score,
        score_specification.x_count,
        actor_id,
        actor_id
      );
    end if;
  end loop;
end;
$$;

-- Fail atomically if the public read model does not expose the intended test
-- cases. This also verifies that the future source values do not leak.
do $$
declare
  context_record record := (select context from gun_fixture_context as context);
  individual_result jsonb;
  pairs_result jsonb;
  individual_totals numeric[];
  individual_x_totals numeric[];
  pairs_totals numeric[];
  pair_three_round_two_state text;
  pair_three_round_two_total numeric;
begin
  select public.get_competition_gun_score_results(
    context_record.organisation_id,
    context_record.league_season_id,
    competition.id
  )
  into individual_result
  from gun_fixture_competitions as competition
  where competition.slug = 'dev-gun-score-individual';

  select public.get_competition_gun_score_results(
    context_record.organisation_id,
    context_record.league_season_id,
    competition.id
  )
  into pairs_result
  from gun_fixture_competitions as competition
  where competition.slug = 'dev-gun-score-pairs-dropped';

  select
    array_agg((entrant.value ->> 'gun_total')::numeric order by entrant.ordinality),
    array_agg((entrant.value ->> 'x_total')::numeric order by entrant.ordinality)
  into individual_totals, individual_x_totals
  from jsonb_array_elements(
    individual_result #> '{groups,0,entrants}'
  ) with ordinality as entrant(value, ordinality);

  select array_agg(
    (entrant.value ->> 'gun_total')::numeric order by entrant.ordinality
  )
  into pairs_totals
  from jsonb_array_elements(
    pairs_result #> '{groups,0,entrants}'
  ) with ordinality as entrant(value, ordinality);

  select
    entrant.value #>> '{rounds,1,state}',
    (entrant.value ->> 'gun_total')::numeric
  into pair_three_round_two_state, pair_three_round_two_total
  from jsonb_array_elements(
    pairs_result #> '{groups,0,entrants}'
  ) as entrant(value)
  where entrant.value ->> 'entrant_label' = 'Pair 3';

  if individual_result ->> 'status' <> 'ready'
    or (individual_result ->> 'released_round_count')::integer <> 2
    or individual_totals <> array[197, 196, 196, 195]::numeric[]
    or individual_x_totals <> array[10, 12, 9, 6]::numeric[]
  then
    raise exception 'Individual Gun Score fixture verification failed: %',
      individual_result;
  end if;

  if pairs_result ->> 'status' <> 'ready'
    or (pairs_result ->> 'released_round_count')::integer <> 2
    or pairs_totals <> array[7, 8, 20]::numeric[]
    or pair_three_round_two_state <> 'nsr'
    or pair_three_round_two_total <> 20
  then
    raise exception 'Pairs Gun Score fixture verification failed: %',
      pairs_result;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(
      individual_result #> '{groups,0,entrants}'
    ) as entrant(value)
    where entrant.value #>> '{rounds,2,state}' <> 'pending'
       or entrant.value #> '{rounds,2,gun_score}' <> 'null'::jsonb
  ) or exists (
    select 1
    from jsonb_array_elements(
      pairs_result #> '{groups,0,entrants}'
    ) as entrant(value)
    where entrant.value #>> '{rounds,2,state}' <> 'pending'
       or entrant.value #> '{rounds,2,gun_score}' <> 'null'::jsonb
  ) then
    raise exception 'A future fixture score leaked through public Results.';
  end if;
end;
$$;

commit;

select
  competition.name,
  case competition.slug
    when 'dev-gun-score-individual' then
      'George Foster 197/10X; Sophie Turner 196/12X; Harry Collins 196/9X; Isla Morgan 195/6X'
    else
      'Pair 1 (George/Sophie) 7 dropped; Pair 2 (Harry/Isla) 8 dropped; Pair 3 (Jack/Emily) 20 dropped plus Round 2 NSR'
  end as expected_released_standings,
  '/organisations/eastern-region-shooting-association/leagues/eastern-summer-league/competitions/'
    || competition.slug || '#results' as manual_results_path
from public.competitions as competition
join public.league_seasons as season
  on season.id = competition.league_season_id
where season.slug = 'eastern-summer-league'
  and competition.slug in (
    'dev-gun-score-individual',
    'dev-gun-score-pairs-dropped'
  )
order by competition.slug;
