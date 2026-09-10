# Concurrent Shooting — Stages 1, 2, and 3A

Concurrent Shooting lets one physical score source be used by more than one
compatible Competition. Stage 1 installs the durable domain, lifecycle,
management RPCs, source association/version fields, and append-only audit table.
Stage 2 adds atomic canonical shared-score writes, usage propagation, optimistic
editing, immutable audit events, and late-entry reconciliation. Results and
ranking mathematics remain unchanged. Stage 3A adds the Organisation Management
workflow without exposing Concurrent configuration on public pages.

## Mental model

The four concepts have separate responsibilities:

| Concept | Responsibility |
| --- | --- |
| `concurrent_shooting_groups` | Symmetric Organisation/Season configuration and lifecycle |
| `concurrent_shooting_rounds` | One group-local physical shooting occurrence |
| `shooting_score_sources` | One shooter's canonical score for a physical occurrence |
| `competition_score_usages` | A Competition-specific participant/Round use of that source |

A physical Concurrent Round is not a Competition Round and owns no deadline,
release, NSR, standings, or public visibility. Explicit mapping rows connect it
to exact Competition Rounds. One source is associated with the physical Round
and several Competition usages can refer to it.

Pair and Team scores remain participant-owned. There is never a Pair or Team
aggregate source: each shooter has their own source, identified by
`shooter_profile_id`.

## Database model

`concurrent_shooting_groups` is owned by one Organisation and one of that
Organisation's Seasons. Its trimmed name is case-insensitively unique within the
Organisation. Its lifecycle is `draft`, `active`, or `archived`. Draft rows have
no compatibility signature. Active and Archived rows retain the server-derived
V1 signature and activation time.

`concurrent_shooting_group_competitions` is the membership relation. A global
unique constraint on `competition_id` limits a Competition to one Concurrent
group in V1. A validation trigger requires the same Organisation and exact same
Season as the group.

`concurrent_shooting_rounds` contains deterministic group-local `position` and
an optional organiser label. It has no score or release state.

`concurrent_shooting_round_mappings` carries both group and parent identifiers
so composite foreign keys enforce all practical consistency rules:

- the physical Round belongs to the group;
- the Competition is a group member;
- the Competition Round belongs to that Competition;
- a physical Round maps at most one Round from a member Competition; and
- a Competition Round maps to at most one physical Round.

Activation additionally requires at least one physical Round, at least two
distinct member Competitions per physical Round, and at least one mapping for
every member. Round numbers are never inferred. Different Competition Round
counts are valid and unmapped Rounds remain independent.

## V1 compatibility signature

`private.concurrent_shooting_compatibility_signature` derives deterministic
JSONB from authoritative Competition/component rows. Clients cannot provide or
override it. Version 1 contains:

- `sets_per_round`;
- `shots_per_round`, preserving `null`;
- `uses_x_score`;
- component count;
- ordered components containing exact position, exact label (including `null`),
  exact maximum and per-component `score_method`; and
- derived shooter maximum (`sets_per_round × sum(component maximums)`).

JSONB equality is the identity comparison. Competition/Series names, ranking
method, entry format, team size, number of Rounds, deadlines, Competition Series,
and Average Context are not part of it. Consequently, identical Individual,
Pair, and Team Courses of Fire can join one group, while an Ex100 single
component does not match P/S/K components that happen to total Ex100.

Draft membership performs an early compatibility check for useful feedback.
Activation recalculates every signature in one transaction and stores only the
authoritative reference signature. Management detail reads also return each
member's current signature and mismatch field names.

## Lifecycle and permissions

All authorisation uses active contextual `organisation_staff`; the legacy
`user_organisations` relation is never consulted.

| Operation | Owner | Manager |
| --- | --- | --- |
| Create, rename or delete Draft group | Yes | Yes |
| Add/remove Draft members | Yes | Yes |
| Create/edit/delete Draft physical Rounds and mappings | Yes | Yes |
| Read/list management data | Yes | Yes |
| Activate | Yes | No |
| Safely cancel activation | Yes | No |
| Archive | Yes | No |

Activation is atomic. It re-locks and validates the group and all members, then
requires at least two member Competitions, same Organisation and Season,
Published status, future effective start, exact V1 compatibility, complete
mapping invariants, and no score usage in a mapped slot.

Active membership, physical Rounds, mappings, name, activation metadata, and
signature are immutable. Active membership also counts as Competition
participation, preventing Return to Draft and deletion through the established
lifecycle operations. Independent triggers protect signature-bearing sporting
fields and components for Active or Archived groups.

The owner may cancel activation only while every member is still unstarted and
neither mapped usages nor Concurrent-associated sources exist. Safe cancellation
returns the group to Draft and removes its activation signature so preparation
can resume. Archive is a terminal preservation state: configuration remains
immutable and provenance stays addressable.

Draft groups are removable and cascade only their Draft child configuration.
Competition membership itself uses `ON DELETE RESTRICT`, so a Draft membership
must be removed before deleting that Competition. No existing group, mapping, or
source association is inferred or backfilled.

## Source and audit foundation

`shooting_score_sources.concurrent_shooting_round_id` is nullable. Existing and
new ordinary sources keep `null` and behave exactly as before. The partial unique
index on `(concurrent_shooting_round_id, shooter_profile_id)` permits only one
canonical source per shooter/physical occurrence.

`shooting_score_sources.version` starts at 1 and cannot decrease. Shared edits
must supply the version returned by the score-entry read model. Each successful
shared update or clear compares and increments it; stale or missing versions on
an existing shared source fail with SQLSTATE `40001`. Ordinary score writes keep
their established behavior and do not require or increment a version.

`shooting_score_change_events` is a generic append-only canonical score audit
table. It records source, actor, optional origin Competition/Round, operation
(`create`, `update`, or `clear`), before/after JSON object state, optional reason,
and timestamp. Origin consistency is validated. Update and delete always fail;
normal application roles have no direct table privileges. Every shared create,
update, and clear inserts an event in the same transaction as values, usages,
and source version changes. Before/after JSON snapshots contain source version
and ordered canonical achieved-score/X rows, so later changes to live rows do
not alter audit history. Ordinary writes are not audited in Stage 2 because the
legacy ordinary clear deletes an orphan source and the audit foreign key
intentionally preserves audited sources; changing that behavior is outside this
stage.

## Shared score transaction

Only a mapping in an `active` group enables sharing. Unmapped Rounds continue
through the ordinary score path and create sources whose Concurrent Round is
`null`.

For a mapped Round, the save RPC:

1. validates the initiating Competition batch and resolves each participant to
   the stable shooter profile (`club_memberships.user_id`);
2. takes a transaction advisory lock keyed by the physical Concurrent Round,
   then locks the source and usage rows in deterministic ID order;
3. finds or creates the unique `(physical Round, shooter)` source;
4. scans every mapped Competition for submitted participant slots owned by that
   shooter, failing closed if any Competition contains more than one match;
5. validates Competition-start and actor authority for every matched target;
6. rejects any target slot or source provenance that points elsewhere;
7. creates missing usages and mutates the canonical values once; and
8. increments the source version and appends its audit event.

The physical advisory lock serializes saves initiated from different mapped
Competitions. The Stage 1 partial unique index remains the final protection
against duplicate sources; a unique race is surfaced as a refreshable
`40001` conflict rather than silently merging sources.

Late-entry submission necessarily owns its entry row before its trigger can
take the physical lock. Shared save therefore does not pre-lock participant or
entry rows: this avoids an entry-row/physical-lock cycle. A submission that
commits afterwards performs reconciliation under the physical lock and attaches
the existing source; an ambiguous duplicate submission fails atomically.

A missing submitted participant in a linked Competition is not an error and no
usage is created there. Pair and Team entries use their individual participant
rows exactly like Individual entries; no Pair/Team aggregate source exists.

## Authority and clear semantics

Organisation scoring retains the existing contextual active owner/manager
authority. Club owner/official scoring must pass the established checks for
every matched target: same club, local scoring enabled, Competition started,
and Round cutoff still open. One denied linked target aborts the entire
transaction. A club scorer cannot use an editable Competition as a route around
another Competition's restrictions.

All-blank input for a shared source is a global physical-score clear. It deletes
canonical value rows but preserves the source, its Concurrent association, and
all usages; it increments the version and writes a `clear` event. There is no
per-Competition unlink operation. The RPC response reports `shared`,
`globally_cleared`, `shared_clear_count`, linked usage count, and current source
versions so the later UI can give an explicit warning.

## Late-entry reconciliation and read metadata

When an entry transitions to `submitted`, reconciliation locks all mapped
physical Rounds in ascending order. For every stable shooter in the new entry,
it attaches an already-existing shared source to the eligible participant/Round
slot. It never creates a source, changes score values, or rewrites a conflicting
slot. Duplicate shooter appearances and unrelated existing sources fail the
submission transaction. Organisation owners/managers also have a narrow manual
reconciliation RPC for an already-submitted entry.

The authenticated score-entry read model now returns group/physical-Round and
linked Competition summaries, participant match states (`matched`, `missing`,
`ambiguous`, out-of-club, or source conflict), aggregate shared editability,
source version, and last source update timestamp. It remains behind the existing
score-entry authorization boundary and exposes no additional public scores.

## Release, Results, Series, and averages

Stage 2 does not change release or Results queries. Canonical source existence
is shared, while each Competition Round independently controls whether its
usage is visible. Public Results stay Competition-specific, so an unreleased
linked Competition does not reveal a score released by another Competition.
Corrections flow through existing live Results semantics after each usage's own
release boundary.

These domains remain deliberately separate:

- Competition Series is historical Competition identity across Seasons.
- Average Context groups the history used to calculate averages.
- Concurrent Shooting groups contemporaneous physical score reuse.

No S/Av or R/Av SQL changes are included. R/Av sees one usage in each linked
Competition and therefore includes the source once per Competition Round.
Existing Average Context source-ID deduplication means one physical source
contributes once inside one context and independently once to each different
explicitly configured context. Frozen S/Av snapshots and their provenance do
not change when the live shared source is corrected.

## Security

All five new tables have RLS enabled and no anonymous or authenticated direct
table privileges. Management uses narrow `SECURITY DEFINER` RPCs with an empty
search path, explicit grants, and `auth.uid()` contextual owner/manager checks.
Private helpers and sequences are not API-executable. No service-role bypass or
public score access change is introduced.

Shared club scoring authorizes the actor across every usage that the transaction
would affect. If the actor lacks any affected Competition/club authority, an
Organisation scorer is required. Stage 2 helpers and RPCs use an empty search
path, fully qualified relations, explicit execute grants, and `auth.uid()`;
there are no service-role shortcuts.

## Stage 3A Organisation Management workflow

Organisation Management has routed destinations for Overview, Competition
Series, Averages, and Concurrent Shooting. The existing Series list and owner
lifecycle controls live on the Competition Series route; Overview remains
focused on access requests and staff. Managers can still view Series, while
existing owner-only Series mutations are unchanged.

Concurrent Shooting is prepared as a Draft workflow: create the group, select
server-validated candidates, explicitly add physical Rounds and choose each
Competition Round mapping, review independent Rounds and non-blocking format or
schedule differences, then ask an owner to activate. Course-of-Fire mismatch
codes are translated into organiser-facing reasons; the server remains the
authority for candidate eligibility and activation validation. Active and
Archived configurations render read-only. Safe cancellation is displayed only
to owners when the lifecycle read model confirms it remains possible.

The responsive mapping view uses cards instead of a wide table. Equal Round
numbers are not saved automatically, and clearing a selection leaves that
Competition Round independent. A management-only Competition indicator links
members back to the Organisation workflow and does not broaden public access.

`database/concurrent-shooting-stage-3a.sql` adds only four narrow functions:
same-Season candidate diagnostics, lifecycle display metadata, a Competition
membership summary, and an atomic Draft mapping setter. They use the existing
contextual `organisation_staff` authorization, empty search paths, explicit
grants, and server-derived compatibility rules. No table or score behavior is
changed.

## Deployment and verification

Deploy the existing migrations through
`database/competition-averages-stage-3.sql`, then run exactly:

1. `database/concurrent-shooting.sql`
2. `database/concurrent-shooting-stage-2.sql`
3. `database/concurrent-shooting-stage-3a.sql`

All three files are additive and rerunnable. They create no groups, do no
historical backfill or source merge, and infer no relationship. Stage 2 must be
deployed before Active groups are used for score entry; Stage 3A must be
deployed before exposing its management routes. Run `npm run test:concurrent`
for the focused disposable-PostgreSQL and UI suite.

## Deferred stages

Still deferred are the score-entry shared-score banner, global-clear
confirmation, stale-version refresh handling, participant conflict presentation,
audit viewer, and public Concurrent pages. Results, S/Av, and R/Av behavior is
not redesigned. Substitutions, persistent Pair/Team identities,
cross-Organisation/cross-Season groups, partial Course-of-Fire mappings,
many-to-one Round mappings, and historical retroactive linking also remain out
of scope.
