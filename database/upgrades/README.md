# Existing database upgrades

The numbered `database/*.sql` files are the canonical schema for clean installs.
Do not paste or replay those subsystem files into an existing database.

Existing databases receive the targeted, dated upgrade files in this directory.
Each upgrade states the baseline it expects and should contain only the objects
that changed after that baseline. Do not replay removed historical stage files.

Application releases using prelaunch publication readiness, safe Club entry
context, and empty draft Season deletion require:

`database/upgrades/2026-09-21_prelaunch-ux-polish.sql`

Apply that upgrade before, or in the same deployment as, the corresponding
application code. Run `npm run test:upgrade-prelaunch-ux` to verify the upgrade
from its immutable historical baseline, then run `npm run test:database-contracts`
to verify the current canonical contract.
