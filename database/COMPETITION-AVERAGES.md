# Competition Averages

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

Recalculation replaces calculated provisional rows and their provenance. A manual provisional row is retained while the Policy still resolves to manual, but is replaced if sufficient qualifying history later makes an automatic branch valid. Changing authoritative Competition Average settings deletes provisional snapshots; it is rejected once any snapshot is frozen. Frozen rows cannot be changed through the provisional update path.

Historical source corrections are visible on the next provisional calculation. They do not rewrite frozen S/Av or its captured provenance.

## Stage 2B division projection and finalisation

Division management continues to use participant-owned S/Av snapshots. It does not create a Pair or Team history entity:

- an Individual entrant projection is its one submitted participant's S/Av;
- a Pair or Team entrant projection is the database-numeric arithmetic mean of every submitted participant's S/Av;
- if any participant value is missing, the entrant projection is null and is marked `manual_required` or `recalculation_required`; zero is never substituted;
- the mean is not persisted and is rounded only for UI display.

The organiser can order cards from highest to lowest projected S/Av inside the existing unassigned/division buckets. This is an assisted review view: it does not invent division capacities, change assignments, or publish. Existing drag/drop and select movement remains authoritative, and recalculation never reshuffles a saved layout.

Each averages-enabled division draft stores an opaque fingerprint of the authoritative Competition binding, submitted participant roster, and exact participant snapshot identity/value/origin/calculation/source state that staff last saved and reviewed. Recalculation, manual input, roster changes, or binding changes make that review stale. The publication RPC rejects a missing or mismatched review rather than publishing against values different from those reviewed in the UI.

The first successful division publication is one transaction. Under the existing Competition division advisory lock it validates the current submitted roster and complete allocation, locks the relevant entry/participant/snapshot rows, requires every submitted participant S/Av, verifies the reviewed fingerprint, changes every provisional snapshot to `frozen`, inserts one immutable `competition_starting_average_finalisations` marker, and publishes the division config. Any failure rolls back both freeze and publication. Competitions without Average setup take the existing publication path and are not blocked.

Returning published divisions to draft changes only the division config. It never updates or removes the finalisation marker and never thaws participant snapshots. A later publication verifies and reuses the same frozen state. Normal calculation, manual input, and Average-binding changes cannot mutate finalised S/Av. There is no V1 override or resnapshot path.

When a Competition will not publish divisions, the staff-only `finalise_competition_starting_averages` RPC provides the explicit freeze point. It is available only while no division config exists, requires a configured complete participant S/Av set, and uses the same atomic private freeze primitive without creating or altering divisions.

## Stage 3 Running Average in Results

Starting Average and Running Average have deliberately separate lifecycles:

- S/Av is the frozen historical snapshot the participant entered this Competition with. It may validly be null, and current-Competition scores never update it.
- R/Av is the live unrounded database-numeric arithmetic mean of that participant's qualifying canonical achieved-score totals in this Competition. It is never persisted, manually entered, frozen, or copied into S/Av.

For participant `p`, with the set `Q(p)` of qualifying score sources, the exact rule is:

`R/Av(p) = SUM(q.achieved_score) / COUNT(Q(p))`

where each `q.achieved_score` is the sum of all canonical `shooting_score_values.achieved_score` slots for one complete participant/Round source. PostgreSQL `avg(numeric)` performs the calculation without UI rounding. The Results UI displays two decimal places; when `Q(p)` is empty the database returns null and the UI displays `R/Av —`, never zero.

A source qualifies only when it belongs to the exact published Competition and submitted participant, is linked to an eligible Competition Round, the current UTC date is strictly after that Round End, and every configured set/component slot is present. Missing usages, blank/missing values, NSR, incomplete/partial Course-of-Fire entry, and unreleased/future Rounds are excluded. Achieved zero is complete and included. The canonical score-source uniqueness rules and the projection's participant/Round/source partition prevent a reused physical source from being counted twice in one result slot.

Points-dropped entry needs no separate Running Average arithmetic: score entry has already converted it to canonical achieved score, so (for example) 4 dropped Ex100 contributes 96, not 4.

`get_competition_result_averages` is a narrow set-based released-results projection used alongside Aggregate, Gun Score, and Round Robin Results. It does not change their position, tie, points, gun-score, match-point, or division mathematics. Individual rows show a compact R/Av under the shooter name. Pair/Team rows show each participant's R/Av in the existing participant breakdown; there is no entrant-level Pair/Team R/Av.

Anonymous and ordinary authenticated readers receive R/Av only, derived from the same released source basis as public Results. An authenticated active Organisation owner/manager additionally receives the already staff-only frozen S/Av in that exact context. The projection does not broaden direct score, snapshot, or provenance table access and cannot expose an entered unreleased score through R/Av.

Because R/Av is derived on every request, a legitimate correction to a released canonical score is reflected immediately. The correction does not mutate frozen S/Av, its provenance, or division finalisation state.

## Series defaults

`competition_series_average_defaults` holds an optional Context and Policy version pair. `create_competition_series_with_average_defaults` applies them to the first edition. Existing `continue_competition_series` attaches the Series after creating the draft; a database trigger copies the then-current defaults to a new authoritative Competition binding with `contributes_to_history = true`.

Changing or clearing a Series default never updates existing editions. No participants, prior S/Av values, candidates, provenance, or score usages are copied.

## Stage 2A/2B management workflow

Organisation owners and managers configure Contexts, Policies, immutable Policy versions, and Series defaults under Organisation Management → Averages. The Competition creation flow optionally binds a new Series and its first edition, or a one-off Competition, to an existing active Context and latest selected Policy version. Continuing a Series shows its inherited default and relies on the Stage 1 copy-on-create trigger.

Each published Competition has a staff-only Starting Averages workspace. It uses `calculate_competition_starting_averages` for the preview/recalculation result and `set_manual_competition_starting_average` for manual fallback. The application does not reproduce candidate, chronology, completeness, or policy logic. Values remain explicitly provisional until first division publication or explicit divisionless finalisation. Afterwards the workspace shows Frozen values and removes recalculation/manual edit controls.

Stage 2A adds two narrow RPCs. `create_competition_with_average_settings` composes the canonical private Competition save and Stage 1 setting RPC in one transaction so an averages-enabled one-off cannot be created without its authoritative binding. `get_competition_starting_average_management` returns only the staff-only participant and provisional S/Av projection needed by the workspace, because Organisation staff must not bypass the existing club-scoped participant RLS policies.

## Security and deferred scope

All public management tables have RLS. Direct anonymous/authenticated writes are revoked. Contextual active Organisation owners and managers use narrow `SECURITY DEFINER` RPCs with `search_path = ''`; `user_organisations` is never used for authorisation. Private derivation functions are not executable by API roles. Starting Average and provenance remain management-only; the Stage 3 Results projection includes S/Av only after the same contextual staff check and only when the snapshot is frozen.

The application does not persist Running Average. Stage 3 also does not implement persistent Pair/Team averages, entrant-level Pair/Team R/Av, Concurrent Shooting, substitutions, promotion/relegation, Results ranking changes, or `ranking_method = best_n_average` standings. Competition Best N standings remain separate from historical Average Policy.

## Existing database deployment order

Run these files after all existing Competition Series SQL:

1. `database/competition-averages.sql`
2. `database/competition-average-series-defaults.sql`
3. `database/competition-averages-stage-2a.sql`
4. `database/competition-averages-stage-2b.sql`
5. `database/competition-averages-optional-null.sql`
6. `database/competition-averages-stage-3.sql`

For a database where Stage 1, Stage 2A, Stage 2B, and the optional-null upgrade are already deployed, run only file 6. All six files are additive and rerunnable. No reset or destructive rewrite of deployed migration history is required.
