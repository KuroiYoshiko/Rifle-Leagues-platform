import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const CLUB_COMPETITION_ENTRY_STATUSES = [
  "draft",
  "submitted",
  "withdrawn",
] as const;

export type ClubCompetitionEntryStatus =
  (typeof CLUB_COMPETITION_ENTRY_STATUSES)[number];
export type CompetitionEntryWindowState = "upcoming" | "open" | "closed";

export type CompetitionClubEntryContext = {
  club_id: number;
  club_name: string;
  club_slug: string;
  club_role: "member" | "official" | "owner";
  entry_id: number | null;
  entry_status: ClubCompetitionEntryStatus | null;
  entrant_count: number;
  participant_count: number;
  is_user_entered: boolean;
  can_manage: boolean;
  entry_window_state: CompetitionEntryWindowState;
  database_today: string;
};

export type ClubCompetitionEntryCard = {
  entry_id: number;
  entry_status: ClubCompetitionEntryStatus;
  submitted_at: string | null;
  entry_updated_at: string;
  competition_id: number;
  competition_name: string;
  competition_slug: string;
  entry_format: "individual" | "pairs" | "team";
  team_size: number;
  league_season_name: string;
  league_season_slug: string;
  league_season_starts_at: string | null;
  league_season_ends_at: string | null;
  organisation_name: string;
  organisation_slug: string;
  entrant_count: number;
  participant_count: number;
  is_user_entered: boolean;
  can_manage: boolean;
  entry_window_state: CompetitionEntryWindowState;
};

export type EntryParticipant = {
  slot_number: number;
  membership_id: number;
  first_name: string | null;
  last_name: string | null;
  membership_status: "pending" | "active" | "rejected" | "left";
};

export type EntryUnit = {
  id: number;
  position: number;
  participants: EntryParticipant[];
};

export type ClubCompetitionEntryManagement = {
  entry: {
    id: number;
    status: ClubCompetitionEntryStatus;
    submitted_at: string | null;
  };
  club: { id: number; name: string; slug: string };
  competition: {
    id: number;
    name: string;
    slug: string;
    entry_format: "individual" | "pairs" | "team";
    team_size: number;
  };
  season: {
    id: number;
    name: string;
    slug: string;
    status: "draft" | "open" | "active" | "completed";
    entry_opens_at: string | null;
    entry_closes_at: string | null;
  };
  organisation: { id: number; name: string; slug: string };
  entry_window_state: CompetitionEntryWindowState;
  database_today: string;
  entrants: EntryUnit[];
};

export type EntryMemberSearchResult = {
  membership_id: number;
  first_name: string | null;
  last_name: string | null;
  club_role: "member" | "official" | "owner";
};

export function getEntryMemberName(
  member: Pick<EntryMemberSearchResult, "first_name" | "last_name">,
) {
  return (
    [member.first_name?.trim(), member.last_name?.trim()]
      .filter(Boolean)
      .join(" ") || "Club member"
  );
}

export function getClubCompetitionEntryStatusLabel(
  status: ClubCompetitionEntryStatus,
) {
  return status[0].toUpperCase() + status.slice(1);
}

export const getCompetitionClubEntryContext = cache(
  async (competitionId: number) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "get_competition_club_entry_context",
      { p_competition_id: competitionId },
    );

    if (error) {
      throw new Error("Club competition entry context could not be loaded.");
    }

    return (data ?? []) as CompetitionClubEntryContext[];
  },
);

export const getClubCompetitionEntries = cache(async (clubId: number) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_club_competition_entries", {
    p_club_id: clubId,
  });

  if (error) {
    throw new Error("Club competition entries could not be loaded.");
  }

  return (data ?? []) as ClubCompetitionEntryCard[];
});

export const getClubCompetitionEntryManagement = cache(
  async (entryId: number) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "get_club_competition_entry_management",
      { p_club_competition_entry_id: entryId },
    );

    if (error || !data) return null;
    return data as ClubCompetitionEntryManagement;
  },
);

export async function searchClubCompetitionEntryMembers(
  entryId: number,
  query = "",
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "search_club_competition_entry_members",
    {
      p_club_competition_entry_id: entryId,
      p_query: query,
      p_limit: 30,
    },
  );

  if (error) {
    throw new Error("Eligible club members could not be loaded.");
  }

  return (data ?? []) as EntryMemberSearchResult[];
}
