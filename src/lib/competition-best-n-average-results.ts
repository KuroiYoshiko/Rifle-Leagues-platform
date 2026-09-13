import { cache } from "react";
import type { CompetitionEntryFormat } from "@/lib/competitions";
import type { CompetitionResultDisplayMode } from "@/lib/competition-results";
import type {
  AggregateParticipant,
  AggregateParticipantRoundCell,
} from "@/lib/competition-aggregate-results";
import { createClient } from "@/lib/supabase/server";

export type BestNAverageParticipant = AggregateParticipant;
export type BestNAverageParticipantRoundCell = AggregateParticipantRoundCell;

export type BestNAverageRoundCell = {
  round_id: number;
  state: "pending" | "scored" | "nsr";
  gun_score: number | null;
  counts_towards_average: boolean;
};

export type BestNAverageEntrant = {
  entrant_id: number;
  entrant_format: CompetitionEntryFormat;
  entrant_label: string;
  club_name: string;
  participants: BestNAverageParticipant[];
  position: number;
  tied: boolean;
  scored_rounds: number;
  nsr_rounds: number;
  counted_rounds: number;
  qualifying_average: number | null;
  rounds: BestNAverageRoundCell[];
};

export type CompetitionBestNAverageResults = {
  status: "awaiting_divisions";
  rounds: [];
  groups: [];
} | {
  status: "ready";
  display_scoring_mode: CompetitionResultDisplayMode;
  uses_x_score: false;
  best_rounds_count: number;
  released_round_count: number;
  rounds: Array<{
    id: number;
    round_number: number;
    deadline: string;
    released: boolean;
  }>;
  groups: Array<{ id: number; name: string; entrants: BestNAverageEntrant[] }>;
};

export const getCompetitionBestNAverageResults = cache(async (
  organisationId: number,
  leagueSeasonId: number,
  competitionId: number,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_competition_best_n_average_results",
    {
      p_organisation_id: organisationId,
      p_league_season_id: leagueSeasonId,
      p_competition_id: competitionId,
    },
  );
  if (error) {
    if (["42501", "P0002"].includes(error.code)) return null;
    throw new Error("Competition results could not be loaded.");
  }
  return data as CompetitionBestNAverageResults | null;
});
