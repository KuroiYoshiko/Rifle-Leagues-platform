import { generateIndividualDivisionDraft } from "./competition-division-seeding.mjs";

/**
 * Non-authoritative shooter what-if. The canonical automatic Division seeding
 * algorithm remains the only allocator: this helper changes only the current
 * shooter's in-memory seed value and never persists an assignment.
 */
export function getIfSeededTodayDivision({
  entrants,
  ownEntrantId,
  targetSize,
  currentRunningAverage,
}) {
  if (currentRunningAverage === null || currentRunningAverage === undefined) {
    return null;
  }

  const hypotheticalRoster = substituteCurrentShooterSeed(
    entrants,
    ownEntrantId,
    currentRunningAverage,
  );
  const generated = generateIndividualDivisionDraft(hypotheticalRoster, targetSize);
  return generated.divisions.find((division) =>
    division.entrant_ids.includes(ownEntrantId)
  )?.name ?? null;
}

export function substituteCurrentShooterSeed(
  entrants,
  ownEntrantId,
  currentRunningAverage,
) {
  return entrants.map((entrant) => ({
    ...entrant,
    starting_average: entrant.id === ownEntrantId
      ? currentRunningAverage
      : entrant.starting_average,
  }));
}
