# Database install and rerun contract

The executable source of truth is
`scripts/helpers/database-install-manifest.mjs`. Its
`CANONICAL_FRESH_INSTALL_ORDER` is the complete current fresh-install order used
by the disposable canonical database installer.

The following files are supported as standalone reruns against a current
database:

- `organisation-registration.sql`, `organisation-about-contact.sql`,
  `season-description.sql`, and `club-teams.sql`;
- `competition-configuration-save-fix.sql`,
  `competition-configuration-owner-save-fix.sql`, and
  `competition-scores-deferred-trigger-security.sql`;
- `club-operational-summaries.sql`;
- `competition-aggregate-results.sql`, `competition-gun-score-results.sql`,
  `competition-best-n-average-results.sql`, and
  `competition-round-robin-results.sql`;
- `my-shooting-competitions.sql`,
  `competition-series-one-edition-per-season.sql`,
  `competition-averages-stage-3.sql`, and `shooter-analytics.sql`.

Every other file in the canonical install order is supported for reapplication
only through the manifest's `complete-current-schema` ordered bundle. Do not
manually rerun one of those older foundations alone: it can replace a newer
function definition or reinstate an obsolete explicit column-grant list.

Development fixtures, `dev-reset-all-data.sql`, and diagnostic SQL are listed in
`NON_STANDALONE_SQL_FILES`. They are not deployment inputs and must not be run as
schema upgrades. Run `npm run test:database-contracts` before changing the
classification or deployment order.

