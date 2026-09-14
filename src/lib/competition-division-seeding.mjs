const RESOLVED_STARTING_AVERAGE_STATES = new Set([
  "ready",
  "no_average",
  "frozen",
]);

/**
 * Reports whether the current management projection can be used for automatic
 * Division seeding. The database remains authoritative for access control and
 * for accepting the reviewed projection fingerprint when the draft is saved.
 */
export function getDivisionSeedingAvailability({
  entryFormat,
  workflowStatus,
  averageConfigured,
  currentFingerprint,
  entrants,
}) {
  if (workflowStatus !== "draft") {
    return {
      available: false,
      reason: "Published Divisions cannot be regenerated. Return them to draft first.",
    };
  }
  if (entryFormat !== "individual") {
    return {
      available: false,
      reason: "Automatic seeding is available only for Individual Competitions. Pair and Team Divisions remain manual.",
    };
  }
  if (!averageConfigured) {
    return {
      available: false,
      reason: "Set up Starting Averages for this Competition before using automatic seeding.",
    };
  }
  if (!currentFingerprint) {
    return {
      available: false,
      reason: "A current Starting Average review is required before automatic seeding.",
    };
  }
  if (!Array.isArray(entrants) || entrants.length === 0) {
    return {
      available: false,
      reason: "At least one submitted entrant is required before automatic seeding.",
    };
  }
  if (
    entrants.some(
      (entrant) =>
        !RESOLVED_STARTING_AVERAGE_STATES.has(entrant.starting_average_state),
    )
  ) {
    return {
      available: false,
      reason: "Calculate or review every participant Starting Average before automatic seeding.",
    };
  }

  return { available: true, reason: null };
}

/**
 * Keep the existing target-size planning semantics: the number of numbered
 * Divisions is ceil(seeded entrants / target size). Divide the seeded field as
 * evenly as possible across that count, putting at most one extra entrant in
 * each earlier (and therefore stronger) Division.
 */
export function getBalancedDivisionSizes(seededEntrantCount, targetSize) {
  if (
    !Number.isSafeInteger(seededEntrantCount) ||
    seededEntrantCount < 0 ||
    !Number.isSafeInteger(targetSize) ||
    targetSize < 1
  ) {
    throw new TypeError("Seeded entrant count and target size must be valid integers.");
  }
  if (seededEntrantCount === 0) return [];

  const divisionCount = Math.ceil(seededEntrantCount / targetSize);
  const smallerSize = Math.floor(seededEntrantCount / divisionCount);
  const largerDivisionCount = seededEntrantCount % divisionCount;

  return Array.from(
    { length: divisionCount },
    (_, index) => smallerSize + (index < largerDivisionCount ? 1 : 0),
  );
}

export function divisionDraftNeedsRegenerationConfirmation(divisions) {
  return Array.isArray(divisions) && divisions.length > 0;
}

/**
 * Builds a deterministic, contiguous draft. A numeric zero is a real S/Av and
 * remains seeded; only null/undefined values are unseeded. Equal S/Av values
 * use entrant id as the stable tie-breaker.
 */
export function generateIndividualDivisionDraft(entrants, targetSize) {
  const seededEntrants = entrants
    .filter(
      (entrant) =>
        typeof entrant.starting_average === "number" &&
        Number.isFinite(entrant.starting_average),
    )
    .toSorted(
      (left, right) =>
        right.starting_average - left.starting_average || left.id - right.id,
    );
  const unseededEntrantIds = entrants
    .filter(
      (entrant) =>
        entrant.starting_average === null ||
        entrant.starting_average === undefined,
    )
    .map((entrant) => entrant.id)
    .toSorted((left, right) => left - right);
  const sizes = getBalancedDivisionSizes(seededEntrants.length, targetSize);
  let offset = 0;

  const divisions = sizes.map((size, index) => {
    const divisionEntrants = seededEntrants.slice(offset, offset + size);
    offset += size;
    return {
      name: `Division ${index + 1}`,
      entrant_ids: divisionEntrants.map((entrant) => entrant.id),
    };
  });

  return {
    divisions,
    seededEntrantIds: seededEntrants.map((entrant) => entrant.id),
    unseededEntrantIds,
    sizes,
  };
}
