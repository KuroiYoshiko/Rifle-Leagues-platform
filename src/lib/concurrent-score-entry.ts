import type { CompetitionScoreEntryParticipant } from "@/lib/competition-scores";

export type SharedScoreDraftParticipant = Pick<
  CompetitionScoreEntryParticipant,
  "participant_id" | "source_version" | "shared_metadata"
> & {
  has_recorded_score: boolean;
  values: Array<{ entered_score: string }>;
};

export type SharedParticipantIssue =
  | "ambiguous"
  | "source_conflict"
  | "outside_club_scope"
  | "authority";

export function isSubmittedScoreBlank(
  participant: Pick<SharedScoreDraftParticipant, "values">,
) {
  return participant.values.every(
    (value) => value.entered_score.trim() === "",
  );
}

export function getGlobalClearParticipantIds(
  shared: boolean,
  participants: SharedScoreDraftParticipant[],
) {
  if (!shared) return [];
  return participants
    .filter(
      (participant) =>
        participant.has_recorded_score && isSubmittedScoreBlank(participant),
    )
    .map((participant) => participant.participant_id);
}

export function getSharedParticipantIssue(
  participant: Pick<SharedScoreDraftParticipant, "shared_metadata">,
): SharedParticipantIssue | null {
  const states = participant.shared_metadata.linked_competitions.map(
    (competition) => competition.participant_match,
  );
  if (states.includes("ambiguous")) return "ambiguous";
  if (states.includes("source_conflict")) return "source_conflict";
  if (states.includes("outside_club_scope")) return "outside_club_scope";
  if (!participant.shared_metadata.can_edit_shared) return "authority";
  return null;
}

export function getMissingLinkedCompetitions(
  participant: Pick<SharedScoreDraftParticipant, "shared_metadata">,
) {
  return participant.shared_metadata.linked_competitions.filter(
    (competition) => competition.participant_match === "missing",
  );
}

export function getAffectedLinkedCompetitions(
  participants: SharedScoreDraftParticipant[],
  participantIds?: number[],
) {
  const includedIds = participantIds ? new Set(participantIds) : null;
  const competitions = new Map<
    number,
    SharedScoreDraftParticipant["shared_metadata"]["linked_competitions"][number]
  >();

  for (const participant of participants) {
    if (includedIds && !includedIds.has(participant.participant_id)) continue;
    for (const competition of participant.shared_metadata.linked_competitions) {
      if (competition.participant_match === "matched") {
        competitions.set(competition.competition_id, competition);
      }
    }
  }

  return [...competitions.values()];
}

function linkedCompetitionPhrase(count: number) {
  if (count === 0) return "across its linked Competitions";
  return `across ${count} linked Competition${count === 1 ? "" : "s"}`;
}

export function sharedScoreSuccessMessage({
  participants,
  clearedParticipantIds,
  sharedClearCount,
}: {
  participants: SharedScoreDraftParticipant[];
  clearedParticipantIds: number[];
  sharedClearCount: number;
}) {
  const relevantParticipants = clearedParticipantIds.length > 0
    ? clearedParticipantIds
    : participants
        .filter((participant) => !isSubmittedScoreBlank(participant))
        .map((participant) => participant.participant_id);
  const competitionCount = getAffectedLinkedCompetitions(
    participants,
    relevantParticipants,
  ).length;
  const scope = linkedCompetitionPhrase(competitionCount);

  if (sharedClearCount > 0) {
    return sharedClearCount === 1
      ? `Shared score cleared ${scope}.`
      : `${sharedClearCount} shared scores cleared ${scope}.`;
  }

  const existingCount = participants.filter(
    (participant) =>
      participant.has_recorded_score && !isSubmittedScoreBlank(participant),
  ).length;
  const recordedCount = participants.filter(
    (participant) => !isSubmittedScoreBlank(participant),
  ).length;
  if (existingCount > 0) {
    return recordedCount === 1
      ? `Shared score updated ${scope}.`
      : `Shared scores updated ${scope}.`;
  }
  return recordedCount === 1
    ? `Shared score saved ${scope}.`
    : `Shared scores saved ${scope}.`;
}

export function retainReturnedSourceVersions<
  T extends Pick<SharedScoreDraftParticipant, "participant_id" | "source_version">,
>(participants: T[], sourceVersions: Record<string, number | null>) {
  return participants.map((participant) => {
    const key = String(participant.participant_id);
    return {
      ...participant,
      source_version: Object.prototype.hasOwnProperty.call(sourceVersions, key)
        ? sourceVersions[key]
        : participant.source_version,
    };
  });
}
