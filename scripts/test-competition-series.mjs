import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installCanonicalDatabase, sqlFile } from "./helpers/canonical-database.mjs";

// Disposable PostgreSQL only. No Supabase credentials, network, resets or seeds.
const db = new PGlite();
const actors = Object.fromEntries(["owner", "manager", "normal", "clubOwner", "clubOfficial", "foreignOwner"]
  .map((role, i) => [role, `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`]));
before(async () => { await installCanonicalDatabase(db); });
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`begin;
    insert into organisations(id,name,slug,status) overriding system value values
      (1,'Organisation One','organisation-one','active'),(2,'Organisation Two','organisation-two','active');
    insert into league_seasons(id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at)
      overriding system value values
      (1,1,'Previous','previous','active',current_date-90,current_date-70,current_date-60,current_date+365),
      (2,1,'Next','next','draft',current_date+1,current_date+10,current_date+20,current_date+365),
      (3,2,'Foreign','foreign','draft',current_date+1,current_date+10,current_date+20,current_date+365);
    insert into clubs(id,name,slug,status) overriding system value values(1,'Independent Club','independent-club','active');
  `);
  for (const actor of Object.values(actors)) await db.query("insert into auth.users(id) values($1)", [actor]);
  await db.query(`insert into organisation_staff(organisation_id,user_id,role,status) values
    (1,$1,'owner','active'),(1,$2,'manager','active'),(2,$3,'owner','active')`, [actors.owner, actors.manager, actors.foreignOwner]);
  await db.query(`insert into club_memberships(club_id,user_id,role,status) values
    (1,$1,'owner','active'),(1,$2,'official','active'),(1,$3,'member','active')`, [actors.clubOwner, actors.clubOfficial, actors.normal]);
  await db.query("insert into user_organisations(user_id,organisation_id) values($1,1)", [actors.normal]);
  await actor("owner");
});
afterEach(async () => { await db.exec("rollback; reset role"); });

async function actor(role) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actors[role] ?? ""]);
  await db.exec(`set role ${role === "anon" ? "anon" : "authenticated"}`);
}
async function admin(sql, params = []) {
  await db.exec("reset role");
  try { return await db.query(sql, params); } finally { await db.exec("set role authenticated"); }
}
async function flush() { await db.exec("set constraints all immediate; set constraints all deferred"); }
async function rejected(sql, params, pattern) {
  await db.exec("savepoint expected_failure");
  try { await assert.rejects(async () => { await db.query(sql, params); await flush(); }, pattern); }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}
function config(name = "Prone edition", extra = {}) {
  return { name, description: "Original description", entry_format: "individual", team_size: 1,
    sets_per_round: 1, shots_per_round: 10,
    score_components: [{ short_label: "Prone", maximum_score: 100, score_method: "points_dropped" }],
    uses_x_score: false, number_of_rounds: 2, ranking_method: "aggregate", entry_fee: 7,
    entry_window_mode: "season_default", start_date_mode: "season_default", local_scoring_enabled: true,
    round_deadlines: ["2027-01-01", "2027-01-15"], ...extra };
}
// Relative fixture dates make the suite independent of the system calendar.
async function datedConfig(name, extra = {}) {
  const dates = (await admin("select (current_date+30)::text a,(current_date+45)::text b")).rows[0];
  return config(name, { round_deadlines: [dates.a, dates.b], ...extra });
}
async function create({ name = "Series One", season = 1, org = 1, values } = {}) {
  return (await db.query("select public.create_competition_series($1,$2,$3,$4) data",
    [org, season, name, values ?? await datedConfig(name)])).rows[0].data;
}
async function sources(first, target = 2) {
  return (await db.query("select public.get_competition_series_sources(1,$1,$2) data", [target, first.competition_series_id])).rows[0].data;
}
async function continueSeries(first, overrides = {}, sourceVersion) {
  const chooser = await sources(first);
  return (await db.query("select public.continue_competition_series(1,2,$1,$2,$3,$4) data",
    [first.competition_series_id, first.id, sourceVersion ?? chooser.sources.find(s => s.id === first.id).configuration_version,
      { name: "Next edition", ...overrides }])).rows[0].data;
}
async function update(first, values) {
  return db.query("select public.update_competition_series_draft(1,1,$1,$2)", [first.id, values]);
}
async function publish(first) { await db.query("select public.publish_competition(1,1,$1)", [first.id]); await flush(); }

const typedConfig = `v.name,v.description,v.entry_format,v.team_size,v.shots_per_round,v.uses_x_score,
  v.number_of_rounds,v.entry_fee,v.entry_window_mode,v.custom_entry_opens_at,v.custom_entry_closes_at,
  v.start_date_mode,v.custom_starts_at,v.sets_per_round,$2::jsonb->'score_components',v.ranking_method,
  v.best_rounds_count,v.local_scoring_enabled,
  array(select value::date from jsonb_array_elements_text($2::jsonb->'round_deadlines')),
  array(select value::date from jsonb_array_elements_text(coalesce($2::jsonb->'round_shoot_by_dates','[]'::jsonb)))`;
const existingUpdateSql = `select public.update_competition(1,1,$1,${typedConfig},$3)
  from jsonb_populate_record(null::public.competitions,$2::jsonb) v`;
async function createOneOff(values) {
  return (await db.query(`select public.create_competition(1,1,${typedConfig}) data
    from jsonb_populate_record(null::public.competitions,$2::jsonb) v where $1::integer=1`, [1, values])).rows[0].data;
}
async function operational(first, method = "aggregate") {
  await publish(first);
  const entry = (await admin("insert into club_competition_entries(competition_id,club_id,status,submitted_at) values($1,1,'submitted',now()) returning id", [first.id])).rows[0].id;
  const entrant = (await admin("insert into competition_entrants(club_competition_entry_id,position) values($1,1) returning id", [entry])).rows[0].id;
  const participant = (await admin(`insert into competition_entrant_participants(club_competition_entry_id,competition_entrant_id,club_membership_id,slot_number)
    select $1,$2,id,1 from club_memberships where user_id=$3 returning id`, [entry, entrant, actors.normal])).rows[0].id;
  await db.query("select public.save_competition_division_draft(1,1,$1,4,$2)", [first.id, [{ name: "Division One", entrant_ids: [entrant] }]]);
  await db.query("select public.publish_competition_divisions(1,1,$1)", [first.id]);
  if (method === "round_robin") await admin("update competitions set custom_starts_at=current_date-60 where id=$1", [first.id]);
  await admin("update competition_rounds set deadline=current_date-10+round_number where competition_id=$1", [first.id]);
  const round = (await db.query("select id from competition_rounds where competition_id=$1 order by round_number", [first.id])).rows[0].id;
  await db.query("select public.save_individual_competition_round_scores(1,1,$1,$2,null,$3)", [first.id, round,
    [{ participant_id: participant, values: [{ set_number: 1, component_position: 1, entered_score: "3", x_count: null }] }]]);
  await flush();
}
async function persistedConfig(id) {
  const c = (await admin("select * from competitions where id=$1", [id])).rows[0];
  c.score_components = (await admin("select short_label,maximum_score,score_method from competition_score_components where competition_id=$1 order by position", [id])).rows;
  const rounds = (await admin("select deadline::text,shoot_by_date::text from competition_rounds where competition_id=$1 order by round_number", [id])).rows;
  c.round_deadlines = rounds.map(r => r.deadline); c.round_shoot_by_dates = rounds.map(r => r.shoot_by_date);
  return c;
}

test("owner and manager create atomic Series/drafts; staff read drafts, ordinary and club roles cannot author", async () => {
  const ownerEdition = await create();
  await actor("manager");
  const managerEdition = await create({ name: "Manager Series", season: 2 });
  assert.notEqual(ownerEdition.id, managerEdition.id);
  assert.equal((await db.query("select id from competitions where id=$1", [managerEdition.id])).rows.length, 1);
  assert.equal((await db.query("select id from league_seasons where id=2")).rows.length, 1);
  await flush();
  for (const role of ["normal", "clubOwner", "clubOfficial", "foreignOwner"]) {
    await actor(role);
    await rejected("select public.create_competition_series(1,1,'Denied',$1)", [await datedConfig("Denied")], /permission/);
    await rejected("select public.get_competition_series_sources(1,2,$1)", [ownerEdition.competition_series_id], /permission/);
    assert.equal((await db.query("select id from competition_series")).rows.length, 0);
  }
  await actor("anon");
  await rejected("select * from public.competition_series", [], /permission denied/);
  await rejected("select public.get_competition_series_sources(1,2,$1)", [ownerEdition.competition_series_id], /permission denied/);
});

test("failure after Competition creation leaves no orphan; Organisation mismatch and direct writes denied", async () => {
  await rejected("select public.create_competition_series(1,1,'!',$1)", [await datedConfig("Rollback")], /check constraint/);
  assert.equal((await admin("select count(*)::int n from competitions")).rows[0].n, 0);
  assert.equal((await admin("select count(*)::int n from competition_series")).rows[0].n, 0);
  await rejected("select public.create_competition_series(1,3,'Mismatch',$1)", [await datedConfig("Mismatch")], /Season not found/);
  await rejected("insert into public.competition_series(organisation_id,name,slug,entry_format,team_size,sets_per_round) values(1,'Denied','denied','individual',1,1)", [], /permission denied/);
});

test("published one-off permits admin edits but rejects every sporting RPC change without rewriting components", async () => {
  const values = await datedConfig("Published one-off", { score_components: [
    { short_label: "A", maximum_score: 50, score_method: "points_scored" },
    { short_label: "B", maximum_score: 50, score_method: "points_scored" },
  ] });
  const competition = await createOneOff(values);
  await publish(competition);
  const beforeComponents = (await admin(
    "select to_jsonb(component) data from competition_score_components component where competition_id=$1 order by position",
    [competition.id],
  )).rows;

  await db.query(existingUpdateSql, [competition.id, {
    ...values,
    name: "Published one-off renamed",
    description: "Administrative correction",
    entry_fee: 9,
    local_scoring_enabled: false,
  }, "published"]);
  await flush();

  const saved = (await admin(
    "select name,description,entry_fee,local_scoring_enabled,status from competitions where id=$1",
    [competition.id],
  )).rows[0];
  assert.equal(saved.name, "Published one-off renamed");
  assert.equal(saved.description, "Administrative correction");
  assert.equal(saved.entry_fee, "9.00");
  assert.equal(saved.local_scoring_enabled, false);
  assert.equal(saved.status, "published");
  assert.deepEqual((await admin(
    "select to_jsonb(component) data from competition_score_components component where competition_id=$1 order by position",
    [competition.id],
  )).rows, beforeComponents);

  const thirdDeadline = (await admin("select (current_date+60)::text value")).rows[0].value;
  const sportingChanges = [
    { score_components: [
      { short_label: "A", maximum_score: 60, score_method: "points_scored" },
      { short_label: "B", maximum_score: 40, score_method: "points_scored" },
    ] },
    { score_components: [{ short_label: "Only", maximum_score: 100, score_method: "points_scored" }] },
    { score_components: [
      { short_label: "B", maximum_score: 50, score_method: "points_scored" },
      { short_label: "A", maximum_score: 50, score_method: "points_scored" },
    ] },
    { score_components: [
      { short_label: "A", maximum_score: 50, score_method: "points_scored" },
      { short_label: "B", maximum_score: 50, score_method: "points_dropped" },
    ] },
    { shots_per_round: 20 },
    { ranking_method: "gun_score" },
    { uses_x_score: true },
    { number_of_rounds: 3, round_deadlines: [...values.round_deadlines, thirdDeadline] },
    { sets_per_round: 2 },
    { entry_format: "pairs", team_size: 2 },
  ];
  for (const change of sportingChanges) {
    await rejected(existingUpdateSql, [competition.id, {
      ...values,
      name: "Published one-off renamed",
      description: "Administrative correction",
      entry_fee: 9,
      local_scoring_enabled: false,
      ...change,
    }, "published"], /Published Competition .* locked/);
  }

  await db.exec("reset role");
  await db.query("update competitions set discipline_code='rifle_benchrest' where id=$1", [competition.id]);
  await flush();
  await rejected(
    "update competition_score_components set short_label='Direct mutation' where competition_id=$1 and position=1",
    [competition.id],
    /Published Competition Course of Fire is locked/,
  );
});

test("published Best-N count is locked while a valid one-off draft remains structurally configurable", async () => {
  const draftValues = await datedConfig("Configurable draft", { score_components: [
    { short_label: "A", maximum_score: 50, score_method: "points_scored" },
    { short_label: "B", maximum_score: 50, score_method: "points_scored" },
  ] });
  const draft = await createOneOff(draftValues);
  const thirdDeadline = (await admin("select (current_date+60)::text value")).rows[0].value;
  const changed = {
    ...draftValues,
    entry_format: "pairs",
    team_size: 2,
    sets_per_round: 2,
    shots_per_round: 20,
    score_components: [{ short_label: "Pair", maximum_score: 200, score_method: "points_dropped" }],
    ranking_method: "gun_score",
    uses_x_score: true,
    number_of_rounds: 3,
    round_deadlines: [...draftValues.round_deadlines, thirdDeadline],
  };
  await db.query(existingUpdateSql, [draft.id, changed, "draft"]);
  await flush();
  const configured = (await admin(
    "select entry_format,team_size,sets_per_round,shots_per_round,ranking_method,uses_x_score,number_of_rounds from competitions where id=$1",
    [draft.id],
  )).rows[0];
  assert.deepEqual(configured, {
    entry_format: "pairs", team_size: 2, sets_per_round: 2, shots_per_round: 20,
    ranking_method: "gun_score", uses_x_score: true, number_of_rounds: 3,
  });

  const bestValues = await datedConfig("Published Best N", {
    ranking_method: "best_n_average", best_rounds_count: 1,
  });
  const best = await createOneOff(bestValues);
  await publish(best);
  await rejected(existingUpdateSql, [best.id, { ...bestValues, best_rounds_count: 2 }, "published"],
    /Published Competition sporting configuration is locked/);
});

test("a draft Club entry with zero shooters is participation and blocks Return to Draft", async () => {
  const values = await datedConfig("Entered Competition");
  const competition = await createOneOff(values);
  await publish(competition);
  await admin(
    "insert into club_competition_entries(competition_id,club_id,status) values($1,1,'draft')",
    [competition.id],
  );
  assert.equal((await admin(
    "select count(*)::int count from competition_entrant_participants participant join club_competition_entries entry on entry.id=participant.club_competition_entry_id where entry.competition_id=$1",
    [competition.id],
  )).rows[0].count, 0);
  const lifecycle = (await db.query(
    "select public.get_competition_lifecycle_state(1,1,$1) data",
    [competition.id],
  )).rows[0].data;
  assert.equal(lifecycle.has_participation, true);
  assert.equal(lifecycle.can_return_to_draft, false);
  await rejected("select public.return_competition_to_draft(1,1,$1)", [competition.id], /participation data/);
});

test("first draft identity corrects atomically; publication finalises and Return to Draft never unlocks", async () => {
  const first = await create();
  await actor("manager");
  const changed = await datedConfig("Series One", { entry_format: "pairs", team_size: 2,
    score_components: [{ short_label: "Benchrest", maximum_score: 100, score_method: "points_scored" }] });
  await update(first, changed); await flush();
  const series = (await db.query("select * from competition_series where id=$1", [first.competition_series_id])).rows[0];
  assert.equal(series.team_size, 2);
  assert.equal(series.identity_locked_at, null);
  await actor("owner"); await publish(first);
  const locked = (await db.query("select identity_locked_at from competition_series where id=$1", [series.id])).rows[0].identity_locked_at;
  await db.query("select public.return_competition_to_draft(1,1,$1)", [first.id]);
  await flush();
  assert.deepEqual((await db.query("select identity_locked_at from competition_series where id=$1", [series.id])).rows[0].identity_locked_at, locked);
  for (const override of [
    { entry_format: "individual", team_size: 1 },
    { sets_per_round: 2 }, { shots_per_round: 20 },
    { score_components: [{ short_label: "Benchrest", maximum_score: 200, score_method: "points_scored" }] },
    { score_components: [{ short_label: "Different", maximum_score: 100, score_method: "points_scored" }] },
    { score_components: [{ short_label: "Benchrest", maximum_score: 100, score_method: "points_dropped" }] },
    { score_components: [
      { short_label: "A", maximum_score: 50, score_method: "points_scored" },
      { short_label: "B", maximum_score: 50, score_method: "points_scored" },
    ] },
  ]) await rejected("select public.update_competition_series_draft(1,1,$1,$2)", [first.id, { ...changed, ...override }], /identity must match/);
});

test("discipline metadata is absent by default and ignored by identity, finalisation and source versions", async () => {
  const first = await create();
  const initial = (await admin(
    "select c.discipline_code competition_code,s.discipline_code series_code from competitions c join competition_series s on s.id=c.competition_series_id where c.id=$1",
    [first.id],
  )).rows[0];
  assert.deepEqual(initial, { competition_code: null, series_code: null });
  await publish(first);
  const version = (await sources(first)).sources[0].configuration_version;
  await admin("update competitions set discipline_code='rifle_benchrest' where id=$1", [first.id]);
  await admin("update competition_series set discipline_code='other',discipline_detail='Legacy metadata' where id=$1", [first.competition_series_id]);
  await flush();
  assert.equal((await sources(first)).sources[0].configuration_version, version);
  const next = await continueSeries(first, {}, version);
  await flush();
  assert.deepEqual((await admin(
    "select discipline_code,discipline_detail from competitions where id=$1",
    [next.id],
  )).rows[0], { discipline_code: null, discipline_detail: null });
});

test("continuation validation failure rolls back Series finalisation", async () => {
  const first = await create();
  const version = (await sources(first)).sources[0].configuration_version;
  await rejected("select public.continue_competition_series(1,2,$1,$2,$3,$4)",
    [first.competition_series_id, first.id, version, { name: "Bad", number_of_rounds: 0 }], /Number of rounds/);
  assert.equal((await db.query("select identity_locked_at from competition_series where id=$1", [first.competition_series_id])).rows[0].identity_locked_at, null);
});

test("continuation finalises first draft, gets new ID, inherits defaults, permits edition rules and never copies historical dates", async () => {
  const dates = (await admin("select (current_date-90)::text opens,(current_date-70)::text closes,(current_date-60)::text starts")).rows[0];
  const first = await create({ values: await datedConfig("Custom source", { entry_window_mode: "custom", custom_entry_opens_at: dates.opens,
    custom_entry_closes_at: dates.closes, start_date_mode: "custom", custom_starts_at: dates.starts }) });
  await actor("manager");
  const next = await continueSeries(first, { ranking_method: "gun_score", uses_x_score: true, number_of_rounds: 8 });
  await flush();
  assert.notEqual(next.id, first.id); assert.equal(next.competition_series_id, first.competition_series_id);
  const c = (await admin("select * from competitions where id=$1", [next.id])).rows[0];
  assert.equal(c.status, "draft"); assert.equal(c.configuration_source_competition_id, first.id);
  assert.equal(c.configuration_source_version, next.configuration_source_version);
  assert.equal(c.ranking_method, "gun_score"); assert.equal(c.uses_x_score, true); assert.equal(c.number_of_rounds, 8);
  assert.equal(c.entry_fee, "7.00"); assert.equal(c.description, "Original description");
  assert.equal(c.custom_entry_opens_at, null); assert.equal(c.custom_entry_closes_at, null); assert.equal(c.custom_starts_at, null);
  assert.equal((await db.query("select * from competition_rounds where competition_id=$1", [next.id])).rows.length, 0);
  assert.equal((await db.query("select identity_locked_at is not null locked from competition_series where id=$1", [first.competition_series_id])).rows[0].locked, true);
  const third = await continueSeries(first, { name: "Third edition", ranking_method: "best_n_average", best_rounds_count: 5, number_of_rounds: 6 });
  assert.notEqual(third.id, next.id); // multiple editions in one Season are intentional
});

test("stale, foreign, archived and identity-override requests are rejected", async () => {
  const first = await create(); const other = await create({ name: "Other Series" });
  const version = (await sources(first)).sources[0].configuration_version;
  await update(first, await datedConfig("Series One", { description: "Changed" }));
  await rejected("select public.continue_competition_series(1,2,$1,$2,$3,$4)",
    [first.competition_series_id, first.id, version, { name: "Stale" }], /Source configuration changed/);
  const fresh = (await sources(first)).sources[0].configuration_version;
  await rejected("select public.continue_competition_series(1,2,$1,$2,$3,$4)",
    [first.competition_series_id, other.id, fresh, { name: "Foreign" }], /source must belong/);
  await rejected("select public.continue_competition_series(1,3,$1,$2,$3,$4)",
    [first.competition_series_id, first.id, fresh, { name: "Foreign Season" }], /Target Season/);
  await rejected("select public.continue_competition_series(1,2,$1,$2,$3,$4)",
    [first.competition_series_id, first.id, fresh, { name: "Override", entry_format: "pairs" }], /Unsupported/);
  await db.query("select public.set_competition_series_archived(1,$1,true)", [first.competition_series_id]);
  await rejected("select public.continue_competition_series(1,2,$1,$2,$3,$4)",
    [first.competition_series_id, first.id, fresh, { name: "Archived" }], /Archived/);
});

test("source version covers components, rounds and inherited Season dates; same-date sources require selection", async () => {
  const first = await create(); await publish(first);
  assert.equal((await sources(first)).recommended_source_id, first.id);
  const before = (await sources(first)).sources[0].configuration_version;
  await admin("update competition_rounds set deadline=deadline+1 where competition_id=$1 and round_number=2", [first.id]);
  const afterRound = (await sources(first)).sources[0].configuration_version;
  assert.notEqual(before, afterRound);
  await admin("update league_seasons set entry_opens_at=entry_opens_at-1 where id=1");
  assert.notEqual(afterRound, (await sources(first)).sources[0].configuration_version);
  const second = await continueSeries(first, { name: "Second published", entry_window_mode: "season_default", start_date_mode: "season_default",
    round_deadlines: (await datedConfig("dates")).round_deadlines });
  // Same actual start in a second public Season, not merely the highest ID.
  await admin("update league_seasons set starts_at=current_date-60,entry_opens_at=current_date-90,entry_closes_at=current_date-70,status='active' where id=2");
  await db.query("select public.publish_competition(1,2,$1)", [second.id]); await flush();
  const chooser = (await db.query("select public.get_competition_series_sources(1,2,$1,current_date+100) data", [first.competition_series_id])).rows[0].data;
  assert.equal(chooser.recommended_source_id, null); assert.equal(chooser.ambiguous_latest_date, true);
  assert.equal(chooser.selection_required, true);
});

test("owner archive/restore/delete-empty; manager cannot invoke owner lifecycle or edit published editions", async () => {
  const first = await create();
  await db.query("select public.rename_competition_series(1,$1,'Renamed Series')", [first.competition_series_id]);
  assert.deepEqual((await db.query(
    "select name,slug from competition_series where id=$1",
    [first.competition_series_id],
  )).rows[0], { name: "Renamed Series", slug: "series-one" });
  await actor("manager");
  for (const [sql, args] of [
    ["select public.publish_competition(1,1,$1)", [first.id]],
    ["select public.return_competition_to_draft(1,1,$1)", [first.id]],
    ["select public.delete_competition(1,1,$1)", [first.id]],
    ["select public.set_competition_series_archived(1,$1,true)", [first.competition_series_id]],
    ["select public.set_competition_series_archived(1,$1,false)", [first.competition_series_id]],
    ["select public.delete_empty_competition_series(1,$1)", [first.competition_series_id]],
    ["select public.rename_competition_series(1,$1,'Manager rename')", [first.competition_series_id]],
  ]) await rejected(sql, args, /permission/);
  await actor("owner"); await publish(first);
  await actor("manager");
  await rejected("select public.update_competition_series_draft(1,1,$1,$2)", [first.id, await datedConfig("Series One")], /Draft Competition/);
  await actor("owner");
  await rejected("select public.delete_empty_competition_series(1,$1)", [first.competition_series_id], /with editions/);
  await db.query("select public.set_competition_series_archived(1,$1,true)", [first.competition_series_id]);
  await db.query("select public.set_competition_series_archived(1,$1,false)", [first.competition_series_id]);
  await db.query("select public.delete_competition(1,1,$1)", [first.id]);
  await db.query("select public.delete_empty_competition_series(1,$1)", [first.competition_series_id]);
  await flush();
});

test("recommendation excludes future, undated and draft history; explicit overrides remain available", async () => {
  const first = await create();
  assert.equal((await sources(first)).recommended_source_id, null); // draft is not a default
  await publish(first);
  const future = await continueSeries(first, { name: "Future published", round_deadlines: (await datedConfig("Schedule")).round_deadlines });
  await admin("update league_seasons set status='open' where id=2");
  await db.query("select public.publish_competition(1,2,$1)", [future.id]); await flush();
  const chooser = (await db.query("select public.get_competition_series_sources(1,2,$1,current_date+100) data", [first.competition_series_id])).rows[0].data;
  assert.equal(chooser.recommended_source_id, first.id);
  assert.ok(chooser.sources.some(s => s.id === future.id && s.status === "published"));
  const explicit = await continueSeries(future, { name: "Explicit future source" });
  assert.equal(explicit.configuration_source_competition_id, future.id);
  const undated = await continueSeries(first, { name: "Undated draft", start_date_mode: "custom" });
  const undatedSource = (await sources(first)).sources.find(s => s.id === undated.id);
  assert.equal(undatedSource.effective_starts_at, null);
  await admin("insert into league_seasons(id,organisation_id,name,slug,status) overriding system value values(4,1,'Undated target','undated-target','draft')");
  const provisional = await sources(first, 4);
  assert.equal(provisional.provisional_cutoff, true);
  assert.equal(provisional.recommended_source_id, first.id);
});

test("deleting a configuration source preserves destination configuration, version and permanent identity lock", async () => {
  const first = await create(); const next = await continueSeries(first); await flush();
  const before = await persistedConfig(next.id);
  await db.query("select public.delete_competition(1,1,$1)", [first.id]); await flush();
  const after = await persistedConfig(next.id);
  assert.equal(after.configuration_source_competition_id, null);
  assert.equal(after.configuration_source_version, before.configuration_source_version);
  assert.deepEqual(after.score_components, before.score_components);
  assert.equal(after.competition_series_id, first.competition_series_id);
  assert.equal((await db.query("select identity_locked_at is not null locked from competition_series where id=$1", [first.competition_series_id])).rows[0].locked, true);
});

test("revoked managers and inactive Organisations lose management reads and writes", async () => {
  const first = await create();
  await admin("update organisation_staff set status='revoked' where user_id=$1", [actors.manager]);
  await actor("manager");
  assert.equal((await db.query("select id from competition_series")).rows.length, 0);
  assert.equal((await db.query("select id from competitions where id=$1", [first.id])).rows.length, 0);
  await rejected("select public.get_competition_series_sources(1,2,$1)", [first.competition_series_id], /permission/);
  await rejected("select public.create_competition_series(1,1,'Revoked',$1)", [await datedConfig("Revoked")], /permission/);
  await actor("owner");
  await admin("update organisations set status='inactive' where id=1");
  assert.equal((await db.query("select id from competition_series")).rows.length, 0);
  await rejected("select public.get_competition_series_sources(1,2,$1)", [first.competition_series_id], /permission/);
});

test("database invariants reject cross-Organisation, detach, contract mutation and component reorder", async () => {
  const first = await create({ values: await datedConfig("Two components", { score_components: [
    { short_label: "A", maximum_score: 50, score_method: "points_scored" },
    { short_label: "B", maximum_score: 50, score_method: "points_scored" }] }) });
  await publish(first);
  await db.exec("reset role");
  for (const [sql, args, pattern] of [
    ["update competition_series set organisation_id=2 where id=$1", [first.competition_series_id], /immutable/],
    ["update competition_series set identity_locked_at=null where id=$1", [first.competition_series_id], /immutable/],
    ["update competitions set competition_series_id=null where id=$1", [first.id], /detached/],
    ["update competitions set league_season_id=3 where id=$1", [first.id], /same Organisation/],
    ["update league_seasons set organisation_id=2 where id=1", [], /cannot change Organisation/],
    ["update competition_series_score_components set maximum_score=200 where competition_series_id=$1", [first.competition_series_id], /immutable/],
    ["update competition_score_components set short_label=case position when 1 then 'B' else 'A' end where competition_id=$1", [first.id], /locked|identity must match/],
  ]) await rejected(sql, args, pattern);
});

test("scored description/fee/access edits preserve component IDs and values; actual protected changes fail", async () => {
  const first = await create(); await operational(first);
  const before = (await admin("select to_jsonb(c) data from competition_score_components c where competition_id=$1", [first.id])).rows;
  const values = await persistedConfig(first.id);
  await db.query(existingUpdateSql, [first.id, { ...values, description: "Description corrected", entry_fee: 9, local_scoring_enabled: false }, "published"]);
  await flush();
  assert.deepEqual((await admin("select to_jsonb(c) data from competition_score_components c where competition_id=$1", [first.id])).rows, before);
  assert.equal((await admin("select description from competitions where id=$1", [first.id])).rows[0].description, "Description corrected");
  for (const change of [{ uses_x_score: true }, { sets_per_round: 2 }, { shots_per_round: 20 },
    { score_components: [{ short_label: "Prone", maximum_score: 200, score_method: "points_dropped" }] },
    { score_components: [{ short_label: "Changed", maximum_score: 100, score_method: "points_dropped" }] }]) {
    await rejected(existingUpdateSql, [first.id, { ...values, ...change }, "published"], /locked|cannot change after scores/);
  }
  await actor("manager");
  await rejected(existingUpdateSql, [first.id, values, "published"], /permission/);
  await actor("owner");
  await rejected("select public.return_competition_to_draft(1,1,$1)", [first.id], /participation data/);
  await rejected("select public.delete_competition(1,1,$1)", [first.id], /participation data/);
});

test("continuing an operational Round Robin copies no participation, scores, divisions, fixtures or Results", async () => {
  const tomorrow = (await admin("select (current_date+1)::text value")).rows[0].value;
  const first = await create({ values: await datedConfig("Round Robin source", { ranking_method: "round_robin", start_date_mode: "custom", custom_starts_at: tomorrow }) });
  await operational(first, "round_robin");
  const before = (await db.query("select public.get_competition_round_robin_results(1,1,$1) data", [first.id])).rows[0].data;
  const counts = (await admin("select (select count(*) from shooting_score_sources)::int sources,(select count(*) from shooting_score_values)::int values")).rows[0];
  const next = await continueSeries(first, { ranking_method: "aggregate" }); await flush();
  for (const table of ["club_competition_entries", "competition_division_configs", "competition_divisions", "competition_division_assignments", "competition_score_usages", "competition_round_robin_fixtures"]) {
    assert.equal((await admin(`select count(*)::int n from public.${table} where competition_id=$1`, [next.id])).rows[0].n, 0, table);
  }
  assert.equal((await admin(`select count(*)::int n from competition_entrants e join club_competition_entries c on c.id=e.club_competition_entry_id where c.competition_id=$1`, [next.id])).rows[0].n, 0);
  assert.equal((await admin(`select count(*)::int n from competition_entrant_participants p join club_competition_entries c on c.id=p.club_competition_entry_id where c.competition_id=$1`, [next.id])).rows[0].n, 0);
  assert.deepEqual((await admin("select (select count(*) from shooting_score_sources)::int sources,(select count(*) from shooting_score_values)::int values")).rows[0], counts);
  assert.deepEqual((await db.query("select public.get_competition_round_robin_results(1,1,$1) data", [first.id])).rows[0].data, before);
  await actor("anon");
  await rejected("select public.get_competition_aggregate_results(1,2,$1)", [next.id], /Published Competition/);
});

test("linked Aggregate and Gun Score public Results remain edition-owned and survive Series archive", async () => {
  for (const method of ["aggregate", "gun_score"]) {
    const first = await create({ name: `${method} Series`, values: await datedConfig(`${method} edition`, { ranking_method: method }) });
    await operational(first, method);
    await actor("anon");
    const resultSql = `select public.get_competition_${method}_results(1,1,$1) data`;
    const before = (await db.query(resultSql, [first.id])).rows[0].data;
    assert.equal(before.status, "ready");
    await actor("owner");
    await db.query("select public.set_competition_series_archived(1,$1,true)", [first.competition_series_id]);
    await actor("anon");
    assert.deepEqual((await db.query(resultSql, [first.id])).rows[0].data, before);
    const catalog = (await db.query("select public.get_public_results_catalog('organisation-one','previous',$1) data", [`${method.replaceAll("_", "-")}-edition`])).rows[0].data;
    assert.equal(JSON.stringify(catalog).includes("configuration_source"), false);
    assert.equal(JSON.stringify(catalog).includes("identity_locked_at"), false);
    await actor("owner");
  }
});

test("existing one-off RPC works for owner/manager, and manager cannot publish via legacy update", async () => {
  await actor("manager");
  const values = await datedConfig("One off", { best_rounds_count: null });
  const result = await createOneOff(values);
  assert.equal((await admin("select competition_series_id from competitions where id=$1", [result.id])).rows[0].competition_series_id, null);
  await rejected(existingUpdateSql, [result.id, values, "published"], /permission/);
  await db.query(existingUpdateSql, [result.id, { ...values, description: "Manager draft edit" }, "draft"]);
  await actor("owner"); await publish(result);
});

test("additive and rerunnable upgrade preserves pre-existing one-offs, identifiers and schedules", async () => {
  const isolated = new PGlite();
  try {
    await installCanonicalDatabase(isolated, { competitionSeries: false });
    await isolated.exec(`insert into organisations(name,slug,status) values('Existing','existing','active');
      insert into league_seasons(organisation_id,name,slug,status) values(1,'Existing','existing','draft');
      insert into competitions(league_season_id,name,slug,status,entry_format,team_size,scoring_method,number_of_rounds)
        values(1,'Existing one-off','existing-one-off','draft','individual',1,'points_scored',1);
      insert into competition_score_components(competition_id,position,maximum_score,score_method) values(1,1,100,'points_scored');
      insert into competition_rounds(competition_id,round_number,deadline) values(1,1,current_date+30);`);
    const before = (await isolated.query("select to_jsonb(c) data from competitions c")).rows;
    const rounds = (await isolated.query("select * from competition_rounds")).rows;
    const components = (await isolated.query("select * from competition_score_components")).rows;
    for (let run = 0; run < 2; run++) {
      await isolated.exec(await sqlFile("competition-series"));
      await isolated.exec(await sqlFile("competition-series-management"));
      await isolated.exec(await sqlFile("competition-published-configuration-lock"));
      await isolated.exec(await sqlFile("competition-published-configuration-lock"));
      await isolated.exec(await sqlFile("competition-series-stage-2-management"));
      await isolated.exec(await sqlFile("competition-series-stage-2-management"));
      await isolated.exec(await sqlFile("competition-series-v1-identity-without-discipline"));
      await isolated.exec(await sqlFile("competition-series-v1-identity-without-discipline"));
      assert.deepEqual((await isolated.query(`select to_jsonb(c)-array['competition_series_id','configuration_source_competition_id',
        'configuration_source_version','discipline_code','discipline_detail'] data from competitions c`)).rows, before);
      assert.deepEqual((await isolated.query("select * from competition_rounds")).rows, rounds);
      assert.deepEqual((await isolated.query("select * from competition_score_components")).rows, components);
      assert.equal((await isolated.query("select competition_series_id from competitions")).rows[0].competition_series_id, null);
      assert.equal((await isolated.query("select count(*)::int n from competition_series")).rows[0].n, 0);
    }
  } finally { await isolated.close(); }
});

test("development Series fixture is isolated and rerunnable", async () => {
  const isolated = new PGlite();
  try {
    await installCanonicalDatabase(isolated);
    await isolated.query("insert into auth.users(id) values($1)", [actors.owner]);
    await isolated.exec(`
      insert into organisations(id,name,slug,status) overriding system value values
        (1,'Eastern Region','eastern-region-shooting-association','active');
      insert into league_seasons(id,organisation_id,name,slug,status,entry_opens_at,entry_closes_at,starts_at,ends_at)
        overriding system value values
        (1,1,'Winter','eastern-winter-postal-league','completed',current_date-300,current_date-280,current_date-270,current_date-100),
        (2,1,'Summer','eastern-summer-league','open',current_date-40,current_date-20,current_date-10,current_date+100);
    `);
    await isolated.query(
      "insert into organisation_staff(organisation_id,user_id,role,status) values(1,$1,'owner','active')",
      [actors.owner],
    );
    const fixture = await sqlFile("development-competition-series-fixture");
    await isolated.exec(fixture);
    await isolated.exec(fixture);
    assert.deepEqual((await isolated.query(
      "select count(*)::int series_count,(select count(*)::int from competitions) competition_count,(select count(*)::int from competition_score_components) component_count from competition_series",
    )).rows[0], { series_count: 2, competition_count: 2, component_count: 2 });
    assert.equal((await isolated.query(
      "select identity_locked_at is not null locked from competition_series where slug='dev-short-range-prone-league'",
    )).rows[0].locked, true);
    assert.equal((await isolated.query(
      "select count(*)::int n from competition_series where discipline_code is not null or discipline_detail is not null",
    )).rows[0].n, 0);
  } finally {
    await isolated.close();
  }
});

test("Stage 2 creation UI omits discipline and keeps Series-name prefilling one-way", async () => {
  const [flow, form] = await Promise.all([
    readFile(new URL("../src/components/competition-creation-flow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/competition-form.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(`${flow}\n${form}`, /discipline[ _/-]|discipline$/im);
  for (const mode of ["continue_series", "new_series", "one_off"]) assert.match(flow, new RegExp(mode));
  assert.match(form, /Competition series name/);
  assert.match(form, /Used to identify this recurring Competition across Seasons\./);
  assert.match(form, /if \(!competitionNameEditedRef\.current\) setCompetitionName\(value\)/);
  const independentEdit = form.match(/function changeCompetitionName[\s\S]*?\n  }/)?.[0] ?? "";
  assert.match(independentEdit, /competitionNameEditedRef\.current = true/);
  assert.doesNotMatch(independentEdit, /setSeriesName/);
});
