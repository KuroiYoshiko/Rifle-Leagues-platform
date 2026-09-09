import { cache } from "react";
import type { CompetitionAggregateResults } from "@/lib/competition-aggregate-results";
import type { CompetitionGunScoreResults } from "@/lib/competition-gun-score-results";
import type { CompetitionRoundRobinResults } from "@/lib/competition-round-robin-results";
import { createClient } from "@/lib/supabase/server";

export type CompetitionParticipantResultAverage = {
  entrant_id: number;
  slot_number: number;
  running_average: number | null;
  starting_average?: number | null;
};

export type CompetitionResultAverages = {
  participants: CompetitionParticipantResultAverage[];
};

type ResultsProjection =
  | CompetitionAggregateResults
  | CompetitionGunScoreResults
  | CompetitionRoundRobinResults;

type ResultAverageRow = {
  entrant_id: number;
  slot_number: number;
  running_average: number | string | null;
  starting_average?: number | string | null;
};

function numericValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export const getCompetitionResultAverages = cache(async (
  organisationId: number,
  leagueSeasonId: number,
  competitionId: number,
): Promise<CompetitionResultAverages | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_competition_result_averages",
    {
      p_organisation_id: organisationId,
      p_league_season_id: leagueSeasonId,
      p_competition_id: competitionId,
    },
  );

  if (error) {
    if (["42501", "P0002"].includes(error.code)) return null;
    throw new Error("Competition result averages could not be loaded.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const rows = Array.isArray((data as { participants?: unknown }).participants)
    ? (data as { participants: ResultAverageRow[] }).participants
    : [];

  return {
    participants: rows.map((row) => ({
      entrant_id: Number(row.entrant_id),
      slot_number: Number(row.slot_number),
      running_average: numericValue(row.running_average),
      ...(Object.hasOwn(row, "starting_average")
        ? { starting_average: numericValue(row.starting_average) }
        : {}),
    })),
  };
});

export function addAveragesToCompetitionResults<T extends ResultsProjection>(
  results: T | null,
  averages: CompetitionResultAverages | null,
): T | null {
  if (!results || results.status !== "ready") return results;

  const byParticipant = new Map(
    (averages?.participants ?? []).map((participant) => [
      `${participant.entrant_id}:${participant.slot_number}`,
      participant,
    ]),
  );

  return {
    ...results,
    groups: results.groups.map((group) => ({
      ...group,
      entrants: group.entrants.map((entrant) => ({
        ...entrant,
        participants: entrant.participants.map((participant) => {
          const average = byParticipant.get(
            `${entrant.entrant_id}:${participant.slot_number}`,
          );
          return {
            ...participant,
            running_average: average?.running_average ?? null,
            ...(average && Object.hasOwn(average, "starting_average")
              ? { starting_average: average.starting_average ?? null }
              : {}),
          };
        }),
      })),
    })),
  } as T;
}
