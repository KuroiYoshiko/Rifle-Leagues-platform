export type CompetitionDivisionStatus = "draft" | "published";

export type DivisionParticipant = {
  first_name: string | null;
  last_name: string | null;
  slot_number: number;
  starting_average?: number | null;
  starting_average_origin?: "calculated" | "manual" | null;
  starting_average_status?: "provisional" | "frozen" | null;
  starting_average_state?: DivisionStartingAverageState;
};

export type DivisionStartingAverageState =
  | "not_configured"
  | "ready"
  | "manual_required"
  | "recalculation_required"
  | "frozen";

export type DivisionEntrant = {
  id: number;
  club_id: number;
  club_name: string;
  entry_position: number;
  participants: DivisionParticipant[];
  starting_average: number | null;
  starting_average_state: DivisionStartingAverageState;
};

export type DivisionAverageReviewStatus =
  | "not_configured"
  | "unreviewed"
  | "current"
  | "stale"
  | "finalised";

export type CompetitionDivisionAverageState = {
  configured: boolean;
  basis_maximum: number | null;
  current_fingerprint: string | null;
  review_status: DivisionAverageReviewStatus;
  finalised_at: string | null;
};

export type CompetitionDivision = {
  id: number;
  name: string;
  position: number;
  entrant_ids: number[];
};

export type CompetitionDivisionManagement = {
  competition_id: number;
  entry_format: "individual" | "pairs" | "team";
  team_size: number;
  database_today: string;
  entry_closes_at: string | null;
  effective_entry_closes_at: string | null;
  entry_window_closed: boolean;
  entrant_count: number;
  club_count: number;
  config: {
    target_size: number;
    status: CompetitionDivisionStatus;
    published_at: string | null;
    updated_at: string;
  } | null;
  average: CompetitionDivisionAverageState;
  entrants: DivisionEntrant[];
  divisions: CompetitionDivision[];
};

export type PublishedDivisionEntrant = {
  id: number;
  club_name: string;
  is_current_user: boolean;
  participants: DivisionParticipant[];
};

export type PublishedCompetitionDivision = {
  id: number;
  name: string;
  position: number;
  entrants: PublishedDivisionEntrant[];
};

export type PublishedCompetitionDivisions = {
  status: "published";
  divisions: PublishedCompetitionDivision[];
};

export function getDivisionParticipantName(
  participant: Pick<DivisionParticipant, "first_name" | "last_name">,
) {
  return (
    [participant.first_name?.trim(), participant.last_name?.trim()]
      .filter(Boolean)
      .join(" ") || "Club member"
  );
}

export function getDivisionEntrantName(
  entrant: Pick<DivisionEntrant, "participants">,
) {
  return entrant.participants.map(getDivisionParticipantName).join(" · ");
}
