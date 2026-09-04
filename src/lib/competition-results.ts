import { cache } from "react";
import type {
  CompetitionEntryFormat,
  CompetitionRankingMethod,
  CompetitionScoringMethod,
} from "@/lib/competitions";
import { createClient } from "@/lib/supabase/server";

export type CompetitionResultCompleteness = "complete" | "incomplete";
export type CompetitionResultDisplayMode =
  | CompetitionScoringMethod
  | "mixed";

export type CompetitionResultComponent = {
  position: number;
  short_label: string | null;
  maximum_score: number;
  score_method: CompetitionScoringMethod;
};

export type CompetitionResultValue = {
  set_number: number;
  component_position: number;
  short_label: string | null;
  score_method: CompetitionScoringMethod;
  maximum_possible_score: number;
  is_present: boolean;
  achieved_score: number | null;
  display_score: number | null;
  x_count?: number | null;
};

export type CompetitionParticipantRoundResult = {
  participant_id: number;
  shooter_profile_id: string;
  slot_number: number;
  first_name: string | null;
  last_name: string | null;
  completeness: CompetitionResultCompleteness;
  recorded_slot_count: number;
  expected_slot_count: number;
  achieved_score: number | null;
  maximum_possible_score: number;
  display_score: number | null;
  display_scoring_mode: CompetitionResultDisplayMode;
  x_total?: number | null;
  component_values: CompetitionResultValue[];
};

export type CompetitionResultDivision = {
  id: number;
  name: string;
  position: number;
};

export type CompetitionEntrantRoundResult = {
  entrant_id: number;
  entrant_format: CompetitionEntryFormat;
  entrant_label: string;
  entrant_position: number;
  club_id: number;
  club_name: string;
  division: CompetitionResultDivision | null;
  participant_count: number;
  expected_participant_count: number;
  completeness: CompetitionResultCompleteness;
  achieved_score: number | null;
  maximum_possible_score: number;
  display_score: number | null;
  display_scoring_mode: CompetitionResultDisplayMode;
  x_total?: number | null;
  participants: CompetitionParticipantRoundResult[];
};

export type CompetitionRoundResult = {
  id: number;
  round_number: number;
  deadline: string;
  shoot_by_date: string | null;
  entrants: CompetitionEntrantRoundResult[];
};

export type CompetitionRoundResults = {
  access_scope: "organisation" | "club";
  scoped_club_id: number | null;
  competition: {
    id: number;
    name: string;
    slug: string;
    entry_format: CompetitionEntryFormat;
    team_size: number;
    sets_per_round: number;
    uses_x_score: boolean;
    ranking_method: CompetitionRankingMethod;
    best_rounds_count: number | null;
    display_scoring_mode: CompetitionResultDisplayMode;
    shooter_maximum_possible_score: number;
    expected_score_slots_per_shooter: number;
    divisions_published: boolean;
  };
  components: CompetitionResultComponent[];
  rounds: CompetitionRoundResult[];
};

export const getCompetitionRoundResults = cache(
  async (
    organisationId: number,
    leagueSeasonId: number,
    competitionId: number,
    clubId: number | null,
  ) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "get_competition_round_results",
      {
        p_organisation_id: organisationId,
        p_league_season_id: leagueSeasonId,
        p_competition_id: competitionId,
        p_club_id: clubId,
      },
    );

    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    return data as CompetitionRoundResults;
  },
);
