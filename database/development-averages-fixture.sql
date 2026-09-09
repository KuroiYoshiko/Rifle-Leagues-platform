-- DEVELOPMENT ONLY. Rerunnable Starting Average + division manual-smoke fixture.
-- Run after development-demo-seed.sql and Competition Averages Stage 2B.
-- Reserved records use the marker below; only their operational children reset.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table average_fixture_session(previous_actor text) on commit drop;
insert into average_fixture_session values (current_setting('request.jwt.claim.sub',true));
create temporary table average_fixture_ids(key text primary key,id bigint not null) on commit drop;
create temporary table average_fixture_people(
  key text primary key,user_id uuid not null,membership_id bigint not null
) on commit drop;

do $$
declare
  v_missing text;
  v_marker constant text := 'DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
begin
  select string_agg(required.name,', ' order by required.name) into v_missing
  from (values ('public.average_contexts'),('public.average_policy_versions'),
    ('public.competition_average_settings'),('public.competition_participant_starting_averages'),
    ('public.competition_starting_average_finalisations'),('public.competition_division_configs'),
    ('public.shooting_score_sources'),('public.shooting_score_values'),
    ('public.competition_score_usages')) required(name)
  where to_regclass(required.name) is null;
  if v_missing is not null then
    raise exception 'Average fixture prerequisites are missing: %. Deploy Stage 2B first.',v_missing;
  end if;
  if to_regprocedure('public.save_competition_division_draft(bigint,bigint,bigint,integer,jsonb)') is null
    or to_regprocedure('public.calculate_competition_starting_averages(bigint,bigint,bigint)') is null
    or to_regprocedure('public.publish_competition_divisions(bigint,bigint,bigint)') is null then
    raise exception 'Average fixture requires the deployed Competition Average and division RPCs.';
  end if;
  if exists (
    select 1 from public.league_seasons season
    join public.organisations organisation on organisation.id=season.organisation_id
    where season.slug in ('average-test-preceding-season','average-test-latest-season','average-test-target-season')
      and (organisation.slug<>'eastern-region-shooting-association' or season.description is distinct from v_marker)
  ) then raise exception 'A reserved Average fixture Season slug is occupied by an unmarked record.'; end if;
  if exists (
    select 1 from public.competitions competition
    where competition.slug in ('average-test-preceding','average-test-latest',
      'average-test-individual-target','average-test-pairs-target')
      and competition.description is distinct from v_marker
  ) then raise exception 'A reserved Average fixture Competition slug is occupied by an unmarked record.'; end if;
end $$;

do $$
declare
  v_organisation_id bigint; v_owner_id uuid; v_club_id bigint;
  v_context_id bigint; v_policy_id bigint; v_policy_version_id bigint; v_series_id bigint;
  v_marker constant text := 'DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
begin
  select id into v_organisation_id from public.organisations
  where slug='eastern-region-shooting-association' and status='active';
  select users.id into v_owner_id from auth.users users
  join public.organisation_staff staff on staff.user_id=users.id
  where lower(users.email)='basildon.demo01@example.com'
    and staff.organisation_id=v_organisation_id and staff.role='owner' and staff.status='active';
  select id into v_club_id from public.clubs
  where slug='basildon-rifle-and-pistol-club' and status='active';
  if v_organisation_id is null or v_owner_id is null or v_club_id is null then
    raise exception 'Run database/development-demo-seed.sql before the Average development fixture.';
  end if;
  insert into average_fixture_ids values ('organisation',v_organisation_id),('club',v_club_id);
  insert into average_fixture_people
  select requested.key,users.id,membership.id
  from (values ('latest','basildon.demo04@example.com'),('preceding','basildon.demo05@example.com'),
    ('manual','basildon.demo06@example.com'),('pair_latest','basildon.demo07@example.com')) requested(key,email)
  join auth.users users on lower(users.email)=requested.email
  join public.club_memberships membership on membership.user_id=users.id
    and membership.club_id=v_club_id and membership.status='active';
  if (select count(*) from average_fixture_people)<>4 then
    raise exception 'The Average fixture requires active Basildon demo04 through demo07 memberships.';
  end if;

  select id into v_context_id from public.average_contexts
  where organisation_id=v_organisation_id and lower(name)=lower('Average Test Context');
  if v_context_id is null then
    insert into public.average_contexts(organisation_id,name,basis_maximum,created_by,updated_by)
    values(v_organisation_id,'Average Test Context',100,v_owner_id,v_owner_id) returning id into v_context_id;
  elsif not exists(select 1 from public.average_contexts where id=v_context_id and basis_maximum=100) then
    raise exception 'Average Test Context already exists with a basis other than Ex100.';
  else update public.average_contexts set archived_at=null,updated_by=v_owner_id where id=v_context_id;
  end if;
  select id into v_policy_id from public.average_policies
  where organisation_id=v_organisation_id and lower(name)=lower('Average Test Policy');
  if v_policy_id is null then
    insert into public.average_policies(organisation_id,name,created_by,updated_by)
    values(v_organisation_id,'Average Test Policy',v_owner_id,v_owner_id) returning id into v_policy_id;
  else update public.average_policies set archived_at=null,updated_by=v_owner_id where id=v_policy_id; end if;
  select id into v_policy_version_id from public.average_policy_versions
  where average_policy_id=v_policy_id and version_number=1;
  if v_policy_version_id is null then
    insert into public.average_policy_versions(average_policy_id,version_number,strategy,configuration,created_by)
    values(v_policy_id,1,'current_then_preceding',
      '{"minimum_current_scores":2,"minimum_preceding_scores":2,"fallback":"manual"}',v_owner_id)
    returning id into v_policy_version_id;
  elsif not exists(select 1 from public.average_policy_versions where id=v_policy_version_id
    and strategy='current_then_preceding'
    and configuration='{"minimum_current_scores":2,"minimum_preceding_scores":2,"fallback":"manual"}'::jsonb) then
    raise exception 'Average Test Policy version 1 is not the fixture definition.';
  end if;
  insert into average_fixture_ids values ('context',v_context_id),('policy',v_policy_id),('policy_version',v_policy_version_id);

  insert into public.league_seasons(organisation_id,name,description,slug,status,
    entry_opens_at,entry_closes_at,starts_at,ends_at,created_by,updated_by)
  values
    (v_organisation_id,'Average Test · Preceding',v_marker,'average-test-preceding-season','completed',
      current_date-300,current_date-290,current_date-280,current_date-220,v_owner_id,v_owner_id),
    (v_organisation_id,'Average Test · Latest',v_marker,'average-test-latest-season','completed',
      current_date-170,current_date-160,current_date-150,current_date-80,v_owner_id,v_owner_id),
    (v_organisation_id,'Average Test · Target',v_marker,'average-test-target-season','open',
      current_date-10,current_date-1,current_date+14,current_date+90,v_owner_id,v_owner_id)
  on conflict(organisation_id,slug) do nothing;
  insert into average_fixture_ids
  select case slug when 'average-test-preceding-season' then 'preceding_season'
    when 'average-test-latest-season' then 'latest_season' else 'target_season' end,id
  from public.league_seasons where organisation_id=v_organisation_id
    and slug in ('average-test-preceding-season','average-test-latest-season','average-test-target-season');

  select id into v_series_id from public.competition_series
  where organisation_id=v_organisation_id and slug='average-test-series';
  if v_series_id is null then
    insert into public.competition_series(organisation_id,name,slug,entry_format,team_size,
      discipline_code,sets_per_round,shots_per_round,created_by,updated_by)
    values(v_organisation_id,'Average Test Series','average-test-series','individual',1,
      'rifle_prone',1,10,v_owner_id,v_owner_id) returning id into v_series_id;
    insert into public.competition_series_score_components(
      competition_series_id,position,short_label,maximum_score,score_method)
    values(v_series_id,1,'Ex100',100,'points_dropped');
  else update public.competition_series set archived_at=null,updated_by=v_owner_id where id=v_series_id; end if;
  insert into average_fixture_ids values ('series',v_series_id);
end $$;

create temporary table average_fixture_old_sources(id bigint primary key) on commit drop;
insert into average_fixture_old_sources
select distinct usage.shooting_score_source_id from public.competition_score_usages usage
join public.competitions competition on competition.id=usage.competition_id
where competition.description='DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
delete from public.competition_starting_average_finalisations f using public.competitions c
where c.id=f.competition_id and c.description='DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
delete from public.competition_participant_starting_averages a using public.competitions c
where c.id=a.competition_id and c.description='DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
delete from public.competition_division_configs d using public.competitions c
where c.id=d.competition_id and c.description='DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
delete from public.competition_score_usages u using public.competitions c
where c.id=u.competition_id and c.description='DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
delete from public.club_competition_entries e using public.competitions c
where c.id=e.competition_id and c.description='DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
delete from public.shooting_score_sources s using average_fixture_old_sources old
where s.id=old.id and not exists(select 1 from public.competition_score_usages u where u.shooting_score_source_id=s.id);

do $$
declare
  v_owner_id uuid; v_series_id bigint:=(select id from average_fixture_ids where key='series');
  v_marker constant text:='DEVELOPMENT ONLY: competition-averages-manual-fixture-v1';
  v_competition_id bigint; v_spec record;
begin
  select id into v_owner_id from auth.users where lower(email)='basildon.demo01@example.com';
  for v_spec in select * from (values
    ('preceding','preceding_season','Average Test · Preceding Competition','average-test-preceding','individual',1,v_series_id),
    ('latest','latest_season','Average Test · Latest Competition','average-test-latest','individual',1,v_series_id),
    ('individual_target','target_season','Average Test · Individual Target','average-test-individual-target','individual',1,v_series_id),
    ('pairs_target','target_season','Average Test · Pairs Target','average-test-pairs-target','pairs',2,null::bigint)
  ) spec(key,season_key,name,slug,entry_format,team_size,series_id) loop
    select id into v_competition_id from public.competitions
    where league_season_id=(select id from average_fixture_ids where key=v_spec.season_key) and slug=v_spec.slug;
    if v_competition_id is null then
      insert into public.competitions(league_season_id,competition_series_id,name,slug,description,status,
        entry_format,team_size,scoring_method,maximum_score_per_round,shots_per_round,uses_x_score,
        number_of_rounds,entry_fee,entry_window_mode,start_date_mode,sets_per_round,ranking_method,
        best_rounds_count,local_scoring_enabled,discipline_code,created_by,updated_by)
      values((select id from average_fixture_ids where key=v_spec.season_key),v_spec.series_id,v_spec.name,
        v_spec.slug,v_marker,'draft',v_spec.entry_format,v_spec.team_size,'points_dropped',100,10,false,
        3,0,'season_default','season_default',1,'aggregate',null,true,'rifle_prone',v_owner_id,v_owner_id)
      returning id into v_competition_id;
      insert into public.competition_score_components(competition_id,position,short_label,maximum_score,score_method)
      values(v_competition_id,1,'Ex100',100,'points_dropped');
      insert into public.competition_rounds(competition_id,round_number,deadline)
      select v_competition_id,n,season.starts_at+(n*14) from generate_series(1,3) n
      join public.league_seasons season on season.id=(select id from average_fixture_ids where key=v_spec.season_key);
      update public.competitions set status='published' where id=v_competition_id;
    end if;
    insert into average_fixture_ids values(v_spec.key||'_competition',v_competition_id);
  end loop;
  if exists(select 1 from (values
    ('preceding_competition','individual',1,v_series_id),('latest_competition','individual',1,v_series_id),
    ('individual_target_competition','individual',1,v_series_id),('pairs_target_competition','pairs',2,null::bigint)
  ) expected(key,entry_format,team_size,series_id)
  join average_fixture_ids fixture on fixture.key=expected.key
  join public.competitions competition on competition.id=fixture.id
  where competition.description is distinct from v_marker or competition.status<>'published'
    or competition.entry_format<>expected.entry_format or competition.team_size<>expected.team_size
    or competition.competition_series_id is distinct from expected.series_id
    or private.competition_average_shooter_maximum(competition.id)<>100) then
    raise exception 'An existing Average fixture Competition no longer matches its reserved definition.';
  end if;
end $$;

insert into public.competition_average_settings(competition_id,average_context_id,
  average_policy_version_id,contributes_to_history,created_by,updated_by)
select competition.id,context.id,policy.id,
  competition.key in ('preceding_competition','latest_competition'),owner_user.id,owner_user.id
from average_fixture_ids competition
cross join lateral(select id from average_fixture_ids where key='context') context
cross join lateral(select id from average_fixture_ids where key='policy_version') policy
cross join lateral(select id from auth.users where lower(email)='basildon.demo01@example.com') owner_user
where competition.key in ('preceding_competition','latest_competition',
  'individual_target_competition','pairs_target_competition')
on conflict(competition_id) do update set average_context_id=excluded.average_context_id,
  average_policy_version_id=excluded.average_policy_version_id,
  contributes_to_history=excluded.contributes_to_history,updated_by=excluded.updated_by;

create temporary table average_fixture_entry_specs(
  competition_key text,entrant_position integer,slot_number integer,person_key text,
  primary key(competition_key,entrant_position,slot_number)
) on commit drop;
insert into average_fixture_entry_specs values
  ('preceding_competition',1,1,'latest'),('preceding_competition',2,1,'preceding'),
  ('preceding_competition',3,1,'manual'),('preceding_competition',4,1,'pair_latest'),
  ('latest_competition',1,1,'latest'),('latest_competition',2,1,'preceding'),
  ('latest_competition',3,1,'manual'),('latest_competition',4,1,'pair_latest'),
  ('individual_target_competition',1,1,'latest'),('individual_target_competition',2,1,'preceding'),
  ('individual_target_competition',3,1,'manual'),('pairs_target_competition',1,1,'latest'),
  ('pairs_target_competition',1,2,'preceding'),('pairs_target_competition',2,1,'pair_latest'),
  ('pairs_target_competition',2,2,'manual');
create temporary table average_fixture_entries(competition_key text primary key,entry_id bigint) on commit drop;
insert into public.club_competition_entries(competition_id,club_id,status,submitted_at,created_by,updated_by)
select competition.id,club.id,'submitted',clock_timestamp(),owner_user.id,owner_user.id
from (select distinct competition_key from average_fixture_entry_specs) spec
join average_fixture_ids competition on competition.key=spec.competition_key
cross join lateral(select id from average_fixture_ids where key='club') club
cross join lateral(select id from auth.users where lower(email)='basildon.demo01@example.com') owner_user;
insert into average_fixture_entries
select spec.competition_key,entry.id from (select distinct competition_key from average_fixture_entry_specs) spec
join average_fixture_ids competition on competition.key=spec.competition_key
join public.club_competition_entries entry on entry.competition_id=competition.id
join average_fixture_ids club on club.key='club' and club.id=entry.club_id;
insert into public.competition_entrants(club_competition_entry_id,position)
select entry.entry_id,spec.entrant_position from
  (select distinct competition_key,entrant_position from average_fixture_entry_specs) spec
join average_fixture_entries entry on entry.competition_key=spec.competition_key;
insert into public.competition_entrant_participants(club_competition_entry_id,
  competition_entrant_id,club_membership_id,slot_number)
select entry.entry_id,entrant.id,person.membership_id,spec.slot_number
from average_fixture_entry_specs spec
join average_fixture_entries entry on entry.competition_key=spec.competition_key
join public.competition_entrants entrant on entrant.club_competition_entry_id=entry.entry_id
  and entrant.position=spec.entrant_position
join average_fixture_people person on person.key=spec.person_key;

do $$
declare v_owner_id uuid; v_score record; v_source_id bigint; v_round_id bigint; v_participant_id bigint;
begin
  select id into v_owner_id from auth.users where lower(email)='basildon.demo01@example.com';
  for v_score in select * from (values
    ('preceding_competition','latest',1,97.00::numeric),('preceding_competition','latest',2,97.00::numeric),
    ('preceding_competition','preceding',1,94.00::numeric),('preceding_competition','preceding',2,96.00::numeric),
    ('preceding_competition','pair_latest',1,90.00::numeric),('preceding_competition','pair_latest',2,92.00::numeric),
    ('latest_competition','latest',1,98.50::numeric),('latest_competition','latest',2,97.50::numeric),
    ('latest_competition','preceding',1,99.00::numeric),
    ('latest_competition','pair_latest',1,92.00::numeric),('latest_competition','pair_latest',2,94.00::numeric)
  ) score(competition_key,person_key,round_number,achieved_score) loop
    select round.id,participant.id into v_round_id,v_participant_id
    from average_fixture_ids competition
    join public.competition_rounds round on round.competition_id=competition.id and round.round_number=v_score.round_number
    join average_fixture_entries entry on entry.competition_key=v_score.competition_key
    join public.competition_entrant_participants participant on participant.club_competition_entry_id=entry.entry_id
    join average_fixture_people person on person.key=v_score.person_key and person.membership_id=participant.club_membership_id
    where competition.key=v_score.competition_key;
    insert into public.shooting_score_sources(shooter_profile_id,created_by,updated_by)
    select user_id,v_owner_id,v_owner_id from average_fixture_people where key=v_score.person_key
    returning id into v_source_id;
    insert into public.competition_score_usages(shooting_score_source_id,competition_id,
      competition_round_id,competition_entrant_participant_id,created_by,updated_by)
    values(v_source_id,(select id from average_fixture_ids where key=v_score.competition_key),
      v_round_id,v_participant_id,v_owner_id,v_owner_id);
    -- Points-dropped input is represented by its already-converted achieved value.
    insert into public.shooting_score_values(shooting_score_source_id,set_number,
      component_position,achieved_score,x_count,created_by,updated_by)
    values(v_source_id,1,1,v_score.achieved_score,null,v_owner_id,v_owner_id);
  end loop;
end $$;

-- Save unreviewed drafts through the production RPC. S/Av rows remain absent
-- until staff press Calculate in the UI.
grant select on average_fixture_ids,average_fixture_entries to authenticated;
select set_config('request.jwt.claim.sub',(select id::text from auth.users
  where lower(email)='basildon.demo01@example.com'),true);
set local role authenticated;
select public.save_competition_division_draft(
  (select id from average_fixture_ids where key='organisation'),
  (select id from average_fixture_ids where key='target_season'),
  (select id from average_fixture_ids where key='individual_target_competition'),2,
  jsonb_build_array(
    jsonb_build_object('name','Division 1','entrant_ids',jsonb_build_array(
      (select entrant.id from average_fixture_entries entry join public.competition_entrants entrant
       on entrant.club_competition_entry_id=entry.entry_id where entry.competition_key='individual_target_competition' and entrant.position=1),
      (select entrant.id from average_fixture_entries entry join public.competition_entrants entrant
       on entrant.club_competition_entry_id=entry.entry_id where entry.competition_key='individual_target_competition' and entrant.position=3))),
    jsonb_build_object('name','Division 2','entrant_ids',jsonb_build_array(
      (select entrant.id from average_fixture_entries entry join public.competition_entrants entrant
       on entrant.club_competition_entry_id=entry.entry_id where entry.competition_key='individual_target_competition' and entrant.position=2)))));
select public.save_competition_division_draft(
  (select id from average_fixture_ids where key='organisation'),
  (select id from average_fixture_ids where key='target_season'),
  (select id from average_fixture_ids where key='pairs_target_competition'),1,
  jsonb_build_array(
    jsonb_build_object('name','Division 1','entrant_ids',jsonb_build_array(
      (select entrant.id from average_fixture_entries entry join public.competition_entrants entrant
       on entrant.club_competition_entry_id=entry.entry_id where entry.competition_key='pairs_target_competition' and entrant.position=1))),
    jsonb_build_object('name','Division 2','entrant_ids',jsonb_build_array(
      (select entrant.id from average_fixture_entries entry join public.competition_entrants entrant
       on entrant.club_competition_entry_id=entry.entry_id where entry.competition_key='pairs_target_competition' and entrant.position=2)))));
reset role;
select set_config('request.jwt.claim.sub',coalesce((select previous_actor from average_fixture_session),''),true);
set constraints all immediate;

-- SQL Editor confirmation only; resolving these previews does not create snapshots.
select profile.first_name||' '||profile.last_name shooter,decision.policy_branch expected_branch,
  decision.starting_average expected_starting_average,
  decision.qualifying_score_count expected_scores_used,source.name expected_source
from average_fixture_people person join public.profiles profile on profile.id=person.user_id
cross join lateral private.resolve_competition_starting_average(
  (select id from average_fixture_ids where key='individual_target_competition'),person.user_id) decision
left join public.competitions source on source.id=decision.source_competition_id
where person.key in ('latest','preceding','manual')
order by case person.key when 'latest' then 1 when 'preceding' then 2 else 3 end;
select
  '/organisations/eastern-region-shooting-association/leagues/average-test-target-season/competitions/average-test-individual-target/averages' individual_starting_averages_route,
  '/organisations/eastern-region-shooting-association/leagues/average-test-target-season/competitions/average-test-individual-target/divisions' individual_divisions_route,
  '/organisations/eastern-region-shooting-association/leagues/average-test-target-season/competitions/average-test-pairs-target/averages' pairs_starting_averages_route,
  '/organisations/eastern-region-shooting-association/leagues/average-test-target-season/competitions/average-test-pairs-target/divisions' pairs_divisions_route;
commit;

-- Login: basildon.demo01@example.com or basildon.demo02@example.com
-- Password from development-demo-seed.sql: RifleLeagues-Demo-2026!
