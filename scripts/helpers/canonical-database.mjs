import { readFile } from "node:fs/promises";
import { CANONICAL_FRESH_INSTALL_ORDER } from "./database-install-manifest.mjs";

export async function sqlFile(name) {
  return readFile(new URL(`../../database/${name}.sql`, import.meta.url), "utf8");
}

// Disposable PostgreSQL with the complete current application schema,
// triggers, constraints, RLS, and grants. Only Supabase-managed Auth is stubbed.
export async function installCanonicalDatabase(db) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    set timezone = 'UTC';
    create schema auth;
    grant usage on schema public,auth to anon,authenticated;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  `);

  for (const name of CANONICAL_FRESH_INSTALL_ORDER) {
    try {
      await db.exec(await sqlFile(name));
    } catch (error) {
      throw new Error(`Schema ${name}: ${error.message}`, { cause: error });
    }
  }
}
