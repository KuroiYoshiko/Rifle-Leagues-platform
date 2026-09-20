# Existing database upgrades

The numbered files in the database root are for clean installs, not incremental
upgrades.

An existing database that had the complete pre-cleanup schema installed already
matches the numbered schema and requires no reset, reseed, or SQL transition.
Run `npm run test:database-contracts` locally to verify the repository contract.

Future deployed-schema changes that cannot be applied by a documented
standalone rerun belong here as explicit, versioned upgrade artifacts. Do not
replay removed historical stage files against a current database.
