# Competition Series backend foundation

Stage 1 only: no Add Competition UI, historical linking, public Series history,
templates, persistent Pair/Team identity, averages, payments or source-score reuse.

Stage 2 adds the authenticated Add Competition and minimum Series management UI.
The V1 identity correction removes the earlier non-authoritative discipline fields
from product behaviour while retaining their nullable database columns safely.

## Deployment

On an installation that already has Competition Series Stage 1, run in order:

1. `database/competition-series-stage-2-management.sql`
2. `database/competition-series-v1-identity-without-discipline.sql`
3. `database/competition-series-one-edition-per-season.sql`

If either earlier Stage 2 file was already applied, do not rerun it merely for
this change; apply the remaining files in the listed order.

The previously deployed `database/competition-published-configuration-lock.sql`
does not need to be rerun for Stage 2.

For a fresh installation with the current README Competition, source-score,
lifecycle, division and Round Robin foundations, run these complete transactional
files in order:

1. `database/competition-series.sql`
2. `database/competition-series-management.sql`
3. `database/competition-published-configuration-lock.sql`
4. `database/competition-series-stage-2-management.sql`
5. `database/competition-series-v1-identity-without-discipline.sql`
6. `database/competition-series-one-edition-per-season.sql`

All six are rerunnable. The hardening file does not require either Stage 1 file
to be rerun on an up-to-date installation. For a fresh installation run the existing
foundations first, then these files last.
If an earlier configuration/lifecycle file is reapplied later, rerun the listed
Competition Series files in this order. The two contract corrections must remain
after the Stage 2 management file and in the listed order because earlier files
can replace upgraded RPCs or triggers.

None of these scripts infers or links history, rewrites configuration, resets data or seeds
examples. Existing Competition IDs, slugs, timestamps, components and Rounds remain
intact; all new fields start NULL. No script is applied automatically by the app.

## Relational contract

`competition_series` owns the Organisation-scoped historical identity and ordered
`competition_series_score_components`. Editions retain their own operational
Competition/component/Round records; existing Results never join Series tables.

The Series contract includes entry format, normalised team size (1/2/3–20), sets,
optional shots, and ordered Course-of-Fire labels, maxima and scoring methods.
Series slugs are unique within an Organisation and immutable. Display names need
not be unique. Multiple editions in one Season are allowed, while the existing
Season-scoped Competition name/slug uniqueness still applies.

The nullable `discipline_code` and `discipline_detail` columns remain only as
deprecated metadata for additive compatibility. Current RPC writes ignore them;
they are not required, copied, compared, finalised, versioned or exposed in the UI.
Existing values are neither rewritten nor inferred from Competition or Series names.
They have no average, Concurrent Shooting or other compatibility meaning.

The sole unpublished first draft may correct identity. Existing `update_competition`
updates its provisional contract atomically. First publication or successful continuation sets a sticky
`identity_locked_at`. Returning to draft does not clear it. Subsequent identity
changes fail, including changing only labels, scoring convention or nullable shots.

Deferred constraint triggers validate final relational equality, contiguous
component positions and Organisation ownership. The Series FK does not cascade
delete editions. Linked editions cannot be detached/reassigned through this Stage.
Archive blocks continuation but leaves existing editions and public Results intact.
Only an empty Series can be deleted.

A partial unique index enforces at most one non-NULL `competition_series_id` per
`league_season_id`. Unlinked one-off Competitions are outside this invariant.
Continuation source reads exclude every edition from the target Season.

## Authorisation and transactions

Active exact `organisation_staff` owners and managers may create Series/editions
and edit drafts. Only owners may edit published Competitions, publish, Return to
Draft, delete Competitions, archive/restore Series, or delete empty Series.
Managers can read contextual draft Seasons, Competitions, Rounds, components and
Series. Existing UI owner gates are intentionally unchanged until Stage 2.

Ordinary users, follows, club owners and club officials grant no authoring powers.
Series tables have RLS and authenticated management reads only; direct client
writes, sequence access and anonymous access are revoked. Private functions are
not executable by clients. Management RPCs use fixed empty search paths and derive
the actor from `auth.uid()`; there is no service-role application client.

Authoring RPCs, including existing typed create/update and lifecycle paths, acquire
the same Organisation transaction advisory lock before taking row locks. Series
rows protect finalisation/archive operations; continuation also locks source/target
Seasons and the source Competition before checking its version. Transactions are
short and contain no network activity. The conservative Organisation lock trades
authoring concurrency for consistent ordering; score entry and Results remain on
their existing paths. PGlite tests verify atomic rollback and invariants, but do not
simulate genuinely concurrent PostgreSQL sessions. Run the two-session checks below
in a disposable staging database before enabling Stage 2.

## RPC contracts

All listed public functions are authenticated-only and independently authorise the
exact context. Mutations return the existing `{id, organisation_slug, season_slug,
competition_slug, status}` navigation object where applicable, plus Series/provenance.

### Create Series and first draft

`create_competition_series(p_organisation_id bigint, p_league_season_id bigint,
p_series_name text, p_configuration jsonb)`

`p_configuration` is a full configuration object with these supported keys:

- `name`, `description`, `entry_format`, `team_size`, `shots_per_round`
- `sets_per_round`, `score_components`
- `entry_fee`, `uses_x_score`, `number_of_rounds`, `local_scoring_enabled`
- `entry_window_mode`, `custom_entry_opens_at`, `custom_entry_closes_at`
- `start_date_mode`, `custom_starts_at`
- `ranking_method`, `best_rounds_count`
- `round_deadlines`, `round_shoot_by_dates`

Components are ordered objects `{short_label, maximum_score, score_method}`.
Dates are ISO dates; schedules are arrays of dates/NULLs, with existing validation.
Unsupported keys (including status, IDs or participation) fail. Omitted structural
defaults: Individual, size 1, one set, ten Rounds, empty components, X off,
Aggregate, local scoring on, Season-default entry/start modes. Name is required.
The existing typed configuration validator is authoritative for fees, dates,
maxima, X/Best N and publication completeness. Legacy clients may submit the two
deprecated discipline keys during a rolling deployment, but they are discarded.

Series, contract components, first draft, its components and supplied Rounds are
one transaction. Failure even after creating the Competition leaves no orphan.

### Edit a draft

`update_competition_series_draft(p_organisation_id bigint, p_league_season_id bigint,
p_competition_id bigint, p_configuration jsonb)`

Accepts the same full configuration payload (not a partial patch) and saves draft
status only. Also works for unlinked drafts. Include all retained configuration
values. It cannot publish or change Series membership. Existing
typed/legacy update RPCs remain supported; managers cannot use them to publish or
edit a published Competition.

### Continue Series

`continue_competition_series(p_organisation_id bigint, p_league_season_id bigint,
p_competition_series_id bigint, p_configuration_source_competition_id bigint,
p_expected_source_version text, p_edition_values jsonb)`

The source must explicitly belong to the selected Series/Organisation. A complete
draft, future or undated edition may be explicitly selected; none is silently
recommended. Series must be active and have valid complete identity.

`p_edition_values` is a partial override limited to the full payload's edition
fields: name, description, fee, modes/custom dates, ranking/Best N, X, scoring
access, Round count and schedule arrays. Identity keys are rejected, even if equal.
The default title may conflict with an existing target-Season title; the caller
must then provide a distinct edition name. Do not silently invent a duplicate.

Only non-date edition settings are inherited. Custom dates become NULL; inherited
dates resolve from the target Season. Omitted schedules create no Round rows.
Fresh explicitly supplied schedules use the existing validator. Switching away
from Best N clears inherited Best-N count; selecting Best N requires valid N and
the existing X restriction still applies. No components or Round IDs are reused.

Never copies entries, entrant/participant rows, divisions, assignments, source
scores/values/usages, Results or Round Robin fixtures. New status is always draft.

`configuration_source_version` is an opaque hash of the source Competition excluding
deprecated discipline metadata, plus ordered components, Rounds and inherited Season
date context. This is stronger than
`updated_at` alone (which can miss child-only changes or same-transaction edits).
Pass the version from the source read RPC; do not calculate it in the client.
A mismatch raises SQLSTATE `40001`: reload and ask the user to review, rather than
blindly retrying with a refreshed version. Provenance survives source configuration
changes; deleting a safely deletable source sets its FK NULL without erasing the
saved version or destination configuration.

### Source chooser read support

`get_competition_series_sources(p_organisation_id bigint, p_league_season_id bigint,
p_competition_series_id bigint, p_target_starts_at date default null)`

Returns explicit management metadata, versions and a recommended source ID. The
cutoff is explicit target start, then target Season start, then today (marked
provisional). Recommend the published edition in a non-draft Season with the latest
effective start strictly preceding that cutoff and not after today. A future
published edition is an explicit override, even when the target starts later.
Tied latest dates produce NULL and
`ambiguous_latest_date=true`. No candidate also produces NULL/selection-required.
IDs only stabilise display ordering; they never resolve a historical ambiguity.
The list includes explicit overrides with their status and date visible. Archived
Series are rejected. Source versions/metadata are not added to anonymous Results.

`src/lib/competition-series.ts` supplies authenticated Series/source loaders for
Stage 2. No public history is added.

### Owner-only Series lifecycle

- `set_competition_series_archived(org_id, series_id, p_archived boolean)` archives
  or restores; repeat calls are safe.
- `delete_empty_competition_series(org_id, series_id)` rejects any remaining edition.

## Scored-edition save repair

The upgraded `update_competition` filters identical components before INSERT, not
only in `ON CONFLICT DO UPDATE`: PostgreSQL BEFORE INSERT guards run even when an
upsert would skip its UPDATE. Actual component changes still reach the existing
score guards and fail. Description/fee/scoring-access edits preserve component IDs,
values and timestamps. Existing protected X/sets/shots changes remain rejected.
Other existing operational editing permissions/guards are retained; this Stage
does not redesign general Results or introduce average semantics.

## Published sporting-configuration lock

The final hardening file adds database triggers shared by one-off, historical and
Series Competitions. While `status = 'published'`, entry format/team size,
sets/shots metadata, derived legacy scoring fields, ranking/Best N, X,
Round count, and all Course-of-Fire component mutations are rejected. Name,
description, fee, scoring access and the existing guarded date/schedule paths remain
available. Returning a participation-free one-off to draft unlocks its sporting
configuration; a finalised Series edition remains subject to its permanent Series
identity triggers even after Return to Draft.

## Verification and Stage 2 checklist

The Add Competition route now presents explicit Continue Series, New Series and
one-off paths. Owners and managers can create and edit drafts. Only owners see
publication/deletion lifecycle actions or Series rename/archive/restore/delete
controls. `database/competition-series-stage-2-management.sql` adds the one narrow
owner-only rename RPC needed by that UI; archive/restore/delete continue to use the
Stage 1 RPCs above.

For local manual testing after `development-demo-seed.sql`, optionally run
`database/development-competition-series-fixture.sql`. It adds only marker-named,
development-only Series/editions and is safe to rerun. It does not alter existing
Aggregate, Gun Score, Round Robin, entry, division, or score fixtures.

Run `npm run test:series`, `npm run test:results`, `npm run lint`, `npx tsc --noEmit`,
`npm run build` and `git diff --check`. The canonical PGlite fixture installs these
upgrades, so canonical Round Robin regressions exercise the new foundation too.

Before Stage 2, use a disposable staging database with actual owner/manager users:

1. Apply the complete two-file upgrade and check installed grants/functions.
2. Compare existing Competition/Round/component/entry/score counts and IDs; verify
   no Series associations or discipline values were invented.
3. Verify contextual manager draft reads and denied publication/deletion/archive.
4. Create, correct, publish and continue a test Series; verify new IDs, fresh dates,
   sticky identity and zero copied participation. Delete only expendable fixtures.
5. Reproduce description-only save on a scored test edition; ensure real format/X
   changes fail and public Aggregate/Gun Score/Round Robin remain unchanged.
6. In two SQL sessions test continuation versus identity correction, publication,
   archive, source update and deletion. One authoring operation should wait; then
   either use the validated current state or reject stale/archived/invalid state.
   Two first-continuation calls must not admit incompatible identities.
7. Verify source recommendation for draft-only history, missing dates, future
   history, cross-Season history and ambiguous same-day candidates.

Series and configuration-source provenance do not select Starting Average inputs.
Organisation average policies can differ, and similar Individual/Team results are
not automatically compatible. No Average Context/Policy or S/Av/R/Av is implemented.
