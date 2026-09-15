import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ClubTeam = {
  id: number;
  club_id: number;
  name: string;
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

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  return data as ClubTeams;
});
