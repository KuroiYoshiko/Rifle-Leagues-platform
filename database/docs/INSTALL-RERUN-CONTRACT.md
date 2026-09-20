# Database install and rerun contract

The executable source of truth is
`scripts/helpers/database-install-manifest.mjs`.

The 18 numbered root SQL files are the complete fresh-install schema and run in
numeric order. Most create tables or global integrity metadata and are therefore
fresh-install-only.

Only these function-only files are supported standalone reruns against a
database already at the current schema version:

- `09_club_operations.sql`
- `10_results.sql`
- `16_public_read_models.sql`
- `17_shooter_analytics.sql`

There is currently no supported ordered partial-rerun bundle. Development SQL,
diagnostics, and upgrade documentation are non-canonical inputs. Run
`npm run test:database-contracts` before changing the install order or any rerun
classification.
