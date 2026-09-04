import { cache } from "react";
import type { CompetitionScoringMethod } from "@/lib/competitions";
import { createClient } from "@/lib/supabase/server";

export type ScoreEntryAccessScope = "club" | "organisation";

export type IndividualScoreEntryComponent = {
  position: number;
  short_label: string | null;
  maximum_score: number;
  score_method: CompetitionScoringMethod;
};

export type IndividualScoreEntryValue = {
  set_number: number;
  component_position: number;
  entered_score: number | null;
  x_count: number | null;
};

export type IndividualScoreEntryParticipant = {
  participant_id: number;
  entrant_id: number;
  entrant_position: number;
  club_id: number;
  club_name: string;
  first_name: string | null;
  last_name: string | null;
  values: IndividualScoreEntryValue[];
};

export type IndividualCompetitionScoreEntry = {
  access_scope: ScoreEntryAccessScope;
  database_today: string;
  can_edit: boolean;
  competition: {
    id: number;
    name: string;
    entry_format: "individual";
    uses_x_score: boolean;
    sets_per_round: number;
    shots_per_round: number | null;
    local_scoring_enabled: boolean;
    effective_starts_at: string | null;
    started: boolean;
  };
  round: {
    id: number;
    round_number: number;
    deadline: string;
    shoot_by_date: string | null;
    local_cutoff: string;
    local_cutoff_passed: boolean;
  };
  components: IndividualScoreEntryComponent[];
  participants: IndividualScoreEntryParticipant[];
};

export const getIndividualCompetitionScoreEntry = cache(
  async (
    organisationId: number,
    leagueSeasonId: number,
    competitionId: number,
    competitionRoundId: number,
    clubId: number | null,
  ) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "get_individual_competition_score_entry",
      {
        p_organisation_id: organisationId,
        p_league_season_id: leagueSeasonId,
        p_competition_id: competitionId,
        p_competition_round_id: competitionRoundId,
        p_club_id: clubId,
      },
    );

    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    return data as IndividualCompetitionScoreEntry;
  },
);
