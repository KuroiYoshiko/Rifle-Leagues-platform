# Automatic Division seeding

Automatic seeding is an additive draft-planning aid for Individual Competitions. It reads the participant Starting Average values returned by the existing `get_competition_division_average_projection` workflow and saves through `save_competition_division_draft_with_average_review`. It does not calculate or freeze Starting Averages, read live Running Averages or results, or bypass the existing publication checks.

## Deterministic algorithm

1. Only submitted Individual entrant units from the authorised management projection are considered.
2. Entrants with a numeric S/Av are sorted descending, so Division 1 is strongest. Equal values are ordered by entrant ID as a stable tie-breaker. A genuine numeric zero remains a seeded value.
3. The Division count retains the existing target-size planning semantics: `ceil(seeded entrant count / target size)`.
4. The seeded field is divided as evenly as possible across that count. Each Division receives `floor(seeded count / Division count)` entrants, and any remainder is assigned one at a time to the earlier Divisions. Sizes therefore differ by at most one.
5. Consecutive slices of the ranked list form the ordered Divisions. There is no round-robin distribution of strong and weak entrants.
6. Entrants whose reviewed S/Av is null stay in the Unseeded / Manual placement area. They are never converted to zero or silently assigned to the last Division.

Examples: 12 seeded entrants at target 4 produce sizes 4/4/4. Thirteen seeded entrants at target 6 retain the existing three-Division planning count and produce sizes 5/4/4 rather than 6/6/1.

Pair and Team automatic seeding is unavailable. Their existing manual Division management remains unchanged; no aggregate group S/Av is introduced.

Regeneration is available only while the allocation is a draft and requires confirmation if numbered Divisions already exist. Saving uses the current reviewed Starting Average fingerprint, so a projection change during review is rejected by the existing stale-review protection. Publication remains the existing atomic validation and Starting Average freeze operation.

## Unresolved sporting rule

The note “6 cards must be shot before adding to a division” is not sufficiently defined. This feature does **not** implement a six-card minimum, a six-current-card minimum, a six-score eligibility rule, or any fallback based on six scores. The sporting authority must clarify the intended edition, score source, eligibility effect, and handling of new shooters before it can be specified or implemented.
