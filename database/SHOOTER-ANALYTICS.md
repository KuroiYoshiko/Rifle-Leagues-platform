# Shooter performance analytics V1

## Existing authoritative model audit

The feature reads the existing canonical model and adds no score, result,
standing, Series, Season, or Average storage.

| Concern | Authoritative relation/function | Analytics use |
| --- | --- | --- |
| Shooter identity | `profiles.id`; `club_memberships.user_id`; `shooting_score_sources.shooter_profile_id` | The RPC fixes the subject to `auth.uid()`. Participant names and mutable club membership state are not used as physical identity. |
| Competition participation | Submitted `club_competition_entries`, `competition_entrants`, `competition_entrant_participants`, and `competition_score_usages` | A distinct released Competition usage counts as participation. |
| Physical score identity | `shooting_score_sources.id` | One trend point and one physical-score count per source, including Concurrent Shooting. |
| Canonical score values | `shooting_score_values.achieved_score` keyed by source, set, and component position | Values are summed only after the full physical result is complete. `points_dropped` has already been converted to achieved performance by the canonical save path. |
| Course maximum and scoring method | `competitions.sets_per_round`; ordered `competition_score_components.maximum_score` and `.score_method` | Maximum is derived for the selected component scope. Percentage is achieved / maximum × 100. X is never part of it. |
| X values | `competitions.uses_x_score`; `shooting_score_values.x_count` | Preserved as a separate supporting total. |
| Round and release | `competition_rounds.deadline`; released Results convention in `private.derive_competition_round_results` and the public Results RPCs | A usage is released when the UTC database date is strictly after `deadline`. `shoot_by_date` is a local scoring cutoff and is not used as the analytics date. |
| Equipment | `competitions.equipment_type_code` / `organisation_equipment_type_id`; `shooting_equipment_types`; `organisation_equipment_types` | Exact built-in or Organisation custom identity. No Competition-name parsing. |
| Position/style | Component `shooting_position_mode`, built-in `shooting_position_code`, or Organisation custom position ID | Fixed, Variable, Not applicable, and legacy Unspecified states stay distinct. |
| Distance | Component `distance_mode`, `distance_value`, and `distance_unit` | Exact value and original unit for Fixed, plus Variable, Not applicable, and legacy Unspecified. No implicit unit conversion. |
| Competition Series | `competitions.competition_series_id`; `competition_series` | Display metadata only. It is never physical identity or a score compatibility rule. |
| Seasons | `competitions.league_season_id`; `league_seasons` | Exact filter and context. Only Open, Active, or Completed Seasons in Active Organisations qualify. |
| Average Contexts | `average_contexts`; `competition_average_settings`; existing Starting/Running Average functions | Audited but intentionally not read. Score percentage is not a Starting or Running Average and does not change their domains. |
| Concurrent Shooting | `shooting_score_sources`; `competition_score_usages`; optional `concurrent_shooting_round_id` provenance | The source is counted once physically; its separately released Competition usages remain separate context and participation. |

## Query architecture

`public.get_my_shooter_analytics` is a single `STABLE SECURITY DEFINER` RPC with
an empty search path and fully qualified relations. A definer is necessary
because canonical score tables deliberately grant no direct Data API access.
The function has no shooter/owner argument: it derives the shooter from
`auth.uid()`, rejects missing authentication, and filters the source relation by
that identity before aggregation.

The read pipeline is:

1. select only the caller's canonical sources;
2. admit only submitted usages in Published Competitions, public Season states,
   Active Organisations, and released Rounds;
3. require every configured set/component slot to have a canonical value;
4. apply exact structured filters;
5. choose one deterministic display usage per source and aggregate canonical
   values once;
6. return summary metrics, at most 500 chronological chart points, the latest
   20 rows, and released-data-only filter choices.

No materialized view or analytics table is introduced. Existing indexes cover
the access path: `shooting_score_sources_shooter_profile_idx`, the source-leading
unique index on `competition_score_usages`, and the source/set/component unique
index on `shooting_score_values`. V1 therefore adds no speculative index. Query
plans and latency should be observed with production cardinalities before adding
covering indexes or materialization.

## Multi-component behavior

Without a position or distance filter, one point is a complete Round-level
physical score across every component and set. With either component filter,
the point remains deduplicated by physical source but its achieved value and
maximum include only components matching the combined filter. The UI labels
this as a component view. Combined position and distance conditions must match
the same component, so a Standing-at-10-m component plus a Prone-at-50-m
component cannot falsely satisfy Standing at 50 m.

Legacy Competitions with valid score components and maxima remain in the general
trend. Their missing equipment, position, and distance are returned as
Unspecified; no sporting identity is fabricated.

## Date semantics

The schema does not store the actual date on which a shooter fired. V1 plots the
Competition Round end (`competition_rounds.deadline`) and labels it explicitly.
For a shared source with more than one released usage, the earliest released
Round end is the deterministic chart coordinate and all released Competition /
Round contexts are included. An unreleased linked usage is absent from counts,
metadata, filter choices, HTML, and the RPC payload until its own release.

## Deployment

1. Deploy all existing Competition, Results, Series, Averages, structured
   shooting-details, and Concurrent Shooting migrations in their documented
   order.
2. Run `database/shooter-analytics.sql`.
3. Deploy the application containing the `/statistics` route.

The SQL is additive and rerunnable. It creates no new tables and performs no
data backfill.
