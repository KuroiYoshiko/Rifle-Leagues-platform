import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const CLUB_SCORE_WARNING_DAYS = 7;

export type ClubOperationalStatus =
  | "all_on_track"
  | "action_needed"
  | "deadline_passed"
  | "no_active_scoring";

export type ClubOperationalSummary = {
  club_id: number;
  club_name: string;
  club_slug: string;
  active_member_count: number;
  active_competition_count: number;
  attention_status: ClubOperationalStatus;
  outstanding_score_count: number;
  competition_id: number | null;
  competition_name: string | null;
  competition_slug: string | null;
  organisation_slug: string | null;
  league_season_slug: string | null;
  competition_round_id: number | null;
  round_number: number | null;
  local_cutoff: string | null;
  days_until_cutoff: number | null;
  participant_count: number | null;
  complete_participant_count: number | null;
  incomplete_participant_count: number | null;
};

export const getClubOperationalSummaries = cache(
  async (clubId: number | null = null) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "get_club_operational_summaries",
      {
        p_club_id: clubId,
        p_warning_days: CLUB_SCORE_WARNING_DAYS,
      },
    );

    if (error) {
      throw new Error("Club scoring attention could not be loaded.");
    }

    return (data ?? []) as ClubOperationalSummary[];
  },
);
