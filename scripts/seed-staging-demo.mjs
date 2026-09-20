#!/usr/bin/env node

// DEVELOPMENT / STAGING ONLY
// DESTRUCTIVE PRECONDITION: run database/dev/dev-reset-all-data.sql first.
// DO NOT RUN AGAINST PRODUCTION.

import process from "node:process";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { buildStagingDemoModel } from "./lib/staging-demo-model.mjs";
import { seedStagingDemoDomain } from "./lib/seed-staging-demo-domain.mjs";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name, argumentName = name.toLowerCase().replaceAll("_", "-")) {
  const value = argument(argumentName) ?? process.env[name];
  if (!value) throw new Error(`Missing ${name} (or --${argumentName}).`);
  return value;
}

const showcaseUserId = required("SHOWCASE_USER_ID", "showcase-user-id");
const showcaseEmail = required("SHOWCASE_EMAIL", "showcase-email").toLowerCase();
const showcaseFirstName = required("SHOWCASE_FIRST_NAME", "showcase-first-name");
const showcaseLastName = required("SHOWCASE_LAST_NAME", "showcase-last-name");
const supabaseUrl = required("SUPABASE_URL");
const supabaseSecretKey = required("SUPABASE_SECRET_KEY");
const databaseUrl = required("SUPABASE_DB_URL");

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(showcaseUserId)) {
  throw new Error("SHOWCASE_USER_ID must be a non-zero UUID.");
}
if (showcaseUserId === "00000000-0000-0000-0000-000000000000") {
  throw new Error("SHOWCASE_USER_ID must not be the zero UUID.");
}
if (!showcaseEmail.includes("@")) throw new Error("SHOWCASE_EMAIL is invalid.");

const model = buildStagingDemoModel({
  email: showcaseEmail,
  firstName: showcaseFirstName,
  lastName: showcaseLastName,
});
model.showcaseUserId = showcaseUserId;

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: process.env.SUPABASE_DB_SSL === "disable" ? false : "require",
  idle_timeout: 20,
  connect_timeout: 20,
});
const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const createdSyntheticUserIds = [];

async function preflight() {
  const [state] = await sql`
    select
      (select count(*)::integer from auth.users) as auth_users,
      exists (select 1 from auth.users where id = ${showcaseUserId}::uuid
        and lower(email) = ${showcaseEmail}) as showcase_matches,
      exists (select 1 from auth.identities where user_id = ${showcaseUserId}::uuid) as showcase_has_identity,
      current_date::text as database_date,
      (
        select count(*) = 3
        from public.shooting_equipment_types
        where code in ('smallbore_rifle', 'air_rifle', 'gallery_rifle')
      ) as has_required_equipment,
      (
        select count(*) = 4
        from public.shooting_positions
        where code in ('prone', 'standing', 'kneeling', 'benchrest')
      ) as has_required_positions,
      (
        (select count(*) from public.average_contexts) +
        (select count(*) from public.average_policies) +
        (select count(*) from public.average_policy_versions) +
        (select count(*) from public.club_competition_entries) +
        (select count(*) from public.club_information_cards) +
        (select count(*) from public.club_memberships) +
        (select count(*) from public.clubs) +
        (select count(*) from public.competition_average_settings) +
        (select count(*) from public.competition_division_assignments) +
        (select count(*) from public.competition_division_configs) +
        (select count(*) from public.competition_divisions) +
        (select count(*) from public.competition_entrant_participants) +
        (select count(*) from public.competition_entrants) +
        (select count(*) from public.competition_participant_starting_averages) +
        (select count(*) from public.competition_round_robin_fixtures) +
        (select count(*) from public.competition_rounds) +
        (select count(*) from public.competition_score_components) +
        (select count(*) from public.competition_score_usages) +
        (select count(*) from public.competition_series) +
        (select count(*) from public.competition_series_average_defaults) +
        (select count(*) from public.competition_series_score_components) +
        (select count(*) from public.competition_starting_average_finalisations) +
        (select count(*) from public.competitions) +
        (select count(*) from public.concurrent_shooting_group_competitions) +
        (select count(*) from public.concurrent_shooting_groups) +
        (select count(*) from public.concurrent_shooting_round_mappings) +
        (select count(*) from public.concurrent_shooting_rounds) +
        (select count(*) from public.league_seasons) +
        (select count(*) from public.organisation_equipment_types) +
        (select count(*) from public.organisation_information_cards) +
        (select count(*) from public.organisation_shooting_positions) +
        (select count(*) from public.organisation_staff) +
        (select count(*) from public.organisations) +
        (select count(*) from public.profiles) +
        (select count(*) from public.shooting_score_change_events) +
        (select count(*) from public.shooting_score_sources) +
        (select count(*) from public.shooting_score_values) +
        (select count(*) from public.starting_average_score_sources) +
        (select count(*) from public.user_organisations)
      )::integer as application_rows
  `;
  if (state.auth_users !== 1 || !state.showcase_matches || !state.showcase_has_identity) {
    throw new Error(
      "Safety preflight failed: the reset database must contain exactly the matching showcase Auth user with an identity.",
    );
  }
  if (state.database_date < "2026-09-06" || state.database_date > "2026-09-19") {
    throw new Error(
      `Safety preflight failed: database date ${state.database_date} is outside the seed's 2026-09-06..2026-09-19 release window.`,
    );
  }
  if (!state.has_required_equipment || !state.has_required_positions) {
    throw new Error("Safety preflight failed: required built-in shooting taxonomies are missing.");
  }
  if (state.application_rows !== 0) {
    throw new Error(
      `Safety preflight failed: found ${state.application_rows} application row(s) across the complete audited schema. Run database/dev/dev-reset-all-data.sql first.`,
    );
  }
}

async function createSyntheticUsers() {
  const syntheticShooters = model.shooters.filter((shooter) => !shooter.showcase);
  for (let offset = 0; offset < syntheticShooters.length; offset += 5) {
    const batch = syntheticShooters.slice(offset, offset + 5);
    const results = await Promise.allSettled(batch.map(async (shooter) => {
      const { data, error } = await supabase.auth.admin.createUser({
        email: shooter.email,
        email_confirm: true,
        user_metadata: { first_name: shooter.firstName, last_name: shooter.lastName },
        app_metadata: { rifle_leagues_fixture: "staging-history-v1" },
      });
      if (error || !data.user) {
        throw new Error(`Could not create synthetic Auth principal ${shooter.key}: ${error?.message ?? "no user returned"}`);
      }
      shooter.authId = data.user.id;
      createdSyntheticUserIds.push(data.user.id);
    }));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        `Could not create ${failures.length} synthetic Auth principal(s) in batch.`,
      );
    }
  }
  model.shooters.find((shooter) => shooter.showcase).authId = showcaseUserId;
}

async function cleanupSyntheticUsers() {
  const failures = [];
  for (const userId of createdSyntheticUserIds.reverse()) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) failures.push(`${userId}: ${error.message}`);
  }
  if (failures.length > 0) {
    console.error("Synthetic Auth cleanup failures:\n" + failures.join("\n"));
  }
}

console.warn("DEVELOPMENT / STAGING ONLY — deterministic Rifle Leagues history seed");
console.warn("Target showcase account:", showcaseEmail);

try {
  await preflight();
  await createSyntheticUsers();
  const summary = await seedStagingDemoDomain(sql, model);
  console.log("Staging history seed succeeded:");
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (createdSyntheticUserIds.length > 0) await cleanupSyntheticUsers();
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
