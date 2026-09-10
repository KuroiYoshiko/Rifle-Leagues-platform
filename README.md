This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Supabase database setup

The application profile feature requires the SQL in
[`database/user-profiles.sql`](database/user-profiles.sql). Run the entire file
once in the Supabase Dashboard SQL Editor before testing `/dashboard` or
`/profile`.

The script is safe to rerun. It creates the private `public.profiles` table,
backfills existing Auth users from their first/last-name metadata, installs the
new-user and `updated_at` triggers, grants authenticated Data API access, and
enables owner-only Row Level Security policies.

No service-role key is used by the application and no additional environment
variables are required.

## Organisation management access

Run the complete [`database/organisation-staff.sql`](database/organisation-staff.sql)
file in the Supabase Dashboard SQL Editor after `database/user-profiles.sql` and
`database/organisations.sql`. This adds the separate organisation-management
relationship, its constraints and RLS policy, and the narrowly scoped RPCs used
to request, approve, reject, revoke, list, and transfer access.

The script is safe to rerun and does not modify `public.user_organisations`.
Dashboard follows remain personal shortcuts and never grant management access.
It also does not assign an owner automatically.

To assign the first owner of an existing development organisation, run the
guarded block below separately. Replace only the placeholder email and slug:

```sql
do $$
declare
  v_user_id uuid;
  v_organisation_id bigint;
  v_existing_owner_id uuid;
begin
  select users.id
  into v_user_id
  from auth.users as users
  where lower(users.email) = lower('your-test-user@example.com');

  if v_user_id is null then
    raise exception 'Bootstrap user does not exist.';
  end if;

  -- Lock this organisation so two bootstrap attempts cannot race.
  select organisations.id
  into v_organisation_id
  from public.organisations as organisations
  where organisations.slug = 'eastern-region-shooting-association'
  for update;

  if v_organisation_id is null then
    raise exception 'Bootstrap organisation does not exist.';
  end if;

  select staff.user_id
  into v_existing_owner_id
  from public.organisation_staff as staff
  where staff.organisation_id = v_organisation_id
    and staff.role = 'owner';

  if v_existing_owner_id is not null and v_existing_owner_id <> v_user_id then
    raise exception 'This organisation already has another owner.';
  end if;

  insert into public.organisation_staff (
    organisation_id,
    user_id,
    role,
    status
  )
  values (
    v_organisation_id,
    v_user_id,
    'owner',
    'active'
  )
  on conflict (organisation_id, user_id) do update
  set role = 'owner',
      status = 'active';
end;
$$;
```

The organisation row lock serialises bootstrap attempts. The block aborts
without changes if the Auth user or organisation does not exist, or if another
user is already the owner. Rerunning it for the same user and organisation is
safe.

## Organisation registration

Run the complete
[`database/organisation-registration.sql`](database/organisation-registration.sql)
file in the Supabase Dashboard SQL Editor after `database/organisations.sql` and
`database/organisation-staff.sql`. The file is safe to rerun.

It adds the organisation type, address, postcode, and telephone registration
fields, backfills pre-existing organisations to the `other` type, and creates
the authenticated `register_organisation` RPC. That RPC validates and inserts
the organisation and its first active owner in one database transaction. Direct
client inserts into either organisation table remain unavailable, and no
`user_organisations` follow row is created.

New organisation slugs are generated from their official names. A collision
with an existing slug is treated as a likely duplicate and registration stops
with no rows committed; the function does not create a random suffixed copy.

## Organisation About and Contact management

Run the complete
[`database/organisation-about-contact.sql`](database/organisation-about-contact.sql)
file in the Supabase Dashboard SQL Editor after `database/organisations.sql`,
`database/organisation-staff.sql`, and `database/organisation-registration.sql`.
The file is safe to rerun and does not create placeholder content.

It adds the single nullable `about_content` Markdown document to each
organisation and narrowly scoped About and structured Contact update RPCs.
Only the exact organisation's active owner can call either mutation. Managers
and other authenticated users retain read-only access, and direct client
`UPDATE` access to `public.organisations` remains revoked.

## Organisation information cards

Run the complete
[`database/organisation-information-cards.sql`](database/organisation-information-cards.sql)
file in the Supabase Dashboard SQL Editor after `database/user-profiles.sql`,
`database/organisations.sql`, and `database/organisation-staff.sql`. The file is
safe to rerun and does not add placeholder or development content.

It creates the generic information-card table, read-only authenticated access,
and the narrowly scoped create, update, delete, and atomic reorder RPCs. Only an
active organisation owner can call the write operations. Content is stored as
constrained Markdown (120-character titles and 20,000-character card content),
and the database permits at most five ordered cards per organisation.

## League seasons

Run the complete [`database/league-seasons.sql`](database/league-seasons.sql)
file in the Supabase Dashboard SQL Editor after `database/user-profiles.sql`,
`database/organisations.sql`, and `database/organisation-staff.sql`. The file is
safe to rerun and creates no example seasons.

It creates `public.league_seasons`, its constraints, indexes, audit trigger,
read-only authenticated Data API grant, and draft-aware RLS policy. Normal
authenticated viewers can read only `open`, `active`, and `completed` seasons;
an organisation's active owner can additionally read its drafts. Direct client
writes remain revoked.

The authenticated `create_league_season` and `update_league_season` RPCs verify
the active organisation and its exact active owner before every write. New
seasons are always drafts. Status can remain unchanged or move one step forward
through `draft`, `open`, `active`, and `completed`. Season route slugs are unique
within an organisation and remain stable after a rename.

For an existing populated installation that already has the season schema, run
the focused additive [`database/season-description.sql`](database/season-description.sql)
migration once. It adds the nullable, 2,000-character plain-text description
column and backward-compatible RPC overloads without resetting or reseeding any
season data. The migration is safe to rerun.

## Competition and round configuration

Run the complete
[`database/competition-rounds.sql`](database/competition-rounds.sql) file in the
Supabase Dashboard SQL Editor after `database/user-profiles.sql`,
`database/organisations.sql`, `database/organisation-staff.sql`, and
`database/league-seasons.sql`. The file is safe to rerun and creates no example
competitions or rounds.

It creates `public.competitions` and `public.competition_rounds`, their hard
limits, indexes, audit and validation triggers, read-only authenticated Data API
grants, and draft-aware RLS policies. Normal authenticated viewers can read only
published competitions within a public parent season; the exact active
organisation owner can additionally read private drafts. Direct table writes
remain revoked.

The authenticated `create_competition` and `update_competition` RPCs verify the
active organisation, exact season, exact competition, and active owner before
atomically saving configuration and the round schedule. New competitions are
always drafts, and publishing remains a deliberate validated transition.

For an existing populated installation, then run the complete focused additive
[`database/competition-configuration-refactor.sql`](database/competition-configuration-refactor.sql)
file after `database/season-description.sql`, `database/competition-rounds.sql`,
`database/competition-entries.sql`, and `database/competition-divisions.sql`.
It adds Competition date inheritance, optional Shoot-by dates, ranking and
scoring-access configuration, and the relational Course of Fire table. It
backfills existing one-score Competitions without replacing any Competition,
Round, Entry, Entrant, Participant, Division, or assignment row. No reset or
reseed is required. The historical baseline SQL files should be run before this
focused upgrade; rerun the upgrade last if a baseline file is reapplied.

Then run
[`database/competition-lifecycle-management.sql`](database/competition-lifecycle-management.sql)
after the Competition configuration refactor and Division SQL. It adds narrowly
scoped owner-only publish, return-to-draft, and safe-delete RPCs. Return to draft
and deletion are blocked atomically when any club entry, entrant, participant,
division configuration, division, or assignment exists. Safe deletion removes
only the Competition and its configuration-owned rounds and Course of Fire rows;
no database reset or reseed is required.

## Competition source scores and derived Round results

### Competition Series backend foundation (Stage 1)

After installing the current Competition configuration, lifecycle, source-score,
division, Results and Round Robin foundations documented below, run these complete
files in order:

1. [`database/competition-series.sql`](database/competition-series.sql)
2. [`database/competition-series-management.sql`](database/competition-series-management.sql)

No existing SQL needs rerunning on an up-to-date installation. Both new files are
additive and rerunnable; existing Competitions remain unlinked with unchanged IDs,
configuration and participation. Run this upgrade last if reapplying earlier SQL.

### Concurrent Shooting (Stages 1, 2, and 3A)

After all existing Competition, score, Series, and Average migrations through
`database/competition-averages-stage-3.sql`, run these complete files in order:

1. [`database/concurrent-shooting.sql`](database/concurrent-shooting.sql)
2. [`database/concurrent-shooting-stage-2.sql`](database/concurrent-shooting-stage-2.sql)
3. [`database/concurrent-shooting-stage-3a.sql`](database/concurrent-shooting-stage-3a.sql)
4. [`database/competition-shooting-details.sql`](database/competition-shooting-details.sql)
5. [`database/concurrent-shooting-physical-compatibility.sql`](database/concurrent-shooting-physical-compatibility.sql)

The first file adds opt-in Organisation/Season-scoped groups, explicit physical
Round mappings, strict server-derived Course-of-Fire signatures, lifecycle
guards, source association/version fields, and generic append-only audit
storage. The second adds atomic shared-score resolution and usage propagation,
optimistic conflicts, global clear, audit recording, late-entry reconciliation,
and shared score-entry metadata. The third adds narrow management read models
and an atomic Draft mapping setter for the Organisation Management workflow.
Existing unmapped scoring and Results remain unchanged; none of these files
creates links, merges sources, or backfills history.

The fourth file adds stable built-in equipment and position taxonomies,
normalised reusable Organisation custom values, Competition-level equipment,
and component-level position/style, distance, and physical shots. New structured
drafts derive `shots_per_round` on the server as sets multiplied by the sum of
component shots. Existing rows remain explicitly legacy (`shooting_details_version
IS NULL`) with no inferred values. Series identity and continuation preserve the
physical definition. The fifth file installs exact physical compatibility V2;
legacy or incomplete Competitions show “Physical shooting details required” and
cannot be newly linked merely because their score-entry shapes match.

See [the Concurrent Shooting architecture and deployment boundary](database/CONCURRENT-SHOOTING.md).
See [the structured physical shooting model](database/COMPETITION-SHOOTING-DETAILS.md)
for taxonomy, Series inheritance, legacy behavior, and analytics rationale.
Run `npm run test:concurrent` and `npm run test:shooting-details` for the disposable
PostgreSQL regression suites.
No reset, reseed, name-based association or live database application is automated.

This adds strict organisation-scoped Series identity, atomic first-draft and
continuation RPCs, manager draft authoring, source selection metadata and owner-only
Series lifecycle. It also repairs unchanged-component upserts when editing a scored
Competition's description. The Add Competition UI remains unchanged.

See [`database/COMPETITION-SERIES.md`](database/COMPETITION-SERIES.md) for the exact
RPC payloads, permission model, copy rules, deployment checks and Stage 2 checklist.
Run `npm run test:series` for disposable PGlite coverage.

### Source-score foundation

After the Competition configuration and entry foundations above, run these
focused additive files in this order:

1. [`database/competition-configuration-save-fix.sql`](database/competition-configuration-save-fix.sql)
2. [`database/competition-configuration-owner-save-fix.sql`](database/competition-configuration-owner-save-fix.sql)
3. [`database/competition-scores.sql`](database/competition-scores.sql)
4. [`database/competition-scores-deferred-trigger-security.sql`](database/competition-scores-deferred-trigger-security.sql)
5. [`database/competition-scores-participant-formats.sql`](database/competition-scores-participant-formats.sql)
6. [`database/competition-results.sql`](database/competition-results.sql)

The score files create participant-owned physical source scores and link them
to exact Competition participant/Round slots without copying the canonical
achieved value. The final results file adds an authenticated live read model for
Individual, Pair, and Team Round results. It stores no entrant totals. Required
slots are derived from `sets_per_round × score components`; missing rows remain
incomplete, X totals are exposed only for X-enabled Competitions, and a single
legacy display score is withheld for mixed scoring methods.

The foundation's diagnostic RPC remains restricted to organisation owners/managers
or the exact submitted club's owners/officials. Normal Competition Results now use
the separate released Aggregate API below. Manage Scores remains the live source
score editing workflow.

## Aggregate Competition Results

For an existing installation with the tested Results foundation, run these **complete
files in this order** in the Supabase SQL Editor:

1. [`database/competition-results.sql`](database/competition-results.sql) — rerun
   the updated foundation to extract its shared private derivation. The existing
   authorised diagnostic RPC keeps its signature and access checks.
2. [`database/competition-aggregate-results.sql`](database/competition-aggregate-results.sql)
   — add the released `get_competition_aggregate_results` RPC.

Both files are transactional and safe to rerun. They only define functions and
their grants/comments: no reset, reseed, source-score redesign, fake zeros, NSR
rows, materialized standings, or data backfill. Rerun the Aggregate file last if
reapplying earlier foundation SQL.

For the points-dropped standings update on an installation that already has the
shared foundation, rerun only `database/competition-aggregate-results.sql`.
It derives the homogeneous gun result directly from achieved/maximum totals and
uses that one value for Round placement, cells and overall totals. It no longer
depends on the foundation's presentation-only `display_score` field. No source
score, score-entry, shared derivation, or mixed-method behavior changes are needed.

## Gun Score Competition Results

For an existing installation, run these complete files in order:

1. [`database/competition-results.sql`](database/competition-results.sql) — ensure
   the current shared participant/entrant derivation is installed.
2. [`database/competition-gun-score-results.sql`](database/competition-gun-score-results.sql)
   — add the narrow public `get_competition_gun_score_results` RPC.

Gun Score standings accumulate complete released shooting results directly. Points
scored rank high-to-low; points dropped are derived from maximum minus canonical
achieved score and rank low-to-high. Equal primary totals use higher X only when X
is enabled, with exact equality retaining competition rank ties. NSR remains a
derived presentation state: it contributes no gun result, maximum, or X and does
not create a source row. Because no prior Gun Score attendance rule exists, the
read model does not add a scored-Round-count penalty or invalidate an entrant's
other complete Rounds. This is significant for accumulated points-dropped totals
and should be revisited only when a separate sporting policy is established.

The Competition page uses the same responsive Results matrix and participant
disclosures as Aggregate Results, but Gun Score cells contain no ranking-point
fields or badges. Anonymous readers call only the context-checked RPC; score-table
grants and RLS remain unchanged. Run `npm run test:gun-score` for its disposable
PGlite, route, loader, public-boundary, and rendered-matrix coverage.

The exact 397/400 versus 396/400 example also passes against the preceding
checked-in SQL: achieved descending is equivalent to dropped ascending for equal
maxima. A later live diagnostic resolved the Summer Pairs 200 discrepancy:
canonical participant scores actually summed to **3 and 4 achieved**, not 397 and
396. The private derivation returned those same achieved totals, and Aggregate
correctly returned **397 and 396 dropped**, placing Pair 2 first. The installed
Aggregate, shared derivation, and diagnostic function bodies matched these files;
the frontend passed their values and order through unchanged.

For that data discrepancy, no function rerun or ranking change is needed. An
authorised scorer should use Manage Scores for Round 1, check the original score
records, and enter each participant's **dropped points** in the Ex 200 fields.
For example, 199/200 achieved is entered as 1 dropped and is stored canonically as
199 achieved. Correct dropped totals of 3 and 4 produce achieved totals of 397
and 396 and standings of Pair 1 (3 dropped, 2 points), then Pair 2 (4 dropped,
1 point). Do not guess the participant split from a Pair total or bulk-invert
source rows. The diagnostic establishes the stored-data mismatch, but does not
identify who wrote the rows or whether they came from score entry or another
earlier data operation. No live source corrections have been applied by this work.

### Tracing an installed Aggregate discrepancy

Both the Competition page and its `/results` page call the real server loader
`src/lib/competition-aggregate-results.ts`. It uses `src/lib/supabase/server.ts`
and the configured `NEXT_PUBLIC_SUPABASE_URL`, issuing a POST to the default
public schema's `/rest/v1/rpc/get_competition_aggregate_results` with exactly
`p_organisation_id`, `p_league_season_id`, and `p_competition_id`. There is no
overload type encoded in that HTTP request: PostgREST resolves the installed
function from its schema, parameter names and values.

The loader returns the response unchanged. The Results table maps the returned
entrant order and renders `rounds[].gun_score`, `rounds[].ranking_points`,
`gun_total`, and `position`; it does not sort or substitute achieved totals.
The old diagnostic RPC/component is not called by either Results page.

If the runtime differs, run
[`database/diagnostics/aggregate-runtime.sql`](database/diagnostics/aggregate-runtime.sql)
in the same Supabase project as the app. Section 1 inventories all relevant
schemas/overloads and returns installed function definitions. Section 2 uses
your own existing Auth user UUID to run the exact RPC and compare its payload
with component configuration, upstream derived totals, and canonical released
source totals. It changes no database rows and rolls back its temporary claim.
Do not interpret scored-entry fields as canonical achieved values: for a
points-dropped component, score entry converts entered dropped points into
stored achieved points. Use the diagnostic's `stored_achieved_sum` to verify.

The runtime-path regression executes the actual Results route, Results loader,
Supabase SSR client/SDK and React table. Next request context and unrelated page
lookups are supplied by the test; only HTTP transport is intercepted to dispatch
the exact RPC request to PGlite. A two-Pair, one-Ex-200-component fixture verifies
397/396 achieved becomes 3/4 dropped with 2/1 points in both the payload and HTML.
The live-data regression uses synthetic participants with the confirmed stored
achieved sums of 3/4 and reproduces the reported 397/396 display and reversed
order through the actual SQL, SDK, loader and renderer. Correcting only those
fixture source values to achieved sums of 397/396 yields the expected 3/4 display
and 2/1 ranking points on the next read. This tests the read path after correction;
it does not alter live data or test the score-save RPC itself.

### Ranking and publication contract

- Source `achieved_score` remains authoritative. The shared foundation derives
  complete participant/entrant totals from all required participants, sets and
  components. PostgreSQL `numeric` arithmetic preserves score precision.
- A Round End is a **date**, inclusive for the whole UTC day. A Round releases
  when `(statement_timestamp() at time zone 'UTC')::date > deadline`. Release
  is independent of Shoot-by and viewer role. The source usage join is gated
  before reading any unreleased score values, including partial components/X.
- Before release, every cell is pending with null gun/X/points. After release,
  an incomplete entrant is NSR with null gun/X and zero ranking points. A real
  complete zero is a scored result. NSR contributes neither gun nor maximum/X
  to aggregates; entrants without scored Rounds have null gun totals.
- Each published division ranks complete entrant gun results by dropped points
  (`maximum - achieved`) ascending for homogeneous dropped courses, or achieved
  points descending for scored courses. X descending follows when `uses_x_score` is
  enabled. There is no separate configurable X tie-break flag in this schema.
  Remaining ties use competition rank (`1,1,3`), awarding `N - rank + 1` points
  where N includes every submitted entrant assigned to that division, including
  NSR. Five distinct scorers earn `5,4,3,2,1`; tied leaders earn `5,5,3,2,1`.
- Overall order: total ranking points descending; gun aggregate (points scored
  descending, points dropped ascending); then X descending when enabled.
  Dropped totals sum `maximum - achieved` across scored Rounds only, including
  when tied entrants have different attendance. Mixed courses show and compare
  normalized achieved totals instead of summing incompatible display values.
- Genuine overall ties share position and show `=`. Entrant ID provides stable
  display order within ties, never additional ranking points or a sporting win.
- Divisions are calculated independently. No division configuration means one
  ungrouped table. Draft or incomplete published allocations withhold standings
  until a complete allocation is published; no draft assignment is returned.
- Corrections recalculate on every Results request. React `cache` deduplicates
  only within a request; there is no persistent standings cache. The existing
  score-save action invalidates the organisation layout after a successful save.
  Results do not subscribe to live changes in other viewers' already-open tabs.

### Results UI and read scope

The Competition page and `/results` route now render compact division tables:
position/entrant, one column per Round, then Total. Round and Total cells share the
same hierarchy: the shooting result is primary and the Aggregate ranking-points
award is the small `pts` badge beneath it. Individual rows remain unchanged.
Pair/Team rows keep their label and club plus a native keyboard/touch-accessible
`details`/`summary` disclosure. Expanding it shows one participant per row with
released shooting results by Round, an individual shooting Total, and compact X
values when enabled; participants never receive Aggregate ranking points. Names
stay in a sticky column and the table remains horizontally scrollable on mobile.

Normal authenticated viewers of the exact active organisation / visible season /
published Aggregate Competition receive all participating clubs, matching the
published-division read scope. The RPC does not accept a club filter or release
override. It returns names, slots, clubs, standings, configured Round metadata,
and for Pair/Team entrants only the complete released participant gun/X results
and their released-round totals. Unreleased and incomplete participant values are
null; no contact details, profile IDs, component values, partial results or source
IDs cross the RPC boundary.
Source-table permissions/RLS are unchanged. Its privileged read is explicitly
authenticated, context-checked, uses an empty search path, and denies anonymous
execution; the shared private derivation is not executable by API readers.

The Internal Preview action and route rendering are retired. The old component,
types and restricted RPC remain documented as internal diagnostics only. Manage
Scores keeps its existing permissions and source-score workflow. Other ranking
methods display an unavailable state if their Results route is visited directly.

### Verification and deliberately deferred work

Run `npm run test:aggregate` for disposable PostgreSQL (PGlite) regression cases.
It applies both real SQL files twice to a minimal source-schema fixture and checks
Individual/Pairs/Team, 5..1 points, ties, NSR/zero, scored/dropped/mixed courses,
multi-set completeness, X, overall ordering, corrections, date boundaries,
division isolation, cross-club reads, private-field exclusion and denied access.
It does not connect to or modify the application database and is not a substitute
for verifying deployment-specific grants/schema in the Supabase project.

Focused 400-maximum cases cover Individual/Pairs/Team in both homogeneous modes:
397 achieved beats 396, displaying 3/4 dropped or 397/396 scored. Additional Pairs
cases check that 3 dropped beats 4 despite a lower X total; tied dropped results
use X then preserve unresolved ties; NSR earns zero; saved unreleased 400s stay
pending; and two released Rounds (397+395 versus 396+394 achieved) produce gun
totals of 8 versus 10 dropped with ranking-point totals of 10 versus 8. Route-level
assertions cover Total hierarchy, Pair/Team participant Round columns and totals,
X, unchanged Individual rendering, unreleased-value exclusion, and live source
corrections updating both participant and entrant totals.

Required application checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`,
and `git diff --check`.

Countback and later tie-break criteria are intentionally deferred: the repository
does not define them precisely. Also deferred: Best N Average, Round Robin, Gun
Score standings, promotion/relegation, Starting Average, payments, Concurrent
Shooting score orchestration, organisation-wide result search, and live push
updates to open Results.

## Club competition entries

Run the complete
[`database/competition-entries.sql`](database/competition-entries.sql) file
after the profile, organisation, organisation staff, clubs and memberships,
league seasons, and competition rounds SQL listed above. The file is safe to
rerun and creates no example entries.

It creates the club submission, entrant-unit, and participant tables; strict
RLS and Data API grants; club-owner/official mutation and roster RPCs; safe
member-facing competition reads; and the deduplicated MY ORGANISATIONS read
model. Entry mutations use database time and require a published competition,
an open parent season, and the configured inclusive entry window.

## Club roles and membership approval

Run the complete [`database/clubs-and-memberships.sql`](database/clubs-and-memberships.sql)
file in the Supabase Dashboard SQL Editor before testing club roles, membership
approval, the Members page, or Club settings.

The file is the canonical club schema and is safe to rerun. It preserves every
existing club and membership row, adds existing memberships as `member`, and
recreates only idempotent constraints, indexes, policies, triggers, grants, and
functions. It does not select an owner for an existing club.

After running the schema, bootstrap a specific existing development club owner
with this guarded SQL. Replace only the example email and slug:

```sql
do $$
declare
  v_user_id uuid;
  v_club_id bigint;
  v_membership_id bigint;
  v_existing_owner_id uuid;
begin
  select users.id
  into v_user_id
  from auth.users as users
  where lower(users.email) = lower('your-test-user@example.com');

  if v_user_id is null then
    raise exception 'Bootstrap user does not exist.';
  end if;

  select clubs.id
  into v_club_id
  from public.clubs as clubs
  where clubs.slug = 'basildon-rifle-and-pistol-club';

  if v_club_id is null then
    raise exception 'Bootstrap club does not exist.';
  end if;

  select memberships.id
  into v_membership_id
  from public.club_memberships as memberships
  where memberships.club_id = v_club_id
    and memberships.user_id = v_user_id
    and memberships.status = 'active';

  if v_membership_id is null then
    raise exception 'Bootstrap user is not an active member of this club.';
  end if;

  select memberships.user_id
  into v_existing_owner_id
  from public.club_memberships as memberships
  where memberships.club_id = v_club_id
    and memberships.role = 'owner';

  if v_existing_owner_id is not null and v_existing_owner_id <> v_user_id then
    raise exception 'This club already has another owner.';
  end if;

  update public.club_memberships
  set role = 'owner'
  where id = v_membership_id;
end;
$$;
```

The block changes exactly one active membership to `owner`. It raises a clear
error and rolls back without changes when the user, club, or active membership
does not exist, or when the club already has a different owner. Rerunning it for
the same user and club is a harmless no-op update.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

### Round Robin Results

The first Round Robin implementation adds persisted entrant-unit fixtures and
released match standings using the existing source-score derivation. Deploy
`database/competition-round-robin.sql`, then
`database/competition-round-robin-results.sql`. In development, run
`database/development-round-robin-fixture.sql` afterward.

See [the Round Robin implementation and deployment report](database/ROUND-ROBIN.md)
for lifecycle rules, NSR policy, expected standings, exact manual paths and checks.
Run `npm run test:round-robin` or the complete `npm run test:results`.
