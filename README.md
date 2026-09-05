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
- Each published division ranks complete entrant gun results by normalized
  achieved total descending, followed by X descending when `uses_x_score` is
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
position/entrant, one column per Round, then ranking-points total with supporting
gun/X totals. Individual rows show shooter names; Pair/Team rows show their label
and club, with native keyboard-accessible `details`/`summary` participant names
collapsed by default. Names stay in a sticky column; Round columns keep readable
widths inside a keyboard-focusable horizontal scrolling region on desktop/mobile.

Normal authenticated viewers of the exact active organisation / visible season /
published Aggregate Competition receive all participating clubs, matching the
published-division read scope. The RPC does not accept a club filter or release
override. It returns names, slots, clubs, standings, and configured Round metadata;
no contact details, profile IDs, component values, partial results or source IDs.
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

Required application checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`,
and `git diff --check`.

Countback and later tie-break criteria are intentionally deferred: the repository
does not define them precisely. Also deferred: Best N Average, Round Robin, Gun
Score standings, promotion/relegation, Starting Average, payments, Concurrent
Shooting, organisation-wide result search, and live push updates to open Results.

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
