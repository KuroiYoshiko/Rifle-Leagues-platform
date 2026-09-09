# Concurrent Shooting — Stage 1 foundation

Concurrent Shooting lets one physical score source be used by more than one
compatible Competition. Stage 1 installs the durable domain, lifecycle,
management RPCs, source association/version fields, and append-only audit table.
It deliberately does not change score entry or Results.

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
to exact Competition Rounds. In the later transactional score stage, one source
will be associated with the physical Round and several Competition usages will
refer to it.

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

`shooting_score_sources.version` starts at 1 and cannot decrease. Stage 2 will
use compare-and-increment updates for optimistic editor concurrency. Stage 1
does not change the existing score-save RPC and therefore does not increment the
version during ordinary saves.

`shooting_score_change_events` is a generic append-only canonical score audit
table. It records source, actor, optional origin Competition/Round, operation
(`create`, `update`, or `clear`), before/after JSON object state, optional reason,
and timestamp. Origin consistency is validated. Update and delete always fail;
normal application roles have no direct table privileges. The later score
transaction will insert the event in the same transaction as values, usages,
and source version changes.

## Release, Results, Series, and averages

Stage 1 does not change release or Results queries. The eventual model remains:
canonical source existence is shared, while each Competition Round independently
controls whether its usage is visible. Public Results stay Competition-specific.

These domains remain deliberately separate:

- Competition Series is historical Competition identity across Seasons.
- Average Context groups the history used to calculate averages.
- Concurrent Shooting groups contemporaneous physical score reuse.

No S/Av or R/Av SQL changes are included. Existing Average Context source-ID
deduplication remains unchanged: later, a shared physical source can contribute
once inside one context and independently once to each different explicitly
configured context.

## Security

All five new tables have RLS enabled and no anonymous or authenticated direct
table privileges. Management uses narrow `SECURITY DEFINER` RPCs with an empty
search path, explicit grants, and `auth.uid()` contextual owner/manager checks.
Private helpers and sequences are not API-executable. No service-role bypass or
public score access change is introduced.

Stage 2 club scoring must authorize the actor across every usage that the shared
transaction would affect. If the actor lacks any affected Competition/club
authority, an Organisation scorer is required.

## Deployment and verification

Deploy the existing migrations through
`database/competition-averages-stage-3.sql`, then run exactly:

1. `database/concurrent-shooting.sql`

The file is additive and rerunnable. It creates no groups and performs no score
linking, source merging, or relationship inference. Run `npm run test:concurrent`
for the focused disposable-PostgreSQL suite.

## Deferred stages

Before exposing Active groups to scorers, the transactional score stage must add:

- cross-Competition source/usage creation from either member Competition;
- authority validation across every affected usage;
- optimistic version comparison and increment;
- audit-event insertion in the same transaction;
- conflicting second-entry prevention and shared edit/correction behavior;
- global clear that clears canonical values everywhere while preserving source,
  usages, and provenance; and
- late-entrant reconciliation against an existing physical source.

Also deferred are the shared-score banner/editor, full management wizard, public
Concurrent pages, Results changes, S/Av and R/Av changes, substitutions,
cross-Organisation/cross-Season groups, partial Course-of-Fire mappings,
many-to-one Round mappings, and historical retroactive linking.

The key Stage 2 release gate is operational: do not surface activation in a UI
until score orchestration understands Active mappings. The Stage 1 database RPC
exists for controlled foundation testing and future UI integration.
