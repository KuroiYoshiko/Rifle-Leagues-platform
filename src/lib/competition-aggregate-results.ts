import { cache } from "react";
import type { CompetitionEntryFormat } from "@/lib/competitions";
import type { CompetitionResultDisplayMode } from "@/lib/competition-results";
import { createClient } from "@/lib/supabase/server";

export type AggregateParticipant = {
  first_name: string | null;
  last_name: string | null;
  slot_number: number;
};

export type AggregateRoundCell = {
  round_id: number;
  state: "pending" | "scored" | "nsr";
  gun_score: number | null;
  ranking_points: number | null;
  x_total?: number | null;
};

export type AggregateEntrant = {
  entrant_id: number;
  entrant_format: CompetitionEntryFormat;
  entrant_label: string;
  club_name: string;
  participants: AggregateParticipant[];
  position: number;
  tied: boolean;
  total_points: number;
  scored_rounds: number;
  achieved_total: number | null;
  maximum_total: number | null;
  gun_total: number | null;
  x_total?: number | null;
  rounds: AggregateRoundCell[];
};

export type CompetitionAggregateResults = {
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
  groups: Array<{ id: number; name: string; entrants: AggregateEntrant[] }>;
};

// Request memoization only. Source corrections and date changes are recalculated
// by PostgreSQL on every request; no persisted or cross-request standings cache.
export const getCompetitionAggregateResults = cache(async (
  organisationId: number,
  leagueSeasonId: number,
  competitionId: number,
) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_competition_aggregate_results", {
    p_organisation_id: organisationId,
    p_league_season_id: leagueSeasonId,
    p_competition_id: competitionId,
  });
  if (error) {
    if (["42501", "P0002"].includes(error.code)) return null;
    throw new Error("Competition results could not be loaded.");
  }
  return data as CompetitionAggregateResults | null;
});
