import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ClubTeamUnitType = "pair" | "team";

export type ClubTeamRosterMember = {
  position: number;
  membership_id: number;
  first_name: string | null;
  last_name: string | null;
  membership_status: "pending" | "active" | "rejected" | "left";
};

export type ClubTeam = {
  id: number;
  club_id: number;
  name: string;
  unit_type: ClubTeamUnitType | null;
  fixed_size: number | null;
  is_complete: boolean;
  roster: ClubTeamRosterMember[];
  display_order: number;
  archived_at: string | null;
  competition_usage_count: number;
  submitted_usage_count: number;
  created_at: string;
  updated_at: string;
};

export type ClubTeams = {
  club_id: number;
  can_manage: boolean;
  teams: ClubTeam[];
};

export const getClubTeams = cache(async (
  clubId: number,
  includeArchived = false,
): Promise<ClubTeams | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_club_teams", {
    p_club_id: clubId,
    p_include_archived: includeArchived,
  });

  if (error && process.env.NODE_ENV !== "production") {
    console.error("[club-teams] get_club_teams failed", JSON.stringify({
      code: error.code ?? null,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    }));
  }

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  return data as ClubTeams;
});
