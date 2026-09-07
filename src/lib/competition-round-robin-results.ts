import { cache } from "react";
import type { CompetitionGunScoreResults, GunScoreEntrant, GunScoreRoundCell } from "@/lib/competition-gun-score-results";
import { createClient } from "@/lib/supabase/server";

export type RoundRobinCell = GunScoreRoundCell & {
  opponent_id: number | null;
  match_number: number;
  outcome: "pending" | "win" | "draw" | "loss" | "bye" | "bye_nsr" | "unresolved";
  match_points: number | null;
};
export type RoundRobinEntrant = Omit<GunScoreEntrant, "rounds"> & {
  total_match_points: number;
  unresolved_matches: number;
  rounds: RoundRobinCell[];
};
export type CompetitionRoundRobinResults = Extract<CompetitionGunScoreResults, {status: "awaiting_divisions"}> |
  (Omit<Extract<CompetitionGunScoreResults, {status: "ready"}>, "groups"> & {
    groups: Array<{id: number; name: string; entrants: RoundRobinEntrant[]}>;
  });

export const getCompetitionRoundRobinResults = cache(async (
  organisationId: number, leagueSeasonId: number, competitionId: number,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_competition_round_robin_results", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    p_competition_id: competitionId,
  });
  if (error) {
    if (["42501", "P0002"].includes(error.code)) return null;
    throw new Error("Competition results could not be loaded.");
  }
  return data as CompetitionRoundRobinResults | null;
});
