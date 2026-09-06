# First Round Robin implementation

Implemented against the repository's current canonical SQL schema and verified
in disposable PGlite databases. No connected Supabase database was reset, reseeded,
or changed during implementation. Aggregate and Gun Score derivations and their
test files are unchanged.

## 1. Architecture and generation algorithm

The inspection covered Competition configuration and lifecycle RPCs, effective
dates and Round validators, Division draft/publication RPCs, submitted club
entries, entrant units and participant memberships, source-score tables and
permissions, shared Round-result derivation, both existing Results RPCs and UI,
the anonymous catalog/routes, and the existing development Gun Score fixture.

Fixtures use the circle method. Entrant IDs are sorted ascending; the first slot
stays fixed and the remaining slots rotate. Odd Divisions get one NULL ghost
slot. Its real opponent receives the bye fixture. Each entrant appears once per
matchday, every unordered pair appears once per cycle, and each odd-Division
entrant receives one bye per cycle. One-entrant Divisions contain a score-required
bye each Round. An even N has N−1 matchdays; an odd N has N. Additional Competition
Rounds repeat from matchday one. Shorter competitions use the initial matchdays.
`number_of_rounds` is never changed by the generator.

## 2. Fixture lifecycle

The existing `publish_competition_divisions` RPC performs its normal organisation
owner/manager, effective Entry Close and exact-allocation checks. An AFTER trigger
on Division configuration generates the schedule in the same transaction. The
existing `save_and_publish_competition_divisions` RPC therefore uses the same path.

Publication requires a nonempty complete Division allocation, all configured
Competition Rounds, and an effective Start strictly after today's UTC date.
Existing schedules are retained on publication retries. Before Start, the
existing **Edit divisions** action clears fixtures and returns allocations to
draft; republication rebuilds them deterministically.

From Start, published Divisions cannot return to draft. While fixtures exist,
entry/entrant/participant composition, Division assignment and Round identities
cannot change. Competition format, round count, ranking method, parent season
and publication status also cannot change underneath the schedule. The Start of
a live scheduled competition cannot be moved to reopen editing, including via
an inherited Season Start. Round End/Shoot-by dates and source corrections retain
their existing validation and release behavior.

A preexisting live Round Robin without fixtures is **not backfilled**. Results
fail closed with an organiser-attention message. New publication/start changes
cannot put a competition into that state; if time passes before Divisions are
finalised, Results explicitly report the missing configuration. There is no
automatic scheduler or live reshuffle.

## 3. Match and bye semantics

For two complete released entrant results, higher points-scored gun result wins;
lower points-dropped gun result wins. Only equal primary results compare X when
`uses_x_score` is enabled. Equal primary and enabled X results draw. No countback.

| Outcome | Round Robin match points |
|---|---:|
| W | 2 |
| D | 1 each |
| L | 0 |
| Bye with complete released score | 2 |
| Bye with incomplete/missing score | NULL: no award |
| Pending or unresolved match | NULL: no award |

NULL awards contribute nothing to accumulated match points; they are not stored
zeros or fabricated losses. Pair/Team fixtures and match points belong to the
whole entrant unit. Participant results use the existing completeness and total
derivation; participants never become opponents or earn separate match points.

## 4. NSR ambiguity

The available repository/legacy descriptions establish NSR for incomplete
released scores but do not establish a one-sided forfeit or both-NSR match-point
rule. Both cases therefore return `unresolved`, with no match points awarded to
either entrant. Each entrant independently retains its scored or NSR state.
Standings containing unresolved matches display a provisional explanation.
Incomplete byes return `bye_nsr`, visibly **Bye · no win / No points awarded**.
Source corrections automatically resolve matches on the next Results request.

## 5. Standings

Each published Division ranks by total match points descending, then complete
released gun aggregate (scored descending / dropped ascending), then X aggregate
descending when enabled. Mixed Course-of-Fire totals follow the existing
canonical achieved-total convention. NSR supplies no gun or X total. A missing
gun total sorts after real totals. Equal implemented criteria share a position
with `=`; entrant IDs only stabilise display order within a tie. There is no
attendance tie-break or countback.

## 6. Database and RPC changes

`competition-round-robin.sql` adds one RLS-protected table,
`public.competition_round_robin_fixtures`, with Competition, Division, Round,
match number, entrant A and nullable entrant B. The composite primary key is its
stable identity; foreign keys, indexes and a no-self-match check are included.
It adds the private generator, circle function and lifecycle/protection triggers.
No winners, shooting totals or match points are persisted.

`competition-round-robin-results.sql` adds the narrow
`get_competition_round_robin_results(bigint,bigint,bigint)` RPC. It calls
`private.derive_competition_round_results(..., true)` once. Shooting mathematics,
participant completeness, canonical achieved storage, and points-dropped display
all remain in the existing source-score architecture.

## 7–8. UI and public Results

The Competition page selects the new RPC only for `round_robin`. A compact,
horizontally scrollable table shows position, entrant/club, each opponent, gun
result, W/D/L/Bye state, match points and accumulated totals. It retains sticky
entrant headers, short dates without year and the existing collapsible Pair/Team
participant breakdown. Configuration and Division pages explain the lifecycle;
the score-entry page links to Results.

Anonymous users use the same route and narrow RPC. It requires an active exact
Organisation, public Season and published Competition with published allocations
and fixtures. Future opponents/byes are intentionally visible as the public
schedule. Until the UTC date is **strictly after** a Round's inclusive End date,
gun values, X, outcomes and match-point awards remain Pending/NULL, including
participant values. Shoot-by does not release results. Source/profile IDs,
contact fields, draft allocations and management controls are excluded.
No anon/authenticated direct fixture-table access or additional source-table
grants are introduced; private helper execution is revoked from client roles.

## 9. Files changed

- Added `database/competition-round-robin.sql`,
  `database/competition-round-robin-results.sql`,
  `database/development-round-robin-fixture.sql`, and this report.
- Added `src/lib/competition-round-robin-results.ts` and
  `src/components/competition-round-robin-results.tsx`.
- Updated the Competition overview, score-entry and Division management pages
  under `src/app/(app)/organisations/[slug]/leagues/[seasonSlug]/competitions/[competitionSlug]/`.
- Updated `src/components/competition-form.tsx`; exported the unchanged
  participant breakdown from `src/components/competition-aggregate-results.tsx`.
- Added `scripts/helpers/canonical-database.mjs` and
  `scripts/test-round-robin-results.mjs`; extended the existing route-test helper
  to load the new route dependencies. Existing Aggregate/Gun Score tests unchanged.
- Updated `package.json` test commands and `README.md` deployment link.

## 10–11. Exact deployment order on the existing Supabase database

For the current installation with working Aggregate/Gun Score Results and the
current configuration, Division and source-score schema already deployed, run
each complete file in the Supabase SQL Editor, in this order:

1. **`database/competition-round-robin.sql`** — additive table, generator and guards.
2. **`database/competition-round-robin-results.sql`** — public released Results RPC.
3. Deploy the application changes.
4. Development database only: **`database/development-round-robin-fixture.sql`**.

Do not rerun the demo seed or reset the database. The fixture reuses Eastern
Region Shooting Association, Eastern Summer League, Basildon and Northbridge,
Eleanor's existing management access, and ten existing development memberships.
It requires the Season to encompass today−10 through today+14, otherwise it
aborts without altering the Season. Reserved slugs require the exact DEV marker.
Reruns replace only these two DEV competitions; externally reused score sources
are preserved. It creates the schedule through the production publication RPC,
then advances its own simulated lifecycle by backdating Start/Round dates inside
the transaction. It never disables triggers. Assertions and deferred constraints
must pass before commit.

## 12. Expected development standings and notable results

**DEV Round Robin Individual**: all three Rounds released.

| Position | Entrant | Match points | Gun aggregate | X |
|---|---|---:|---:|---:|
| 1 | George Foster | 4 | 294 | 14 |
| 2 | Sophie Turner | 3 | 294 | 12 |
| 3 | Harry Collins | 3 | 292 | 9 |
| 4 | Isla Morgan | 2 | 292 | 6 |

R1: George beats Isla 99–97; Sophie/Harry draw 98/4X each.
R2: Harry beats George 98/2X–97/8X; Sophie beats Isla 99–96.
R3: George beats Sophie 98–97; Isla beats Harry 99–96.
Sophie wins the gun-aggregate tie-break over Harry at three match points each.

**DEV Round Robin Bye Test**: Pairs, points dropped; R1–R5 released, R6 future.

| Position | Entrant | Club | Match points | Dropped aggregate |
|---|---|---|---:|---:|
| 1 | Pair 1 | Basildon | 10 | 10 |
| 2 | Pair 2 | Basildon | 8 | 20 |
| 3 | Pair 3 | Basildon | 6 | 30 |
| 4 | Pair 4 | Northbridge | 2 | 32 |
| 5 | Pair 5 | Northbridge | 2 | 50 |

Byes rotate through Pair 1, Pair 4, Pair 2, Pair 5, Pair 3. Pair 4 lacks its
second participant's R2 score, so that bye awards no win. The other complete byes
award two points. Pair 4 beats Pair 5 on dropped aggregate at two match points.
R6 repeats R1 opponents; both participants have early 100 achieved source scores,
but all R6 gun values/outcomes/points remain Pending. Its Shoot-by is yesterday.

## 13. Manual URLs and checks

Append these exact paths to your app origin (for local development,
`http://localhost:3000`):

- `/organisations/eastern-region-shooting-association/leagues/eastern-summer-league/competitions/dev-round-robin-individual#results`
- `/organisations/eastern-region-shooting-association/leagues/eastern-summer-league/competitions/dev-round-robin-bye-test#results`

Check the standings above signed out. Expand Pair 4 participants: Alfie has a
released R2 result; Phoebe is NSR; the whole Pair's bye has no award. R6 shows
opponents/bye and Pending, with no early 100s, combined 200, dropped zero or
participant score values. Check mobile horizontal scrolling and compact dates.
While signed in as the existing organisation owner, open each base path plus
`/divisions`: Edit divisions must reject the now-live fixture. Open `/scores`
for central score entry and correct the missing Pair 4/R2 participant; the bye
then earns two points on the next Results request. The fixture rerun restores
the documented scenarios. Local club score entry remains governed by the
existing local-scoring permission and Shoot-by cutoff.

## Verification

12 Round Robin tests run on the real canonical schema and production SQL,
including the complete development script twice, marker rejection rollback,
unchanged real Gun Score fixture payloads, schedule properties, release/X/NSR,
Pair/Team derivation, standings and anonymous/management permissions.
Existing Results suites (34 Aggregate, 14 Gun Score, 18 public, 8 saved) and
16 club-operation tests pass. Lint, `tsc --noEmit`, production build and
`git diff --check` pass. Browser checks inspected the actual rendered components
with production CSS at desktop and 390px widths and expanded the NSR Pair
breakdown, using only isolated fixture data.
