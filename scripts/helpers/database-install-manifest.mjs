export const CANONICAL_FRESH_INSTALL_ORDER = Object.freeze([
  "user-profiles",
  "organisations",
  "organisation-staff",
  "organisation-registration",
  "organisation-about-contact",
  "organisation-information-cards",
  "clubs-and-memberships",
  "club-foundation",
  "league-seasons",
  "season-description",
  "competition-rounds",
  "competition-entries",
  "club-teams",
  "competition-divisions",
  "competition-configuration-refactor",
  "competition-configuration-save-fix",
  "competition-configuration-owner-save-fix",
  "competition-lifecycle-management",
  "competition-scores",
  "competition-scores-deferred-trigger-security",
  "competition-scores-participant-formats",
  "club-operational-summaries",
  "competition-results",
  "competition-aggregate-results",
  "competition-gun-score-results",
  "competition-best-n-average-results",
  "public-results",
  "my-shooting-competitions",
  "competition-round-robin",
  "competition-round-robin-results",
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
  "concurrent-shooting",
  "concurrent-shooting-stage-2",
  "concurrent-shooting-stage-3a",
  "competition-shooting-details",
  "concurrent-shooting-physical-compatibility",
  "concurrent-shooting-management-ux",
  "concurrent-shooting-final-audit",
  "shooter-analytics",
]);

// These terminal/additive files may be reapplied individually to a current
// database. Everything else in the canonical chain must use the ordered bundle.
export const STANDALONE_RERUNNABLE_SQL_FILES = Object.freeze([
  "organisation-registration",
  "organisation-about-contact",
  "season-description",
  "club-teams",
  "competition-configuration-save-fix",
  "competition-configuration-owner-save-fix",
  "competition-scores-deferred-trigger-security",
  "club-operational-summaries",
  "competition-aggregate-results",
  "competition-gun-score-results",
  "competition-best-n-average-results",
  "my-shooting-competitions",
  "competition-round-robin-results",
  "competition-series-one-edition-per-season",
  "competition-averages-stage-3",
  "shooter-analytics",
]);

export const ORDERED_RERUN_BUNDLES = Object.freeze([
  Object.freeze({
    id: "complete-current-schema",
    description:
      "Reapply the complete current schema in canonical order so later grants and function definitions win.",
    files: CANONICAL_FRESH_INSTALL_ORDER,
  }),
]);

const standaloneFiles = new Set(STANDALONE_RERUNNABLE_SQL_FILES);
export const ORDERED_BUNDLE_ONLY_SQL_FILES = Object.freeze(
  CANONICAL_FRESH_INSTALL_ORDER.filter((name) => !standaloneFiles.has(name)),
);

// These files are tools or fixtures, not schema deployment inputs. They must
// never be treated as safe manual migrations for an upgraded database.
export const NON_STANDALONE_SQL_FILES = Object.freeze([
  "dev-reset-all-data",
  "development-organisations",
  "development-clubs",
  "development-demo-seed",
  "development-gun-score-fixture",
  "development-round-robin-fixture",
  "development-competition-series-fixture",
  "development-averages-fixture",
  "diagnostics/aggregate-runtime",
]);

