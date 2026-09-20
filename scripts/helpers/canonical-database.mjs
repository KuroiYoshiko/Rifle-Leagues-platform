import { readFile } from "node:fs/promises";
import { CANONICAL_FRESH_INSTALL_ORDER } from "./database-install-manifest.mjs";

export async function sqlFile(name) {
  return readFile(new URL(`../../database/${name}.sql`, import.meta.url), "utf8");
}

// Disposable PostgreSQL with the real canonical application schema, triggers,
// constraints and grants. Only the Supabase-managed Auth surface is stubbed.
export async function installCanonicalDatabase(db, {
  competitionSeries = true,
  concurrentShooting = false,
  concurrentShootingStage2 = false,
  concurrentShootingStage3a = true,
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
  const seriesFiles = new Set([
    "competition-series",
    "competition-series-management",
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
  ]);
  const concurrentFiles = new Set([
    "concurrent-shooting",
    "concurrent-shooting-stage-2",
    "concurrent-shooting-stage-3a",
    "concurrent-shooting-physical-compatibility",
    "concurrent-shooting-management-ux",
    "concurrent-shooting-final-audit",
    "shooter-analytics",
  ]);

  const includeConcurrentBase = concurrentShooting || concurrentShootingStage2 || concurrentShootingStage3a;
  const installOrder = CANONICAL_FRESH_INSTALL_ORDER.filter((name) => {
    if (!competitionSeries && (seriesFiles.has(name) || concurrentFiles.has(name))) return false;
    if (name === "concurrent-shooting") return includeConcurrentBase;
    if (name === "concurrent-shooting-stage-2") return concurrentShootingStage2 || concurrentShootingStage3a;
    if (name === "concurrent-shooting-stage-3a") return concurrentShootingStage3a;
    if ([
      "concurrent-shooting-physical-compatibility",
      "concurrent-shooting-management-ux",
      "concurrent-shooting-final-audit",
      "shooter-analytics",
    ].includes(name)) return concurrentShootingStage3a;
    return true;
  });

  for (const name of installOrder) {
    try { await db.exec(await sqlFile(name)); }
    catch (error) { throw new Error(`Schema ${name}: ${error.message}`, { cause: error }); }
  }
}
