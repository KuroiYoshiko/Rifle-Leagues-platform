import { readFile } from "node:fs/promises";

export async function sqlFile(name) {
  return readFile(new URL(`../../database/${name}.sql`, import.meta.url), "utf8");
}

// Disposable PostgreSQL with the real canonical application schema, triggers,
// constraints and grants. Only the Supabase-managed Auth surface is stubbed.
export async function installCanonicalDatabase(db, {
  competitionSeries = true,
  concurrentShooting = false,
  concurrentShootingStage2 = false,
  concurrentShootingStage3a = false,
} = {}) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    set timezone = 'UTC';
    create schema auth;
    grant usage on schema public,auth to anon,authenticated;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  `);
  for (const name of [
    "user-profiles", "organisations", "organisation-staff", "organisation-registration",
    "organisation-about-contact", "organisation-information-cards",
    "clubs-and-memberships", "club-foundation", "league-seasons", "competition-rounds",
    "competition-entries", "competition-divisions", "competition-configuration-refactor",
    "competition-configuration-save-fix", "competition-configuration-owner-save-fix",
    "competition-lifecycle-management", "competition-scores",
    "competition-scores-deferred-trigger-security", "competition-scores-participant-formats",
    "competition-results", "competition-aggregate-results", "competition-gun-score-results", "public-results",
    "competition-round-robin", "competition-round-robin-results",
    ...(competitionSeries ? [
      "competition-series", "competition-series-management",
      "competition-published-configuration-lock",
      "competition-series-stage-2-management",
      "competition-series-v1-identity-without-discipline",
      "competition-series-one-edition-per-season",
      "competition-averages",
      "competition-average-series-defaults",
      "competition-averages-stage-2a",
      "competition-averages-stage-2b",
      "competition-averages-optional-null",
      "competition-averages-stage-3",
      "competition-shooting-details",
    ] : []),
    ...(concurrentShooting || concurrentShootingStage2 || concurrentShootingStage3a
      ? ["concurrent-shooting"]
      : []),
    ...(concurrentShootingStage2 || concurrentShootingStage3a
      ? ["concurrent-shooting-stage-2"]
      : []),
    ...(concurrentShootingStage3a ? ["concurrent-shooting-stage-3a"] : []),
    ...(concurrentShootingStage3a ? ["concurrent-shooting-physical-compatibility"] : []),
    ...(concurrentShootingStage3a ? ["concurrent-shooting-management-ux"] : []),
  ]) {
    try { await db.exec(await sqlFile(name)); }
    catch (error) { throw new Error(`Schema ${name}: ${error.message}`, { cause: error }); }
  }
}
