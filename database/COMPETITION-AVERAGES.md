# Competition Averages Stage 1

Competition Series, Average Context, Average Policy, and Starting Average source are deliberately different concepts:

- Competition Series is recurring-edition identity and configuration continuity.
- Average Context is an explicit Organisation-owned pool of sportingly compatible Competition editions.
- Average Policy is a named Organisation-owned identity whose immutable versions define how S/Av is selected.
- Starting Average is a snapshot owned by one `competition_entrant_participant` in one edition.

Series membership never contributes a score by itself. The authoritative source is the edition row in `competition_average_settings`.

## Average Context

V1 uses exact shooter maximum compatibility. The Competition maximum is:

`sets_per_round * SUM(competition_score_components.maximum_score)`

That value must equal `average_contexts.basis_maximum`. Ex100 and Ex200 are incompatible, and V1 performs no proportional conversion. Names, Series names, deprecated discipline metadata, Course-of-Fire labels, and points-scored/points-dropped display modes do not infer compatibility.

Contexts may be shared by explicit bindings across several Series and one-off Competitions. Series defaults are only copy-on-create conveniences.

## Policy versions

`average_policies` is the mutable named identity. `average_policy_versions` rows are insert-only and immutable. Existing Competition bindings and snapshots retain a version ID.

V1 strategies are:

- `manual`, with exactly `{}` configuration.
- `current_then_preceding`, with exactly `minimum_current_scores`, `minimum_preceding_scores`, and `fallback: "manual"`.

The database rejects unknown keys, missing keys, non-positive/non-integer minima, and fallback values other than `manual`. A future historical strategy can be added under an unambiguous name such as `best_n_of_last_m_history`; it is not implemented here.

## Exact `current_then_preceding` rule

For the target Competition, eligible historical Competitions are published, explicitly bound to the same Context, marked `contributes_to_history = true`, strict-maximum compatible, and earlier than the target.

Chronology uses `private.get_competition_effective_dates`: `custom_starts_at` when `start_date_mode = 'custom'`, otherwise the League Season `starts_at`. History sorts `effective_starts_at DESC, competition.id DESC`; ID is only a deterministic tie-breaker. Undated history cannot precede a target. `configuration_source_competition_id` is never consulted.

1. Inspect the first (latest/current) eligible Competition. If its shooter candidate count reaches `minimum_current_scores`, average all of that Competition's qualifying candidates.
2. Otherwise inspect exactly the second (immediately preceding) eligible Competition. If its count reaches `minimum_preceding_scores`, average all of that Competition's candidates.
3. Otherwise require manual input.

Scores are never combined across the two branches, and the rule never skips a scoreless immediate predecessor to search farther back.

## Qualifying score primitive

`private.shooter_historical_average_candidates` uses the existing source-score architecture. A candidate must:

- link the stable `shooting_score_sources.shooter_profile_id` to the same profile represented by the Competition participant;
- belong to a submitted entry in an explicitly contributing Context-bound published Competition;
- be released under the Results rule: current UTC date is strictly after Round End;
- contain every required set/component slot;
- use the sum of canonical `shooting_score_values.achieved_score`;
- have a shooter maximum exactly equal to the Context basis.

A genuine achieved zero is complete and valid. No usage, no values, or partial values are excluded; released no-score therefore remains NSR rather than zero. Future/unreleased scores are excluded. Aggregate ranking points, Gun Score, Round Robin match points, and entrant totals are never read. Points-dropped input needs no special arithmetic because score entry already persisted canonical achieved values.

The primitive partitions by `shooting_score_source_id`. If future Concurrent Shooting gives one physical source several eligible usages in a Context, it is counted once and credited deterministically to its latest eligible usage. Concurrent Shooting itself is not implemented.

## Starting Average snapshot and lifecycle

`competition_participant_starting_averages` owns one S/Av per exact participant. The same shooter may therefore have different snapshots in different editions or separate participant snapshots in an Individual, Pair, or Team entry.

Calculated rows are provisional and record Context, immutable Policy version, source Competition, count, calculation time, and audit identity. `starting_average_score_sources` records only the exact physical source ID (nullable if later removed), source Competition/Round where retained, canonical achieved total, and maximum captured at calculation. Manual rows store an optional reason and have no calculated score provenance.

Recalculation replaces calculated provisional rows and their provenance. A manual provisional row is retained while the Policy still resolves to manual, but is replaced if sufficient qualifying history later makes an automatic branch valid. Changing authoritative Competition Average settings deletes provisional snapshots; it is rejected once any snapshot is frozen. Frozen rows cannot be changed through the provisional update path. Stage 1 does not decide or integrate the division-publication freeze point.

Historical source corrections are visible on the next provisional calculation. They do not rewrite frozen S/Av or its captured provenance.

## Series defaults

`competition_series_average_defaults` holds an optional Context and Policy version pair. `create_competition_series_with_average_defaults` applies them to the first edition. Existing `continue_competition_series` attaches the Series after creating the draft; a database trigger copies the then-current defaults to a new authoritative Competition binding with `contributes_to_history = true`.

Changing or clearing a Series default never updates existing editions. No participants, prior S/Av values, candidates, provenance, or score usages are copied.

## Security and deferred scope

All public management tables have RLS. Direct anonymous/authenticated writes are revoked. Contextual active Organisation owners and managers use narrow `SECURITY DEFINER` RPCs with `search_path = ''`; `user_organisations` is never used for authorisation. Private derivation functions are not executable by API roles. Starting Average and provenance are management-only and are not added to public Results.

Stage 1 does not persist or publicly expose Running Average. R/Av remains a live derived value for complete released scores in the current Competition and will reuse the same canonical completeness/release/source-deduplication rules in Stage 2. Stage 1 also does not implement Pair/Team aggregate averages, Concurrent Shooting, divisions/results UI, or `ranking_method = best_n_average` standings. Competition Best N standings remain separate from historical Average Policy.

## Existing database deployment order

Run these new files after all existing Competition Series SQL:

1. `database/competition-averages.sql`
2. `database/competition-average-series-defaults.sql`

Both files are additive and rerunnable. No reset or destructive rewrite of deployed migration history is required.
