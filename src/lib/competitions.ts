import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export const COMPETITION_STATUSES = ["draft", "published"] as const;
export const COMPETITION_ENTRY_FORMATS = [
  "individual",
  "pairs",
  "team",
] as const;
export const COMPETITION_SCORING_METHODS = [
  "points_dropped",
  "points_scored",
] as const;

export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];
export type CompetitionEntryFormat =
  (typeof COMPETITION_ENTRY_FORMATS)[number];
export type CompetitionScoringMethod =
  (typeof COMPETITION_SCORING_METHODS)[number];

export type Competition = {
  id: number;
  league_season_id: number;
  name: string;
  slug: string;
  description: string | null;
  status: CompetitionStatus;
  entry_format: CompetitionEntryFormat;
  team_size: number;
  scoring_method: CompetitionScoringMethod;
  maximum_score_per_round: number | null;
  shots_per_round: number | null;
  uses_x_score: boolean;
  number_of_rounds: number;
  entry_fee: number | null;
  created_at: string;
  updated_at: string;
};

export type CompetitionRound = {
  id: number;
  competition_id: number;
  round_number: number;
  deadline: string;
  created_at: string;
  updated_at: string;
};

const competitionColumns =
  "id, league_season_id, name, slug, description, status, entry_format, team_size, scoring_method, maximum_score_per_round, shots_per_round, uses_x_score, number_of_rounds, entry_fee, created_at, updated_at";
const competitionRoundColumns =
  "id, competition_id, round_number, deadline, created_at, updated_at";
const routeSafeSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const entryFormatLabels: Record<CompetitionEntryFormat, string> = {
  individual: "Individual",
  pairs: "Pairs",
  team: "Team",
};

const scoringMethodLabels: Record<CompetitionScoringMethod, string> = {
  points_dropped: "Points dropped",
  points_scored: "Points scored",
};

const roundDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const getCompetitions = cache(async (leagueSeasonId: number) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competitions")
    .select(competitionColumns)
    .eq("league_season_id", leagueSeasonId)
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error("Competitions could not be loaded.");
  }

  return (data ?? []) as Competition[];
});

export const getCompetitionBySlug = cache(
  async (leagueSeasonId: number, competitionSlug: string) => {
    if (
      competitionSlug.length > 180 ||
      !routeSafeSlugPattern.test(competitionSlug)
    ) {
      return null;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("competitions")
      .select(competitionColumns)
      .eq("league_season_id", leagueSeasonId)
      .eq("slug", competitionSlug)
      .maybeSingle();

    if (error) {
      throw new Error("The competition could not be loaded.");
    }

    return data as Competition | null;
  },
);

export const getCompetitionRounds = cache(async (competitionId: number) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competition_rounds")
    .select(competitionRoundColumns)
    .eq("competition_id", competitionId)
    .order("round_number", { ascending: true });

  if (error) {
    throw new Error("The competition round schedule could not be loaded.");
  }

  return (data ?? []) as CompetitionRound[];
});

export function getCompetitionStatusLabel(status: CompetitionStatus) {
  return status === "draft" ? "Draft" : "Published";
}

export function getCompetitionEntryFormatLabel(
  entryFormat: CompetitionEntryFormat,
) {
  return entryFormatLabels[entryFormat];
}

export function getCompetitionScoringMethodLabel(
  scoringMethod: CompetitionScoringMethod,
) {
  return scoringMethodLabels[scoringMethod];
}

export function formatCompetitionRoundDate(value: string) {
  return roundDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function formatCompetitionEntryFee(value: number | null) {
  if (value === null) return null;

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}
