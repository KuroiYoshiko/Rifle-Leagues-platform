// Retained for internal derived-score diagnostics. Do not mount on product
// Results routes: ordinary readers use CompetitionAggregateResultsTable.
import { Badge, Card } from "@/components/ui";
import type {
  CompetitionEntrantRoundResult,
  CompetitionParticipantRoundResult,
  CompetitionResultDisplayMode,
  CompetitionResultValue,
  CompetitionRoundResult,
  CompetitionRoundResults,
} from "@/lib/competition-results";

const scoreFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 2,
});

const roundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatScore(value: number) {
  return scoreFormatter.format(Number(value));
}

function formatRoundDate(value: string) {
  return roundDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function participantName(
  participant: Pick<
    CompetitionParticipantRoundResult,
    "first_name" | "last_name"
  >,
) {
  return (
    [participant.first_name?.trim(), participant.last_name?.trim()]
      .filter(Boolean)
      .join(" ") || "Shooter"
  );
}

function displayModeLabel(mode: CompetitionResultDisplayMode) {
  if (mode === "points_dropped") return "Points dropped";
  if (mode === "points_scored") return "Points scored";
  return "Mixed scoring methods";
}

function resultPresentation(
  achievedScore: number | null,
  displayScore: number | null,
  displayMode: CompetitionResultDisplayMode,
) {
  if (displayMode === "mixed") {
    return { primaryScore: null, canonicalAchievedScore: achievedScore };
  }

  if (displayMode === "points_dropped") {
    return {
      primaryScore:
        achievedScore === null ? null : Number(achievedScore),
      canonicalAchievedScore:
        displayScore === null ? null : Number(displayScore),
    };
  }

  return {
    primaryScore: achievedScore === null ? null : Number(achievedScore),
    canonicalAchievedScore:
      displayScore === null ? achievedScore : Number(displayScore),
  };
}

function participantBreakdown(participant: CompetitionParticipantRoundResult) {
  const sets = new Map<number, string[]>();

  for (const value of participant.component_values) {
    const setValues = sets.get(value.set_number) ?? [];
    const presentation = resultPresentation(
      value.achieved_score,
      value.display_score,
      value.score_method,
    );
    setValues.push(
      value.is_present && presentation.primaryScore !== null
        ? formatScore(presentation.primaryScore)
        : "—",
    );
    sets.set(value.set_number, setValues);
  }

  return [...sets.entries()]
    .map(([setNumber, values]) => ({
      setNumber,
      value: values.join(" + "),
    }))
    .sort((left, right) => left.setNumber - right.setNumber);
}

function MixedComponentResult({
  value,
  usesX,
}: {
  value: CompetitionResultValue;
  usesX: boolean;
}) {
  const presentation = resultPresentation(
    value.achieved_score,
    value.display_score,
    value.score_method,
  );

  return (
    <div className="rounded-lg bg-surface-muted px-3 py-2 text-left">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Set {value.set_number} ·{" "}
        {value.short_label || `Score ${value.component_position}`}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
        {!value.is_present || presentation.primaryScore === null
          ? "Missing"
          : value.score_method === "points_dropped"
            ? `${formatScore(presentation.primaryScore)} dropped`
            : formatScore(presentation.primaryScore)}
      </p>
      {value.is_present && presentation.canonicalAchievedScore !== null ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatScore(presentation.canonicalAchievedScore)} /{" "}
          {formatScore(value.maximum_possible_score)} achieved
          {usesX && value.x_count !== null && value.x_count !== undefined
            ? ` · X ${formatScore(value.x_count)}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function ResultTotal({
  result,
  usesX,
}: {
  result: Pick<
    CompetitionEntrantRoundResult,
    | "completeness"
    | "achieved_score"
    | "maximum_possible_score"
    | "display_score"
    | "display_scoring_mode"
    | "x_total"
  >;
  usesX: boolean;
}) {
  if (result.completeness === "incomplete") {
    return (
      <div className="text-left sm:text-right">
        <Badge tone="warning">Incomplete</Badge>
        <p className="mt-1 text-xs text-muted-foreground">
          No entrant total calculated
        </p>
      </div>
    );
  }

  const presentation = resultPresentation(
    result.achieved_score,
    result.display_score,
    result.display_scoring_mode,
  );

  return (
    <div className="text-left sm:text-right">
      {presentation.primaryScore !== null ? (
        <p className="text-2xl font-semibold tabular-nums tracking-[-0.03em] text-foreground">
          {formatScore(presentation.primaryScore)}
          {result.display_scoring_mode === "points_dropped" ? (
            <span className="ml-1 text-base tracking-normal">dropped</span>
          ) : null}
        </p>
      ) : (
        <Badge tone="neutral">Mixed Course of Fire</Badge>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {presentation.canonicalAchievedScore === null
          ? "Canonical total unavailable"
          : `${formatScore(presentation.canonicalAchievedScore)} / ${formatScore(result.maximum_possible_score)} achieved`}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-brand-deep sm:justify-end">
        <span>{displayModeLabel(result.display_scoring_mode)}</span>
        {usesX ? (
          <span>
            {result.x_total === null || result.x_total === undefined
              ? "X not recorded"
              : `X ${formatScore(result.x_total)}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ParticipantResult({
  participant,
  usesX,
}: {
  participant: CompetitionParticipantRoundResult;
  usesX: boolean;
}) {
  const breakdown = participantBreakdown(participant);
  const presentation = resultPresentation(
    participant.achieved_score,
    participant.display_score,
    participant.display_scoring_mode,
  );

  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] sm:px-5">
      <div className="min-w-0">
        <p className="font-semibold text-foreground">
          {participantName(participant)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Shooter {participant.slot_number} · {participant.recorded_slot_count}/
          {participant.expected_slot_count} score slots
        </p>
      </div>

      <div className="min-w-0 sm:text-right">
        {participant.display_scoring_mode === "mixed" ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {participant.component_values.map((value) => (
              <MixedComponentResult
                key={`${value.set_number}-${value.component_position}`}
                value={value}
                usesX={usesX}
              />
            ))}
          </div>
        ) : (
          <div>
            {participant.completeness === "incomplete" ? (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 sm:justify-end">
                  {breakdown.map((set) => (
                    <span
                      key={set.setNumber}
                      className="text-sm font-semibold tabular-nums text-foreground"
                    >
                      {breakdown.length > 1 ? `Set ${set.setNumber}: ` : ""}
                      {set.value}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Incomplete
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {presentation.primaryScore === null
                    ? "Display total unavailable"
                    : formatScore(presentation.primaryScore)}
                  {presentation.primaryScore !== null &&
                  participant.display_scoring_mode === "points_dropped" ? (
                    <span className="ml-1 text-sm">dropped</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {presentation.canonicalAchievedScore === null
                    ? "Canonical total unavailable"
                    : `${formatScore(presentation.canonicalAchievedScore)} / ${formatScore(participant.maximum_possible_score)} achieved`}
                  {usesX
                    ? participant.x_total === null ||
                      participant.x_total === undefined
                      ? " · X not recorded"
                      : ` · X ${formatScore(participant.x_total)}`
                    : ""}
                </p>
                {participant.component_values.length > 1 ? (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-deep sm:justify-end">
                    {breakdown.map((set) => (
                      <span key={set.setNumber}>
                        {breakdown.length > 1
                          ? `Set ${set.setNumber}: `
                          : "Components: "}
                        {set.value}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function entrantName(entrant: CompetitionEntrantRoundResult) {
  if (entrant.entrant_format === "individual" && entrant.participants[0]) {
    return participantName(entrant.participants[0]);
  }

  return entrant.entrant_label;
}

function EntrantResult({
  entrant,
  usesX,
}: {
  entrant: CompetitionEntrantRoundResult;
  usesX: boolean;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 border-b border-border bg-surface-muted px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-foreground">
              {entrantName(entrant)}
            </h4>
            {entrant.division ? (
              <Badge tone="neutral">{entrant.division.name}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {entrant.club_name}
            {entrant.entrant_format === "individual"
              ? ""
              : ` · ${entrant.entrant_label}`}
            {entrant.participant_count !== entrant.expected_participant_count
              ? ` · ${entrant.participant_count}/${entrant.expected_participant_count} submitted shooters`
              : ""}
          </p>
        </div>
        <ResultTotal result={entrant} usesX={usesX} />
      </div>

      <div className="divide-y divide-border">
        {entrant.participants.map((participant) => (
          <ParticipantResult
            key={participant.participant_id}
            participant={participant}
            usesX={usesX}
          />
        ))}
      </div>
    </Card>
  );
}

type EntrantGroup = {
  key: string;
  name: string | null;
  entrants: CompetitionEntrantRoundResult[];
};

function entrantGroups(
  round: CompetitionRoundResult,
  divisionsPublished: boolean,
) {
  if (!divisionsPublished) {
    return [{ key: "all", name: null, entrants: round.entrants }];
  }

  const groups = new Map<string, EntrantGroup>();
  for (const entrant of round.entrants) {
    const key = entrant.division ? `division-${entrant.division.id}` : "unassigned";
    const existing = groups.get(key);
    if (existing) {
      existing.entrants.push(entrant);
      continue;
    }
    groups.set(key, {
      key,
      name: entrant.division?.name ?? "Unassigned",
      entrants: [entrant],
    });
  }
  return [...groups.values()];
}

export function CompetitionResultsPreview({
  data,
}: {
  data: CompetitionRoundResults;
}) {
  const hasMixedScoring =
    data.competition.display_scoring_mode === "mixed";

  return (
    <>
      <Card className="p-5 sm:p-6">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-surface-muted p-4">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Read scope
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {data.access_scope === "organisation"
                ? "All submitted entrants"
                : "Submitted club entrants"}
            </dd>
          </div>
          <div className="rounded-xl bg-surface-muted p-4">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Shooter maximum
            </dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
              {formatScore(
                data.competition.shooter_maximum_possible_score,
              )}{" "}
              per Round
            </dd>
          </div>
          <div className="rounded-xl bg-surface-muted p-4">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Required slots
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {data.competition.expected_score_slots_per_shooter} per shooter
            </dd>
          </div>
          <div className="rounded-xl bg-surface-muted p-4">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Display mode
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {displayModeLabel(data.competition.display_scoring_mode)}
            </dd>
          </div>
        </dl>
      </Card>

      {hasMixedScoring ? (
        <div className="mt-5 rounded-2xl border border-warning/20 bg-warning-subtle px-5 py-4 text-sm leading-6 text-warning">
          This Course of Fire mixes points-scored and points-dropped components.
          Canonical achieved totals and component detail are shown, but no
          combined legacy display score is invented.
        </div>
      ) : null}

      <div className="mt-8 space-y-10">
        {data.rounds.map((round) => (
          <section key={round.id} aria-labelledby={`result-round-${round.id}`}>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-brand-strong">
                  Round {round.round_number}
                </p>
                <h2
                  id={`result-round-${round.id}`}
                  className="mt-1 text-xl font-semibold tracking-[-0.025em] text-foreground"
                >
                  R{round.round_number} derived gun results
                </h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Round End {formatRoundDate(round.deadline)}
                {round.shoot_by_date
                  ? ` · Shoot-by ${formatRoundDate(round.shoot_by_date)}`
                  : ""}
              </p>
            </div>

            {round.entrants.length === 0 ? (
              <Card className="p-6">
                <p className="text-sm text-muted-foreground">
                  No submitted entrants are visible in this result scope.
                </p>
              </Card>
            ) : (
              <div className="space-y-7">
                {entrantGroups(
                  round,
                  data.competition.divisions_published,
                ).map((group) => (
                  <div key={group.key}>
                    {group.name ? (
                      <h3 className="mb-3 text-sm font-semibold text-foreground">
                        {group.name}
                      </h3>
                    ) : null}
                    <div className="space-y-4">
                      {group.entrants.map((entrant) => (
                        <EntrantResult
                          key={entrant.entrant_id}
                          entrant={entrant}
                          usesX={data.competition.uses_x_score}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {data.rounds.length === 0 ? (
        <Card className="mt-6 p-6">
          <p className="text-sm text-muted-foreground">
            No Competition Rounds are configured.
          </p>
        </Card>
      ) : null}
    </>
  );
}
