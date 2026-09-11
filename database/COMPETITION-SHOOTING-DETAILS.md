# Competition physical shooting details

`competition-shooting-details.sql` adds the structured physical definition that
the relational Course of Fire previously lacked. It is additive and rerunnable.
It does not infer values from Competition/Series names, component labels, or free
text, and does not reset or rewrite historical data.

## Model

Equipment belongs to the Competition because every component uses the same
equipment category. Built-ins have stable global codes: Smallbore Rifle,
Fullbore Rifle, Lightweight Sporting Rifle, Gallery Rifle, Air Rifle, Pistol,
Air Pistol, and Shotgun. Position and event style are deliberately not equipment.

Organisation-specific equipment is stored in `organisation_equipment_types`.
The server trims and collapses whitespace, preserves the resulting display name,
and uses a lowercase normalized key unique within one Organisation. Consequently,
`Sniper Rifle`, `sniper rifle`, and ` SNIPER   RIFLE ` resolve to one reusable row
inside an Organisation but never merge across Organisations.

Every `competition_score_components` row stores:

- position/style mode (`fixed`, `variable`, or `not_applicable`); Fixed uses a
  stable built-in position code or an Organisation custom position ID;
- distance mode (`fixed`, `variable`, or `not_applicable`); Fixed retains a
  positive `numeric(12,3)` value and the original `metres`, `yards`, or `feet`
  unit; and
- positive integer `shots`, meaning physical shots represented by that component
  in one set.

Built-in positions are Prone, Standing, Kneeling, and Benchrest. Custom positions
use the same normalized, reusable, Organisation-isolated model as custom equipment.
Three-position is represented by three components, not one synthetic position.

For structured version 1, `competitions.shots_per_round` remains for backward
compatibility but is derived in the authoring transaction:

`sets_per_round × SUM(component shots)`

It is not separately editable. A Double Dewar with two sets and 20 + 20 component
shots therefore stores 80. Score maxima, canonical achieved scores, and score-entry
methods are unchanged.

## Drafts, publication, and legacy rows

Updated creation/edit paths set `shooting_details_version = 1`. Drafts may retain
incomplete fields. Publication requires exactly one equipment identity and a
valid explicit position/style state, distance state, and positive shot count for
every component.

Historical rows retain a NULL version and NULL structured fields. They continue
to render, score, and produce Results under the existing behavior. They are never
guessed or silently upgraded. The marker is durable and lets Concurrent Shooting
distinguish unknown legacy physical configuration from a verified match.

Published Competition locks, finalised Series identity locks, and Active/Archived
Concurrent locks include the new sporting fields. Organisation custom lookup reads
use contextual active `organisation_staff` owner/manager authorization; direct
client writes and cross-Organisation access are denied. Server authoring functions
use empty search paths, fully qualified relations, and explicit grants.

## Series and analytics

Series parent rows and ordered Series components mirror the physical fields.
Creating a Series records them; continuing the Series copies them into fresh
Competition/component rows. Ranking and other edition settings remain separate.

The normalized equipment and position identities plus numeric distance value/unit
allow future progress queries by equipment, distance, position, or their
combinations without parsing names. This migration intentionally adds no analytics
tables, cached statistics, charts, or dashboards.

## Deployment

On an installation already deployed through Concurrent Shooting Stage 3A, run:

1. `database/competition-shooting-details.sql`
2. `database/concurrent-shooting-physical-compatibility.sql`

The second migration upgrades new Concurrent activations to compatibility version
2 and compares equipment, scoring shape, ordered component positions, exact
distance value/unit, component shots, X behavior, and derived maxima. Ranking,
entry format, team size, Competition Round count, Series, Average Context, and
explicit Round mapping remain outside physical compatibility.

Verify with `npm run test:shooting-details` and `npm run test:concurrent` before
deploying to production.
