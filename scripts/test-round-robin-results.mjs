import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";
import { renderAggregateResultsRoute } from "./helpers/aggregate-ui-path.mjs";

const db = new PGlite();
const actor = "10000000-0000-4000-8000-000000000001";
before(async () => {
  await installCanonicalDatabase(db);
  await db.exec(await sqlFile("competition-round-robin"));
  await db.exec(await sqlFile("competition-round-robin-results"));
});
after(async () => db.close());
beforeEach(async () => db.exec("begin"));
afterEach(async () => db.exec("rollback; reset role"));

async function seedContext(database = db) {
  await database.exec(`
    insert into organisations(id,name,slug,status) overriding system value values(1,'Eastern Region Shooting Association','eastern-region-shooting-association','active');
    insert into league_seasons(id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at) overriding system value
      values(1,1,'Eastern Summer League','eastern-summer-league','active',current_date-60,current_date-40,current_date-30,current_date+90);
    insert into clubs(id,name,slug,status) overriding system value values
      (1,'Basildon Rifle and Pistol Club','basildon-rifle-and-pistol-club','active'),
      (2,'Northbridge Target Shooting Club','northbridge-target-shooting-club','active');
    insert into auth.users(id) values('${actor}');
    insert into organisation_staff(organisation_id,user_id,role,status) values(1,'${actor}','owner','active');
    insert into club_memberships(club_id,user_id,role,status) values(1,'${actor}','owner','active');
    select set_config('request.jwt.claim.sub','${actor}',false);
  `);
  const names = [["George","Foster"],["Sophie","Turner"],["Harry","Collins"],["Isla","Morgan"],["Jack","Ward"],["Emily","Price"],["Alfie","Robinson"],["Phoebe","Wood"],["Henry","Thompson"],["Lucy","Green"]];
  for (let i=0;i<10;i++) {
    const uuid = `${i<6?'1':'2'}0000000-0000-4000-8000-${String((i<6?i:i-6)+4).padStart(12,'0')}`;
    await database.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)",[uuid,JSON.stringify({first_name:names[i][0],last_name:names[i][1]})]);
    await database.query("insert into club_memberships(club_id,user_id,role,status) values($1,$2,'member','active')",[i<6?1:2,uuid]);
  }
}

async function fixture({n=4, rounds=3, format="individual", size=1, mode="points_scored", x=false, publish=true, future=false}={}) {
  await seedContext();
  const c = (await db.query(`insert into competitions(league_season_id,name,slug,status,entry_format,team_size,scoring_method,maximum_score_per_round,shots_per_round,uses_x_score,number_of_rounds,entry_window_mode,custom_entry_opens_at,custom_entry_closes_at,start_date_mode,custom_starts_at,sets_per_round,ranking_method)
    values(1,'Round Test','round-test','published',$1,$2,$3,100,10,$4,$5,'custom',current_date-50,current_date-40,'custom',current_date+1,1,'round_robin') returning id`,[format,size,mode,x,rounds])).rows[0].id;
  await db.query("insert into competition_score_components(competition_id,position,short_label,maximum_score,score_method) values($1,1,'Score',100,$2)",[c,mode]);
  const roundIds=[];
  for(let r=1;r<=rounds;r++) roundIds.push((await db.query("insert into competition_rounds(competition_id,round_number,deadline) values($1,$2,current_date+1+$2::integer) returning id",[c,r])).rows[0].id);
  const entry = (await db.query("insert into club_competition_entries(competition_id,club_id,status,submitted_at) values($1,1,'submitted',now()) returning id",[c])).rows[0].id;
  const entrants=[]; const participants=[];
  // Tests needing > six slots create additional memberships only in disposable DB.
  for (let i=0;i<n*size;i++) {
    const uuid=`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)",[uuid,JSON.stringify({first_name:`Entrant ${Math.floor(i/size)+1}`,last_name:`Slot ${i%size+1}`})]);
    await db.query("insert into club_memberships(club_id,user_id,role,status) values(1,$1,'member','active')",[uuid]);
  }
  const members=(await db.query("select id,user_id from club_memberships where user_id::text like '30000000%' order by user_id")).rows;
  for(let i=0;i<n;i++) {
    const id=(await db.query("insert into competition_entrants(club_competition_entry_id,position) values($1,$2) returning id",[entry,i+1])).rows[0].id;
    entrants.push(id); participants.push([]);
    for(let s=0;s<size;s++) participants[i].push({...members[i*size+s], participant:(await db.query("insert into competition_entrant_participants(club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number) values($1,$2,$3,$4) returning id",[entry,id,members[i*size+s].id,s+1])).rows[0].id});
  }
  const allocation=JSON.stringify([{name:"Division One",entrant_ids:entrants}]);
  await db.query("select public.save_competition_division_draft(1,1,$1,$2,$3)",[c,n,allocation]);
  if(publish) {
    await db.query("select public.publish_competition_divisions(1,1,$1)",[c]);
    await db.query("update competitions set custom_starts_at=current_date-30 where id=$1",[c]);
    await db.query("update competition_rounds set deadline=case when $2 and round_number=$3 then current_date else current_date-20+round_number end,shoot_by_date=current_date-25 where competition_id=$1",[c,future,rounds]);
  }
  return {c,entrants,participants,roundIds,size,x,allocation};
}
async function score(f, entrant, round, values, xs=0) {
  for(let s=0;s<f.size;s++) {
    const value=Array.isArray(values)?values[s]:values;
    if(value==null) continue;
    const p=f.participants[entrant][s];
    const id=(await db.query("insert into shooting_score_sources(shooter_profile_id) values($1) returning id",[p.user_id])).rows[0].id;
    await db.query("insert into competition_score_usages(shooting_score_source_id,competition_id,competition_round_id,competition_entrant_participant_id) values($1,$2,$3,$4)",[id,f.c,f.roundIds[round],p.participant]);
    await db.query("insert into shooting_score_values(shooting_score_source_id,set_number,component_position,achieved_score,x_count) values($1,1,1,$2,$3)",[id,value,f.x?(Array.isArray(xs)?xs[s]:xs):null]);
  }
}
async function results(f) {
  await db.exec("set role anon");
  try { return (await db.query("select public.get_competition_round_robin_results(1,1,$1) data",[f.c])).rows[0].data; }
  finally { await db.exec("reset role"); }
}
async function rejected(sql, params=[], pattern) {
  await db.exec("savepoint rejection");
  try { await assert.rejects(db.query(sql,params),pattern); }
  finally { await db.exec("rollback to savepoint rejection; release savepoint rejection"); }
}

test("real development SQL: asserted standings, production publication path, safe rerun and marker protection", async () => {
  const isolated = new PGlite();
  try {
    await installCanonicalDatabase(isolated);
    await seedContext(isolated);
    await isolated.exec(await sqlFile('development-gun-score-fixture'));
    const gunSnapshot=async()=> (await isolated.query(`select public.get_competition_gun_score_results(1,1,id) data
      from competitions where slug in ('dev-gun-score-individual','dev-gun-score-pairs-dropped') order by slug`)).rows;
    const beforeGun=await gunSnapshot();
    // Existing Aggregate/Gun Score data is outside the reserved slugs.
    await isolated.exec(`insert into competitions(league_season_id,name,slug,status,entry_format,team_size,scoring_method,number_of_rounds,ranking_method)
      values(1,'Existing Aggregate','existing-aggregate','draft','individual',1,'points_scored',1,'aggregate'),
      (1,'Existing Gun Score','existing-gun-score','draft','individual',1,'points_scored',1,'gun_score');`);
    const sql=await sqlFile("development-round-robin-fixture");
    for(let i=0;i<2;i++) await isolated.exec(sql);
    assert.deepEqual(await gunSnapshot(),beforeGun);
    assert.equal((await isolated.query("select count(*)::int n from competitions where slug in ('existing-aggregate','existing-gun-score')")).rows[0].n,2);
    await isolated.exec("update competitions set description='Unrelated data' where slug='dev-round-robin-individual'");
    await assert.rejects(isolated.exec(sql),/reserved Round Robin slug/);
    await isolated.exec("rollback");
    assert.equal((await isolated.query("select description from competitions where slug='dev-round-robin-individual'")).rows[0].description,'Unrelated data');
  } finally { await isolated.close(); }
});

test("W=2 D=1 L=0, primary before X, equal primary uses X, anonymous safe Results", async () => {
  const f=await fixture({x:true,rounds:1});
  await score(f,0,0,99,0); await score(f,3,0,98,9);
  await score(f,1,0,97,3); await score(f,2,0,97,3);
  const data=await results(f); const rows=data.groups[0].entrants;
  assert.deepEqual(rows.map(e=>e.total_match_points),[2,1,1,0]);
  assert.deepEqual(rows.map(e=>e.rounds[0].outcome),['win','draw','draw','loss']);
  assert.equal(rows[1].position,2); assert.equal(rows[2].position,2); assert.equal(rows[1].tied,true);
  await db.query(`update shooting_score_values set x_count=4 where shooting_score_source_id in
    (select shooting_score_source_id from competition_score_usages where competition_entrant_participant_id=$1)`,[f.participants[1][0].participant]);
  const updated=(await results(f)).groups[0].entrants;
  assert.equal(updated.find(e=>e.entrant_id===f.entrants[1]).rounds[0].outcome,'win');
  assert.equal(updated.find(e=>e.entrant_id===f.entrants[2]).rounds[0].outcome,'loss');
  assert.doesNotMatch(JSON.stringify(data),/source_id|shooter_profile_id|participant_id|membership_id|component_values|phone|address/);
});

test("points dropped compares derived dropped gun results, Pair and Team stay whole entrants", async () => {
  for(const [format,size] of [['pairs',2],['team',3]]) {
    await db.exec("savepoint format_case");
    const f=await fixture({n:2,rounds:1,format,size,mode:'points_dropped'});
    await score(f,0,0,99); await score(f,1,0,98);
    const rows=(await results(f)).groups[0].entrants;
    assert.equal(rows[0].gun_total,size); assert.equal(rows[0].total_match_points,2);
    assert.equal(rows[1].gun_total,size*2); assert.equal(rows[1].total_match_points,0);
    assert.equal(rows[0].participants.length,size);
    assert.equal(rows[0].participants[0].rounds[0].gun_score,1);
    assert.ok(rows[0].participants.every(p=>!('match_points' in p)));
    await db.exec("rollback to savepoint format_case; release savepoint format_case");
  }
});

test("standings order: match points, gun aggregate, optional X; equal implemented criteria remain tied without countback", async () => {
  for(const x of [true,false]) {
    await db.exec('savepoint standings_case');
    const f=await fixture({x});
    // Entrants 2 and 3 earn three match points and 294 gun each. Their
    // different Round distributions are intentionally not a countback.
    const scores=[[99,97,98],[98,99,97],[98,98,98],[97,96,99]];
    const xs=[[3,8,3],[4,4,4],[4,2,3],[2,2,2]];
    for(let e=0;e<4;e++) for(let r=0;r<3;r++) await score(f,e,r,scores[e][r],xs[e][r]);
    const rows=(await results(f)).groups[0].entrants;
    assert.deepEqual(rows.map(e=>e.total_match_points),[4,3,3,2]);
    assert.deepEqual(rows.map(e=>e.gun_total),[294,294,294,292]);
    assert.deepEqual(rows.map(e=>e.position),x?[1,2,3,4]:[1,2,2,4]);
    assert.equal(rows[1].tied,!x); assert.equal(rows[2].tied,!x);
    if(x) assert.deepEqual(rows.map(e=>e.x_total),[14,12,9,6]);
    else assert.ok(rows.every(e=>!('x_total' in e)));
    await db.exec('rollback to savepoint standings_case; release savepoint standings_case');
  }
});

test("points-dropped aggregate is secondary after match points, lower aggregate wins", async () => {
  const f=await fixture({mode:'points_dropped'});
  const scores=[[99,97,98],[98,99,97],[98,98,96],[97,96,99]];
  for(let e=0;e<4;e++) for(let r=0;r<3;r++) await score(f,e,r,scores[e][r]);
  const rows=(await results(f)).groups[0].entrants;
  assert.deepEqual(rows.map(e=>e.total_match_points),[4,3,3,2]);
  assert.deepEqual(rows.map(e=>e.gun_total),[6,6,8,8]);
  assert.deepEqual(rows.map(e=>e.entrant_id),f.entrants);
});

test("security rejects wrong context and non-managers, hides draft competition and division payloads", async () => {
  const f=await fixture({publish:false});
  await db.exec("set role anon");
  await rejected('select public.get_competition_round_robin_results(999,1,$1)',[f.c],/context was not found/);
  await rejected('select public.get_competition_round_robin_results(1,999,$1)',[f.c],/context was not found/);
  await rejected('select * from competition_division_assignments',[],/permission denied/);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.participants[0][0].user_id]);
  await db.exec('set role authenticated');
  await rejected('select public.publish_competition_divisions(1,1,$1)',[f.c],/owner or manager/);
  await rejected('select public.edit_competition_divisions(1,1,$1)',[f.c],/owner or manager/);
  await db.exec('reset role');
  await db.query("update competitions set status='draft' where id=$1",[f.c]);
  await rejected('select public.get_competition_round_robin_results(1,1,$1)',[f.c],/context was not found/);
});

test("incomplete allocation and missing Rounds fail publication atomically; no schedule cannot be started", async () => {
  const f=await fixture({publish:false});
  await rejected('update competitions set custom_starts_at=current_date where id=$1',[f.c],/requires published Divisions/);
  await db.query('delete from competition_division_assignments where competition_entrant_id=$1',[f.entrants[0]]);
  await rejected('select public.publish_competition_divisions(1,1,$1)',[f.c],/assigned/);
  assert.equal((await results(f)).status,'awaiting_divisions');
  await db.query('select public.save_competition_division_draft(1,1,$1,4,$2)',[f.c,f.allocation]);
  await db.query('delete from competition_rounds where id=$1',[f.roundIds[2]]);
  await rejected('select public.publish_competition_divisions(1,1,$1)',[f.c],/every Competition Round/);
  assert.equal((await db.query('select status from competition_division_configs where competition_id=$1',[f.c])).rows[0].status,'draft');
});

test("persisted extra Rounds repeat the exact published cycle and score corrections recalculate outcomes", async () => {
  const f=await fixture({rounds:6});
  const schedule=(await db.query(`select r.round_number,f.match_number,f.entrant_a_id,f.entrant_b_id
    from competition_round_robin_fixtures f join competition_rounds r on r.id=f.round_id
    where f.competition_id=$1 order by r.round_number,f.match_number`,[f.c])).rows;
  assert.deepEqual(schedule.slice(6).map(m=>({...m,round_number:m.round_number-3})),schedule.slice(0,6));
  await score(f,0,0,99); await score(f,3,0,98);
  assert.equal((await results(f)).groups[0].entrants[0].entrant_id,f.entrants[0]);
  await db.query(`update shooting_score_values set achieved_score=97 where shooting_score_source_id in
    (select shooting_score_source_id from competition_score_usages where competition_entrant_participant_id=$1)`,[f.participants[0][0].participant]);
  assert.equal((await results(f)).groups[0].entrants[0].entrant_id,f.entrants[3]);
});

test("complete bye earns two, incomplete bye earns none; one or both NSR unresolved", async () => {
  const f=await fixture({n:5,rounds:2,format:'pairs',size:2});
  await score(f,0,0,99); await score(f,3,1,[99,null]);
  await score(f,1,0,98); // Opponent 5 NSR; both 3 and 4 NSR.
  const rows=(await results(f)).groups[0].entrants;
  const byId=id=>rows.find(e=>e.entrant_id===id);
  assert.equal(byId(f.entrants[0]).rounds[0].outcome,'bye');
  assert.equal(byId(f.entrants[0]).rounds[0].match_points,2);
  const incomplete=byId(f.entrants[3]).rounds[1];
  assert.equal(incomplete.state,'nsr'); assert.equal(incomplete.outcome,'bye_nsr'); assert.equal(incomplete.match_points,null);
  for(const i of [1,2,3,4]) {
    assert.equal(byId(f.entrants[i]).rounds[0].outcome,'unresolved');
    assert.equal(byId(f.entrants[i]).rounds[0].match_points,null);
  }
});

test("Round End is inclusive; early scores, X and participant values stay hidden despite past Shoot-by", async () => {
  const f=await fixture({format:'pairs',size:2,x:true,future:true});
  for(let e=0;e<4;e++) {await score(f,e,0,90,1);await score(f,e,2,100,10);}
  const data=await results(f);
  assert.equal(data.released_round_count,2);
  for(const e of data.groups[0].entrants) {
    assert.equal(e.gun_total,180); assert.equal(e.x_total,2);
    assert.deepEqual([e.rounds[2].state,e.rounds[2].outcome,e.rounds[2].gun_score,e.rounds[2].x_total,e.rounds[2].match_points],['pending','pending',null,null,null]);
    assert.ok(e.rounds[2].opponent_id);
    assert.ok(e.participants.every(p=>p.rounds[2].gun_score===null&&p.rounds[2].x_total===null));
  }
  const {html}=await renderAggregateResultsRoute({competition:{id:f.c,name:'Round Test',slug:'round-test',status:'published',ranking_method:'round_robin',entry_format:'pairs',team_size:2},viewerId:null,readRpc:()=>results(f)});
  assert.match(html,/data-ranking-method="round_robin"/); assert.match(html,/vs Pair/); assert.match(html,/Participants/); assert.match(html,/Pending/); assert.match(html,/match pts/);
  assert.doesNotMatch(html,/data-entry-controls|data-lifecycle-actions|100.*10 X/);
  await db.query('update competition_rounds set deadline=current_date-1 where id=$1',[f.roundIds[2]]);
  const released=await results(f);
  assert.equal(released.released_round_count,3);
  assert.ok(released.groups[0].entrants.every(e=>e.rounds[2].gun_score===200&&e.rounds[2].match_points===1&&e.rounds[2].outcome==='draw'));
});

test("published schedules rerun without changes; drafts hidden; edit rebuild before Start and freeze after", async () => {
  const f=await fixture({publish:false});
  assert.equal((await results(f)).status,'awaiting_divisions');
  await rejected('select private.generate_round_robin_fixtures($1)',[f.c],/published Divisions/);
  await db.query('select public.publish_competition_divisions(1,1,$1)',[f.c]);
  const fixtures=()=>db.query('select * from competition_round_robin_fixtures where competition_id=$1 order by round_id,match_number',[f.c]).then(r=>r.rows);
  const first=await fixtures();
  await db.query('select public.publish_competition_divisions(1,1,$1)',[f.c]); assert.deepEqual(await fixtures(),first);
  await rejected('delete from competition_division_assignments where competition_id=$1',[f.c],/locked/);
  await db.query('select public.edit_competition_divisions(1,1,$1)',[f.c]);
  assert.equal((await fixtures()).length,0); assert.equal((await results(f)).status,'awaiting_divisions');
  await db.query('select public.publish_competition_divisions(1,1,$1)',[f.c]); assert.deepEqual(await fixtures(),first);
  await db.query('update competitions set custom_starts_at=current_date where id=$1',[f.c]);
  await rejected('select public.edit_competition_divisions(1,1,$1)',[f.c],/frozen/);
  await rejected('update competitions set custom_starts_at=current_date+5 where id=$1',[f.c],/Start cannot change/);
  await rejected('update competitions set number_of_rounds=4 where id=$1',[f.c],/structure/);
  await rejected('delete from competition_entrant_participants where competition_entrant_id=$1',[f.entrants[0]],/locked/);
  await rejected("update club_competition_entries set status='draft',submitted_at=null where competition_id=$1",[f.c],/locked/);
  await db.query('update competition_rounds set deadline=deadline+1 where id=$1',[f.roundIds[2]]);
  await db.exec('set role anon');
  await rejected('select * from competition_round_robin_fixtures',[],/permission denied/);
  await rejected('select * from shooting_score_values',[],/permission denied/);
  await rejected('select private.generate_round_robin_fixtures($1)',[f.c],/permission denied/);
  await rejected('select public.publish_competition_divisions(1,1,$1)',[f.c],/permission denied/);
  await db.exec('reset role');
});

test("circle method: even/odd, fair byes, unique opponents, deterministic, truncated and repeated cycles", async () => {
  for (const n of [1,2,4,5,6,9]) {
    const ids = Array.from({length:n},(_,i)=>i+1);
    const cycle = n % 2 ? n : n-1;
    const query = (entrants, rounds) => db.query("select * from private.round_robin_pairings($1,$2)",[entrants,rounds]).then(r=>r.rows);
    const first = await query(ids,cycle);
    assert.deepEqual(await query([...ids].reverse(),cycle),first);
    const pairings = new Set(); const byes = [];
    for (let r=1;r<=cycle;r++) {
      const seen=[];
      for (const m of first.filter(m=>m.round_number===r)) {
        assert.notEqual(m.entrant_a_id,m.entrant_b_id);
        seen.push(m.entrant_a_id);
        if (m.entrant_b_id == null) byes.push(m.entrant_a_id);
        else {
          seen.push(m.entrant_b_id);
          const key=[m.entrant_a_id,m.entrant_b_id].sort((a,b)=>a-b).join();
          assert.ok(!pairings.has(key)); pairings.add(key);
        }
      }
      assert.deepEqual(seen.sort((a,b)=>a-b),ids);
    }
    assert.equal(pairings.size,n*(n-1)/2);
    assert.deepEqual(byes.sort((a,b)=>a-b),n%2?ids:[]);
    assert.deepEqual(await query(ids,1),first.filter(m=>m.round_number===1));
    assert.deepEqual((await query(ids,cycle*2)).slice(first.length).map(m=>({...m,round_number:m.round_number-cycle})),first);
  }
});
