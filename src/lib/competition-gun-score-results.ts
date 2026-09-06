import { cache } from "react";
import type { CompetitionEntryFormat } from "@/lib/competitions";
import type { CompetitionResultDisplayMode } from "@/lib/competition-results";
import type {
  AggregateParticipant,
  AggregateParticipantRoundCell,
} from "@/lib/competition-aggregate-results";
import { createClient } from "@/lib/supabase/server";

export type GunScoreParticipant = AggregateParticipant;
export type GunScoreParticipantRoundCell = AggregateParticipantRoundCell;

export type GunScoreRoundCell = {
  round_id: number;
  state: "pending" | "scored" | "nsr";
  gun_score: number | null;
  x_total?: number | null;
};

export type GunScoreEntrant = {
  entrant_id: number;
  entrant_format: CompetitionEntryFormat;
  entrant_label: string;
  club_name: string;
  participants: GunScoreParticipant[];
  position: number;
  tied: boolean;
  scored_rounds: number;
  nsr_rounds: number;
  achieved_total: number | null;
  maximum_total: number | null;
  gun_total: number | null;
  x_total?: number | null;
  rounds: GunScoreRoundCell[];
};

export type CompetitionGunScoreResults = {
  status: "awaiting_divisions";
  rounds: [];
  groups: [];
} | {
  status: "ready";
  display_scoring_mode: CompetitionResultDisplayMode;
  uses_x_score: boolean;
  released_round_count: number;
  rounds: Array<{
    id: number;
    round_number: number;
    deadline: string;
    released: boolean;
  }>;
  groups: Array<{ id: number; name: string; entrants: GunScoreEntrant[] }>;
};

// Request memoization only. The RPC derives standings from released source
// scores on every request; no Gun Score totals are persisted.
export const getCompetitionGunScoreResults = cache(async (
  organisationId: number,
  leagueSeasonId: number,
  competitionId: number,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_competition_gun_score_results",
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

  return data as CompetitionGunScoreResults | null;
});
