# Database layout

The numbered SQL files in this directory are the complete current fresh-install
schema. Run `01_profiles.sql` through `18_security_and_integrity.sql` in numeric
order. The executable order and rerun classifications live in
`scripts/helpers/database-install-manifest.mjs`; `npm run test:database-contracts`
proves that order against disposable PGlite databases.

- `dev/` contains reset utilities, demo setup, and development fixtures. Never
  use these as production migrations.
- `upgrades/` documents or contains explicit transitions for already-deployed
  databases. A database already at the pre-cleanup current schema needs no SQL
  transition because this cleanup changes repository layout only.
- `diagnostics/` contains optional manual diagnostics.
- `docs/` contains subsystem and deployment documentation.

Do not manually execute removed historical stage files or individual numbered
files outside the rerun contract. Older definitions can overwrite current
functions or grants even when they appear additive.
