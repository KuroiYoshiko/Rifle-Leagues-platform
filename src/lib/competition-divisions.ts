import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  CompetitionDivisionManagement,
  PublishedCompetitionDivisions,
} from "@/lib/competition-division-types";

export * from "@/lib/competition-division-types";

export const getCompetitionDivisionManagement = cache(
  async (
    organisationId: number,
    leagueSeasonId: number,
    competitionId: number,
  ) => {
    const supabase = await createClient();
    const parameters = {
        p_organisation_id: organisationId,
        p_league_season_id: leagueSeasonId,
        p_competition_id: competitionId,
    };
    const [managementResult, averageResult] = await Promise.all([
      supabase.rpc("get_competition_division_management", parameters),
      supabase.rpc("get_competition_division_average_projection", parameters),
    ]);

    if (managementResult.error || averageResult.error || !managementResult.data || !averageResult.data) {
      return null;
    }

    const management = managementResult.data as CompetitionDivisionManagement;
    const projection = averageResult.data as {
      configured?: boolean;
      basis_maximum?: number | string | null;
      current_fingerprint?: string | null;
      review_status?: CompetitionDivisionManagement["average"]["review_status"];
      finalised_at?: string | null;
      entrants?: Array<{
        competition_entrant_id?: number | string;
        starting_average?: number | string | null;
        state?: CompetitionDivisionManagement["entrants"][number]["starting_average_state"];
        participants?: Array<{
          competition_entrant_participant_id?: number | string;
          slot_number?: number | string;
          first_name?: string | null;
          last_name?: string | null;
          starting_average?: number | string | null;
          origin?: "calculated" | "manual" | "no_history" | null;
          status?: "provisional" | "frozen" | null;
          state?: CompetitionDivisionManagement["entrants"][number]["starting_average_state"];
        }>;
      }>;
    };
    const projectedEntrants = new Map(
      (projection.entrants ?? []).map((entrant) => [Number(entrant.competition_entrant_id), entrant]),
    );

    return {
      ...management,
      average: {
        configured: Boolean(projection.configured),
        basis_maximum: projection.basis_maximum === null || projection.basis_maximum === undefined
          ? null
          : Number(projection.basis_maximum),
        current_fingerprint: projection.current_fingerprint ?? null,
        review_status: projection.review_status ?? "not_configured",
        finalised_at: projection.finalised_at ?? null,
      },
      entrants: management.entrants.map((entrant) => {
        const projected = projectedEntrants.get(entrant.id);
        const projectedParticipants = new Map(
          (projected?.participants ?? []).map((participant) => [Number(participant.slot_number), participant]),
        );
        return {
          ...entrant,
          starting_average: projected?.starting_average === null || projected?.starting_average === undefined
            ? null
            : Number(projected.starting_average),
          starting_average_state: projected?.state ?? "not_configured",
          participants: entrant.participants.map((participant) => {
            const participantAverage = projectedParticipants.get(participant.slot_number);
            return {
              ...participant,
              starting_average: participantAverage?.starting_average === null
                || participantAverage?.starting_average === undefined
                ? null
                : Number(participantAverage.starting_average),
              starting_average_origin: participantAverage?.origin ?? null,
              starting_average_status: participantAverage?.status ?? null,
              starting_average_state: participantAverage?.state ?? "not_configured",
            };
          }),
        };
      }),
    };
  },
);

export const getPublishedCompetitionDivisions = cache(
  async (competitionId: number) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "get_published_competition_divisions",
      { p_competition_id: competitionId },
    );

    if (error || !data) return null;
    return data as PublishedCompetitionDivisions;
  },
);
