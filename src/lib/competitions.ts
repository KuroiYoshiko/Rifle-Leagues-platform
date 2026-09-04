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
export const COMPETITION_ENTRY_WINDOW_MODES = [
  "season_default",
  "custom",
] as const;
export const COMPETITION_START_DATE_MODES = [
  "season_default",
  "custom",
] as const;
export const COMPETITION_RANKING_METHODS = [
  "aggregate",
  "best_n_average",
  "round_robin",
  "gun_score",
] as const;

export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];
export type CompetitionEntryFormat =
  (typeof COMPETITION_ENTRY_FORMATS)[number];
export type CompetitionScoringMethod =
  (typeof COMPETITION_SCORING_METHODS)[number];
export type CompetitionEntryWindowMode =
  (typeof COMPETITION_ENTRY_WINDOW_MODES)[number];
export type CompetitionStartDateMode =
  (typeof COMPETITION_START_DATE_MODES)[number];
export type CompetitionRankingMethod =
  (typeof COMPETITION_RANKING_METHODS)[number];

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
  entry_window_mode: CompetitionEntryWindowMode;
  custom_entry_opens_at: string | null;
  custom_entry_closes_at: string | null;
  start_date_mode: CompetitionStartDateMode;
  custom_starts_at: string | null;
  sets_per_round: number;
  ranking_method: CompetitionRankingMethod;
  best_rounds_count: number | null;
  local_scoring_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type CompetitionRound = {
  id: number;
  competition_id: number;
  round_number: number;
  deadline: string;
  shoot_by_date: string | null;
  created_at: string;
  updated_at: string;
};

export type CompetitionScoreComponent = {
  id: number;
  competition_id: number;
  position: number;
  short_label: string | null;
  maximum_score: number;
  score_method: CompetitionScoringMethod;
  created_at: string;
  updated_at: string;
};

export type CompetitionEffectiveDates = {
  effective_entry_opens_at: string | null;
  effective_entry_closes_at: string | null;
  effective_starts_at: string | null;
};

export type CompetitionLifecycleState = {
  status: CompetitionStatus;
  has_participation: boolean;
  can_return_to_draft: boolean;
  can_delete: boolean;
};

const competitionColumns =
  "id, league_season_id, name, slug, description, status, entry_format, team_size, scoring_method, maximum_score_per_round, shots_per_round, uses_x_score, number_of_rounds, entry_fee, entry_window_mode, custom_entry_opens_at, custom_entry_closes_at, start_date_mode, custom_starts_at, sets_per_round, ranking_method, best_rounds_count, local_scoring_enabled, created_at, updated_at";
const competitionRoundColumns =
  "id, competition_id, round_number, deadline, shoot_by_date, created_at, updated_at";
const competitionScoreComponentColumns =
  "id, competition_id, position, short_label, maximum_score, score_method, created_at, updated_at";
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

const rankingMethodLabels: Record<CompetitionRankingMethod, string> = {
  aggregate: "Aggregate points",
  best_n_average: "Best N rounds average",
  round_robin: "Round robin",
  gun_score: "Gun score",
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

export const getCompetitionScoreComponents = cache(
  async (competitionId: number) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("competition_score_components")
      .select(competitionScoreComponentColumns)
      .eq("competition_id", competitionId)
      .order("position", { ascending: true });

    if (error) {
      throw new Error("The Competition Course of Fire could not be loaded.");
    }

    return (data ?? []) as CompetitionScoreComponent[];
  },
);

export const getCompetitionLifecycleState = cache(
  async (
    organisationId: number,
    leagueSeasonId: number,
    competitionId: number,
  ) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "get_competition_lifecycle_state",
      {
        p_organisation_id: organisationId,
        p_league_season_id: leagueSeasonId,
        p_competition_id: competitionId,
      },
    );

    if (error) {
      throw new Error("Competition lifecycle actions could not be loaded.");
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Competition lifecycle actions returned an invalid state.");
    }

    const value = data as Record<string, unknown>;
    if (
      !COMPETITION_STATUSES.includes(value.status as CompetitionStatus) ||
      typeof value.has_participation !== "boolean" ||
      typeof value.can_return_to_draft !== "boolean" ||
      typeof value.can_delete !== "boolean"
    ) {
      throw new Error("Competition lifecycle actions returned an invalid state.");
    }

    return value as CompetitionLifecycleState;
  },
);

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

export function getCompetitionRankingMethodLabel(
  rankingMethod: CompetitionRankingMethod,
) {
  return rankingMethodLabels[rankingMethod];
}

export function resolveCompetitionEffectiveDates(
  competition: Pick<
    Competition,
    | "entry_window_mode"
    | "custom_entry_opens_at"
    | "custom_entry_closes_at"
    | "start_date_mode"
    | "custom_starts_at"
  >,
  season: {
    entry_opens_at: string | null;
    entry_closes_at: string | null;
    starts_at: string | null;
  },
): CompetitionEffectiveDates {
  return {
    effective_entry_opens_at:
      competition.entry_window_mode === "custom"
        ? competition.custom_entry_opens_at
        : season.entry_opens_at,
    effective_entry_closes_at:
      competition.entry_window_mode === "custom"
        ? competition.custom_entry_closes_at
        : season.entry_closes_at,
    effective_starts_at:
      competition.start_date_mode === "custom"
        ? competition.custom_starts_at
        : season.starts_at,
  };
}

export function getCompetitionMaximumPerRound(
  setsPerRound: number,
  components: Array<Pick<CompetitionScoreComponent, "maximum_score">>,
) {
  return (
    setsPerRound *
    components.reduce(
      (total, component) => total + Number(component.maximum_score),
      0,
    )
  );
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
