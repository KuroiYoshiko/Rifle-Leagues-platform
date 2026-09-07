-- DEVELOPMENT ONLY. Run after competition-round-robin.sql and
-- competition-round-robin-results.sql. Uses existing development memberships;
-- never creates Auth users, resets the database, or changes other competitions.
-- Run the WHOLE file in the Supabase SQL Editor as the database owner.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table rr_context on commit drop as
select o.id organisation_id,s.id season_id,
  '10000000-0000-4000-8000-000000000001'::uuid actor_id,
  current_setting('request.jwt.claim.sub',true) previous_actor
from public.organisations o join public.league_seasons s on s.organisation_id=o.id
where o.slug='eastern-region-shooting-association' and o.status='active'
  and s.slug='eastern-summer-league' and s.status in ('open','active')
  and (s.starts_at is null or s.starts_at <= current_date-10)
  and (s.ends_at is null or s.ends_at >= current_date+14);
do $$ begin
  if (select count(*) from rr_context)<>1 or not exists (
    select 1 from rr_context c join public.organisation_staff s on s.organisation_id=c.organisation_id
    where s.user_id=c.actor_id and s.status='active' and s.role in ('owner','manager')) then
    raise exception 'Expected Eastern Summer League containing today-10 through today+14 and existing Eleanor Hughes organisation management access.';
  end if;
  if to_regprocedure('public.get_competition_round_robin_results(bigint,bigint,bigint)') is null then
    raise exception 'Deploy Round Robin schema and Results SQL first.';
  end if;
end $$;

create temporary table rr_members on commit drop as
select row_number() over(order by m.user_id)::integer member_number,m.id membership_id,m.club_id,m.user_id
from public.club_memberships m join public.clubs c on c.id=m.club_id
where m.status='active' and c.status='active' and (
  (c.slug='basildon-rifle-and-pistol-club' and m.user_id between '10000000-0000-4000-8000-000000000004'::uuid and '10000000-0000-4000-8000-000000000009'::uuid)
  or (c.slug='northbridge-target-shooting-club' and m.user_id between '20000000-0000-4000-8000-000000000004'::uuid and '20000000-0000-4000-8000-000000000007'::uuid));
do $$ begin
  if (select count(*) from rr_members)<>10 then raise exception 'Expected six existing Basildon and four Northbridge development memberships. No users are created by this fixture.'; end if;
end $$;

create temporary table rr_specs(slug text primary key,name text,format text,size integer,entrant_count integer,round_count integer,mode text,x boolean) on commit drop;
insert into rr_specs values
  ('dev-round-robin-individual','DEV Round Robin Individual','individual',1,4,3,'points_scored',true),
  ('dev-round-robin-bye-test','DEV Round Robin Bye Test','pairs',2,5,6,'points_dropped',false);
do $$ begin
  if exists(select 1 from public.competitions c join rr_context x on x.season_id=c.league_season_id
    join rr_specs s using(slug) where c.description is distinct from 'DEVELOPMENT ONLY: round-robin-manual-fixture-v1') then
    raise exception 'A non-fixture competition occupies a reserved Round Robin slug. Nothing changed.';
  end if;
end $$;

create temporary table rr_old_competitions on commit drop as
select c.id from public.competitions c join rr_context x on x.season_id=c.league_season_id join rr_specs s using(slug);
create temporary table rr_old_sources on commit drop as
select distinct u.shooting_score_source_id id from public.competition_score_usages u join rr_old_competitions c on c.id=u.competition_id;
-- Owner-only removal is limited to marker-protected DEV schedules. Production
-- RPCs cannot delete fixtures or bypass the live composition freeze.
delete from public.competition_round_robin_fixtures f using rr_old_competitions c where f.competition_id=c.id;
delete from public.competition_score_usages u using rr_old_competitions c where u.competition_id=c.id;
delete from public.competitions c using rr_old_competitions old_c where c.id=old_c.id;
delete from public.shooting_score_sources s using rr_old_sources old_s where s.id=old_s.id
  and not exists(select 1 from public.competition_score_usages u where u.shooting_score_source_id=s.id);

insert into public.competitions(league_season_id,name,slug,description,status,entry_format,team_size,
  scoring_method,maximum_score_per_round,shots_per_round,uses_x_score,number_of_rounds,entry_fee,
  created_by,updated_by,entry_window_mode,custom_entry_opens_at,custom_entry_closes_at,
  start_date_mode,custom_starts_at,sets_per_round,ranking_method,local_scoring_enabled)
select c.season_id,s.name,s.slug,'DEVELOPMENT ONLY: round-robin-manual-fixture-v1','draft',s.format,s.size,
  s.mode,100,10,s.x,s.round_count,0,c.actor_id,c.actor_id,'custom',current_date-30,current_date-11,
  'custom',current_date+1,1,'round_robin',true from rr_context c cross join rr_specs s;
create temporary table rr_competitions on commit drop as
select c.id,s.* from public.competitions c join rr_context x on x.season_id=c.league_season_id join rr_specs s using(slug);
insert into public.competition_score_components(competition_id,position,short_label,maximum_score,score_method)
select id,1,'Score',100,mode from rr_competitions;
-- Build a valid pre-Start schedule, publish through the real application RPC,
-- then move these DEV competitions into the past for released-results testing.
insert into public.competition_rounds(competition_id,round_number,deadline)
select c.id,r,current_date+1+r from rr_competitions c cross join lateral generate_series(1,c.round_count) r;
do $$ declare c record; ctx record; begin
  select * into ctx from rr_context;
  perform set_config('request.jwt.claim.sub',ctx.actor_id::text,true);
  for c in select * from rr_competitions loop
    perform public.publish_competition(ctx.organisation_id,ctx.season_id,c.id);
  end loop;
end $$;
create temporary table rr_units on commit drop as
select c.id competition_id,c.slug,n entrant_number,m.club_id
from rr_competitions c cross join lateral generate_series(1,c.entrant_count) n
join rr_members m on m.member_number=case when c.size=1 then n else 2*n-1 end;
insert into public.club_competition_entries(competition_id,club_id,status,submitted_at,created_by,updated_by)
select distinct u.competition_id,u.club_id,'submitted',now(),c.actor_id,c.actor_id from rr_units u cross join rr_context c;
insert into public.competition_entrants(club_competition_entry_id,position)
select e.id,u.entrant_number from rr_units u join public.club_competition_entries e
  on e.competition_id=u.competition_id and e.club_id=u.club_id order by u.competition_id,u.entrant_number;
create temporary table rr_entrants on commit drop as
select e.id,c.competition_id,e.club_competition_entry_id,e.position entrant_number
from public.competition_entrants e join public.club_competition_entries c on c.id=e.club_competition_entry_id
join rr_competitions f on f.id=c.competition_id;
insert into public.competition_entrant_participants(club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number)
select e.club_competition_entry_id,e.id,m.membership_id,slot
from rr_entrants e join rr_competitions c on c.id=e.competition_id
cross join lateral generate_series(1,c.size) slot
join rr_members m on m.member_number=case when c.size=1 then e.entrant_number else (e.entrant_number-1)*2+slot end;

do $$ declare c record; ctx record; allocation jsonb; begin
  select * into ctx from rr_context;
  perform set_config('request.jwt.claim.sub',ctx.actor_id::text,true);
  for c in select * from rr_competitions loop
    select jsonb_build_array(jsonb_build_object('name','Manual Test Division','entrant_ids',jsonb_agg(id order by id)))
      into allocation from rr_entrants where competition_id=c.id;
    perform public.save_and_publish_competition_divisions(ctx.organisation_id,ctx.season_id,c.id,c.entrant_count,allocation);
  end loop;
end $$;
update public.competitions c set custom_starts_at=current_date-10 from rr_competitions f where c.id=f.id;
update public.competition_rounds r set deadline=case when r.round_number=6 then current_date+14 else current_date-6+r.round_number end,
  shoot_by_date=case when r.round_number=6 then current_date-1 else current_date-7+r.round_number end
from rr_competitions c where r.competition_id=c.id;

create temporary table rr_scores(competition_id bigint,round_number integer,entrant_number integer,slot integer,achieved numeric,x integer) on commit drop;
insert into rr_scores
select c.id,v.r,v.e,1,v.score,v.x from rr_competitions c cross join (values
  (1,1,99,3),(1,2,98,4),(1,3,98,4),(1,4,97,2),
  (2,1,97,8),(2,2,99,4),(2,3,98,2),(2,4,96,2),
  (3,1,98,3),(3,2,97,4),(3,3,96,3),(3,4,99,2)
) v(r,e,score,x) where c.format='individual';
insert into rr_scores
select c.id,r,e,slot,case when r=6 then 100 else 100-e end,null
from rr_competitions c cross join generate_series(1,6) r cross join generate_series(1,5) e cross join generate_series(1,2) slot
where c.format='pairs' and not (r=2 and e=4 and slot=2);
-- Each real recorded participant score gets a source, usage and achieved value.
-- The missing bye participant has no manufactured source/value row.
do $$ declare s record; source_id bigint; actor uuid; begin
  select actor_id into actor from rr_context;
  for s in select v.*,p.id participant_id,m.user_id,r.id round_id from rr_scores v
    join rr_entrants e on e.competition_id=v.competition_id and e.entrant_number=v.entrant_number
    join public.competition_entrant_participants p on p.competition_entrant_id=e.id and p.slot_number=v.slot
    join public.club_memberships m on m.id=p.club_membership_id
    join public.competition_rounds r on r.competition_id=v.competition_id and r.round_number=v.round_number loop
    insert into public.shooting_score_sources(shooter_profile_id,created_by,updated_by) values(s.user_id,actor,actor) returning id into source_id;
    insert into public.competition_score_usages(shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id,created_by,updated_by)
      values(source_id,s.competition_id,s.round_id,s.participant_id,actor,actor);
    insert into public.shooting_score_values(shooting_score_source_id,set_number,component_position,achieved_score,x_count,created_by,updated_by)
      values(source_id,1,1,s.achieved,s.x,actor,actor);
  end loop;
end $$;

create temporary table rr_results on commit drop as
select c.name,c.slug,c.id,public.get_competition_round_robin_results(x.organisation_id,x.season_id,c.id) result
from rr_competitions c cross join rr_context x;
do $$ declare a jsonb; b jsonb; pts numeric[]; guns numeric[]; ids integer[]; begin
  select result into a from rr_results where slug='dev-round-robin-individual';
  select result into b from rr_results where slug='dev-round-robin-bye-test';
  select array_agg((v->>'total_match_points')::numeric order by ord),array_agg((v->>'gun_total')::numeric order by ord),
    array_agg(e.entrant_number order by ord) into pts,guns,ids
    from jsonb_array_elements(a#>'{groups,0,entrants}') with ordinality t(v,ord) join rr_entrants e on e.id=(v->>'entrant_id')::bigint;
  if pts is distinct from array[4,3,3,2]::numeric[] or guns is distinct from array[294,294,292,292]::numeric[] or ids is distinct from array[1,2,3,4]
    or a#>>'{groups,0,entrants,1,rounds,0,outcome}' is distinct from 'draw'
    or a#>>'{groups,0,entrants,0,rounds,1,outcome}' is distinct from 'loss' then raise exception 'Individual standings/draw/primary-before-X assertion failed: %',a; end if;
  select array_agg((v->>'total_match_points')::numeric order by ord),array_agg((v->>'gun_total')::numeric order by ord),
    array_agg(e.entrant_number order by ord) into pts,guns,ids
    from jsonb_array_elements(b#>'{groups,0,entrants}') with ordinality t(v,ord) join rr_entrants e on e.id=(v->>'entrant_id')::bigint;
  if pts is distinct from array[10,8,6,2,2]::numeric[] or guns is distinct from array[10,20,30,32,50]::numeric[] or ids is distinct from array[1,2,3,4,5]
    or b#>>'{groups,0,entrants,0,rounds,0,outcome}' is distinct from 'bye'
    or b#>>'{groups,0,entrants,3,rounds,1,outcome}' is distinct from 'bye_nsr'
    or b#>>'{groups,0,entrants,3,rounds,1,match_points}' is not null then raise exception 'Pair standings/bye assertion failed: %',b; end if;
  if (a->>'released_round_count')::integer<>3 or (b->>'released_round_count')::integer<>5
    or exists(select 1 from jsonb_array_elements(b#>'{groups,0,entrants}') e where e#>>'{rounds,5,outcome}' is distinct from 'pending'
      or e#>>'{rounds,5,gun_score}' is not null or e#>>'{rounds,5,match_points}' is not null)
    or exists(select 1 from jsonb_array_elements(b#>'{groups,0,entrants}') e cross join lateral jsonb_array_elements(e->'participants') p
      where p#>>'{rounds,5,gun_score}' is not null) then raise exception 'Release boundary assertion failed.'; end if;
end $$;
-- Force all canonical deferred constraints before reporting success.
set constraints all immediate;
select name as competition_name,
  case when slug='dev-round-robin-individual' then '1 George: 4 match pts / 294 gun; 2 Sophie: 3 / 294; 3 Harry: 3 / 292; 4 Isla: 2 / 292'
    else '1 Pair 1: 10 match pts / 10 dropped; 2 Pair 2: 8 / 20; 3 Pair 3: 6 / 30; 4 Pair 4: 2 / 32; 5 Pair 5: 2 / 50' end expected_standings,
  case when slug='dev-round-robin-individual' then 'R1 Sophie/Harry draw; R2 George loses despite 8 X; Sophie wins gun aggregate tie-break over Harry'
    else 'Byes R1 Pair 1, R2 Pair 4 (NSR/no points), R3 Pair 2, R4 Pair 5, R5 Pair 3; early R6 scores hidden despite past Shoot-by' end expected_notable_outcomes,
  '/organisations/eastern-region-shooting-association/leagues/eastern-summer-league/competitions/'||slug||'#results' manual_results_path
from rr_results order by slug;
select set_config('request.jwt.claim.sub',coalesce(previous_actor,''),true) from rr_context;
commit;
