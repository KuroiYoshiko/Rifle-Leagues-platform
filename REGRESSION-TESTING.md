# Regression testing

Use `npm run test:critical-regressions` before committing a shared or cross-feature change. It combines the database contracts, one connected domain smoke fixture, the real Chromium print-media contract, and the focused UI/domain tests with the widest blast radius. Use `npm run test:full-regression` before a significant merge or release; it runs every `scripts/test-*.mjs` file serially.

The print contract needs Playwright Chromium once per machine:

```bash
npx playwright install chromium
```

## Change scope

| Changed area | Minimum regression coverage |
| --- | --- |
| `src/app/globals.css` or print markup | `test:critical-regressions` (Results + Statistics real print media) |
| Competition projections, grants, canonical schema, or installer | `test:database-contracts`; use `test:full-regression` for schema/installer changes |
| Results SQL, loaders, or components | critical cross-feature smoke plus the affected Results suite |
| Entrant labels or Pair/Team snapshots | Club Teams, Results, Divisions, and My Shooting |
| Entry save/submit RPCs | Individual, Pair, and Team entry coverage in critical cross-feature + Club Teams |
| Average or Division behavior | Averages, Running Average, and Division seeding |
| Competition Series | Series plus database contracts |
| Concurrent physical-source logic | Concurrent, Results, and shooter analytics |
| Analytics or My Shooting shared models | Analytics, Statistics, Overview, and My Shooting |

Focused commands remain useful while iterating; the two aggregate commands are safety gates, not replacements for selecting the directly affected domain suite.
