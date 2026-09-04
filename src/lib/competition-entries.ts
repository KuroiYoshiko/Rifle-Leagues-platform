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

export type ClubCompetitionScoreRound = {
  id: number;
  round_number: number;
  deadline: string;
  shoot_by_date: string | null;
};

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
  club_id: number;
  entry_id: number;
  entry_status: ClubCompetitionEntryStatus;
  submitted_at: string | null;
  entry_updated_at: string;
  competition_id: number;
  competition_status: "draft" | "published";
  competition_name: string;
  competition_slug: string;
  entry_format: "individual" | "pairs" | "team";
  team_size: number;
  league_season_name: string;
  league_season_slug: string;
  league_season_starts_at: string | null;
  league_season_ends_at: string | null;
  competition_effective_starts_at: string | null;
  organisation_name: string;
  organisation_slug: string;
  entrant_count: number;
  participant_count: number;
  is_user_entered: boolean;
  can_manage: boolean;
  entry_window_state: CompetitionEntryWindowState;
  local_scoring_enabled: boolean;
  score_rounds: ClubCompetitionScoreRound[];
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
    entry_window_mode: "season_default" | "custom";
    effective_entry_opens_at: string | null;
    effective_entry_closes_at: string | null;
    effective_starts_at: string | null;
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

  const entries = (data ?? []) as Array<
    Omit<
      ClubCompetitionEntryCard,
      | "club_id"
      | "competition_effective_starts_at"
      | "competition_status"
      | "local_scoring_enabled"
      | "score_rounds"
    >
  >;
  const competitionIds = [
    ...new Set(entries.map((entry) => entry.competition_id)),
  ];

  if (competitionIds.length === 0) return [];

  const [competitionResult, roundResult] = await Promise.all([
    supabase
      .from("competitions")
      .select(
        "id, status, local_scoring_enabled, start_date_mode, custom_starts_at",
      )
      .in("id", competitionIds),
    supabase
      .from("competition_rounds")
      .select("id, competition_id, round_number, deadline, shoot_by_date")
      .in("competition_id", competitionIds)
      .order("competition_id", { ascending: true })
      .order("round_number", { ascending: true }),
  ]);

  if (competitionResult.error || roundResult.error) {
    throw new Error("Competition score-entry access could not be loaded.");
  }

  const scoreEntrySettingsByCompetition = new Map(
    (competitionResult.data ?? []).map((competition) => [
      competition.id,
      competition,
    ]),
  );
  const scoreRoundsByCompetition = new Map<
    number,
    ClubCompetitionScoreRound[]
  >();

  for (const round of roundResult.data ?? []) {
    const rounds = scoreRoundsByCompetition.get(round.competition_id);
    const scoreRound = {
      id: round.id,
      round_number: round.round_number,
      deadline: round.deadline,
      shoot_by_date: round.shoot_by_date,
    };

    if (rounds) rounds.push(scoreRound);
    else scoreRoundsByCompetition.set(round.competition_id, [scoreRound]);
  }

  return entries.map((entry) => {
    const settings = scoreEntrySettingsByCompetition.get(entry.competition_id);
    return {
      ...entry,
      club_id: clubId,
      competition_status: settings?.status ?? "draft",
      competition_effective_starts_at:
        settings?.start_date_mode === "custom"
          ? settings.custom_starts_at
          : entry.league_season_starts_at,
      local_scoring_enabled: settings?.local_scoring_enabled ?? false,
      score_rounds: scoreRoundsByCompetition.get(entry.competition_id) ?? [],
    };
  }) satisfies ClubCompetitionEntryCard[];
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
