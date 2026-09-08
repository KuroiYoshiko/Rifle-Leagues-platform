import { readFile } from "node:fs/promises";

export async function sqlFile(name) {
  return readFile(new URL(`../../database/${name}.sql`, import.meta.url), "utf8");
}

// Disposable PostgreSQL with the real canonical application schema, triggers,
// constraints and grants. Only the Supabase-managed Auth surface is stubbed.
export async function installCanonicalDatabase(db, { competitionSeries = true } = {}) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
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
    ] : []),
  ]) {
    try { await db.exec(await sqlFile(name)); }
    catch (error) { throw new Error(`Schema ${name}: ${error.message}`, { cause: error }); }
  }
}
