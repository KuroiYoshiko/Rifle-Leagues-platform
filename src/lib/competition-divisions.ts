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
    const { data, error } = await supabase.rpc(
      "get_competition_division_management",
      {
        p_organisation_id: organisationId,
        p_league_season_id: leagueSeasonId,
        p_competition_id: competitionId,
      },
    );

    if (error || !data) return null;
    return data as CompetitionDivisionManagement;
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
