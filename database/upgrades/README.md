# Existing database upgrades

The numbered `database/*.sql` files are the canonical schema for clean installs.
Do not paste or replay those subsystem files into an existing database.

Existing databases receive the targeted, dated upgrade files in this directory.
Each upgrade states the baseline it expects and should contain only the objects
that changed after that baseline. Do not replay removed historical stage files.

The `fix/prelaunch-ux-polish` application code requires:

`database/upgrades/2026-09-21_prelaunch-ux-polish.sql`

Apply that upgrade before, or in the same deployment as, the corresponding
application code. Run `npm run test:database-contracts` locally to verify the
current repository contract.
