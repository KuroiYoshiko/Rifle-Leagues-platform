export const CANONICAL_FRESH_INSTALL_ORDER = Object.freeze([
  "01_profiles",
  "02_organisations",
  "03_clubs",
  "04_seasons",
  "05_competitions",
  "06_entries",
  "07_divisions",
  "08_scoring",
  "09_club_operations",
  "10_results",
  "11_round_robin",
  "12_series",
  "13_averages",
  "14_shooting_details",
  "15_concurrent_shooting",
  "16_public_read_models",
  "17_shooter_analytics",
  "18_security_and_integrity",
]);

// Function-only terminal subsystems whose CREATE OR REPLACE definitions can be
// safely reapplied to a database already at the current schema version.
export const STANDALONE_RERUNNABLE_SQL_FILES = Object.freeze([
  "09_club_operations",
  "10_results",
  "16_public_read_models",
  "17_shooter_analytics",
]);

// The consolidated schema has no supported partial ordered bundle. Files not
// listed as standalone are fresh-install-only and must be installed together.
export const ORDERED_RERUN_BUNDLES = Object.freeze([]);
export const ORDERED_BUNDLE_ONLY_SQL_FILES = Object.freeze([]);

const standaloneFiles = new Set(STANDALONE_RERUNNABLE_SQL_FILES);
export const FRESH_INSTALL_ONLY_SQL_FILES = Object.freeze(
  CANONICAL_FRESH_INSTALL_ORDER.filter((name) => !standaloneFiles.has(name)),
);

// Targeted deployment artifacts for databases already at the documented
// baseline. These are tested separately from canonical fresh installs.
export const INCREMENTAL_UPGRADE_SQL_FILES = Object.freeze([
  "upgrades/2026-09-21_prelaunch-ux-polish",
]);

// Development utilities, fixtures, and diagnostics are never supported manual
// reruns against a current database.
export const NON_STANDALONE_SQL_FILES = Object.freeze([
  "dev/dev-reset-all-data",
  "dev/development-organisations",
  "dev/development-clubs",
  "dev/development-demo-seed",
  "dev/development-gun-score-fixture",
  "dev/development-round-robin-fixture",
  "dev/development-competition-series-fixture",
  "dev/development-averages-fixture",
  "diagnostics/aggregate-runtime",
]);
