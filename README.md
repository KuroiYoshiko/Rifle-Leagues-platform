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
atomically saving configuration and explicit round deadlines. New competitions
are always drafts. Publishing is a deliberate one-way transition and requires
complete scoring values plus one chronological, in-season deadline for every
configured round.

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
